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
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
  getPayPalApiBaseUrl,
} from './src/server/paymentEngine';
import {
  computeExecutiveKpisForDateRange,
  calculateAuthoritativeOrderTotalsMinor,
  fromMinorUnits,
  toMinorUnits,
} from './src/utils/finance';
import { AuthenticatedActor, evaluateRoleAccess } from './src/utils/rbac';
import {
  ESCROW_ARCHITECTURE_DECISION,
  transitionEscrowState,
  canTransitionEscrow,
  EscrowState,
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
import { runFullSystemDiagnostic, runSystemStatusSummary } from './src/server/healthService';

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
  resolvePublicStorefrontBySlug,
  seedDefaultStorefrontInFirestore,
  getAdminDb,
  getPersistenceMode,
  authMiddleware,
  getUserProfileFromDb,
  saveUserProfileToDb,
  PersistenceError,
  atomicLockOrderForCapture,
  atomicConsumeGuestTokenAndLockOrder,
  isWebhookEventProcessed,
  recordWebhookEvent,
  DEFAULT_BIZ_ID,
} from './src/server/firebaseAdmin';
import crypto from 'node:crypto';
import { validateStartupConfig, ConfigurationError } from './src/server/configValidator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveServerPort(rawPort: string | undefined = process.env.PORT): number {
  if (rawPort === undefined || rawPort.trim() === '') return 3000;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT '${rawPort}': must be an integer between 1 and 65535.`);
  }
  return port;
}

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

async function resolveOptionalAuth(req: Request): Promise<AuthenticatedUserActor | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    return await authenticateRequest(req);
  } catch {
    return null;
  }
}

function verifyGuestToken(order: any, candidateToken: string | undefined): boolean {
  if (!candidateToken || !order?.guestCaptureTokenHash) return false;
  try {
    const candidateHash = crypto.createHash('sha256').update(candidateToken.trim()).digest('hex');
    const storedHashBuf = Buffer.from(String(order.guestCaptureTokenHash), 'hex');
    const candidateHashBuf = Buffer.from(candidateHash, 'hex');
    return (
      storedHashBuf.length > 0 &&
      storedHashBuf.length === candidateHashBuf.length &&
      crypto.timingSafeEqual(storedHashBuf, candidateHashBuf)
    );
  } catch {
    return false;
  }
}

const ALLOWED_PAYPAL_CERT_HOSTS = new Set([
  'api.paypal.com',
  'api-m.paypal.com',
  'api.sandbox.paypal.com',
  'api-m.sandbox.paypal.com',
]);

function isAllowedPayPalCertUrl(certUrl: string): boolean {
  try {
    const parsed = new URL(certUrl);
    return parsed.protocol === 'https:' && ALLOWED_PAYPAL_CERT_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
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
  // Validate startup configuration and persistence requirements
  let configStatus: ReturnType<typeof validateStartupConfig>;
  try {
    configStatus = validateStartupConfig(process.env);
  } catch (err: any) {
    if (err instanceof ConfigurationError && err.message.includes('SECURITY VIOLATION')) {
      throw err;
    }
    const missingVars: string[] = err?.missingVars || [];
    if (process.env.NODE_ENV !== 'test') {
      console.error(
        `[PRODUCTION READINESS DEGRADED] Missing configuration [${missingVars.join(', ')}]. /health/ready will return 503 and durable mutations are blocked.`
      );
    }
    configStatus = {
      ok: false,
      missing: missingVars,
      warnings: [err?.message || 'Production configuration incomplete'],
      persistenceMode: getPersistenceMode(),
    };
  }
  if (configStatus.warnings.length > 0 && process.env.NODE_ENV !== 'test') {
    for (const warn of configStatus.warnings) {
      console.warn(`[CONFIG WARNING] ${warn}`);
    }
  }

  const app = express();
  app.disable('x-powered-by');

  const standardJsonParser = express.json({ limit: '1mb' });
  const mediaJsonParser = express.json({ limit: '25mb' });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (
      req.path === '/api/ai/transcribe' ||
      req.path === '/api/ai/image' ||
      req.path === '/api/ai/video'
    ) {
      return mediaJsonParser(req, res, next);
    }
    return standardJsonParser(req, res, next);
  });

  // Security headers, request correlation ID, CORS allowlist & API no-store cache policy
  const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const localDevOrigins = new Set([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);
  const apiRateBuckets = new Map<string, { count: number; resetAt: number }>();

  app.use((req: Request, res: Response, next: NextFunction) => {
    const rawReqId = req.headers['x-request-id'];
    const requestId =
      typeof rawReqId === 'string' && /^[a-zA-Z0-9._-]{4,64}$/.test(rawReqId)
        ? rawReqId
        : crypto.randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');

    const origin = req.headers.origin;
    if (origin) {
      const normalizedOrigin = origin.replace(/\/$/, '');
      const host = req.headers.host;
      const isSameOrigin =
        Boolean(host) &&
        (normalizedOrigin === `http://${host}` || normalizedOrigin === `https://${host}`);
      const isAllowed =
        isSameOrigin ||
        configuredOrigins.includes(normalizedOrigin) ||
        (process.env.NODE_ENV !== 'production' && localDevOrigins.has(normalizedOrigin));

      if (isAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, x-guest-capture-token, x-request-id'
        );
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      } else if (req.method === 'OPTIONS') {
        return sendTypedError(res, 403, 'CORS_ORIGIN_FORBIDDEN', 'Origin not permitted by CORS policy.');
      }
    }

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    if (req.path.startsWith('/api/') || req.path.startsWith('/health')) {
      res.setHeader('Cache-Control', 'no-store');
    }

    // General API rate limit (skipped in unit test mode & SSE/webhook/health checks)
    if (
      process.env.NODE_ENV !== 'test' &&
      req.path.startsWith('/api/') &&
      !req.path.startsWith('/api/health') &&
      req.path !== '/api/paypal/webhook' &&
      req.path !== '/api/orders/stream'
    ) {
      const ipKey = req.ip || req.socket.remoteAddress || 'local';
      const nowMs = Date.now();
      const windowMs = 60_000;
      const maxReqs = 180;
      const existing = apiRateBuckets.get(ipKey);
      if (!existing || existing.resetAt <= nowMs) {
        apiRateBuckets.set(ipKey, { count: 1, resetAt: nowMs + windowMs });
      } else {
        existing.count += 1;
        if (existing.count > maxReqs) {
          res.setHeader('Retry-After', String(Math.ceil((existing.resetAt - nowMs) / 1000)));
          return sendTypedError(res, 429, 'RATE_LIMIT_EXCEEDED', 'Too many API requests. Please retry shortly.');
        }
      }
    }

    next();
  });

  // Refuse ALL durable mutations in production when durable Firestore persistence is unavailable
  const persistenceCheckMiddleware = (_req: Request, res: Response, next: NextFunction) => {
    const durableRequired =
      process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true';
    if (durableRequired && getPersistenceMode() !== 'firestore-admin') {
      return sendTypedError(
        res,
        503,
        'PERSISTENCE_UNAVAILABLE',
        'Persistent database is unavailable. Durable mutations are disabled in volatile memory mode.'
      );
    }
    next();
  };

  // Seed default canonical storefront and products into Firestore only when Admin DB is active
  if (process.env.NODE_ENV !== 'test' && getPersistenceMode() === 'firestore-admin') {
    seedDefaultStorefrontInFirestore().catch((err) => {
      console.warn('Firestore initial seeding warning:', err?.message || err);
    });
  }

  // ==========================================================================
  // 0. System Health & Persistence Mode Diagnostic (/health, /api/health)
  // ==========================================================================
  app.get(['/health', '/api/health'], async (_req: Request, res: Response) => {
    try {
      const summary = await runSystemStatusSummary();
      const persistenceMode = getPersistenceMode();
      res.status(summary.ok ? 200 : 503).json({
        ok: summary.ok,
        status: summary.status,
        persistenceMode,
        serverTime: summary.serverTime,
        checks: summary.checks,
      });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        status: 'error',
        persistenceMode: getPersistenceMode(),
        error: err?.message || 'Health check failed',
      });
    }
  });

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
      paypalEnv: process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox',
      // In PayPal JS SDK, client-id is the public sandbox identifier for rendering buttons;
      // client-secret NEVER leaves the server. Uses PayPal's official "sb" sandbox test client-id fallback if unset.
      paypalClientId: hasPayPalClientId ? rawPaypalClientId : 'sb',
      hasCustomPayPalClientId: hasPayPalClientId,
      hasPayPalCredentials: hasPayPalClientId && hasPayPalSecret,
      hasGeminiKey,
      escrowArchitecture: ESCROW_ARCHITECTURE_DECISION,
    });
  });

  // Liveness is intentionally cheap and always available once the process is serving.
  app.get(['/health/live', '/api/health/live'], (_req: Request, res: Response) => {
    res.json({
      ok: true,
      status: 'live',
      serverTime: new Date().toISOString(),
    });
  });

  // Readiness fails closed in production when durable Firestore persistence is unavailable.
  app.get(['/health/ready', '/api/health/ready'], (_req: Request, res: Response) => {
    const persistenceMode = getPersistenceMode();
    const durableRequired = process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true';
    const ready = !durableRequired || persistenceMode === 'firestore-admin';
    res.status(ready ? 200 : 503).json({
      ok: ready,
      status: ready ? 'ready' : 'not_ready',
      persistenceMode,
      durableRequired,
      serverTime: new Date().toISOString(),
      ...(ready ? {} : { code: 'PERSISTENCE_UNAVAILABLE' }),
    });
  });

  // ==========================================================================
  // 1b. Real-Time Seller Order Notification Stream (SSE + Storefront Notify)
  // ==========================================================================
  const MAX_SSE_CLIENTS = 100;
  const MAX_SSE_PER_UID = 5;
  const orderStreamClients = new Map<
    Response,
    { uid: string; role: string; bizId: string }
  >();

  const broadcastLiveOrderNotification = (notification: {
    id: string;
    bizId: string;
    customerId?: string;
    orderNumber: string;
    customerName?: string;
    productSummary: string;
    totalInr: number;
    escrowStatus: string;
    createdAt: string;
  }) => {
    const safeEvent = {
      id: notification.id,
      bizId: notification.bizId,
      orderNumber: notification.orderNumber,
      productSummary: notification.productSummary,
      totalInr: notification.totalInr,
      escrowStatus: notification.escrowStatus,
      createdAt: notification.createdAt,
    };
    const payload = `data: ${JSON.stringify(safeEvent)}\n\n`;
    for (const [clientRes, meta] of orderStreamClients.entries()) {
      if (meta.bizId !== notification.bizId) continue;
      if (meta.role === 'customer' && notification.customerId && meta.uid !== notification.customerId) {
        continue;
      }
      if (meta.role === 'customer' && !notification.customerId) {
        continue;
      }
      try {
        clientRes.write(payload);
      } catch {
        orderStreamClients.delete(clientRes);
      }
    }
  };

  app.get('/api/orders/stream', async (req: Request, res: Response) => {
    const actor = await requireAuth(req, res);
    if (!actor) return;

    if (orderStreamClients.size >= MAX_SSE_CLIENTS) {
      return sendTypedError(res, 503, 'STREAM_CAPACITY_REACHED', 'Too many active notification streams.');
    }
    let userConnections = 0;
    for (const meta of orderStreamClients.values()) {
      if (meta.uid === actor.uid) userConnections += 1;
    }
    if (userConnections >= MAX_SSE_PER_UID) {
      return sendTypedError(res, 429, 'STREAM_LIMIT_EXCEEDED', 'Too many open streams for current user.');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify({ type: 'connected', bizId: actor.bizId, timestamp: new Date().toISOString() })}\n\n`);
    orderStreamClients.set(res, { uid: actor.uid, role: actor.role, bizId: actor.bizId });

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

  const OrderNotifySchema = z.object({
    id: z.string().min(1).max(120).optional(),
    orderNumber: z.string().min(1).max(64).optional(),
    productSummary: z.string().min(1).max(200).optional(),
    totalInr: z.number().nonnegative().max(100_000_000).optional(),
    escrowStatus: z.string().min(1).max(80).optional(),
    createdAt: z.string().optional(),
  });

  app.post('/api/orders/notify', persistenceCheckMiddleware, async (req: Request, res: Response) => {
    const actor = await requireAuth(req, res);
    if (!actor) return;

    try {
      const parsed = OrderNotifySchema.parse(req.body || {});
      const bizId = actor.bizId;
      const id = parsed.id || `ord-${Date.now()}`;
      const orderNumber = parsed.orderNumber || `#ORD-${Math.floor(1000 + Math.random() * 9000)}`;
      const productSummary = parsed.productSummary || 'Storefront Order';
      const totalInr = Number(parsed.totalInr ?? 0);
      const escrowStatus = parsed.escrowStatus || 'Escrow Locked';
      const createdAt = parsed.createdAt || new Date().toISOString();

      const notification = {
        id,
        bizId,
        customerId: actor.role === 'customer' ? actor.uid : undefined,
        orderNumber,
        productSummary,
        totalInr,
        escrowStatus,
        createdAt,
      };

      broadcastLiveOrderNotification(notification);
      res.status(201).json({ ok: true, notification });
    } catch (err: any) {
      if (err instanceof ZodError) {
        return sendTypedError(res, 400, 'VALIDATION_ERROR', 'Invalid order notification payload', err.issues);
      }
      res.status(400).json({ ok: false, error: err?.message || 'Unable to broadcast order notification' });
    }
  });

  // ==========================================================================
  // 2. PayPal Sandbox Orders v2 — Create Order (POST /api/paypal/create-order)
  // ==========================================================================
  app.post('/api/paypal/create-order', persistenceCheckMiddleware, async (req: Request, res: Response) => {
    let actor: AuthenticatedActor;
    let isGuest = false;
    let guestCaptureToken: string | undefined;
    let guestCaptureTokenHash: string | undefined;
    let guestExpiresAt: string | undefined;

    // Requirement P1: Reject an invalid supplied Bearer token with HTTP 401 instead of silently treating it as guest checkout
    const authHeader = req.headers.authorization;
    if (authHeader) {
      try {
        const userActor = await authenticateRequest(req);
        actor = userActor;
      } catch (err: any) {
        const status = err instanceof AuthenticationError ? err.statusCode : 401;
        const code = err instanceof AuthenticationError ? err.code : 'UNAUTHORIZED';
        return sendTypedError(res, status, code, err.message || 'Invalid authorization credentials');
      }
    } else {
      // Unauthenticated checkout: generate unique cryptographically secure guest actor & high-entropy capture token
      isGuest = true;
      actor = {
        uid: `guest-${Date.now()}-${crypto.randomBytes(16).toString('hex')}`,
        email: 'guest@paypilot.in',
        role: 'customer',
        bizId: DEFAULT_BIZ_ID,
      };
      guestCaptureToken = crypto.randomBytes(32).toString('hex');
      guestCaptureTokenHash = crypto.createHash('sha256').update(guestCaptureToken).digest('hex');
      guestExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 hour expiry
    }
    const requestedStoreSlug =
      typeof req.body?.storeSlug === 'string' ? req.body.storeSlug.trim() : '';
    let bizId = actor.bizId || DEFAULT_BIZ_ID;
    if (isGuest && requestedStoreSlug) {
      try {
        const resolvedStore = await resolvePublicStorefrontBySlug(requestedStoreSlug);
        bizId = resolvedStore.bizId;
      } catch {
        // Ignore unknown slug and validate against default tenant
      }
    }

    try {
      const parsedBody = CreatePayPalOrderSchema.parse({
        ...req.body,
        customerId: actor.uid, // Strictly enforce verified actor.uid, never trust body customerId
        sellerId: req.body?.sellerId || bizId,
        isGuestCheckout: isGuest,
        guestCaptureTokenHash,
        guestExpiresAt,
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
        priceUsd: p.priceUsd ?? (p.currency === 'USD' ? p.price : (typeof p.price === 'number' ? Math.round(p.price * Number(process.env.INR_TO_USD_EXCHANGE_RATE || 0.012) * 100) / 100 : undefined)),
        currency: p.currency || 'INR',
        gstRatePercent: p.gstRate || 18,
        hsnCode: p.hsCode || '8414',
      }));

      // Single authoritative calculation is used directly inside ledger creation and provider payload
      const result = await defaultServerLedger.createOrder(
        {
          ...parsedBody,
          guestCheckoutToken: guestCaptureToken,
        },
        { catalogProducts: catalogItems }
      );

      // On idempotent replay: do NOT overwrite the persisted order with new tokens or replace stored token hashes
      if (!result.idempotentReplay) {
        // Persist order and initial escrow event to Firestore businesses/{bizId}/orders
        await saveOrderForBiz(bizId, {
          ...result.order,
          bizId,
          isGuestCheckout: isGuest,
          guestCaptureTokenHash,
          guestExpiresAt,
          guestTokenUsed: false,
        });
        await recordEscrowEventForBiz(bizId, {
          orderId: result.order.id,
          fromState: null,
          toState: 'created',
          actorId: actor.uid,
          actorRole: actor.role,
          reason: `Order created for ${result.order.currency} ${result.order.totalMinor} minor units`,
          timestamp: new Date().toISOString(),
        });
      }

      const activeGuestToken = result.order.guestCheckoutToken || (isGuest ? guestCaptureToken : undefined);
      res.status(result.idempotentReplay ? 200 : 201).json({
        ok: true,
        ...result,
        ...(result.order.isGuestCheckout && activeGuestToken ? { guestCaptureToken: activeGuestToken } : {}),
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
  app.post('/api/paypal/capture-order/:id', persistenceCheckMiddleware, async (req: Request, res: Response) => {
    let actor: AuthenticatedActor | null = null;
    let isGuestCapture = false;

    // Check if Bearer token is provided
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        actor = await authenticateRequest(req);
      } catch (err: any) {
        const status = err instanceof AuthenticationError ? err.statusCode : 401;
        const code = err instanceof AuthenticationError ? err.code : 'UNAUTHORIZED';
        return sendTypedError(res, status, code, err.message || 'Invalid authentication token');
      }
    }

    const orderOrPaypalId = req.params.id;
    let existing = defaultServerLedger.getOrderWithEvents(orderOrPaypalId);
    if (!existing) {
      const firestoreOrder = await getOrderByIdForBiz(DEFAULT_BIZ_ID, orderOrPaypalId);
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
        `Order '${orderOrPaypalId}' was not found.`
      );
    }

    const order = existing.order;
    const bizId = order.bizId || DEFAULT_BIZ_ID;
    if (!defaultServerLedger.getOrderWithEvents(orderOrPaypalId)) {
      defaultServerLedger.hydrateOrderRecord(order as any, [], []);
    }
    const guestToken = (req.body?.guestCaptureToken || req.headers['x-guest-capture-token']) as string | undefined;

    if (actor) {
      // Authenticated via Bearer ID Token: Check role permissions
      if (
        actor.role !== 'finance' &&
        actor.role !== 'business_head' &&
        !(actor.role === 'customer' && order.customerId === actor.uid)
      ) {
        return sendTypedError(
          res,
          403,
          'ROLE_ACCESS_DENIED',
          'Only the order buyer or finance officer may capture this payment.'
        );
      }
    } else {
      // Guest Checkout: Require single-use high-entropy capture token
      if (!guestToken || typeof guestToken !== 'string' || guestToken.trim() === '') {
        return sendTypedError(
          res,
          401,
          'MISSING_AUTH_TOKEN',
          'Authentication required: provide a valid Bearer token or guest capture token.'
        );
      }

      if (!order.isGuestCheckout || !order.guestCaptureTokenHash) {
        return sendTypedError(
          res,
          403,
          'INVALID_GUEST_TOKEN',
          'This order was not created as guest checkout.'
        );
      }

      if (order.guestTokenUsed) {
        return sendTypedError(
          res,
          403,
          'GUEST_TOKEN_REUSED',
          'Guest capture token has already been used and is invalidated.'
        );
      }

      if (order.guestExpiresAt && new Date(order.guestExpiresAt).getTime() < Date.now()) {
        return sendTypedError(
          res,
          403,
          'GUEST_TOKEN_EXPIRED',
          'Guest capture token has expired.'
        );
      }

      // Constant-time comparison
      const candidateHash = crypto.createHash('sha256').update(guestToken.trim()).digest('hex');
      const storedHashBuf = Buffer.from(order.guestCaptureTokenHash, 'hex');
      const candidateHashBuf = Buffer.from(candidateHash, 'hex');

      if (
        storedHashBuf.length !== candidateHashBuf.length ||
        !crypto.timingSafeEqual(storedHashBuf, candidateHashBuf)
      ) {
        return sendTypedError(
          res,
          403,
          'INVALID_GUEST_TOKEN',
          'Invalid guest capture token for this order.'
        );
      }

      if (getPersistenceMode() === 'firestore-admin') {
        const idempotencyKey = req.body?.idempotencyKey || (req.headers['idempotency-key'] as string) || `cap-${order.id}`;
        const txResult = await atomicConsumeGuestTokenAndLockOrder(bizId, order.id, guestToken, idempotencyKey);
        if (!txResult.ok) {
          const code = txResult.statusCode === 409
            ? 'CONCURRENT_CAPTURE_CONFLICT'
            : txResult.reason?.includes('expired')
            ? 'GUEST_TOKEN_EXPIRED'
            : txResult.reason?.includes('already been used')
            ? 'GUEST_TOKEN_REUSED'
            : 'INVALID_GUEST_TOKEN';
          return sendTypedError(res, txResult.statusCode || 403, code, txResult.reason || 'Invalid guest token');
        }
      }

      isGuestCapture = true;
      actor = {
        uid: order.customerId,
        email: order.buyerEmail || 'guest@paypilot.in',
        role: 'customer',
        bizId,
      };
    }

    const captureIdempotencyKey =
      req.body?.idempotencyKey || (req.headers['idempotency-key'] as string) || `cap-${order.id}`;

    // For authenticated orders in production firestore-admin mode, acquire durable capture lock
    if (!guestToken && getPersistenceMode() === 'firestore-admin') {
      const lockResult = await atomicLockOrderForCapture(bizId, order.id, captureIdempotencyKey);
      if (!lockResult.ok) {
        const code =
          lockResult.statusCode === 409
            ? 'CONCURRENT_CAPTURE_CONFLICT'
            : 'CAPTURE_LOCK_FAILED';
        return sendTypedError(
          res,
          lockResult.statusCode || 409,
          code,
          lockResult.reason || 'Capture lock failed'
        );
      }
    }

    try {
      const parsedBody = CapturePayPalOrderSchema.parse({
        ...req.body,
        actorId: actor.uid,
        actorRole: actor.role,
      });

      const result = await defaultServerLedger.captureOrder(orderOrPaypalId, parsedBody);

      if (isGuestCapture || order.isGuestCheckout) {
        order.guestTokenUsed = true;
        result.order.guestTokenUsed = true;
      }

      // Persist captured order & payment to Firestore businesses/{bizId}/...
      try {
        await saveOrderForBiz(bizId, {
          ...result.order,
          bizId,
          guestTokenUsed: true,
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
      } catch (persistErr: any) {
        // Requirement P0: Provider capture succeeded but DB write failed -> produce recoverable reconciliation state
        if (
          persistErr instanceof PersistenceError ||
          persistErr?.name === 'PersistenceError' ||
          persistErr?.code === 'DURABLE_WRITE_FAILED'
        ) {
          console.error(
            '[CRITICAL FINANCIAL RECONCILIATION] Provider capture succeeded but durable persistence failed. DO NOT report payment failed.',
            {
              orderId: result.order.id,
              paypalCaptureId: result.order.paypalCaptureId,
              error: persistErr.message,
            }
          );
          return res.status(502).json({
            ok: false,
            code: 'PAYMENT_CAPTURED_RECONCILIATION_REQUIRED',
            error:
              'Payment was captured by PayPal, but durable database persistence failed. Payment has been flagged for automated reconciliation. Escrow remains held in safety.',
            orderId: result.order.id,
            paypalCaptureId: result.order.paypalCaptureId,
            paymentStatus: result.order.paymentStatus,
            escrowState: 'created',
            reconciliationRequired: true,
          });
        }
        throw persistErr;
      }

      if (!result.idempotentReplay && result.order.paymentStatus === 'Captured') {
        const firstItemName =
          result.order.items?.[0]?.name || 'AeroBreeze Smart BLDC Bundle';
        const extraCount = (result.order.items?.length || 1) - 1;
        broadcastLiveOrderNotification({
          id: result.order.id,
          bizId: actor.bizId || bizId,
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
      if (err?.message === 'CONCURRENT_CAPTURE_CONFLICT') {
        return sendTypedError(
          res,
          409,
          'CONCURRENT_CAPTURE_CONFLICT',
          'A capture operation is already in progress for this order with a different idempotency key.'
        );
      }
      if (err?.message === 'GUEST_TOKEN_REUSED') {
        return sendTypedError(
          res,
          403,
          'GUEST_TOKEN_REUSED',
          'Guest capture token has already been used and is invalidated.'
        );
      }
      if (err?.message === 'GUEST_TOKEN_EXPIRED') {
        return sendTypedError(
          res,
          403,
          'GUEST_TOKEN_EXPIRED',
          'Guest capture token has expired.'
        );
      }
      const message = err instanceof Error ? err.message : 'Unable to capture PayPal order';
      return sendTypedError(res, 400, 'ORDER_CAPTURE_FAILED', message);
    }
  });

  // ==========================================================================
  // 4. PayPal Sandbox Cancel Order (POST /api/paypal/cancel-order/:id)
  // ==========================================================================
  app.post('/api/paypal/cancel-order/:id', persistenceCheckMiddleware, async (req: Request, res: Response) => {
    const actorResolved = await resolveOptionalAuth(req);
    let actor: AuthenticatedActor | null = actorResolved;

    const orderOrPaypalId = req.params.id;
    let existing = defaultServerLedger.getOrderWithEvents(orderOrPaypalId);
    if (!existing) {
      const firestoreOrder = await getOrderByIdForBiz(actor?.bizId || DEFAULT_BIZ_ID, orderOrPaypalId);
      if (firestoreOrder) {
        existing = {
          order: firestoreOrder,
          escrowEvents: [],
          payments: [],
        };
      }
    }

    if (!existing) {
      return sendTypedError(res, 404, 'ORDER_NOT_FOUND', `Order '${orderOrPaypalId}' not found.`);
    }

    const order = existing.order;
    const bizId = order.bizId || DEFAULT_BIZ_ID;
    if (!defaultServerLedger.getOrderWithEvents(orderOrPaypalId)) {
      defaultServerLedger.hydrateOrderRecord(order as any, [], []);
    }

    if (!actor) {
      const guestToken = (req.body?.guestCaptureToken || req.headers['x-guest-capture-token']) as string | undefined;
      if (!guestToken || !order.guestCaptureTokenHash) {
        return sendTypedError(res, 401, 'MISSING_AUTH_TOKEN', 'Authentication required to cancel order.');
      }
      if (!verifyGuestToken(order, guestToken)) {
        return sendTypedError(res, 403, 'INVALID_GUEST_TOKEN', 'Invalid guest capture token.');
      }
      actor = {
        uid: order.customerId,
        email: order.buyerEmail || 'guest@paypilot.in',
        role: 'customer',
        bizId,
      };
    }

    try {
      const parsedBody = CancelPayPalOrderSchema.parse({
        ...req.body,
        actorId: actor.uid,
      });

      const updatedOrder = defaultServerLedger.cancelOrder(orderOrPaypalId, parsedBody);
      await saveOrderForBiz(bizId, {
        ...updatedOrder,
        bizId,
      });

      res.json({
        ok: true,
        order: updatedOrder,
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
    const actor = await resolveOptionalAuth(req);
    const guestToken = req.headers['x-guest-capture-token'] as string | undefined;

    if (!actor && !guestToken) {
      return sendTypedError(
        res,
        401,
        'MISSING_AUTH_TOKEN',
        'Authentication or valid x-guest-capture-token header is required to inspect checkout status.'
      );
    }

    const orderOrPaypalId = req.params.id;
    let found = defaultServerLedger.getOrderWithEvents(orderOrPaypalId);

    if (!found) {
      const firestoreOrder = await getOrderByIdForBiz(actor?.bizId || DEFAULT_BIZ_ID, orderOrPaypalId);
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

    if (actor) {
      if (found.order.bizId && found.order.bizId !== actor.bizId) {
        return sendTypedError(
          res,
          403,
          'TENANT_ACCESS_DENIED',
          'Cannot inspect an order belonging to another business tenant.'
        );
      }
      const decision = evaluateRoleAccess(actor, 'orders', 'read', {
        customerId: found.order.customerId,
        sellerId: found.order.sellerId,
      });
      if (!decision.allowed) {
        return sendTypedError(res, 403, 'ORDER_ACCESS_DENIED', 'Not authorized to inspect this order.');
      }

      return res.json({
        ok: true,
        order: found.order,
        escrowEvents: found.escrowEvents,
        payments: found.payments,
        verifiedByServer: found.order.verifiedByServer,
      });
    }

    if (!verifyGuestToken(found.order, guestToken)) {
      return sendTypedError(
        res,
        403,
        'INVALID_GUEST_TOKEN',
        'Invalid guest capture token for this checkout order.'
      );
    }

    // Minimal buyer-safe checkout projection for verified guest capture token
    const safeOrder = {
      id: found.order.id,
      orderNumber: found.order.orderNumber,
      paypalOrderId: found.order.paypalOrderId,
      paypalCaptureId: found.order.paypalCaptureId,
      currency: found.order.currency,
      total: fromMinorUnits(found.order.totalMinor),
      totalMinor: found.order.totalMinor,
      subtotalMinor: found.order.subtotalMinor,
      taxMinor: found.order.taxMinor,
      paypalFeeMinor: found.order.paypalFeeMinor,
      netPayoutMinor: found.order.netPayoutMinor,
      feesFromProvider: found.order.feesFromProvider,
      paymentStatus: found.order.paymentStatus,
      escrowState: found.order.escrowState,
      verifiedByServer: found.order.verifiedByServer,
      failureReason: found.order.failureReason,
      items: found.order.items,
      createdAt: found.order.createdAt,
      updatedAt: found.order.updatedAt,
    };

    return res.json({
      ok: true,
      order: safeOrder,
      escrowEvents: found.escrowEvents,
      payments: [],
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

    const isProduction = process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true';
    let orders = Array.from(orderMap.values());
    if (isProduction) {
      orders = orders.filter((o) => !o.isDemo);
    }

    res.json({
      ok: true,
      bizId: actor.bizId,
      actorRole: actor.role,
      orders,
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

    const isProduction = process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true';
    let payments = Array.from(paymentMap.values());
    if (isProduction) {
      payments = payments.filter((p) => !p.isDemo);
    }

    res.json({
      ok: true,
      bizId: actor.bizId,
      payments,
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

  app.post('/api/paypal/refund-order/:id', persistenceCheckMiddleware, async (req: Request, res: Response) => {
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

    // Tenant boundary check:
    if (authoritativeOrder.bizId && authoritativeOrder.bizId !== actor.bizId) {
      return sendTypedError(
        res,
        403,
        'TENANT_ACCESS_DENIED',
        'Cannot issue refund for an order belonging to another business tenant.'
      );
    }

    // State validation: Funds must have been captured from provider before refunding
    if (authoritativeOrder.paymentStatus !== 'Captured') {
      return sendTypedError(
        res,
        400,
        'INVALID_REFUND_STATE',
        `Cannot refund order with payment status '${authoritativeOrder.paymentStatus}'. Order must be 'Captured'.`
      );
    }

    // Escrow state machine validation:
    const currentEscrow = (authoritativeOrder.escrowState || authoritativeOrder.escrowStage || 'created') as any;
    if (!canTransitionEscrow(currentEscrow, 'refunded')) {
      return sendTypedError(
        res,
        400,
        'INVALID_STATE_TRANSITION',
        `Cannot refund order in escrow state '${currentEscrow}'. Escrow funds may have already been released or refunded.`
      );
    }

    // Never trust amounts coming from the client; derive strictly from authoritative server record
    const refundAmountMinor =
      typeof authoritativeOrder.totalMinor === 'number'
        ? authoritativeOrder.totalMinor
        : Math.round(Number(authoritativeOrder.total || authoritativeOrder.amountInr || 0) * 100);
    const refundCurrency: 'INR' | 'USD' = authoritativeOrder.currency === 'USD' ? 'USD' : 'INR';
    const refundIdempotencyKey =
      (typeof req.body?.idempotencyKey === 'string' && req.body.idempotencyKey.trim()) ||
      `refund-${authoritativeOrder.id}-${currentEscrow}`;

    // Execute PayPal provider refund BEFORE mutating local or Firestore state (SEC-006)
    let providerRefund: { refundId: string; status: 'COMPLETED' | 'PENDING'; mode: string };
    try {
      providerRefund = await defaultServerLedger.executeProviderRefund({
        paypalCaptureId: authoritativeOrder.paypalCaptureId || '',
        amountMinor: refundAmountMinor,
        currency: refundCurrency,
        reason,
        idempotencyKey: refundIdempotencyKey,
      });
    } catch (providerErr: any) {
      return sendTypedError(
        res,
        502,
        'PAYPAL_REFUND_FAILED',
        providerErr?.message || 'PayPal refund execution failed; escrow state was not mutated.'
      );
    }

    // Sync in-memory ledger after verified provider refund
    if (ledgerEntry) {
      try {
        defaultServerLedger.transitionOrderEscrow(authoritativeOrder.id, {
          nextState: 'refunded',
          actorId: actor.uid,
          actorRole: actor.role as any,
          reason,
        });
      } catch {
        // Ledger state sync
      }
    }

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
      paypalRefundId: providerRefund.refundId,
      refundStatus: providerRefund.status,
      refundProviderMode: providerRefund.mode,
      updatedAt: new Date().toISOString(),
    });

    const escrowEvent = await recordEscrowEventForBiz(actor.bizId, {
      orderId: updatedOrder.id,
      paypalOrderId: updatedOrder.paypalOrderId || orderOrPaypalId,
      paypalRefundId: providerRefund.refundId,
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
      providerRefund,
      authoritativeAmountInr,
    });
  });

  // ==========================================================================
  // 7. Application-Level Escrow Transition (POST /api/orders/:id/escrow-transition)
  // ==========================================================================
  app.post('/api/orders/:id/escrow-transition', persistenceCheckMiddleware, async (req: Request, res: Response) => {
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

      // Fetch authoritative order first to verify existence, tenant isolation, and ownership boundaries
      const firestoreOrder = await getOrderByIdForBiz(actor.bizId, orderId);
      const ledgerEntry = defaultServerLedger.getOrderWithEvents(orderId);
      const authoritativeOrder = firestoreOrder || ledgerEntry?.order;

      if (!authoritativeOrder) {
        return sendTypedError(
          res,
          404,
          'ORDER_NOT_FOUND',
          `Order '${orderId}' was not found in server ledger or Firestore.`
        );
      }

      // Tenant boundary check:
      if (authoritativeOrder.bizId && authoritativeOrder.bizId !== actor.bizId) {
        return sendTypedError(
          res,
          403,
          'TENANT_ACCESS_DENIED',
          'Cannot transition escrow for another business tenant.'
        );
      }

      // Customer ownership check: Customers may only transition their own orders
      if (
        actor.role === 'customer' &&
        authoritativeOrder.customerId &&
        authoritativeOrder.customerId !== actor.uid
      ) {
        return sendTypedError(
          res,
          403,
          'ORDER_ACCESS_DENIED',
          'Customers may only transition escrow on their own orders.'
        );
      }

      // Seller ownership check: Sellers may only transition orders assigned to them
      if (
        actor.role === 'seller' &&
        authoritativeOrder.sellerId &&
        authoritativeOrder.sellerId !== actor.uid
      ) {
        return sendTypedError(
          res,
          403,
          'ORDER_ACCESS_DENIED',
          'Sellers may only transition escrow on their own assigned orders.'
        );
      }

      const targetBizId = authoritativeOrder.bizId || actor.bizId;

      let result;
      try {
        result = defaultServerLedger.transitionOrderEscrow(orderId, parsedBody);
      } catch (ledgerErr) {
        // If not found in memory ledger, look up in Firestore businesses/{bizId}/orders
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
        const updated = await saveOrderForBiz(targetBizId, {
          ...firestoreOrder,
          escrowState: parsedBody.nextState,
          updatedAt: new Date().toISOString(),
        });
        const event = await recordEscrowEventForBiz(targetBizId, transitionCheck.event);
        result = { order: updated, event, nextState: parsedBody.nextState };
      }

      // Persist transition to Firestore businesses/{bizId}/orders & escrowEvents
      await saveOrderForBiz(targetBizId, {
        ...result.order,
        bizId: targetBizId,
      });
      if (result.event) {
        await recordEscrowEventForBiz(targetBizId, result.event);
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
  // 9. Executive KPI Calculation for Chosen Date Range (GET & POST /api/executive/kpis)
  // ==========================================================================
  async function loadScopedOrdersForActor(actor: { bizId: string; uid: string; role: any }) {
    const firestoreOrders = await getOrdersForBiz(actor.bizId, actor as any);
    const ledgerOrders = defaultServerLedger.listOrdersForActor(actor as any);
    const mergedMap = new Map<string, any>();
    for (const ord of firestoreOrders) {
      if (!ord.bizId || ord.bizId === actor.bizId) mergedMap.set(ord.id, ord);
    }
    for (const ord of ledgerOrders) {
      if (!mergedMap.has(ord.id) && (!ord.bizId || ord.bizId === actor.bizId)) {
        mergedMap.set(ord.id, ord);
      }
    }
    return Array.from(mergedMap.values());
  }

  app.get('/api/executive/kpis', async (req: Request, res: Response) => {
    try {
      const actor = await requireAuth(req, res);
      if (!actor) return;
      if (actor.role !== 'business_head' && actor.role !== 'finance') {
        return sendTypedError(
          res,
          403,
          'ROLE_ACCESS_DENIED',
          'Only Business Head and Finance roles may query Executive KPI aggregates.'
        );
      }

      const rawRange = String(req.query.dateRange || '30d');
      const dateRange = (['7d', '30d', '90d', 'all'].includes(rawRange) ? rawRange : '30d') as
        | '7d'
        | '30d'
        | '90d'
        | 'all';
      const hasComparisonRequested = String(req.query.hasComparison || 'false') === 'true';
      const allowDemo =
        actor.uid.startsWith('demo-') ||
        process.env.DEMO_MODE === 'true' ||
        process.env.NODE_ENV === 'test';

      const scopedOrders = (await loadScopedOrdersForActor(actor)).filter(
        (o) => allowDemo || !o.isDemo
      );

      const nowMs = Date.now();
      const rangeDays = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : dateRange === '90d' ? 90 : 3650;
      const cutoffMs = nowMs - rangeDays * 86400000;
      const inWindowOrders =
        dateRange === 'all'
          ? scopedOrders
          : scopedOrders.filter((o) => {
              const t = new Date(o.createdAt || nowMs).getTime();
              return Number.isFinite(t) && t >= cutoffMs;
            });

      const resolveTotalMinor = (o: any) =>
        typeof o.totalMinor === 'number'
          ? o.totalMinor
          : Math.round(Number(o.total || o.amountInr || 0) * 100);

      let gmvMinor = 0;
      let subtotalMinor = 0;
      let taxMinor = 0;
      let capturedCount = 0;
      let authorizedEscrowMinor = 0;
      let refundedMinor = 0;
      let verifiedPaypalFeeMinorSum = 0;
      let hasProviderFees = false;

      for (const o of inWindowOrders) {
        const totalMinor = resolveTotalMinor(o);
        const subMinor =
          typeof o.subtotalMinor === 'number' ? o.subtotalMinor : Math.round((totalMinor * 100) / 118);
        const oTaxMinor =
          typeof o.taxMinor === 'number' ? o.taxMinor : Math.max(0, totalMinor - subMinor);

        gmvMinor += totalMinor;
        subtotalMinor += subMinor;
        taxMinor += oTaxMinor;

        const isCaptured =
          o.paymentStatus === 'Captured' ||
          o.escrowState === 'funded' ||
          o.escrowState === 'in_delivery' ||
          o.escrowState === 'released';
        if (isCaptured) capturedCount += 1;

        if (o.escrowState === 'funded' || o.escrowState === 'in_delivery') {
          authorizedEscrowMinor += totalMinor;
        }
        if (o.escrowState === 'refunded' || o.paymentStatus === 'Refunded') {
          refundedMinor += totalMinor;
        }
        if (o.feesFromProvider === true && typeof o.paypalFeeMinor === 'number') {
          hasProviderFees = true;
          verifiedPaypalFeeMinorSum += o.paypalFeeMinor;
        }
      }

      const startIso = new Date(dateRange === 'all' ? 0 : cutoffMs).toISOString();
      const endIso = new Date(nowMs).toISOString();
      const comparisonReport = computeExecutiveKpisForDateRange(
        scopedOrders.map((o) => ({
          id: o.id,
          totalMinor: resolveTotalMinor(o),
          escrowState: (o.escrowState || 'created') as EscrowState,
          createdAtIso: o.createdAt || endIso,
          isDemo: Boolean(o.isDemo),
        })),
        startIso,
        endIso,
        'INR',
        { includeDemo: allowDemo }
      );

      const hasComparisonData = hasComparisonRequested && comparisonReport.hasBaseline;
      const comparisonNote = hasComparisonRequested
        ? comparisonReport.hasBaseline
          ? comparisonReport.growthLabel
          : 'No prior-period baseline records available'
        : 'Current window only (comparison off)';

      return res.json({
        ok: true,
        dateRange,
        currency: 'INR',
        recordCount: inWindowOrders.length,
        hasComparisonData,
        comparisonNote,
        kpis: {
          gmvMinor,
          subtotalMinor,
          taxMinor,
          capturedCount,
          authorizedEscrowMinor,
          refundedMinor,
          verifiedPaypalFeeMinor: hasProviderFees ? verifiedPaypalFeeMinorSum : null,
          verifiedNetPayoutMinor: hasProviderFees ? Math.max(0, gmvMinor - verifiedPaypalFeeMinorSum) : null,
          feesFromProvider: hasProviderFees,
        },
      });
    } catch {
      return sendTypedError(res, 400, 'KPI_CALCULATION_ERROR', 'Failed to compute executive KPIs');
    }
  });

  app.post('/api/executive/kpis', async (req: Request, res: Response) => {
    try {
      const actor = await requireAuth(req, res);
      if (!actor) return;
      if (actor.role !== 'business_head' && actor.role !== 'finance') {
        return sendTypedError(
          res,
          403,
          'ROLE_ACCESS_DENIED',
          'Only Business Head and Finance roles may query Executive KPI aggregates.'
        );
      }

      const parsed = ExecutiveKpiBodySchema.parse(req.body);
      const scopedOrders = await loadScopedOrdersForActor(actor);
      const report = computeExecutiveKpisForDateRange(
        scopedOrders.map((o) => ({
          id: o.id,
          totalMinor:
            typeof o.totalMinor === 'number'
              ? o.totalMinor
              : Math.round(Number(o.total || o.amountInr || 0) * 100),
          escrowState: (o.escrowState || 'created') as EscrowState,
          createdAtIso: o.createdAt || new Date().toISOString(),
        })),
        parsed.startIso,
        parsed.endIso,
        parsed.currency
      );

      res.json({
        ok: true,
        bizId: actor.bizId,
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

  function enforceAiRateLimit(req: Request, res: Response, authenticatedUid?: string): boolean {
    const actorUid = authenticatedUid || resolveActorFromRequest(req).uid;
    const key = `${actorUid}:${req.ip || 'local'}`;
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
    const actor = await requireAuth(req, res);
    if (!actor) return;
    if (!enforceAiRateLimit(req, res, actor.uid)) return;
    try {
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
    const actor = await requireAuth(req, res);
    if (!actor) return;
    if (actor.role !== 'seller' && actor.role !== 'finance' && actor.role !== 'business_head') {
      return sendTypedError(res, 403, 'RBAC_FORBIDDEN', 'Only seller, finance, or business head may analyze GST invoices.');
    }
    if (!enforceAiRateLimit(req, res, actor.uid)) return;
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
    const optActor = await resolveOptionalAuth(req);
    if (!enforceAiRateLimit(req, res, optActor?.uid)) return;
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
    const actor = await requireAuth(req, res);
    if (!actor) return;
    if (actor.role !== 'seller' && actor.role !== 'business_head') {
      return sendTypedError(res, 403, 'RBAC_FORBIDDEN', 'Only sellers or business heads may generate product listings.');
    }
    if (!enforceAiRateLimit(req, res, actor.uid)) return;
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
    const actor = await requireAuth(req, res);
    if (!actor) return;
    if (actor.role !== 'business_head' && actor.role !== 'finance') {
      return sendTypedError(res, 403, 'RBAC_FORBIDDEN', 'Only Finance and Business Head roles may generate executive insights.');
    }
    if (!enforceAiRateLimit(req, res, actor.uid)) return;
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
    const actor = await requireAuth(req, res);
    if (!actor) return;
    if (actor.role !== 'seller' && actor.role !== 'finance' && actor.role !== 'business_head') {
      return sendTypedError(res, 403, 'RBAC_FORBIDDEN', 'Only merchant staff may query escrow recommendations.');
    }
    if (!enforceAiRateLimit(req, res, actor.uid)) return;
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
    const optActor = await resolveOptionalAuth(req);
    if (!enforceAiRateLimit(req, res, optActor?.uid)) return;
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
    const actor = await requireAuth(req, res);
    if (!actor) return;
    if (!enforceAiRateLimit(req, res, actor.uid)) return;
    try {
      const parsed = AiSuggestBodySchema.parse(req.body);
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

  app.get('/api/products/assets', async (req: Request, res: Response) => {
    const actor = await resolveOptionalAuth(req);
    const bizId = actor?.bizId || DEFAULT_BIZ_ID;
    return res.json({
      ok: true,
      bizId,
      assets: listAllSeller3DAssets(bizId),
    });
  });

  app.get('/api/products/:sku/asset', async (req: Request, res: Response) => {
    const actor = await resolveOptionalAuth(req);
    const bizId = actor?.bizId || DEFAULT_BIZ_ID;
    const asset = getSeller3DAsset(req.params.sku, bizId);
    return res.json({
      ok: true,
      sku: req.params.sku,
      bizId,
      hasModel: Boolean(asset && asset.status === 'Ready' && asset.modelUrl),
      asset,
    });
  });

  const SellerAssetUploadSchema = z.object({
    fileName: z.string().min(1, 'fileName is required'),
    sizeBytes: z.number().int().nonnegative(),
  });

  app.post('/api/products/:sku/asset', persistenceCheckMiddleware, async (req: Request, res: Response) => {
    try {
      const actor = await requireAuth(req, res);
      if (!actor) return;
      if (actor.role !== 'seller' && actor.role !== 'business_head') {
        return sendTypedError(
          res,
          403,
          'RBAC_FORBIDDEN',
          `Role '${actor.role}' cannot upload 3D product assets.`
        );
      }

      const rawSku = req.params.sku;
      const cleanSku = rawSku.replace(/^#/, '');
      const products = await getProductsForBiz(actor.bizId);
      const ownedProduct = products.find(
        (p) =>
          p.id === rawSku ||
          p.id === cleanSku ||
          String(p.sku || '').replace(/^#/, '') === cleanSku
      );
      if (!ownedProduct) {
        return sendTypedError(
          res,
          404,
          'PRODUCT_NOT_FOUND',
          `SKU '${rawSku}' does not exist in business tenant '${actor.bizId}'.`
        );
      }
      if (actor.role === 'seller' && ownedProduct.sellerId && ownedProduct.sellerId !== actor.uid) {
        return sendTypedError(
          res,
          403,
          'RBAC_FORBIDDEN',
          `Product '${rawSku}' belongs to another seller and cannot be mutated by '${actor.uid}'.`
        );
      }

      const parsed = SellerAssetUploadSchema.parse(req.body);
      const record = registerSeller3DAsset({
        sku: rawSku,
        bizId: actor.bizId,
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
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      throw new Error('GEMINI_API_KEY_MISSING');
    }
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
    const actor = await resolveOptionalAuth(req);
    const activeActor = actor || (await requireAuth(req, res));
    if (!activeActor) return;
    if (!enforceAiRateLimit(req, res, activeActor.uid)) return;

    try {
      const {
        messages = [],
        model = 'gemini-3.8-flash',
        portalRole = 'seller',
      } = req.body || {};

      const allowedModels = ['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];
      const selectedModel = allowedModels.includes(model) ? model : 'gemini-3.8-flash';
      const resolvedPortalRole =
        activeActor.role === 'customer' ? 'customer' : portalRole === 'customer' ? 'customer' : 'seller';

      const systemInstruction =
        resolvedPortalRole === 'customer'
          ? 'You are the AC PayPilot Customer Shopping & Escrow Concierge. Help shoppers compare smart hardware products (AeroBreeze BLDC Ceiling Fan #FAN-BLDC-892, Yonex Astrox 99 Pro #SPO-YNX-99P, AcousticSphere ANC Pods #AUD-ANC-99, ProArt Studio Workstation #AC-WRK-8990), inspect 3D/AR models, optimize SmartCart budgets in INR (₹), and understand 100% PayPal Escrow buyer protection. Keep answers concise, clear, and helpful.'
          : 'You are the AC PayPilot Seller Operations & Autonomous Escrow Strategist. Help merchants analyze order volume trends, audit GST invoices (CGST/SGST vs IGST), optimize product listings, triage escrow risk anomalies, and manage PayPal Sandbox settlements in INR (₹). Provide actionable, data-driven answers.';

      const normalizedHistory = Array.isArray(messages)
        ? messages
            .filter((m: any) => m && typeof m.text === 'string' && m.text.trim().length > 0)
            .slice(-24)
            .map((m: any) => ({
              role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
              parts: [{ text: String(m.text).slice(0, 4000) }],
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
        portalRole: resolvedPortalRole,
        reply: response.text || 'Processed your request.',
      });
    } catch (err: any) {
      if (err?.message === 'GEMINI_API_KEY_MISSING') {
        return sendTypedError(res, 503, 'AI_SERVICE_UNAVAILABLE', 'Gemini API key is not configured.');
      }
      const msg = err instanceof Error ? err.message : 'Unable to generate chat response';
      return res.status(500).json({
        ok: false,
        error: msg,
      });
    }
  });

  // Microphone Audio Transcription (gemini-3.5-transcribe)
  app.post('/api/ai/transcribe', async (req: Request, res: Response) => {
    const actor = await requireAuth(req, res);
    if (!actor) return;
    if (!enforceAiRateLimit(req, res, actor.uid)) return;

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
      if (err?.message === 'GEMINI_API_KEY_MISSING') {
        return sendTypedError(res, 503, 'AI_SERVICE_UNAVAILABLE', 'Gemini API key is not configured.');
      }
      const msg = err instanceof Error ? err.message : 'Audio transcription failed';
      return res.status(500).json({
        ok: false,
        error: msg,
      });
    }
  });

  // Create & Edit Images (gemini-nano-banana-2.1)
  app.post('/api/ai/image', async (req: Request, res: Response) => {
    const actor = await requireAuth(req, res);
    if (!actor) return;
    if (!enforceAiRateLimit(req, res, actor.uid)) return;

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
      if (err?.message === 'GEMINI_API_KEY_MISSING') {
        return sendTypedError(res, 503, 'AI_SERVICE_UNAVAILABLE', 'Gemini API key is not configured.');
      }
      const msg = err instanceof Error ? err.message : 'Image generation/editing failed';
      return res.status(500).json({
        ok: false,
        error: msg,
      });
    }
  });

  // Animate Uploaded Photo into Video via Interactions API (gemini-omni-1.1-flash)
  app.post('/api/ai/video', async (req: Request, res: Response) => {
    const actor = await requireAuth(req, res);
    if (!actor) return;
    if (!enforceAiRateLimit(req, res, actor.uid)) return;

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
      if (err?.message === 'GEMINI_API_KEY_MISSING') {
        return sendTypedError(res, 503, 'AI_SERVICE_UNAVAILABLE', 'Gemini API key is not configured.');
      }
      const msg = err instanceof Error ? err.message : 'Video generation failed';
      return res.status(500).json({
        ok: false,
        error: msg,
      });
    }
  });

  // ==========================================================================
  // 12. System Health Check Diagnostic Endpoint (GET /api/health/system-check)
  // ==========================================================================
  app.get('/api/health/system-check', async (req: Request, res: Response) => {
    const actor = await requireAuth(req, res);
    if (!actor) return;
    if (!enforceAiRateLimit(req, res, actor.uid)) return;

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

    // Verify certUrl is valid HTTPS and strictly hosted on an official PayPal API hostname
    if (!isAllowedPayPalCertUrl(certUrl)) {
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
      const paypalApiBase = getPayPalApiBaseUrl();
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch(`${paypalApiBase}/v1/oauth2/token`, {
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
        `${paypalApiBase}/v1/notifications/verify-webhook-signature`,
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

  app.post('/api/paypal/webhook', persistenceCheckMiddleware, async (req: Request, res: Response) => {
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

      // Check existing processed status (durable + memory) before mutating
      if (parsed.id) {
        const isProcessed = await isWebhookEventProcessed(parsed.id);
        if (isProcessed || processedWebhookEventIds.has(parsed.id)) {
          return res.status(200).json({
            ok: true,
            duplicate: true,
            eventId: parsed.id,
            status: 'DUPLICATE_IGNORED',
            message: `Event '${parsed.id}' has already been processed.`,
          });
        }
      }

      // Check for supported event types BEFORE recording event ID
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

      // Validate referenced order, currency & minor-unit amount BEFORE recording webhook deduplication
      let existingOrder: any = null;
      let existingLedger: ReturnType<typeof defaultServerLedger.getOrderWithEvents> = null;
      if (paypalOrderId) {
        existingOrder = await getOrderByIdForBiz(DEFAULT_BIZ_ID, paypalOrderId);
        existingLedger = defaultServerLedger.getOrderWithEvents(paypalOrderId);
        const targetOrder = existingOrder || existingLedger?.order;

        if (!targetOrder) {
          return sendTypedError(
            res,
            404,
            'ORDER_NOT_FOUND',
            `Order '${paypalOrderId}' referenced in webhook does not exist.`
          );
        }

        // Amount & currency verification if included in resource (exact integer minor-unit check)
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
            if (resMinor !== targetOrder.totalMinor) {
              return sendTypedError(
                res,
                400,
                'WEBHOOK_AMOUNT_MISMATCH',
                `Webhook amount '${resMinor}' does not match order total '${targetOrder.totalMinor}'.`
              );
            }
          }
        }
      }

      // Atomically claim event ID only AFTER validation passes (eliminates TOCTOU duplicate race)
      if (parsed.id) {
        const recordResult = await recordWebhookEvent(parsed.id, {
          eventType,
          paypalOrderId,
          timestamp: new Date().toISOString(),
        });
        processedWebhookEventIds.add(parsed.id);
        if (recordResult.alreadyExists) {
          return res.status(200).json({
            ok: true,
            duplicate: true,
            eventId: parsed.id,
            status: 'DUPLICATE_IGNORED',
            message: `Event '${parsed.id}' has already been processed.`,
          });
        }
      }

      // 3. Apply validated escrow transition
      if (paypalOrderId) {
        const targetOrder = existingOrder || existingLedger?.order;
        if (existingOrder) {
          let nextState = existingOrder.escrowState;
          if (eventType === 'PAYMENT.CAPTURE.COMPLETED') nextState = 'funded';
          else if (eventType === 'PAYMENT.CAPTURE.DENIED') nextState = 'disputed';
          else if (eventType === 'PAYMENT.CAPTURE.REFUNDED') nextState = 'refunded';

          if (nextState !== existingOrder.escrowState && canTransitionEscrow(existingOrder.escrowState, nextState)) {
            const webhookBizId = targetOrder.bizId || existingOrder.bizId || DEFAULT_BIZ_ID;
            await saveOrderForBiz(webhookBizId, {
              ...existingOrder,
              escrowState: nextState,
              status: nextState === 'funded' ? 'processing' : existingOrder.status,
            });
            await recordEscrowEventForBiz(webhookBizId, {
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
  app.post('/api/products', persistenceCheckMiddleware, async (req: Request, res: Response) => {
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
  app.delete('/api/products/:sku', persistenceCheckMiddleware, async (req: Request, res: Response) => {
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

  app.post('/api/merchants/profile', persistenceCheckMiddleware, async (req: Request, res: Response) => {
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
  // 15b. User Profile Management (GET/PATCH /api/users/profile)
  // ==========================================================================
  const UserProfileUpdateSchema = z
    .object({
      displayName: z.string().min(1).max(100).optional(),
      gender: z.enum(['Male', 'Female', 'Non-binary', 'Prefer not to say']).optional(),
      phone: z.string().max(25).optional(),
      countryCode: z.string().max(10).optional(),
      age: z.number().int().min(18).max(120).optional(),
      onboardingCompleted: z.boolean().optional(),
    })
    .strict();

  app.get('/api/users/profile', async (req: Request, res: Response) => {
    try {
      const actor = await requireAuth(req, res);
      if (!actor) return;

      const profile = await getUserProfileFromDb(actor.uid);
      if (!profile) {
        return sendTypedError(res, 404, 'USER_NOT_FOUND', 'User profile not found.');
      }
      return res.json({
        ok: true,
        profile,
      });
    } catch (err: any) {
      return sendTypedError(res, 500, 'USER_PROFILE_FETCH_ERROR', err.message || 'Failed to fetch user profile');
    }
  });

  app.patch('/api/users/profile', persistenceCheckMiddleware, async (req: Request, res: Response) => {
    try {
      const actor = await requireAuth(req, res);
      if (!actor) return;

      const parsed = UserProfileUpdateSchema.parse(req.body);
      const updatedProfile = await saveUserProfileToDb(actor.uid, parsed);
      return res.json({
        ok: true,
        message: 'Profile updated successfully',
        profile: updatedProfile,
      });
    } catch (err: any) {
      if (err instanceof ZodError) {
        return sendTypedError(
          res,
          400,
          'VALIDATION_ERROR',
          'Invalid profile update payload. Role, bizId, and verification status are immutable.',
          err.issues
        );
      }
      return sendTypedError(res, 500, 'USER_PROFILE_UPDATE_ERROR', err?.message || 'Failed to update user profile');
    }
  });

  // ==========================================================================
  // Storefront & Multi-Tenant Domain Routes
  // ==========================================================================

  // Auto-generate storefront brand and products with Gemini (Onboarding finish)
  app.post('/api/ai/generate-storefront', async (req: Request, res: Response) => {
    const actor = await requireAuth(req, res);
    if (!actor) return;
    if (actor.role !== 'seller' && actor.role !== 'business_head') {
      return sendTypedError(res, 403, 'RBAC_FORBIDDEN', 'Only seller or business head may generate storefront assets.');
    }
    if (!enforceAiRateLimit(req, res, actor.uid)) return;

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
    const actor = await requireAuth(req, res);
    if (!actor) return;
    if (actor.role !== 'seller' && actor.role !== 'business_head') {
      return sendTypedError(res, 403, 'RBAC_FORBIDDEN', 'Only seller or business head may run the AI design assistant.');
    }
    if (!enforceAiRateLimit(req, res, actor.uid)) return;

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
    const actor = await requireAuth(req, res);
    if (!actor) return;
    if (actor.role !== 'seller' && actor.role !== 'business_head' && actor.role !== 'finance') {
      return sendTypedError(res, 403, 'RBAC_FORBIDDEN', 'Only merchant or finance staff may fetch seller insights.');
    }
    if (!enforceAiRateLimit(req, res, actor.uid)) return;

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
  // ==========================================================================
  // Public Sanitized Storefront Projection (SEC-010: never leaks ownerUid/paypalEmail/taxIds)
  // ==========================================================================
  app.get('/api/storefront/:slug', async (req: Request, res: Response) => {
    try {
      const data = await resolvePublicStorefrontBySlug(req.params.slug);
      return res.json({
        ok: true,
        ...data,
      });
    } catch (err: any) {
      return sendTypedError(
        res,
        500,
        'STOREFRONT_LOAD_ERROR',
        err?.message || 'Unable to load storefront configuration'
      );
    }
  });

  // ==========================================================================
  // Storefront Order Server Endpoints (Admin SDK persistence; clients cannot write orders directly)
  // ==========================================================================
  const StorefrontOrderItemSchema = z.object({
    sku: z.string().min(1),
    quantity: z.number().int().positive(),
    name: z.string().optional(),
    price: z.number().nonnegative().optional(),
    image: z.string().optional(),
  });

  const StorefrontOrderCreateSchema = z.object({
    bizId: z.string().min(1).optional(),
    storeSlug: z.string().min(1).optional(),
    orderNumber: z.string().optional(),
    customerName: z.string().min(1),
    customerEmail: z.string().email(),
    customerPhone: z.string().optional().default(''),
    shippingAddress: z.string().min(3),
    items: z.array(StorefrontOrderItemSchema).min(1),
    discount: z.number().nonnegative().optional(),
    shippingFee: z.number().nonnegative().optional(),
    paymentMethod: z.enum(['paypal', 'escrow']).default('paypal'),
    trackingId: z.string().optional(),
    carrier: z.string().optional(),
    paypalOrderId: z.string().optional(),
  });

  app.post('/api/storefront/orders', persistenceCheckMiddleware, async (req: Request, res: Response) => {
    try {
      const parsed = StorefrontOrderCreateSchema.parse(req.body || {});
      const authActor = await resolveOptionalAuth(req);

      let bizId = DEFAULT_BIZ_ID;
      if (authActor) {
        bizId = authActor.bizId;
      } else if (parsed.storeSlug) {
        const resolved = await resolvePublicStorefrontBySlug(parsed.storeSlug);
        bizId = resolved.bizId;
      }

      if (parsed.bizId && parsed.bizId !== bizId) {
        return sendTypedError(
          res,
          403,
          'TENANT_ACCESS_DENIED',
          'Caller cannot specify an arbitrary cross-tenant bizId on storefront order creation.'
        );
      }

      const products = await getProductsForBiz(bizId);
      const bySku = new Map<string, any>();
      for (const product of products) {
        const keys = [product.sku, product.sku?.replace(/^#/, ''), product.id, `#${String(product.sku || '').replace(/^#/, '')}`];
        for (const key of keys) {
          if (key) bySku.set(String(key), product);
        }
      }

      let subtotal = 0;
      const items = parsed.items.map((item) => {
        const cleanSku = item.sku.replace(/^#/, '');
        const product = bySku.get(item.sku) || bySku.get(cleanSku) || bySku.get(`#${cleanSku}`);
        if (!product) {
          throw new Error(`Product '${item.sku}' was not found in the storefront catalog.`);
        }
        const unitPrice =
          typeof product.price === 'number'
            ? product.price
            : (product.priceMinor || 0) / 100;
        subtotal += unitPrice * item.quantity;
        return {
          sku: product.sku || `#${cleanSku}`,
          name: product.name || item.name || cleanSku,
          quantity: item.quantity,
          price: unitPrice,
          image: product.images?.[0] || product.img || item.image,
        };
      });

      const discount = Math.min(Math.max(0, parsed.discount || 0), subtotal);
      const shippingFee = Math.min(Math.max(0, parsed.shippingFee || 0), 100000);
      const taxable = Math.max(0, subtotal - discount);
      const tax = Math.round(taxable * 0.18);
      const total = taxable + shippingFee + tax;
      const totalMinor = Math.round(total * 100);
      const escrowFee = Math.round(total * 0.015);
      const now = new Date().toISOString();

      // SEC-004: NEVER mark an order as Escrow Locked without server-verified capture.
      let verifiedCapture = false;
      if (parsed.paypalOrderId) {
        const ledgerOrder = defaultServerLedger.getOrderWithEvents(parsed.paypalOrderId)?.order;
        const dbOrder = ledgerOrder ? null : await getOrderByIdForBiz(bizId, parsed.paypalOrderId);
        const matchedPayPalOrder = ledgerOrder || dbOrder;
        if (
          !matchedPayPalOrder ||
          matchedPayPalOrder.paymentStatus !== 'Captured' ||
          !matchedPayPalOrder.verifiedByServer
        ) {
          return sendTypedError(
            res,
            400,
            'PAYMENT_NOT_VERIFIED',
            `PayPal order '${parsed.paypalOrderId}' has not been captured and verified by the server.`
          );
        }
        verifiedCapture = true;
      }

      const orderId = `ord-store-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const orderNumber = parsed.orderNumber || `#ORD-${Math.floor(1000 + Math.random() * 9000)}`;

      const order = await saveOrderForBiz(bizId, {
        id: orderId,
        bizId,
        customerId: authActor?.uid || `guest-${crypto.createHash('sha256').update(parsed.customerEmail.toLowerCase()).digest('hex').slice(0, 12)}`,
        orderNumber,
        customerName: parsed.customerName,
        customerEmail: parsed.customerEmail,
        customerPhone: parsed.customerPhone,
        shippingAddress: parsed.shippingAddress,
        items,
        subtotal,
        discount,
        shippingFee,
        tax,
        total,
        totalMinor,
        escrowFee,
        escrowState: verifiedCapture ? 'funded' : 'created',
        paymentStatus: verifiedCapture ? 'Captured' : 'Created',
        verifiedByServer: verifiedCapture,
        escrowStatus: verifiedCapture ? 'Escrow Locked' : 'Pending Payment',
        paymentMethod: parsed.paymentMethod,
        ...(parsed.paypalOrderId ? { paypalOrderId: parsed.paypalOrderId } : {}),
        trackingId: parsed.trackingId || `BLUEDART-${Math.floor(100000000 + Math.random() * 900000000)}`,
        carrier: parsed.carrier || 'BlueDart Air Express',
        timeline: [
          {
            step: verifiedCapture ? 'escrow_locked' : 'created',
            label: verifiedCapture
              ? 'Payment Verified & Secured in Escrow'
              : 'Order Created — Awaiting Payment Verification',
            timestamp: now,
            completed: verifiedCapture,
            current: true,
          },
          { step: 'packed', label: 'Merchant Processing & Packing', timestamp: '', completed: false },
          { step: 'in_transit', label: 'Shipped via BlueDart Express Air', timestamp: '', completed: false },
          { step: 'released', label: 'Delivery Verified & Escrow Released', timestamp: '', completed: false },
        ],
        createdAt: now,
        updatedAt: now,
      });

      const escrowEvent = await recordEscrowEventForBiz(bizId, {
        orderId,
        fromState: null,
        toState: verifiedCapture ? 'funded' : 'created',
        actorId: authActor?.uid || 'storefront-customer',
        actorRole: authActor?.role || 'customer',
        reason: verifiedCapture
          ? `Storefront order ${orderNumber} verified & funded in escrow for ${parsed.customerEmail}`
          : `Storefront order ${orderNumber} created awaiting PayPal capture`,
        timestamp: now,
      });

      return res.status(201).json({ ok: true, order, escrowEvent });
    } catch (err: any) {
      if (err instanceof ZodError) {
        return sendTypedError(res, 400, 'VALIDATION_ERROR', 'Invalid storefront order payload', err.issues);
      }
      return sendTypedError(res, 400, 'STOREFRONT_ORDER_FAILED', err?.message || 'Unable to create storefront order');
    }
  });

  const StorefrontEscrowStatusSchema = z.object({
    bizId: z.string().optional(),
    escrowStatus: z.enum(['Escrow Locked', 'In Transit', 'Delivered — Escrow Released', 'Disputed']),
    reason: z.string().optional(),
    trackingId: z.string().optional(),
  });

  app.post('/api/storefront/orders/:id/escrow-status', persistenceCheckMiddleware, async (req: Request, res: Response) => {
    try {
      const actor = await requireAuth(req, res);
      if (!actor) return;
      if (!['seller', 'business_head', 'finance'].includes(actor.role)) {
        return sendTypedError(res, 403, 'ROLE_ACCESS_DENIED', 'Only seller, finance, or business head may update storefront order status.');
      }

      const parsed = StorefrontEscrowStatusSchema.parse(req.body || {});
      const order = await getOrderByIdForBiz(actor.bizId, req.params.id);
      if (!order) {
        return sendTypedError(res, 404, 'ORDER_NOT_FOUND', `Storefront order '${req.params.id}' was not found.`);
      }
      if (order.bizId && order.bizId !== actor.bizId) {
        return sendTypedError(res, 403, 'TENANT_ACCESS_DENIED', 'Cannot update an order belonging to another business tenant.');
      }

      const toState: EscrowState =
        parsed.escrowStatus === 'In Transit'
          ? 'in_delivery'
          : parsed.escrowStatus === 'Delivered — Escrow Released'
            ? 'released'
            : parsed.escrowStatus === 'Disputed'
              ? 'disputed'
              : 'funded';

      if (
        (toState === 'funded' || toState === 'in_delivery' || toState === 'released') &&
        order.paymentStatus !== 'Captured' &&
        order.verifiedByServer !== true
      ) {
        return sendTypedError(
          res,
          400,
          'PAYMENT_NOT_VERIFIED',
          `Cannot advance storefront order '${order.id}' to '${parsed.escrowStatus}' before payment is verified & captured.`
        );
      }

      const currentState = (order.escrowState ||
        (order.escrowStatus === 'In Transit'
          ? 'in_delivery'
          : order.escrowStatus === 'Delivered — Escrow Released'
            ? 'released'
            : order.escrowStatus === 'Disputed'
              ? 'disputed'
              : order.escrowStatus === 'Pending Payment'
                ? 'created'
                : 'funded')) as EscrowState;

      const transitionRes = transitionEscrowState({
        orderId: order.id,
        currentState,
        nextState: toState,
        actorId: actor.uid,
        actorRole: actor.role as any,
        reason: parsed.reason || `Storefront order status changed to ${parsed.escrowStatus}`,
      });
      if (!transitionRes.ok || !transitionRes.event) {
        const status =
          transitionRes.code === 'UNAUTHORIZED_ROLE_FOR_TRANSITION' ||
          transitionRes.code === 'AI_DIRECT_MUTATION_FORBIDDEN'
            ? 403
            : 400;
        return sendTypedError(
          res,
          status,
          transitionRes.code || 'INVALID_STATE_TRANSITION',
          transitionRes.error || 'Storefront escrow state transition rejected.'
        );
      }

      const now = new Date().toISOString();
      const timeline = Array.isArray(order.timeline) ? order.timeline : [];
      const updatedTimeline = timeline.map((item: any) => {
        if (parsed.escrowStatus === 'In Transit' && item.step === 'in_transit') {
          return { ...item, completed: true, timestamp: now, current: true };
        }
        if (parsed.escrowStatus === 'Delivered — Escrow Released' && item.step === 'released') {
          return { ...item, completed: true, timestamp: now, current: true };
        }
        if (parsed.escrowStatus === 'Disputed') {
          return { ...item, current: false };
        }
        return item;
      });

      const updated = await saveOrderForBiz(actor.bizId, {
        ...order,
        bizId: actor.bizId,
        escrowState: toState,
        escrowStatus: parsed.escrowStatus,
        timeline: updatedTimeline,
        ...(parsed.trackingId ? { trackingId: parsed.trackingId } : {}),
        ...(parsed.reason ? { updateReason: parsed.reason } : {}),
        updatedAt: now,
      });

      const escrowEvent = await recordEscrowEventForBiz(actor.bizId, {
        orderId: updated.id,
        orderNumber: updated.orderNumber,
        fromState: currentState,
        toState,
        actorId: actor.uid,
        actorRole: actor.role,
        reason: parsed.reason || `Storefront order status changed to ${parsed.escrowStatus}`,
        timestamp: now,
      });

      return res.json({ ok: true, order: updated, escrowEvent });
    } catch (err: any) {
      if (err instanceof ZodError) {
        return sendTypedError(res, 400, 'VALIDATION_ERROR', 'Invalid storefront escrow status payload', err.issues);
      }
      return sendTypedError(res, 400, 'STOREFRONT_ORDER_UPDATE_FAILED', err?.message || 'Unable to update storefront order status');
    }
  });

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

  const isDirectEntry =
    !process.env.VERCEL &&
    Boolean(
      process.argv[1] &&
        (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'))
    );

  // ==========================================================================
  // Vite Middleware (Dev) or Static Dist Serving (Prod)
  // ==========================================================================
  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test' && isDirectEntry) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (process.env.NODE_ENV === 'production') {
    const candidateDistPaths = [
      path.join(__dirname, 'dist'),
      path.resolve(process.cwd(), 'dist'),
    ];
    const distPath = candidateDistPaths.find((candidate) =>
      fs.existsSync(path.join(candidate, 'index.html'))
    );
    if (distPath) {
      app.use(
        express.static(distPath, {
          index: false,
          setHeaders: (res, filePath) => {
            if (filePath.includes(`${path.sep}assets${path.sep}`)) {
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            } else if (filePath.endsWith('robots.txt') || filePath.endsWith('sitemap.xml')) {
              res.setHeader('Cache-Control', 'public, max-age=3600');
            } else if (filePath.endsWith('index.html')) {
              res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            }
          },
        })
      );
      app.get('*', (_req: Request, res: Response) => {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  return app;
}

const isDirectEntry =
  !process.env.VERCEL &&
  Boolean(
    process.argv[1] &&
      (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'))
  );

if (process.env.NODE_ENV !== 'test' && isDirectEntry) {
  const port = resolveServerPort();
  createAppServer().then((app) => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`AC PayPilot server listening on http://0.0.0.0:${port}`);
    });
  });
}
