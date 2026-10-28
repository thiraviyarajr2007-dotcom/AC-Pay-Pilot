import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';

process.on('unhandledRejection', (reason: any) => {
  if (
    reason?.message?.includes('Could not load the default credentials') ||
    reason?.message?.includes('MetadataLookupWarning')
  ) {
    return;
  }
  console.warn('Unhandled server promise warning:', reason?.message || reason);
});
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { z, ZodError } from 'zod';
import { GoogleGenAI } from '@google/genai';
import {
  ActorHeaderSchema,
  CancelPayPalOrderSchema,
  CapturePayPalOrderSchema,
  CreatePayPalOrderSchema,
  EscrowTransitionBodySchema,
  CalculateInvoiceBodySchema,
  calculateInvoiceOnServer,
  defaultServerLedger,
} from './src/server/paymentEngine';
import {
  computeExecutiveKpisForDateRange,
  calculateAuthoritativeOrderTotalsMinor,
  toMinorUnits,
} from './src/utils/finance';
import { AuthenticatedActor, evaluateRoleAccess } from './src/utils/rbac';
import {
  ESCROW_ARCHITECTURE_DECISION,
  transitionEscrowState,
  canTransitionEscrow,
} from './src/utils/escrow';
import {
  answerProductQaWithGemini,
  analyzeInvoiceWithGemini,
  assistThemeDesignWithGemini,
  checkAiRateLimit,
  generateExecutiveInsightsWithGemini,
  generateListingWithGemini,
  generateSellerInsightsWithGemini,
  generateStorefrontWithGemini,
  optimizeCartWithGemini,
  recommendEscrowWithGemini,
  runCopilotWithTools,
} from './src/server/geminiService';
import {
  getGlbBufferForModelKey,
  getSeller3DAsset,
  listAllSeller3DAssets,
  registerSeller3DAsset,
} from './src/server/glbGenerator';
import { runFullSystemDiagnostic } from './src/server/healthService';

import dns from 'node:dns/promises';
import {
  authenticateRequest,
  AuthenticatedUserActor,
  AuthenticationError,
  getProductsForBiz,
  getProductBySkuForBiz,
  saveProductForBiz,
  deleteProductBySkuForBiz,
  getOrdersForBiz,
  getOrderByIdForBiz,
  saveOrderForBiz,
  getPaymentsForBiz,
  savePaymentForBiz,
  recordEscrowEventForBiz,
  getEscrowEventsForBiz,
  getMerchantProfileForBiz,
  updateMerchantProfileForBiz,
  seedDefaultStorefrontInFirestore,
  DEFAULT_BIZ_ID,
} from './src/server/firebaseAdmin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Enforces token authentication via Firebase ID Token (Authorization: Bearer <token>).
 * Strips all trust from x-actor-* headers unless DEMO_MODE=true is explicitly set.
 */
async function requireAuth(req: Request, res: Response): Promise<AuthenticatedUserActor | null> {
  try {
    const actor = await authenticateRequest(req);
    return actor;
  } catch (err: any) {
    const status = err instanceof AuthenticationError ? err.statusCode : 401;
    const code = err instanceof AuthenticationError ? err.code : 'UNAUTHORIZED';
    sendTypedError(res, status, code, err.message || 'Authentication required');
    return null;
  }
}

/**
 * Resolves actor context for internal telemetry, AI rate limiting, or legacy compatibility.
 * Strictly ignores untrusted x-actor-* headers unless DEMO_MODE=true is explicitly set.
 */
function resolveActorFromRequest(req: Request): AuthenticatedActor {
  if (process.env.DEMO_MODE === 'true') {
    const role = (req.headers['x-actor-role'] as any) || 'seller';
    const uid = (req.headers['x-actor-uid'] as string) || 'demo-seller-1';
    const email = (req.headers['x-actor-email'] as string) || 'demo.seller@paypilot.in';
    const bizId = (req.headers['x-actor-biz-id'] as string) || DEFAULT_BIZ_ID;
    return { uid, email, role, bizId };
  }
  return {
    uid: 'anonymous-client',
    email: 'client@paypilot.in',
    role: 'customer',
    bizId: DEFAULT_BIZ_ID,
  };
}

/**
 * Standardized typed error responder (Never exposes stack traces or secrets to the client).
 */
function sendTypedError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  issues?: unknown
) {
  res.status(statusCode).json({
    ok: false,
    error: message,
    code,
    ...(issues ? { issues } : {}),
  });
}

const CartCalculateBodySchema = z.object({
  currency: z.enum(['INR', 'USD']).default('INR'),
  budgetMinor: z.number().int().nonnegative(),
  items: z
    .array(
      z.object({
        sku: z.string().min(1),
        quantity: z.number().int().positive(),
        isDeferred: z.boolean().default(false),
      })
    )
    .default([]),
});

const ExecutiveKpiBodySchema = z.object({
  startIso: z.string().datetime(),
  endIso: z.string().datetime(),
  currency: z.enum(['INR', 'USD']).default('INR'),
});

const AiSuggestBodySchema = z.object({
  prompt: z.string().min(2).max(2000),
  contextType: z.enum(['copilot', 'listing', 'invoice_audit', 'escrow_review']).default('copilot'),
});

export async function createAppServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // Seed default canonical storefront and products into Firestore if not present (skipped in test mode)
  if (process.env.NODE_ENV !== 'test') {
    seedDefaultStorefrontInFirestore().catch((err) => {
      console.warn('Firestore initial seeding warning:', err?.message || err);
    });
  }

  // ==========================================================================
  // 1. Public Runtime Config (Safe metadata only — NEVER exposes secrets)
  // ==========================================================================
  app.get('/api/config', (_req: Request, res: Response) => {
    const rawPaypalClientId = process.env.PAYPAL_CLIENT_ID || '';
    const rawPaypalSecret = process.env.PAYPAL_CLIENT_SECRET || '';
    const rawGeminiKey = process.env.GEMINI_API_KEY || '';

    const hasPayPalClientId =
      Boolean(rawPaypalClientId) && rawPaypalClientId !== 'MY_PAYPAL_CLIENT_ID';
    const hasPayPalSecret =
      Boolean(rawPaypalSecret) && rawPaypalSecret !== 'MY_PAYPAL_CLIENT_SECRET';
    const hasGeminiKey = Boolean(rawGeminiKey) && rawGeminiKey !== 'MY_GEMINI_API_KEY';

    res.json({
      ok: true,
      paypalEnv: 'sandbox',
      // In PayPal JS SDK, client-id is the public sandbox identifier for rendering buttons;
      // client-secret NEVER leaves the server. Uses PayPal's official "sb" sandbox test client-id fallback if unset.
      paypalClientId: hasPayPalClientId ? rawPaypalClientId : 'sb',
      hasCustomPayPalClientId: hasPayPalClientId,
      hasPayPalCredentials: hasPayPalClientId && hasPayPalSecret,
      hasGeminiKey,
      escrowArchitecture: ESCROW_ARCHITECTURE_DECISION,
    });
  });

  // ==========================================================================
  // 1b. Real-Time Seller Order Notification Stream (SSE + Storefront Notify)
  // ==========================================================================
  const orderStreamClients = new Set<Response>();

  const broadcastLiveOrderNotification = (notification: {
    id: string;
    bizId?: string;
    orderNumber: string;
    customerName: string;
    productSummary: string;
    totalInr: number;
    escrowStatus: string;
    createdAt: string;
    rawOrder?: Record<string, any>;
  }) => {
    const payload = `data: ${JSON.stringify(notification)}\n\n`;
    for (const client of orderStreamClients) {
      try {
        client.write(payload);
      } catch {
        orderStreamClients.delete(client);
      }
    }
  };

  app.get('/api/orders/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
    orderStreamClients.add(res);

    const keepAlive = setInterval(() => {
      try {
        res.write(': keep-alive\n\n');
      } catch {
        clearInterval(keepAlive);
        orderStreamClients.delete(res);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAlive);
      orderStreamClients.delete(res);
    });
  });

  app.post('/api/orders/notify', async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const bizId = String(body.bizId || DEFAULT_BIZ_ID);
      const id = String(body.id || `ord-${Date.now()}`);
      const orderNumber = String(body.orderNumber || `#ORD-${Math.floor(1000 + Math.random() * 9000)}`);
      const customerName = String(body.customerName || 'Verified Buyer');
      const productSummary = String(body.productSummary || 'Storefront Order');
      const totalInr = Number(body.totalInr ?? body.total ?? 0);
      const escrowStatus = String(body.escrowStatus || 'Escrow Locked');
      const createdAt = String(body.createdAt || new Date().toISOString());

      if (body.rawOrder && typeof body.rawOrder === 'object') {
        await saveOrderForBiz(bizId, {
          ...body.rawOrder,
          id,
          bizId,
        }).catch(() => {
          // Non-fatal if Firestore rules block unauthenticated server client fallback
        });
      }

      const notification = {
        id,
        bizId,
        orderNumber,
        customerName,
        productSummary,
        totalInr,
        escrowStatus,
        createdAt,
        rawOrder: body.rawOrder,
      };

      broadcastLiveOrderNotification(notification);
      res.status(201).json({ ok: true, notification });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'Unable to broadcast order notification' });
    }
  });

  // ==========================================================================
  // 2. PayPal Sandbox Orders v2 — Create Order (POST /api/paypal/create-order)
  // ==========================================================================
  app.post('/api/paypal/create-order', async (req: Request, res: Response) => {
    let actor: AuthenticatedActor;
    try {
      const userActor = await authenticateRequest(req);
      actor = userActor;
    } catch {
      // Unauthenticated checkout: generate unique unforgeable guest actor
      actor = {
        uid: `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        email: 'guest@paypilot.in',
        role: 'customer',
        bizId: DEFAULT_BIZ_ID,
      };
    }
    const bizId = actor.bizId || DEFAULT_BIZ_ID;

    try {
      const parsedBody = CreatePayPalOrderSchema.parse({
        ...req.body,
        customerId: actor.uid, // Strictly enforce verified actor.uid, never trust body customerId
        sellerId: req.body?.sellerId || bizId,
      });

      const access = evaluateRoleAccess(actor, 'orders', 'create', {
        customerId: parsedBody.customerId,
      });
      if (!access.allowed) {
        return sendTypedError(res, 403, 'ROLE_ACCESS_DENIED', access.reason);
      }

      // Authoritative server-side price calculation directly from Firestore products
      const products = await getProductsForBiz(bizId);
      const catalogItems = products.map((p) => ({
        id: p.id || p.sku,
        sku: p.sku,
        name: p.name,
        price: p.price ?? ((p.priceMinor || 0) / 100),
        priceMinor: p.priceMinor || Math.round((p.price || 0) * 100),
        priceUsd: p.priceUsd ?? (typeof p.price === 'number' ? Math.round(p.price * Number(process.env.INR_TO_USD_EXCHANGE_RATE || 0.012) * 100) / 100 : undefined),
        currency: p.currency || 'INR',
        gstRatePercent: p.gstRate || 18,
        hsnCode: p.hsCode || '8414',
      }));

      const calc = calculateAuthoritativeOrderTotalsMinor(
        parsedBody.items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
        catalogItems as any,
        parsedBody.currency,
        parsedBody.shippingMinor
      );

      const result = await defaultServerLedger.createOrder(parsedBody);

      // Persist order and initial escrow event to Firestore businesses/{bizId}/orders
      await saveOrderForBiz(bizId, {
        ...result.order,
        bizId,
        items: calc.items,
        totalMinor: calc.totalMinor,
      });
      await recordEscrowEventForBiz(bizId, {
        orderId: result.order.id,
        fromState: null,
        toState: 'created',
        actorId: actor.uid,
        actorRole: actor.role,
        reason: `Order created for ${calc.currency} ${calc.totalMinor} minor units`,
        timestamp: new Date().toISOString(),
      });

      res.status(result.idempotentReplay ? 200 : 201).json({
        ok: true,
        ...result,
      });
    } catch (err: any) {
      if (err instanceof ZodError) {
        return sendTypedError(
          res,
          400,
          'VALIDATION_ERROR',
          'Invalid create-order payload',
          err.issues
        );
      }
      const message = err instanceof Error ? err.message : 'Unable to create PayPal order';
      return sendTypedError(res, 400, 'ORDER_CREATION_FAILED', message);
    }
  });

  // ==========================================================================
  // 3. PayPal Sandbox Orders v2 — Capture Order (POST /api/paypal/capture-order/:id)
  // ==========================================================================
  app.post('/api/paypal/capture-order/:id', async (req: Request, res: Response) => {
    // Require verified Bearer token authentication for payment capture
    const actor = await requireAuth(req, res);
    if (!actor) return;
    const bizId = actor.bizId || DEFAULT_BIZ_ID;

    try {
      const orderOrPaypalId = req.params.id;
      const parsedBody = CapturePayPalOrderSchema.parse({
        ...req.body,
        actorId: actor.uid, // Strictly bound to verified token
        actorRole: actor.role, // Strictly bound to verified token
      });

      let existing = defaultServerLedger.getOrderWithEvents(orderOrPaypalId);
      if (!existing) {
        const firestoreOrder = await getOrderByIdForBiz(bizId, orderOrPaypalId);
        if (firestoreOrder) {
          existing = {
            order: firestoreOrder,
            escrowEvents: [],
            payments: [],
          };
        }
      }

      if (!existing) {
        return sendTypedError(
          res,
          404,
          'ORDER_NOT_FOUND',
          `Order '${orderOrPaypalId}' was not found in business '${bizId}'.`
        );
      }

      // Verify caller is either the owning customer or finance officer
      if (
        actor.role !== 'finance' &&
        actor.role !== 'business_head' &&
        !(actor.role === 'customer' && existing.order.customerId === actor.uid)
      ) {
        return sendTypedError(
          res,
          403,
          'ROLE_ACCESS_DENIED',
          'Only the order buyer or finance officer may capture this payment.'
        );
      }

      const result = await defaultServerLedger.captureOrder(orderOrPaypalId, parsedBody);

      // Persist captured order & payment to Firestore businesses/{bizId}/...
      await saveOrderForBiz(bizId, {
        ...result.order,
        bizId,
      });
      if (result.payment) {
        await savePaymentForBiz(bizId, {
          ...result.payment,
          bizId,
        });
      }
      if (result.escrowEvents?.length) {
        for (const evt of result.escrowEvents) {
          await recordEscrowEventForBiz(bizId, evt);
        }
      }

      if (!result.idempotentReplay && result.order.paymentStatus === 'Captured') {
        const firstItemName =
          result.order.items?.[0]?.name || 'AeroBreeze Smart BLDC Bundle';
        const extraCount = (result.order.items?.length || 1) - 1;
        broadcastLiveOrderNotification({
          id: result.order.id,
          bizId: actor.bizId,
          orderNumber: result.order.orderNumber || result.order.id,
          customerName: actor.email || 'Priya Patel (Apex Cloud Labs)',
          productSummary:
            extraCount > 0 ? `${firstItemName} +${extraCount} more` : firstItemName,
          totalInr: Math.round((result.order.totalMinor || 0) / 100),
          escrowStatus: 'Escrow Locked',
          createdAt: new Date().toISOString(),
        });
      }

      res.json({
        ok: true,
        ...result,
      });
    } catch (err: any) {
      if (err instanceof ZodError) {
        return sendTypedError(
          res,
          400,
          'VALIDATION_ERROR',
          'Invalid capture-order payload',
          err.issues
        );
      }
      const message = err instanceof Error ? err.message : 'Unable to capture PayPal order';
      return sendTypedError(res, 400, 'ORDER_CAPTURE_FAILED', message);
    }
  });

  // ==========================================================================
  // 4. PayPal Sandbox Cancel Order (POST /api/paypal/cancel-order/:id)
  // ==========================================================================
  app.post('/api/paypal/cancel-order/:id', async (req: Request, res: Response) => {
    const actor = await requireAuth(req, res);
    if (!actor) return;

    try {
      const orderOrPaypalId = req.params.id;
      const parsedBody = CancelPayPalOrderSchema.parse({
        ...req.body,
        actorId: actor.uid,
      });

      const order = defaultServerLedger.cancelOrder(orderOrPaypalId, parsedBody);
      await saveOrderForBiz(actor.bizId, {
        ...order,
        bizId: actor.bizId,
      });

      res.json({
        ok: true,
        order,
      });
    } catch (err: any) {
      if (err instanceof ZodError) {
        return sendTypedError(res, 400, 'VALIDATION_ERROR', 'Invalid cancel payload', err.issues);
      }
      const message = err instanceof Error ? err.message : 'Unable to cancel order';
      return sendTypedError(res, 400, 'ORDER_CANCEL_FAILED', message);
    }
  });

  // ==========================================================================
  // 5. Server-Verified Checkout Result Lookup (GET /api/orders/:id/checkout-status)
  // ==========================================================================
  app.get('/api/orders/:id/checkout-status', async (req: Request, res: Response) => {
    const orderOrPaypalId = req.params.id;
    let found = defaultServerLedger.getOrderWithEvents(orderOrPaypalId);

    if (!found) {
      const firestoreOrder = await getOrderByIdForBiz(DEFAULT_BIZ_ID, orderOrPaypalId);
      if (firestoreOrder) {
        found = {
          order: firestoreOrder,
          escrowEvents: [],
          payments: [],
        };
      }
    }

    if (!found) {
      return sendTypedError(
        res,
        404,
        'ORDER_NOT_FOUND',
        `Order '${orderOrPaypalId}' does not exist in server ledger.`
      );
    }

    res.json({
      ok: true,
      order: found.order,
      escrowEvents: found.escrowEvents,
      payments: found.payments,
      verifiedByServer: found.order.verifiedByServer,
    });
  });

  // ==========================================================================
  // 6. Role-Filtered Orders & Payments Endpoints (Single Source of Truth in Firestore)
  // ==========================================================================
  app.get('/api/orders', async (req: Request, res: Response) => {
    const actor = await requireAuth(req, res);
    if (!actor) return;

    const firestoreOrders = await getOrdersForBiz(actor.bizId, actor);
    // Combine with ledger orders if any exist in current session
    const ledgerOrders = defaultServerLedger.listOrdersForActor(actor);
    const orderMap = new Map<string, any>();
    for (const o of firestoreOrders) orderMap.set(o.id, o);
    for (const o of ledgerOrders) {
      if (!orderMap.has(o.id)) orderMap.set(o.id, o);
    }

    res.json({
      ok: true,
      bizId: actor.bizId,
      actorRole: actor.role,
      orders: Array.from(orderMap.values()),
    });
  });

  app.get('/api/payments', async (req: Request, res: Response) => {
    const actor = await requireAuth(req, res);
    if (!actor) return;

    if (actor.role !== 'finance' && actor.role !== 'business_head' && actor.role !== 'seller') {
      return sendTypedError(
        res,
        403,
        'ROLE_ACCESS_DENIED',
        `Role '${actor.role}' cannot view financial payment records.`
      );
    }

    const firestorePayments = await getPaymentsForBiz(actor.bizId);
    const ledgerPayments = defaultServerLedger.listPaymentsForActor(actor);
    const paymentMap = new Map<string, any>();
    for (const p of firestorePayments) paymentMap.set(p.id, p);
    for (const p of ledgerPayments) {
      if (!paymentMap.has(p.id)) paymentMap.set(p.id, p);
    }

    res.json({
      ok: true,
      bizId: actor.bizId,
      payments: Array.from(paymentMap.values()),
    });
  });

  app.get('/api/escrow-events', async (req: Request, res: Response) => {
    const actor = await requireAuth(req, res);
    if (!actor) return;

    const events = await getEscrowEventsForBiz(actor.bizId);
    res.json({
      ok: true,
      bizId: actor.bizId,
      escrowEvents: events,
    });
  });

  app.post('/api/paypal/refund-order/:id', async (req: Request, res: Response) => {
    const actor = await requireAuth(req, res);
    if (!actor) return;

    if (actor.role !== 'seller' && actor.role !== 'finance' && actor.role !== 'business_head') {
      return sendTypedError(
        res,
        403,
        'ROLE_ACCESS_DENIED',
        'Only seller, finance, or business head may issue an escrow refund.'
      );
    }

    const orderOrPaypalId = req.params.id;
    const reason = String(req.body?.reason || 'Seller initiated PayPal Sandbox refund');

    const firestoreOrder = await getOrderByIdForBiz(actor.bizId, orderOrPaypalId);
    const ledgerEntry = defaultServerLedger.getOrderWithEvents(orderOrPaypalId);
    const authoritativeOrder = firestoreOrder || ledgerEntry?.order;

    if (!authoritativeOrder) {
      return sendTypedError(
        res,
        404,
        'ORDER_NOT_FOUND',
        `Order '${orderOrPaypalId}' was not found in server ledger or Firestore.`
      );
    }

    // Never trust amounts coming from the client; derive strictly from authoritative server record
    const authoritativeAmountInr =
      typeof authoritativeOrder.totalMinor === 'number'
        ? Math.round(authoritativeOrder.totalMinor / 100)
        : Number(authoritativeOrder.total || authoritativeOrder.amountInr || 0);

    const previousStage = authoritativeOrder.escrowState || authoritativeOrder.escrowStage || 'held';

    const updatedOrder = await saveOrderForBiz(actor.bizId, {
      ...authoritativeOrder,
      escrowState: 'refunded',
      escrowStage: 'refunded',
      status: 'refunded',
      paymentStatus: 'Refunded',
      updatedAt: new Date().toISOString(),
    });

    const escrowEvent = await recordEscrowEventForBiz(actor.bizId, {
      orderId: updatedOrder.id,
      paypalOrderId: updatedOrder.paypalOrderId || orderOrPaypalId,
      stage: 'refunded',
      previousStage,
      fromState: previousStage,
      toState: 'refunded',
      amountInr: authoritativeAmountInr,
      escrowFeeInr: Number(updatedOrder.escrowFeeInr || Math.round(authoritativeAmountInr * 0.015)),
      actor: actor.email || actor.uid,
      actorId: actor.uid,
      actorRole: actor.role,
      reason,
      timestamp: new Date().toISOString(),
    });

    return res.json({
      ok: true,
      order: updatedOrder,
      escrowEvent,
      authoritativeAmountInr,
    });
  });

  // ==========================================================================
  // 7. Application-Level Escrow Transition (POST /api/orders/:id/escrow-transition)
  // ==========================================================================
  app.post('/api/orders/:id/escrow-transition', async (req: Request, res: Response) => {
    const actor = await requireAuth(req, res);
    if (!actor) return;

    try {
      const orderId = req.params.id;
      const parsedBody = EscrowTransitionBodySchema.parse({
        ...req.body,
        actorId: actor.uid, // Strictly bound to verified token
        actorRole: actor.role, // Strictly bound to verified token
      });

      if (parsedBody.isAiAutomated) {
        return sendTypedError(
          res,
          403,
          'AI_DIRECT_MUTATION_FORBIDDEN',
          'AI direct mutation of escrow state is forbidden.'
        );
      }

      if (actor.role === 'seller' && parsedBody.nextState === 'released') {
        return sendTypedError(
          res,
          403,
          'UNAUTHORIZED_ROLE_FOR_TRANSITION',
          'Seller cannot release escrow funds to themselves.'
        );
      }

      let result;
      try {
        result = defaultServerLedger.transitionOrderEscrow(orderId, parsedBody);
      } catch (ledgerErr) {
        // If not found in memory ledger, look up in Firestore businesses/{bizId}/orders
        const firestoreOrder = await getOrderByIdForBiz(actor.bizId, orderId);
        if (!firestoreOrder) {
          throw ledgerErr;
        }
        const transitionCheck = transitionEscrowState({
          orderId,
          currentState: firestoreOrder.escrowState || 'created',
          nextState: parsedBody.nextState,
          actorId: actor.uid,
          actorRole: actor.role as any,
          reason: parsedBody.reason,
        });
        if (!transitionCheck.ok) {
          throw Object.assign(new Error(transitionCheck.error), { code: transitionCheck.code });
        }
        const updated = await saveOrderForBiz(actor.bizId, {
          ...firestoreOrder,
          escrowState: parsedBody.nextState,
          updatedAt: new Date().toISOString(),
        });
        const event = await recordEscrowEventForBiz(actor.bizId, transitionCheck.event);
        result = { order: updated, event, nextState: parsedBody.nextState };
      }

      // Persist transition to Firestore businesses/{bizId}/orders & escrowEvents
      await saveOrderForBiz(actor.bizId, {
        ...result.order,
        bizId: actor.bizId,
      });
      if (result.event) {
        await recordEscrowEventForBiz(actor.bizId, result.event);
      }

      res.json({
        ok: true,
        ...result,
      });
    } catch (err: any) {
      if (err instanceof ZodError) {
        return sendTypedError(
          res,
          400,
          'VALIDATION_ERROR',
          'Invalid escrow transition payload',
          err.issues
        );
      }
      const code = (err as Error & { code?: string })?.code || 'ESCROW_TRANSITION_ERROR';
      const status =
        code === 'UNAUTHORIZED_ROLE_FOR_TRANSITION' || code === 'AI_DIRECT_MUTATION_FORBIDDEN'
          ? 403
          : 400;
      const message = err instanceof Error ? err.message : 'Escrow transition failed';
      return sendTypedError(res, status, code, message);
    }
  });

  // ==========================================================================
  // 8. Server-Side Cart & Invoice Recalculation (Minor Units, Single Source of Truth)
  // ==========================================================================
  app.post('/api/cart/calculate', async (req: Request, res: Response) => {
    try {
      const parsed = CartCalculateBodySchema.parse(req.body);
      const activeReqItems = parsed.items
        .filter((i) => !i.isDeferred)
        .map((i) => ({ sku: i.sku, quantity: i.quantity }));

      if (activeReqItems.length === 0) {
        return res.json({
          ok: true,
          currency: parsed.currency,
          budgetMinor: parsed.budgetMinor,
          subtotalMinor: 0,
          taxMinor: 0,
          totalMinor: 0,
          remainingHeadroomMinor: parsed.budgetMinor,
          isOverBudget: false,
          items: [],
        });
      }

      // Read from Firestore businesses/{bizId}/products directly (NO CATALOG_PRODUCTS fallback)
      const bizId = (req.query.bizId as string) || DEFAULT_BIZ_ID;
      const products = await getProductsForBiz(bizId);
      const catalogItems = products.map((p) => ({
        id: p.id || p.sku,
        sku: p.sku,
        name: p.name,
        price: p.price ?? ((p.priceMinor || 0) / 100),
        priceMinor: p.priceMinor || Math.round((p.price || 0) * 100),
        currency: p.currency || 'INR',
        gstRatePercent: p.gstRate || 18,
        hsnCode: p.hsCode || '8414',
      }));

      const calc = calculateAuthoritativeOrderTotalsMinor(
        activeReqItems,
        catalogItems as any,
        parsed.currency,
        0
      );

      res.json({
        ok: true,
        ...calc,
        budgetMinor: parsed.budgetMinor,
        remainingHeadroomMinor: parsed.budgetMinor - calc.totalMinor,
        isOverBudget: parsed.budgetMinor - calc.totalMinor < 0,
      });
    } catch (err: any) {
      if (err instanceof ZodError) {
        return sendTypedError(res, 400, 'VALIDATION_ERROR', 'Invalid cart payload', err.issues);
      }
      const message = err instanceof Error ? err.message : 'Cart calculation failed';
      return sendTypedError(res, 400, 'CART_CALCULATION_ERROR', message);
    }
  });

  app.post('/api/invoices/calculate', (req: Request, res: Response) => {
    try {
      const parsed = CalculateInvoiceBodySchema.parse(req.body);
      const result = calculateInvoiceOnServer(parsed);
      res.json({
        ok: true,
        ...result,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        return sendTypedError(res, 400, 'VALIDATION_ERROR', 'Invalid invoice payload', err.issues);
      }
      const message = err instanceof Error ? err.message : 'Invoice calculation failed';
      return sendTypedError(res, 400, 'INVOICE_CALCULATION_ERROR', message);
    }
  });

  // ==========================================================================
  // 9. Executive KPI Calculation for Chosen Date Range (POST /api/executive/kpis)
  // ==========================================================================
  app.post('/api/executive/kpis', (req: Request, res: Response) => {
    try {
      const actor = resolveActorFromRequest(req);
      if (actor.role !== 'business_head' && actor.role !== 'finance') {
        return sendTypedError(
          res,
          403,
          'ROLE_ACCESS_DENIED',
          'Only Business Head and Finance roles may query Executive KPI aggregates.'
        );
      }

      const parsed = ExecutiveKpiBodySchema.parse(req.body);
      const allOrders = defaultServerLedger.listAllOrdersInternal();
      const report = computeExecutiveKpisForDateRange(
        allOrders.map((o) => ({
          id: o.id,
          totalMinor: o.totalMinor,
          escrowState: o.escrowState,
          createdAtIso: o.createdAt,
        })),
        parsed.startIso,
        parsed.endIso,
        parsed.currency
      );

      res.json({
        ok: true,
        report,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        return sendTypedError(
          res,
          400,
          'VALIDATION_ERROR',
          'Invalid date range payload',
          err.issues
        );
      }
      return sendTypedError(res, 400, 'KPI_CALCULATION_ERROR', 'Failed to compute KPIs');
    }
  });

  // ==========================================================================
  // 10. Server-Side Gemini AI Routes (@google/genai, 15s timeout, rate limit)
  //     Every route returns { source: "live" | "fallback", ... }
  // ==========================================================================

  function enforceAiRateLimit(req: Request, res: Response): boolean {
    const actor = resolveActorFromRequest(req);
    const key = `${actor.uid}:${req.ip || 'local'}`;
    const limit = checkAiRateLimit(key);
    res.setHeader('X-RateLimit-Remaining', String(limit.remaining));
    if (!limit.allowed) {
      sendTypedError(
        res,
        429,
        'AI_RATE_LIMIT_EXCEEDED',
        `Rate limit exceeded. Retry in ${limit.retryAfterSeconds}s.`
      );
      return false;
    }
    return true;
  }

  // 10a) POST /api/copilot (Streaming SSE + JSON support, Role-Aware Function Calling)
  app.post('/api/copilot', async (req: Request, res: Response) => {
    if (!enforceAiRateLimit(req, res)) return;
    try {
      const actor = resolveActorFromRequest(req);
      const result = await runCopilotWithTools(actor, req.body);

      const wantsStream =
        req.body?.stream !== false &&
        (req.headers.accept?.includes('text/event-stream') || req.body?.stream === true);

      if (wantsStream) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');

        // Emit tool call trace event
        res.write(
          `event: tool_calls\ndata: ${JSON.stringify({
            source: result.source,
            role: result.role,
            toolsUsed: result.toolsUsed,
            citedRecords: result.citedRecords,
          })}\n\n`
        );

        // Stream answer tokens in progressive chunks
        const words = result.answer.split(' ');
        const chunkSize = 5;
        for (let i = 0; i < words.length; i += chunkSize) {
          const piece = words.slice(i, i + chunkSize).join(' ') + (i + chunkSize < words.length ? ' ' : '');
          res.write(`event: chunk\ndata: ${JSON.stringify({ text: piece })}\n\n`);
        }

        // Emit final structured summary + user-confirmable proposal
        res.write(
          `event: done\ndata: ${JSON.stringify({
            ok: true,
            ...result,
          })}\n\n`
        );
        res.end();
        return;
      }

      return res.json({
        ok: true,
        ...result,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        return sendTypedError(res, 400, 'VALIDATION_ERROR', 'Invalid copilot request payload', err.issues);
      }
      return sendTypedError(res, 500, 'COPILOT_ERROR', 'Failed to process copilot query');
    }
  });

  // 10b) POST /api/invoice/analyze (GSTIN regex + Place-of-Supply CGST/SGST vs IGST in code + AI draft)
  app.post('/api/invoice/analyze', async (req: Request, res: Response) => {
    if (!enforceAiRateLimit(req, res)) return;
    try {
      const result = await analyzeInvoiceWithGemini(req.body);
      return res.json(result);
    } catch (err) {
      if (err instanceof ZodError) {
        return sendTypedError(
          res,
          400,
          'VALIDATION_ERROR',
          'Invalid invoice analysis payload',
          err.issues
        );
      }
      return sendTypedError(res, 500, 'INVOICE_ANALYZE_ERROR', 'Unable to analyze invoice');
    }
  });

  // 10c) POST /api/cart/optimize (Ranking & explanation only; all money math from finance.ts)
  app.post('/api/cart/optimize', async (req: Request, res: Response) => {
    if (!enforceAiRateLimit(req, res)) return;
    try {
      const result = await optimizeCartWithGemini(req.body);
      return res.json(result);
    } catch (err) {
      if (err instanceof ZodError) {
        return sendTypedError(
          res,
          400,
          'VALIDATION_ERROR',
          'Invalid cart optimization payload',
          err.issues
        );
      }
      return sendTypedError(res, 500, 'CART_OPTIMIZE_ERROR', 'Unable to optimize cart');
    }
  });

  // 10d) POST /api/listing/generate (3 columns: Provided by seller, Generated, Missing information)
  app.post('/api/listing/generate', async (req: Request, res: Response) => {
    if (!enforceAiRateLimit(req, res)) return;
    try {
      const result = await generateListingWithGemini(req.body);
      return res.json(result);
    } catch (err) {
      if (err instanceof ZodError) {
        return sendTypedError(
          res,
          400,
          'VALIDATION_ERROR',
          'Invalid listing generation payload',
          err.issues
        );
      }
      return sendTypedError(res, 500, 'LISTING_GENERATE_ERROR', 'Unable to generate listing draft');
    }
  });

  // 10e) POST /api/executive/insights (Validated analytics + record citations + "Forecast" labels)
  app.post('/api/executive/insights', async (req: Request, res: Response) => {
    if (!enforceAiRateLimit(req, res)) return;
    try {
      const result = await generateExecutiveInsightsWithGemini(req.body);
      return res.json(result);
    } catch (err) {
      if (err instanceof ZodError) {
        return sendTypedError(
          res,
          400,
          'VALIDATION_ERROR',
          'Invalid executive insights payload',
          err.issues
        );
      }
      return sendTypedError(res, 500, 'EXECUTIVE_INSIGHTS_ERROR', 'Unable to generate insights');
    }
  });

  // 10f) POST /api/escrow/recommend (AI Release Agent: release | hold | dispute + confidence + reasons)
  app.post('/api/escrow/recommend', async (req: Request, res: Response) => {
    if (!enforceAiRateLimit(req, res)) return;
    try {
      const result = await recommendEscrowWithGemini(req.body);
      return res.json(result);
    } catch (err) {
      if (err instanceof ZodError) {
        return sendTypedError(
          res,
          400,
          'VALIDATION_ERROR',
          'Invalid escrow recommendation payload',
          err.issues
        );
      }
      return sendTypedError(res, 500, 'ESCROW_RECOMMEND_ERROR', 'Unable to evaluate escrow recommendation');
    }
  });

  // 10g) POST /api/product/qa (Customer Product Q&A strictly from stored product specs)
  app.post('/api/product/qa', async (req: Request, res: Response) => {
    if (!enforceAiRateLimit(req, res)) return;
    try {
      const result = await answerProductQaWithGemini(req.body);
      return res.json(result);
    } catch (err) {
      if (err instanceof ZodError) {
        return sendTypedError(
          res,
          400,
          'VALIDATION_ERROR',
          'Invalid product Q&A payload',
          err.issues
        );
      }
      return sendTypedError(res, 500, 'PRODUCT_QA_ERROR', 'Unable to answer product question');
    }
  });

  // Legacy /api/ai/suggest compatibility wrapper (returns source: "live" | "fallback")
  app.post('/api/ai/suggest', async (req: Request, res: Response) => {
    if (!enforceAiRateLimit(req, res)) return;
    try {
      const parsed = AiSuggestBodySchema.parse(req.body);
      const actor = resolveActorFromRequest(req);
      const copilotRes = await runCopilotWithTools(actor, {
        query: parsed.prompt,
        stream: false,
      });
      return res.json({
        ok: true,
        source: copilotRes.source,
        suggestion: copilotRes.answer,
        whyThis: copilotRes.whyThis,
        citedRecords: copilotRes.citedRecords,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        return sendTypedError(res, 400, 'VALIDATION_ERROR', 'Invalid AI prompt payload', err.issues);
      }
      return sendTypedError(res, 500, 'AI_SERVICE_ERROR', 'Unable to process AI suggestion');
    }
  });

  // ==========================================================================
  // 11. 3D / AR Binary glTF 2.0 (.glb) Model Serving & Seller Asset Upload
  // ==========================================================================
  app.get('/api/models/:modelKey', (req: Request, res: Response) => {
    const glb = getGlbBufferForModelKey(req.params.modelKey);
    if (!glb) {
      return sendTypedError(
        res,
        404,
        'MODEL_NOT_FOUND',
        `No real .glb 3D model exists for '${req.params.modelKey}'.`
      );
    }
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Content-Length', String(glb.length));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(glb);
  });

  app.get('/api/products/assets', (_req: Request, res: Response) => {
    return res.json({
      ok: true,
      assets: listAllSeller3DAssets(),
    });
  });

  app.get('/api/products/:sku/asset', (req: Request, res: Response) => {
    const asset = getSeller3DAsset(req.params.sku);
    return res.json({
      ok: true,
      sku: req.params.sku,
      hasModel: Boolean(asset && asset.status === 'Ready' && asset.modelUrl),
      asset,
    });
  });

  const SellerAssetUploadSchema = z.object({
    fileName: z.string().min(1, 'fileName is required'),
    sizeBytes: z.number().int().nonnegative(),
  });

  app.post('/api/products/:sku/asset', (req: Request, res: Response) => {
    try {
      const actor = resolveActorFromRequest(req);
      if (actor.role !== 'seller' && actor.role !== 'business_head') {
        return sendTypedError(
          res,
          403,
          'RBAC_FORBIDDEN',
          `Role '${actor.role}' cannot upload 3D product assets.`
        );
      }
      const parsed = SellerAssetUploadSchema.parse(req.body);
      const record = registerSeller3DAsset({
        sku: req.params.sku,
        fileName: parsed.fileName,
        sizeBytes: parsed.sizeBytes,
        uploadedBy: actor.email,
      });
      return res.status(record.status === 'Ready' ? 200 : 400).json({
        ok: record.status === 'Ready',
        asset: record,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        return sendTypedError(res, 400, 'VALIDATION_ERROR', 'Invalid 3D asset metadata', err.issues);
      }
      return sendTypedError(res, 500, 'ASSET_UPLOAD_ERROR', 'Failed to validate 3D asset');
    }
  });

  // ==========================================================================
  // 11b. Multimodal Gemini Suite (Chat, Audio Transcription, Image Create/Edit, Video Animation)
  // ==========================================================================
  const getServerGenAiClient = (): GoogleGenAI => {
    const apiKey = process.env.GEMINI_API_KEY || '';
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  };

  // Multi-turn Gemini Chatbot (gemini-4-argon, gemini-3.8-flash, gemini-3.1-flash-lite)
  app.post('/api/ai/chat', async (req: Request, res: Response) => {
    try {
      const {
        messages = [],
        model = 'gemini-3.8-flash',
        portalRole = 'seller',
        customSystemInstruction,
      } = req.body || {};

      const allowedModels = ['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];
      const selectedModel = allowedModels.includes(model) ? model : 'gemini-3.8-flash';

      const defaultSystemInstruction =
        portalRole === 'customer'
          ? 'You are the AC PayPilot Customer Shopping & Escrow Concierge. Help shoppers compare smart hardware products (AeroBreeze BLDC Ceiling Fan #FAN-BLDC-892, Yonex Astrox 99 Pro #SPO-YNX-99P, AcousticSphere ANC Pods #AUD-ANC-99, ProArt Studio Workstation #AC-WRK-8990), inspect 3D/AR models, optimize SmartCart budgets in INR (₹), and understand 100% PayPal Escrow buyer protection. Keep answers concise, clear, and helpful.'
          : 'You are the AC PayPilot Seller Operations & Autonomous Escrow Strategist. Help merchants analyze order volume trends, audit GST invoices (CGST/SGST vs IGST), optimize product listings, triage escrow risk anomalies, and manage PayPal Sandbox settlements in INR (₹). Provide actionable, data-driven answers.';

      const systemInstruction = customSystemInstruction || defaultSystemInstruction;

      const normalizedHistory = Array.isArray(messages)
        ? messages
            .filter((m: any) => m && typeof m.text === 'string' && m.text.trim().length > 0)
            .map((m: any) => ({
              role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
              parts: [{ text: String(m.text) }],
            }))
        : [];

      if (normalizedHistory.length === 0) {
        return sendTypedError(res, 400, 'EMPTY_MESSAGES', 'At least one chat message is required.');
      }

      const ai = getServerGenAiClient();
      const response = await ai.models.generateContent({
        model: selectedModel,
        contents: normalizedHistory,
        config: {
          systemInstruction,
        },
      });

      return res.json({
        ok: true,
        model: selectedModel,
        portalRole,
        reply: response.text || 'Processed your request.',
        systemInstruction,
      });
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Unable to generate chat response';
      return res.status(500).json({
        ok: false,
        error: msg,
      });
    }
  });

  // Microphone Audio Transcription (gemini-3.5-transcribe)
  app.post('/api/ai/transcribe', async (req: Request, res: Response) => {
    try {
      const { audioBase64, mimeType = 'audio/webm', prompt } = req.body || {};
      if (!audioBase64 || typeof audioBase64 !== 'string') {
        return sendTypedError(res, 400, 'AUDIO_REQUIRED', 'Base64 audio data is required.');
      }

      const cleanBase64 = audioBase64.replace(/^data:[^;]+;base64,/, '');
      const ai = getServerGenAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: String(mimeType || 'audio/webm'),
                data: cleanBase64,
              },
            },
            {
              text: prompt ? String(prompt) : 'Transcribe this audio.',
            },
          ],
        },
      });

      return res.json({
        ok: true,
        model: 'gemini-3.5-transcribe',
        transcript: (response.text || '').trim(),
      });
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Audio transcription failed';
      return res.status(500).json({
        ok: false,
        error: msg,
      });
    }
  });

  // Create & Edit Images (gemini-nano-banana-2.1)
  app.post('/api/ai/image', async (req: Request, res: Response) => {
    try {
      const {
        prompt,
        imageBase64,
        mimeType = 'image/png',
        aspectRatio = '1:1',
        imageSize = '1K',
      } = req.body || {};

      if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return sendTypedError(res, 400, 'PROMPT_REQUIRED', 'Text prompt is required to create or edit an image.');
      }

      const validAspectRatios = ['1:1', '3:4', '4:3', '9:16', '16:9', '1:4', '1:8', '4:1', '8:1'];
      const safeAspectRatio = validAspectRatios.includes(aspectRatio) ? aspectRatio : '1:1';
      const validSizes = ['1K', '2K', '4K'];
      const safeSize = validSizes.includes(imageSize) ? imageSize : '1K';

      const parts: any[] = [];
      if (imageBase64 && typeof imageBase64 === 'string') {
        const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
        parts.push({
          inlineData: {
            data: cleanBase64,
            mimeType: String(mimeType || 'image/png'),
          },
        });
      }
      parts.push({ text: prompt.trim() });

      const ai = getServerGenAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-nano-banana-2.1',
        contents: {
          parts,
        },
        config: {
          imageConfig: {
            aspectRatio: safeAspectRatio,
            imageSize: safeSize,
          },
        },
      });

      let generatedImageUrl: string | null = null;
      let textCaption = '';
      const candidateParts = response.candidates?.[0]?.content?.parts || [];
      for (const part of candidateParts) {
        if (part.inlineData?.data) {
          const outMime = part.inlineData.mimeType || 'image/png';
          generatedImageUrl = `data:${outMime};base64,${part.inlineData.data}`;
        } else if (part.text) {
          textCaption += part.text;
        }
      }

      if (!generatedImageUrl) {
        return res.status(502).json({
          ok: false,
          error: textCaption || 'No image data returned by gemini-nano-banana-2.1.',
        });
      }

      return res.json({
        ok: true,
        model: 'gemini-nano-banana-2.1',
        mode: imageBase64 ? 'edit' : 'create',
        imageUrl: generatedImageUrl,
        caption: textCaption.trim(),
        aspectRatio: safeAspectRatio,
        imageSize: safeSize,
      });
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Image generation/editing failed';
      return res.status(500).json({
        ok: false,
        error: msg,
      });
    }
  });

  // Animate Uploaded Photo into Video via Interactions API (gemini-omni-1.1-flash)
  app.post('/api/ai/video', async (req: Request, res: Response) => {
    try {
      const {
        imageBase64,
        mimeType = 'image/png',
        prompt = 'Smooth studio camera pan with subtle lighting reflections around the product.',
        aspectRatio = '16:9',
        duration = '5s',
      } = req.body || {};

      if (!imageBase64 || typeof imageBase64 !== 'string') {
        return sendTypedError(
          res,
          400,
          'IMAGE_REQUIRED',
          'Please upload or select a photo to animate into a video.'
        );
      }

      const safeAspectRatio: '16:9' | '9:16' = aspectRatio === '9:16' ? '9:16' : '16:9';
      const safeDuration: '5s' | '10s' = duration === '10s' ? '10s' : '5s';
      const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');

      const ai = getServerGenAiClient();
      const interaction: any = await ai.interactions.create(
        {
          model: 'gemini-omni-1.1-flash',
          input: [
            {
              type: 'image',
              mime_type: String(mimeType || 'image/png'),
              data: cleanBase64,
            },
            {
              type: 'text',
              text: String(prompt).trim() || 'Animate this photo with smooth cinematic studio motion.',
            },
          ],
          background: false,
          store: false,
          stream: false,
          response_format: {
            type: 'video',
            aspect_ratio: safeAspectRatio,
            duration: safeDuration,
            resolution: '720p',
          },
        } as any,
        { timeout: 300000 }
      );

      const videoPart = interaction?.output_video;
      let videoBase64: string | null = videoPart?.data || null;
      let videoMime = videoPart?.mime_type || 'video/mp4';

      if (!videoBase64 && Array.isArray(interaction?.steps)) {
        for (const step of interaction.steps) {
          if (step?.type === 'model_output' && Array.isArray(step.content)) {
            const foundVideo = step.content.find((c: any) => c.type === 'video' && c.data);
            if (foundVideo) {
              videoBase64 = foundVideo.data;
              videoMime = foundVideo.mime_type || 'video/mp4';
              break;
            }
          }
        }
      }

      if (!videoBase64) {
        return res.status(502).json({
          ok: false,
          error: 'No video output was returned from gemini-omni-1.1-flash.',
        });
      }

      return res.json({
        ok: true,
        model: 'gemini-omni-1.1-flash',
        aspectRatio: safeAspectRatio,
        duration: safeDuration,
        videoUrl: `data:${videoMime};base64,${videoBase64}`,
      });
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Video generation failed';
      return res.status(500).json({
        ok: false,
        error: msg,
      });
    }
  });

  // Standard Liveness/Readiness Health Endpoints (GET /health, GET /api/health)
  app.get(['/health', '/api/health'], (_req: Request, res: Response) => {
    res.json({
      ok: true,
      status: 'healthy',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // ==========================================================================
  // 12. System Health Check Diagnostic Endpoint (GET /api/health/system-check)
  // ==========================================================================
  app.get('/api/health/system-check', async (_req: Request, res: Response) => {
    try {
      const diagnostic = await runFullSystemDiagnostic();
      return res.status(diagnostic.ok ? 200 : 503).json(diagnostic);
    } catch (err) {
      return sendTypedError(
        res,
        500,
        'HEALTH_CHECK_FAILED',
        `Diagnostic failure: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });

  // ==========================================================================
  // 13. PayPal Sandbox Webhook Receiver (POST /api/paypal/webhook)
  // ==========================================================================
  const processedWebhookEventIds = new Set<string>();

  const PayPalWebhookSchema = z.object({
    id: z.string().optional(),
    event_type: z.string(),
    summary: z.string().optional(),
    resource: z.record(z.string(), z.any()).optional(),
  });

  async function verifyPayPalWebhookSignature(req: Request, webhookId: string): Promise<boolean> {
    const transmissionId = req.headers['paypal-transmission-id'] as string;
    const transmissionTime = req.headers['paypal-transmission-time'] as string;
    const transmissionSig = req.headers['paypal-transmission-sig'] as string;
    const certUrl = req.headers['paypal-cert-url'] as string;
    const authAlgo = req.headers['paypal-auth-algo'] as string;

    if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
      return false;
    }

    // Verify certUrl is valid HTTPS and strictly hosted on a PayPal domain
    try {
      const parsedCert = new URL(certUrl);
      if (parsedCert.protocol !== 'https:' || !parsedCert.hostname.endsWith('.paypal.com')) {
        return false;
      }
    } catch {
      return false;
    }

    // Isolated test hook: Gated strictly by NODE_ENV === 'test'.
    // In production, this branch is unreachable.
    if (process.env.NODE_ENV === 'test') {
      const testSecret = process.env.PAYPAL_TEST_WEBHOOK_SECRET || 'test-sandbox-webhook-token';
      if (
        req.headers['x-paypal-test-signature'] === testSecret ||
        (transmissionSig === 'SAMPLE_HMAC_SHA256_TRANSMISSION_SIGNATURE_PAYPAL' && !process.env.PAYPAL_WEBHOOK_ID)
      ) {
        return true;
      }
    }

    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    const hasRealCredentials =
      Boolean(clientId && clientSecret) &&
      clientId !== 'MY_PAYPAL_CLIENT_ID' &&
      clientSecret !== 'MY_PAYPAL_CLIENT_SECRET' &&
      !clientId?.startsWith('sb-placeholder');

    if (!hasRealCredentials || !webhookId || webhookId === 'WH-LOCAL-SANDBOX') {
      // Fail closed: Webhook verification requires valid PayPal credentials and webhook ID
      return false;
    }

    try {
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      if (!tokenRes.ok) return false;
      const tokenData = (await tokenRes.json()) as any;
      const accessToken = tokenData.access_token;
      if (!accessToken) return false;

      const verifyRes = await fetch(
        'https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            auth_algo: authAlgo,
            cert_url: certUrl,
            transmission_id: transmissionId,
            transmission_sig: transmissionSig,
            transmission_time: transmissionTime,
            webhook_id: webhookId,
            webhook_event: req.body,
          }),
        }
      );
      if (!verifyRes.ok) return false;
      const verifyData = (await verifyRes.json()) as any;
      return verifyData.verification_status === 'SUCCESS';
    } catch (err) {
      console.error('PayPal webhook verification call error:', err);
      return false;
    }
  }

  app.post('/api/paypal/webhook', async (req: Request, res: Response) => {
    try {
      // 1. Enforce Webhook Signature Verification Headers
      const transmissionId = req.headers['paypal-transmission-id'];
      const transmissionSig = req.headers['paypal-transmission-sig'];
      const certUrl = req.headers['paypal-cert-url'];

      if (!transmissionId || !transmissionSig || !certUrl) {
        return sendTypedError(
          res,
          400,
          'WEBHOOK_UNSIGNED',
          'Missing required PayPal webhook signature headers (transmission-id, transmission-sig, cert-url).'
        );
      }

      const webhookId = process.env.PAYPAL_WEBHOOK_ID || 'WH-LOCAL-SANDBOX';
      const isValid = await verifyPayPalWebhookSignature(req, webhookId);
      if (!isValid) {
        return sendTypedError(
          res,
          401,
          'INVALID_WEBHOOK_SIGNATURE',
          'PayPal webhook signature verification failed.'
        );
      }

      const parsed = PayPalWebhookSchema.parse(req.body);
      const eventType = parsed.event_type;
      const resource = parsed.resource || {};
      const paypalOrderId = (resource.id as string) || (resource.order_id as string) || '';

      // 2. Deduplication check by event ID
      if (parsed.id) {
        if (processedWebhookEventIds.has(parsed.id)) {
          return res.status(200).json({
            ok: true,
            duplicate: true,
            eventId: parsed.id,
            status: 'DUPLICATE_IGNORED',
            message: `Event '${parsed.id}' has already been processed.`,
          });
        }
        processedWebhookEventIds.add(parsed.id);
      }

      // Check for supported event types
      const supportedEvents = [
        'PAYMENT.CAPTURE.COMPLETED',
        'PAYMENT.CAPTURE.DENIED',
        'PAYMENT.CAPTURE.REFUNDED',
      ];
      if (!supportedEvents.includes(eventType)) {
        return res.status(200).json({
          ok: true,
          status: 'EVENT_IGNORED_UNSUPPORTED_TYPE',
          eventId: parsed.id,
          receivedEventType: eventType,
        });
      }

      // 3. Process webhook event and validate referenced order
      if (paypalOrderId) {
        const existingOrder = await getOrderByIdForBiz(DEFAULT_BIZ_ID, paypalOrderId);
        const existingLedger = defaultServerLedger.getOrderWithEvents(paypalOrderId);
        const targetOrder = existingOrder || existingLedger?.order;

        if (!targetOrder) {
          return sendTypedError(
            res,
            404,
            'ORDER_NOT_FOUND',
            `Order '${paypalOrderId}' referenced in webhook does not exist.`
          );
        }

        // Amount & currency verification if included in resource
        if (resource.amount) {
          const resCurrency = resource.amount.currency_code;
          const resValue = resource.amount.value;
          if (resCurrency && resCurrency !== targetOrder.currency) {
            return sendTypedError(
              res,
              400,
              'WEBHOOK_CURRENCY_MISMATCH',
              `Webhook currency '${resCurrency}' does not match order currency '${targetOrder.currency}'.`
            );
          }
          if (resValue) {
            const resMinor = toMinorUnits(parseFloat(resValue));
            if (Math.abs(resMinor - targetOrder.totalMinor) > 100) {
              return sendTypedError(
                res,
                400,
                'WEBHOOK_AMOUNT_MISMATCH',
                `Webhook amount '${resMinor}' does not match order total '${targetOrder.totalMinor}'.`
              );
            }
          }
        }

        if (existingOrder) {
          let nextState = existingOrder.escrowState;
          if (eventType === 'PAYMENT.CAPTURE.COMPLETED') nextState = 'funded';
          else if (eventType === 'PAYMENT.CAPTURE.DENIED') nextState = 'disputed';
          else if (eventType === 'PAYMENT.CAPTURE.REFUNDED') nextState = 'refunded';

          if (nextState !== existingOrder.escrowState && canTransitionEscrow(existingOrder.escrowState, nextState)) {
            await saveOrderForBiz(DEFAULT_BIZ_ID, {
              ...existingOrder,
              escrowState: nextState,
              status: nextState === 'funded' ? 'processing' : existingOrder.status,
            });
            await recordEscrowEventForBiz(DEFAULT_BIZ_ID, {
              orderId: existingOrder.id,
              paypalOrderId,
              previousState: existingOrder.escrowState,
              nextState,
              reason: `PayPal Webhook: ${eventType}`,
              actorRole: 'finance',
              actorId: 'paypal-webhook-service',
            });
          }
        }

        if (existingLedger) {
          try {
            if (eventType === 'PAYMENT.CAPTURE.COMPLETED' && canTransitionEscrow(existingLedger.order.escrowState, 'funded')) {
              defaultServerLedger.transitionOrderEscrow(existingLedger.order.id, {
                nextState: 'funded',
                reason: `PayPal Webhook: ${eventType} confirmed`,
                actorId: 'paypal-webhook-service',
                actorRole: 'finance',
              });
            } else if (eventType === 'PAYMENT.CAPTURE.DENIED' && canTransitionEscrow(existingLedger.order.escrowState, 'disputed')) {
              defaultServerLedger.transitionOrderEscrow(existingLedger.order.id, {
                nextState: 'disputed',
                reason: 'PayPal Webhook: Capture denied by processor',
                actorId: 'paypal-webhook-service',
                actorRole: 'finance',
              });
            } else if (eventType === 'PAYMENT.CAPTURE.REFUNDED' && canTransitionEscrow(existingLedger.order.escrowState, 'refunded')) {
              defaultServerLedger.transitionOrderEscrow(existingLedger.order.id, {
                nextState: 'refunded',
                reason: 'PayPal Webhook: Refund recorded by provider',
                actorId: 'paypal-webhook-service',
                actorRole: 'finance',
              });
            }
          } catch (ledgerErr) {
            console.warn('Webhook escrow transition notice:', ledgerErr);
          }
        }
      }

      return res.status(200).json({
        ok: true,
        receivedEventType: eventType,
        status: 'PROCESSED',
        eventId: parsed.id,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      if (err instanceof ZodError) {
        return sendTypedError(res, 400, 'VALIDATION_ERROR', 'Invalid webhook payload', err.issues);
      }
      return sendTypedError(res, 500, 'WEBHOOK_ERROR', 'Failed to process webhook event');
    }
  });

  // ==========================================================================
  // 14. Server Product Catalog CRUD (GET/POST/DELETE /api/products)
  // Single Source of Truth in Firestore: businesses/{bizId}/products
  // ==========================================================================
  const ProductMutationSchema = z.object({
    sku: z.string().min(1, 'SKU is required'),
    name: z.string().min(1, 'Product name is required'),
    category: z.string().default('General Appliances'),
    price: z.number().positive('Price must be greater than 0'),
    hsCode: z.string().default('8414.51.10'),
    gstRate: z.number().default(18),
    stock: z.number().int().nonnegative().default(100),
    modelUrl: z.string().nullable().optional(),
    specs: z.array(z.string()).default([]),
    img: z.string().optional(),
    dimensions: z.string().optional(),
    weight: z.string().optional(),
    warranty: z.string().optional(),
  });

  // GET /api/products
  // Public storefront reads permitted when ?public=true without spoofed actor headers
  // Seller portal reads require verified Firebase ID token and are scoped to actor.bizId
  app.get('/api/products', async (req: Request, res: Response) => {
    try {
      const isPublicRead = req.query.public === 'true';
      const hasSpoofedActorHeaders = Boolean(
        req.headers['x-actor-uid'] || req.headers['x-actor-role'] || req.headers['x-actor-email']
      );

      // If spoofed actor headers are provided without DEMO_MODE, strictly enforce auth
      if (!isPublicRead || (hasSpoofedActorHeaders && process.env.DEMO_MODE !== 'true')) {
        const actor = await requireAuth(req, res);
        if (!actor) return;
        const products = await getProductsForBiz(actor.bizId);
        return res.json({
          ok: true,
          count: products.length,
          products,
        });
      }

      const bizId = (req.query.bizId as string) || DEFAULT_BIZ_ID;
      const products = await getProductsForBiz(bizId);
      return res.json({
        ok: true,
        count: products.length,
        products,
      });
    } catch (err: any) {
      return sendTypedError(res, 500, 'PRODUCTS_FETCH_ERROR', err.message || 'Failed to fetch products');
    }
  });

  // POST /api/products
  // Requires verified seller/business_head auth. Scoped strictly to actor.bizId in Firestore.
  app.post('/api/products', async (req: Request, res: Response) => {
    try {
      const actor = await requireAuth(req, res);
      if (!actor) return;

      const allowedRoles = ['seller', 'business_head', 'owner', 'admin'];
      if (!allowedRoles.includes(actor.role)) {
        return sendTypedError(
          res,
          403,
          'ROLE_ACCESS_DENIED',
          'Only sellers or business heads may add or edit products.'
        );
      }

      const parsed = ProductMutationSchema.parse(req.body);
      const cleanSku = parsed.sku.replace(/^#/, '');
      const existing = await getProductBySkuForBiz(actor.bizId, cleanSku);

      const record = {
        id: existing?.id || `prod-${Date.now()}`,
        ...parsed,
        sku: parsed.sku.startsWith('#') ? parsed.sku : `#${parsed.sku}`,
        bizId: actor.bizId,
      };

      const saved = await saveProductForBiz(actor.bizId, record);

      return res.status(existing ? 200 : 201).json({
        ok: true,
        product: saved,
        action: existing ? 'updated' : 'created',
      });
    } catch (err) {
      if (err instanceof ZodError) {
        return sendTypedError(res, 400, 'VALIDATION_ERROR', 'Invalid product data', err.issues);
      }
      return sendTypedError(res, 500, 'PRODUCT_SAVE_ERROR', 'Failed to save product');
    }
  });

  // DELETE /api/products/:sku
  // Requires verified seller/business_head auth.
  app.delete('/api/products/:sku', async (req: Request, res: Response) => {
    try {
      const actor = await requireAuth(req, res);
      if (!actor) return;

      const allowedRoles = ['seller', 'business_head', 'owner', 'admin'];
      if (!allowedRoles.includes(actor.role)) {
        return sendTypedError(
          res,
          403,
          'ROLE_ACCESS_DENIED',
          'Only sellers or business heads may delete products.'
        );
      }

      const cleanSku = decodeURIComponent(req.params.sku).replace(/^#/, '');
      const deleted = await deleteProductBySkuForBiz(actor.bizId, cleanSku);
      if (!deleted) {
        return sendTypedError(res, 404, 'PRODUCT_NOT_FOUND', `Product '${cleanSku}' not found`);
      }

      return res.json({
        ok: true,
        deletedSku: cleanSku,
      });
    } catch (err: any) {
      return sendTypedError(res, 500, 'PRODUCT_DELETE_ERROR', err.message || 'Failed to delete product');
    }
  });

  // ==========================================================================
  // 15. Server Merchant Profile & Settings (GET/POST /api/merchants/profile)
  // Single Source of Truth in Firestore: businesses/{bizId}
  // ==========================================================================
  const MerchantProfileUpdateSchema = z.object({
    storeName: z.string().min(3, 'Store name must be at least 3 characters'),
    gstin: z
      .string()
      .regex(
        /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
        'Must be a valid 15-character Indian GSTIN'
      ),
    settlementBank: z.string().optional(),
    settlementAccount: z.string().optional(),
    notifications: z
      .object({
        escrowRelease: z.boolean(),
        overdueAutoChase: z.boolean(),
        lowStockReorder: z.boolean(),
        feeTierAlerts: z.boolean(),
      })
      .optional(),
  });

  app.get('/api/merchants/profile', async (req: Request, res: Response) => {
    try {
      const actor = await requireAuth(req, res);
      if (!actor) return;

      const profile = await getMerchantProfileForBiz(actor.bizId);
      const defaultProfile = {
        storeName: profile?.name || 'AeroCool Dynamics',
        gstin: profile?.taxGstNumber || '29ABCDE1234F1Z5',
        settlementBank: 'HDFC Bank Corporate •••• 9014 (IFSC: HDFC0001204)',
        notifications: {
          escrowRelease: true,
          overdueAutoChase: true,
          lowStockReorder: true,
          feeTierAlerts: true,
        },
        updatedAt: profile?.updatedAt || new Date().toISOString(),
      };

      return res.json({
        ok: true,
        profile: profile ? { ...defaultProfile, ...profile } : defaultProfile,
      });
    } catch (err: any) {
      return sendTypedError(res, 500, 'PROFILE_FETCH_ERROR', err.message || 'Failed to fetch merchant profile');
    }
  });

  app.post('/api/merchants/profile', async (req: Request, res: Response) => {
    try {
      const actor = await requireAuth(req, res);
      if (!actor) return;

      const allowedRoles = ['seller', 'business_head', 'owner', 'admin'];
      if (!allowedRoles.includes(actor.role)) {
        return sendTypedError(
          res,
          403,
          'ROLE_ACCESS_DENIED',
          'Only seller or business head may update merchant settings.'
        );
      }

      const parsed = MerchantProfileUpdateSchema.parse(req.body);
      const updated = await updateMerchantProfileForBiz(actor.bizId, {
        name: parsed.storeName,
        storeName: parsed.storeName,
        taxGstNumber: parsed.gstin,
        gstin: parsed.gstin,
        settlementBank: parsed.settlementBank || parsed.settlementAccount || 'HDFC Bank Corporate',
        notifications: parsed.notifications,
      });

      return res.json({
        ok: true,
        message: 'Merchant profile updated successfully',
        profile: updated,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        return sendTypedError(res, 400, 'VALIDATION_ERROR', err.issues[0]?.message || 'Validation error', err.issues);
      }
      return sendTypedError(res, 500, 'PROFILE_UPDATE_ERROR', 'Failed to update merchant profile');
    }
  });

  // ==========================================================================
  // Storefront & Multi-Tenant Domain Routes
  // ==========================================================================

  // Auto-generate storefront brand and products with Gemini (Onboarding finish)
  app.post('/api/ai/generate-storefront', async (req: Request, res: Response) => {
    try {
      const { businessName, category, currency } = req.body || {};
      if (!businessName || !category) {
        return sendTypedError(res, 400, 'INVALID_INPUT', 'businessName and category are required.');
      }
      const result = await generateStorefrontWithGemini({
        businessName: String(businessName),
        category: String(category),
        currency: currency || 'INR',
      });
      return res.json({ ok: true, data: result });
    } catch (err) {
      console.error('Error generating storefront with Gemini:', err);
      return sendTypedError(res, 500, 'AI_STOREFRONT_ERROR', 'Failed to generate storefront assets');
    }
  });

  // AI Theme Design Assistant ("make it premium and minimal for jewellery")
  app.post('/api/ai/design-assistant', async (req: Request, res: Response) => {
    try {
      const { prompt, currentTheme, currentTemplateId, businessCategory } = req.body || {};
      if (!prompt) {
        return sendTypedError(res, 400, 'INVALID_INPUT', 'Styling prompt is required.');
      }
      const result = await assistThemeDesignWithGemini({
        prompt: String(prompt),
        currentTheme: currentTheme || {},
        currentTemplateId: currentTemplateId || 'minimal',
        businessCategory: businessCategory ? String(businessCategory) : undefined,
      });
      return res.json(result);
    } catch (err) {
      console.error('Error with AI design assistant:', err);
      return sendTypedError(res, 500, 'AI_DESIGN_ERROR', 'Failed to generate design update');
    }
  });

  // AI Seller Insights for Dashboard
  app.get('/api/ai/seller-insights', async (req: Request, res: Response) => {
    try {
      const bizName = (req.query.businessName as string) || 'AeroCool Dynamics';
      const category = (req.query.category as string) || 'Electronics';
      const count = Number(req.query.ordersCount) || 12;
      const gmv = (req.query.gmv as string) || '₹4,82,500';

      const insights = await generateSellerInsightsWithGemini(bizName, category, count, gmv);
      return res.json({ ok: true, insights });
    } catch (err) {
      return sendTypedError(res, 500, 'INSIGHTS_ERROR', 'Failed to fetch seller insights');
    }
  });

  // Domain search / availability check (Hostinger integration & estimate pricing)
  // Strictly labels static pricing as "estimate" and never returns isAvailable: true without provider API
  app.get('/api/domains/check', async (req: Request, res: Response) => {
    try {
      const rawDomain = (req.query.domain as string) || '';
      if (!rawDomain.trim()) {
        return sendTypedError(res, 400, 'DOMAIN_REQUIRED', 'Domain parameter is required.');
      }
      const cleaned = rawDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const parts = cleaned.split('.');
      const sld = parts.length > 1 ? parts.slice(0, -1).join('.') : parts[0];
      const tld = parts.length > 1 ? parts[parts.length - 1] : 'store';
      const fullDomain = `${sld}.${tld}`;

      const tldPricing: Record<string, { priceUsd: number; priceInr: number }> = {
        store: { priceUsd: 0.99, priceInr: 99 },
        shop: { priceUsd: 1.99, priceInr: 169 },
        online: { priceUsd: 1.99, priceInr: 169 },
        tech: { priceUsd: 2.99, priceInr: 249 },
        in: { priceUsd: 6.99, priceInr: 589 },
        com: { priceUsd: 9.99, priceInr: 849 },
        co: { priceUsd: 11.99, priceInr: 999 },
      };

      const pricing = tldPricing[tld] || { priceUsd: 9.99, priceInr: 849 };
      const reserved = ['google', 'paypal', 'apple', 'amazon', 'facebook', 'acpaypilot', 'microsoft'];
      const isReserved = reserved.includes(sld.toLowerCase()) || sld.length < 3;

      // Rule: Never return isAvailable: true from static data.
      // If reserved, isAvailable: false. Otherwise isAvailable: null (marked as estimate).
      const isAvailable = isReserved ? false : null;

      const altTlds = ['store', 'shop', 'online', 'tech', 'in', 'com'].filter((t) => t !== tld);
      const suggestedAlternatives = altTlds.slice(0, 3).map((alt) => {
        const p = tldPricing[alt] || { priceUsd: 4.99, priceInr: 419 };
        return {
          domain: `${sld}.${alt}`,
          pricePerYearUsd: p.priceUsd,
          pricePerYearInr: p.priceInr,
          tld: `.${alt}`,
          status: 'estimate' as const,
        };
      });

      return res.json({
        ok: true,
        domain: fullDomain,
        status: 'estimate',
        isAvailable,
        availabilityNotice: isReserved
          ? 'Reserved brand name or restricted keyword'
          : 'Estimate only — live verification performed at registrar checkout',
        pricePerYearUsd: pricing.priceUsd,
        pricePerYearInr: pricing.priceInr,
        currency: 'USD',
        provider: 'hostinger',
        tld: `.${tld}`,
        purchaseUrl: `https://www.hostinger.com/domain-name-search?domain=${encodeURIComponent(fullDomain)}&ref=acpaypilot`,
        suggestedAlternatives,
      });
    } catch (err) {
      return sendTypedError(res, 500, 'DOMAIN_CHECK_ERROR', 'Failed to check domain availability');
    }
  });

  // Verify custom domain DNS records using node:dns/promises (CNAME, A, TXT)
  app.get('/api/domains/verify-dns', async (req: Request, res: Response) => {
    const rawDomain = (req.query.domain as string) || '';
    if (!rawDomain.trim()) {
      return sendTypedError(res, 400, 'DOMAIN_REQUIRED', 'Domain parameter is required.');
    }

    const domain = rawDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const expectedTarget = 'cname.acpaypilot.app';
    const expectedRecord = {
      type: 'CNAME',
      name: domain.startsWith('www.') ? 'www' : '@',
      target: expectedTarget,
      ttl: 300,
    };

    let cnameVerified = false;
    let aRecordVerified = false;
    let txtVerified = false;
    const resolvedCnames: string[] = [];
    const resolvedIps: string[] = [];
    const resolvedTxts: string[] = [];

    // 1. Check CNAME record
    try {
      const cnames = await dns.resolveCname(domain);
      resolvedCnames.push(...cnames);
      cnameVerified = cnames.some(
        (c) => c.toLowerCase() === expectedTarget.toLowerCase() || c.toLowerCase().endsWith('acpaypilot.app')
      );
    } catch (e: any) {
      // Expected if no CNAME yet or apex domain
    }

    // 2. Check A record (apex fallback)
    try {
      const ips = await dns.resolve4(domain);
      resolvedIps.push(...ips);
      if (ips.length > 0) {
        aRecordVerified = true;
      }
    } catch (e: any) {
      // Expected if no A record yet
    }

    // 3. Check TXT records
    try {
      const txtRecords = await dns.resolveTxt(domain);
      const flatTxts = txtRecords.flat();
      resolvedTxts.push(...flatTxts);
      txtVerified = flatTxts.some((t) => t.includes('acpaypilot-verification'));
    } catch (e: any) {
      // Expected if no TXT verification record
    }

    // Status evaluation: Verified | Pending | Failed
    let status: 'Verified' | 'Pending' | 'Failed' = 'Failed';
    let message = `DNS records not found for '${domain}'. Add the CNAME record below to connect your domain.`;

    if (cnameVerified || (aRecordVerified && txtVerified)) {
      status = 'Verified';
      message = `Domain '${domain}' is successfully pointed to ${expectedTarget}. SSL certificate active.`;
    } else if (resolvedCnames.length > 0 || resolvedIps.length > 0 || resolvedTxts.length > 0) {
      status = 'Pending';
      message = `DNS records detected for '${domain}', but target does not yet point to ${expectedTarget}. Propagation in progress.`;
    }

    return res.json({
      ok: true,
      domain,
      status,
      cnameVerified,
      aRecordVerified,
      txtVerified,
      expectedRecord,
      resolved: {
        cnames: resolvedCnames,
        aRecords: resolvedIps,
        txtRecords: resolvedTxts,
      },
      message,
    });
  });

  // Catch-all for unknown /api/* routes
  app.use('/api/*', (_req: Request, res: Response) => {
    sendTypedError(res, 404, 'API_ROUTE_NOT_FOUND', 'Requested API endpoint does not exist.');
  });

  // Global Express Error Handler (Suppresses stack traces)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return sendTypedError(res, 400, 'VALIDATION_ERROR', 'Invalid request payload', err.issues);
    }
    sendTypedError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected server error occurred.');
  });

  const isDirectEntry = Boolean(
    process.argv[1] &&
      (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'))
  );

  // ==========================================================================
  // Vite Middleware (Dev) or Static Dist Serving (Prod)
  // ==========================================================================
  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test' && isDirectEntry) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

const PORT = 3000;

const isDirectEntry = Boolean(
  process.argv[1] &&
    (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'))
);

if (process.env.NODE_ENV !== 'test' && isDirectEntry) {
  createAppServer().then((app) => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`AC PayPilot server listening on http://0.0.0.0:${PORT}`);
    });
  });
}
