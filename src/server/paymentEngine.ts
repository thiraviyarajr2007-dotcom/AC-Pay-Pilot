import { z } from 'zod';
import { CATALOG_PRODUCTS } from '../data/mockData';
import {
  SupportedCurrency,
  calculateAuthoritativeOrderTotalsMinor,
  calculateInvoiceTotalsMinor,
  extractProviderFeeBreakdown,
  fromMinorUnits,
  toMinorUnits,
} from '../utils/finance';
import {
  EscrowActorRole,
  EscrowEventRecord,
  EscrowState,
  ESCROW_ARCHITECTURE_DECISION,
  transitionEscrowState,
} from '../utils/escrow';
import {
  AppUserRole,
  AuthenticatedActor,
  evaluateRoleAccess,
} from '../utils/rbac';

export const PAYPAL_SUPPORTED_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'JPY',
  'SGD',
  'CHF',
  'NZD',
  'SEK',
] as const;

export type PayPalSupportedCurrency = (typeof PAYPAL_SUPPORTED_CURRENCIES)[number];

// ============================================================================
// Zod Request Validation Schemas (Step 1 & Step 3)
// ============================================================================

export const ActorHeaderSchema = z.object({
  uid: z.string().min(1, 'Actor uid is required'),
  email: z.string().email().default('demo@paypilot.in'),
  role: z.enum(['customer', 'seller', 'finance', 'business_head']),
});

export const CreatePayPalOrderSchema = z.object({
  idempotencyKey: z.string().min(6, 'idempotencyKey must be at least 6 characters'),
  currency: z.enum(['INR', 'USD']).default('INR'),
  items: z
    .array(
      z.object({
        sku: z.string().min(1, 'SKU is required'),
        quantity: z.number().int().positive('Quantity must be a positive integer'),
        // Any client-sent price or total is intentionally ignored by the server calculator!
        clientPriceIgnored: z.number().optional(),
      })
    )
    .min(1, 'At least one item is required'),
  shippingMinor: z.number().int().min(0).default(0),
  buyerName: z.string().min(1).default('Aarav Mehta'),
  buyerEmail: z.string().email().default('aarav.mehta@enterprise.in'),
  shippingAddress: z
    .string()
    .min(3)
    .default('Embassy TechVillage, Outer Ring Rd, Bengaluru 560103'),
  customerId: z.string().min(1).default('cust-demo-1'),
  sellerId: z.string().min(1).default('seller-demo-1'),
  // Optional client total passed by untrusted browser — strictly ignored!
  clientUntrustedTotalMinor: z.number().optional(),
  isGuestCheckout: z.boolean().optional(),
  guestCheckoutToken: z.string().optional(),
  guestExpiresAt: z.string().optional(),
});

export const CapturePayPalOrderSchema = z.object({
  idempotencyKey: z.string().min(6, 'idempotencyKey must be at least 6 characters'),
  simulateOutcome: z
    .enum(['COMPLETED', 'DECLINED', 'PENDING', 'CANCELLED', 'TIMEOUT'])
    .optional(),
  actorId: z.string().min(1).default('cust-demo-1'),
  actorRole: z.enum(['customer', 'seller', 'finance', 'business_head']).default('customer'),
  guestCheckoutToken: z.string().optional(),
});

export const CancelPayPalOrderSchema = z.object({
  reason: z.string().min(1).default('Buyer cancelled checkout on PayPal modal'),
  actorId: z.string().min(1).default('cust-demo-1'),
  guestCheckoutToken: z.string().optional(),
});

export const EscrowTransitionBodySchema = z.object({
  nextState: z.enum(['created', 'funded', 'in_delivery', 'released', 'disputed', 'refunded']),
  reason: z.string().min(3, 'A clear audit reason (min 3 chars) is required'),
  actorId: z.string().min(1, 'actorId is required'),
  actorRole: z.enum(['customer', 'seller', 'finance', 'business_head']),
  isAiAutomated: z.boolean().optional(),
});

export const CalculateInvoiceBodySchema = z.object({
  currency: z.enum(['INR', 'USD']).default('INR'),
  clientName: z.string().min(1),
  clientGstin: z.string().min(4).default('29AAAAA0000A1Z5'),
  invoiceStatus: z.enum(['draft', 'issued', 'overdue', 'paid', 'void']).default('issued'),
  paymentStatus: z
    .enum(['Pending', 'Authorized', 'Captured', 'Failed', 'Cancelled', 'Refunded'])
    .default('Pending'),
  items: z
    .array(
      z.object({
        sku: z.string().min(1),
        name: z.string().min(1),
        hsn: z.string().default('8471'),
        quantity: z.number().int().positive(),
        unitRateMinor: z.number().int().nonnegative(),
        gstRatePercent: z.number().min(0).max(28),
      })
    )
    .min(1),
});

export type CreatePayPalOrderInput = z.infer<typeof CreatePayPalOrderSchema>;
export type CapturePayPalOrderInput = z.infer<typeof CapturePayPalOrderSchema>;

// ============================================================================
// Server Domain Records (Stored in Server Ledger & Synced to Firestore)
// ============================================================================

export type ServerPaymentStatus =
  | 'Pending'
  | 'Authorized'
  | 'Captured'
  | 'Failed'
  | 'Cancelled'
  | 'Refunded';

export interface ServerOrderRecord {
  id: string;
  orderNumber: string;
  paypalOrderId: string;
  createIdempotencyKey: string;
  captureIdempotencyKey?: string;
  customerId: string;
  sellerId: string;
  buyerName: string;
  buyerEmail: string;
  shippingAddress: string;
  currency: SupportedCurrency;
  subtotalMinor: number;
  taxMinor: number;
  shippingMinor: number;
  totalMinor: number;
  paypalFeeMinor: number | null;
  netPayoutMinor: number | null;
  feesFromProvider: boolean;
  paymentStatus: ServerPaymentStatus;
  verifiedByServer: boolean;
  escrowState: EscrowState;
  paypalIntent: 'CAPTURE' | 'AUTHORIZE';
  paypalCaptureId?: string;
  failureReason?: string;
  items: Array<{
    productId: string;
    sku: string;
    name: string;
    quantity: number;
    unitPriceMinor: number;
    gstRatePercent: number;
    lineSubtotalMinor: number;
    lineTaxMinor: number;
    lineTotalMinor: number;
  }>;
  isGuestCheckout?: boolean;
  guestCheckoutToken?: string;
  guestExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerPaymentRecord {
  id: string;
  orderId: string;
  customerId: string;
  sellerId: string;
  paypalOrderId: string;
  paypalCaptureId?: string;
  intent: 'CAPTURE' | 'AUTHORIZE';
  status: ServerPaymentStatus;
  currency: SupportedCurrency;
  grossMinor: number;
  paypalFeeMinor: number | null;
  netMinor: number | null;
  feesFromProvider: boolean;
  verifiedByServer: boolean;
  providerRawStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayPalProviderAdapter {
  createOrder(params: {
    currency: SupportedCurrency;
    totalMinor: number;
    subtotalMinor: number;
    taxMinor: number;
    shippingMinor: number;
    idempotencyKey: string;
    referenceId: string;
  }): Promise<{
    paypalOrderId: string;
    status: 'CREATED';
    mode: 'paypal_sandbox_api' | 'sandbox_deterministic_fallback';
  }>;

  captureOrder(params: {
    paypalOrderId: string;
    idempotencyKey: string;
    currency: SupportedCurrency;
    expectedTotalMinor: number;
    simulateOutcome?: 'COMPLETED' | 'DECLINED' | 'PENDING' | 'CANCELLED' | 'TIMEOUT';
  }): Promise<{
    paypalOrderId: string;
    captureId?: string;
    providerStatus: 'COMPLETED' | 'DECLINED' | 'PENDING' | 'CANCELLED' | 'TIMEOUT';
    seller_receivable_breakdown?: {
      gross_amount: { currency_code: string; value: string };
      paypal_fee: { currency_code: string; value: string };
      net_amount: { currency_code: string; value: string };
    };
    errorMessage?: string;
    mode: 'paypal_sandbox_api' | 'sandbox_deterministic_fallback';
  }>;
}

/**
 * Default PayPal Sandbox Orders v2 Provider Adapter.
 * Uses real PayPal Sandbox REST API (`https://api-m.sandbox.paypal.com`) when
 * PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are configured on the server;
 * otherwise uses a deterministic Sandbox Orders v2 structure so tests and sandbox flows work reliably.
 */
export function createPayPalSandboxAdapter(): PayPalProviderAdapter {
  const clientId = process.env.PAYPAL_CLIENT_ID || '';
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET || '';
  const isExplicitDemo = process.env.DEMO_MODE === 'true';
  const isTestMode = process.env.NODE_ENV === 'test';
  const hasRealCredentials =
    Boolean(clientId && clientSecret) &&
    clientId !== 'MY_PAYPAL_CLIENT_ID' &&
    clientSecret !== 'MY_PAYPAL_CLIENT_SECRET' &&
    !clientId.startsWith('sb-placeholder');

  async function getSandboxAccessToken(): Promise<string> {
    if (!hasRealCredentials) {
      throw new Error('PAYPAL_CONFIG_MISSING: PayPal Sandbox credentials are not configured on the server.');
    }
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`PAYPAL_AUTH_FAILED: PayPal OAuth token request failed with status ${res.status}: ${errBody}`);
    }
    const data = (await res.json()) as { access_token: string };
    return data.access_token;
  }

  return {
    async createOrder(params) {
      if (hasRealCredentials) {
        try {
          const token = await getSandboxAccessToken();
          const majorTotal = fromMinorUnits(params.totalMinor).toFixed(2);
          const res = await fetch('https://api-m.sandbox.paypal.com/v2/checkout/orders', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              'PayPal-Request-Id': params.idempotencyKey,
            },
            body: JSON.stringify({
              intent: 'CAPTURE',
              purchase_units: [
                {
                  reference_id: params.referenceId,
                  amount: {
                    currency_code: params.currency,
                    value: majorTotal,
                  },
                },
              ],
            }),
          });
          if (res.ok) {
            const data = (await res.json()) as { id: string; status: string };
            return {
              paypalOrderId: data.id,
              status: 'CREATED',
              mode: 'paypal_sandbox_api',
            };
          }
          const errBody = await res.text().catch(() => '');
          throw new Error(`PAYPAL_ORDER_CREATION_FAILED (HTTP ${res.status}): ${errBody}`);
        } catch (err: any) {
          // FAIL CLOSED: Do not convert failure into synthetic success!
          throw new Error(`PayPal Order Creation Failed: ${err.message || String(err)}`);
        }
      }

      // If credentials missing:
      if (process.env.NODE_ENV === 'production') {
        throw new Error('PAYPAL_CONFIG_ERROR: Production payments require valid PayPal credentials. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.');
      }

      // If in demo mode or test runner, provide synthetic test identifier clearly flagged:
      if (isExplicitDemo || isTestMode) {
        const deterministicId = `TEST-SBX-${params.idempotencyKey
          .replace(/[^a-zA-Z0-9]/g, '')
          .slice(-10)
          .toUpperCase()}`;

        return {
          paypalOrderId: deterministicId,
          status: 'CREATED',
          mode: 'sandbox_deterministic_fallback',
        };
      }

      throw new Error('PAYPAL_CREDENTIALS_REQUIRED: PayPal credentials not configured. Configure credentials or enable DEMO_MODE for local testing.');
    },

    async captureOrder(params) {
      // 1. Simulation outcomes (when explicitly requested for testing decline, pending, timeout, cancelled)
      if (params.simulateOutcome && params.simulateOutcome !== 'COMPLETED') {
        switch (params.simulateOutcome) {
          case 'DECLINED':
            return {
              paypalOrderId: params.paypalOrderId,
              providerStatus: 'DECLINED',
              errorMessage: 'INSTRUMENT_DECLINED: The funding instrument was declined by the issuing bank.',
              mode: 'sandbox_deterministic_fallback',
            };
          case 'PENDING':
            return {
              paypalOrderId: params.paypalOrderId,
              captureId: `CAP-PEND-${Date.now().toString(36).toUpperCase()}`,
              providerStatus: 'PENDING',
              errorMessage: 'Payment capture is pending bank clearing review.',
              mode: 'sandbox_deterministic_fallback',
            };
          case 'CANCELLED':
            return {
              paypalOrderId: params.paypalOrderId,
              providerStatus: 'CANCELLED',
              errorMessage: 'Order was cancelled before capture completion.',
              mode: 'sandbox_deterministic_fallback',
            };
          case 'TIMEOUT':
            return {
              paypalOrderId: params.paypalOrderId,
              providerStatus: 'TIMEOUT',
              errorMessage: 'Gateway timeout waiting for upstream processor response. Safe to retry with same idempotencyKey.',
              mode: 'sandbox_deterministic_fallback',
            };
        }
      }

      // 2. Real PayPal API call
      if (hasRealCredentials && !params.paypalOrderId.startsWith('TEST-SBX-') && !params.paypalOrderId.startsWith('PAYPAL-SBX-')) {
        try {
          const token = await getSandboxAccessToken();
          const res = await fetch(
            `https://api-m.sandbox.paypal.com/v2/checkout/orders/${encodeURIComponent(
              params.paypalOrderId
            )}/capture`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'PayPal-Request-Id': params.idempotencyKey,
              },
            }
          );
          if (res.ok) {
            const data = (await res.json()) as any;
            const capture = data.purchase_units?.[0]?.payments?.captures?.[0];

            // Invariant verification
            const capturedCurrency = capture?.amount?.currency_code || data.purchase_units?.[0]?.amount?.currency_code;
            const capturedValue = capture?.amount?.value || data.purchase_units?.[0]?.amount?.value;
            const capturedMinor = capturedValue ? toMinorUnits(parseFloat(capturedValue)) : params.expectedTotalMinor;

            if (capturedCurrency && capturedCurrency !== params.currency) {
              throw new Error(`INVARIANT_VIOLATION: Currency mismatch: PayPal captured ${capturedCurrency}, expected ${params.currency}`);
            }

            if (Math.abs(capturedMinor - params.expectedTotalMinor) > 100) {
              throw new Error(`INVARIANT_VIOLATION: Amount mismatch: PayPal captured minor ${capturedMinor}, expected ${params.expectedTotalMinor}`);
            }

            const isCompleted = data.status === 'COMPLETED' || capture?.status === 'COMPLETED';

            return {
              paypalOrderId: data.id || params.paypalOrderId,
              captureId: capture?.id,
              providerStatus: isCompleted ? 'COMPLETED' : (capture?.status || data.status || 'PENDING'),
              seller_receivable_breakdown: capture?.seller_receivable_breakdown,
              mode: 'paypal_sandbox_api',
            };
          } else {
            const errText = await res.text().catch(() => '');
            let parsedErr: any;
            try { parsedErr = JSON.parse(errText); } catch (_) {}
            const issueName = parsedErr?.details?.[0]?.issue || parsedErr?.name || 'CAPTURE_FAILED';
            const errorMsg = parsedErr?.details?.[0]?.description || parsedErr?.message || `PayPal capture failed with status ${res.status}`;

            if (issueName === 'INSTRUMENT_DECLINED') {
              return {
                paypalOrderId: params.paypalOrderId,
                providerStatus: 'DECLINED',
                errorMessage: errorMsg,
                mode: 'paypal_sandbox_api',
              };
            }

            // FAIL CLOSED: Do NOT convert failure into synthetic success!
            throw new Error(`PayPal capture error (HTTP ${res.status}): ${errorMsg}`);
          }
        } catch (err: any) {
          throw new Error(`PayPal Capture Failed: ${err.message || String(err)}`);
        }
      }

      // If credentials missing:
      if (process.env.NODE_ENV === 'production') {
        throw new Error('PAYPAL_CONFIG_ERROR: Production capture requires valid PayPal credentials.');
      }

      // In explicit demo or test mode with synthetic order:
      if (isExplicitDemo || isTestMode) {
        return {
          paypalOrderId: params.paypalOrderId,
          captureId: `CAP-TEST-${params.paypalOrderId.slice(-8)}`,
          providerStatus: 'COMPLETED',
          seller_receivable_breakdown: undefined, // Do not claim verified provider fees!
          mode: 'sandbox_deterministic_fallback',
        };
      }

      throw new Error('PAYPAL_CREDENTIALS_REQUIRED: PayPal credentials not configured for capture.');
    },
  };
}

// ============================================================================
// Server Ledger Store + Idempotent Payment Engine
// ============================================================================

export class ServerPaymentLedger {
  private ordersById = new Map<string, ServerOrderRecord>();
  private orderIdByCreateKey = new Map<string, string>();
  private orderIdByPaypalId = new Map<string, string>();
  private captureResultByKey = new Map<
    string,
    {
      order: ServerOrderRecord;
      payment: ServerPaymentRecord;
      escrowEvents: EscrowEventRecord[];
      idempotentReplay: boolean;
    }
  >();
  private paymentsById = new Map<string, ServerPaymentRecord>();
  private escrowEventsByOrderId = new Map<string, EscrowEventRecord[]>();
  private provider: PayPalProviderAdapter;

  constructor(provider?: PayPalProviderAdapter) {
    this.provider = provider || createPayPalSandboxAdapter();
    this.seedInitialLedger();
  }

  private seedInitialLedger() {
    // Seed 3 historical server orders across dates so Executive KPIs and Orders/Ledger screens have initial verified records
    const seedOrders: Array<{
      id: string;
      orderNumber: string;
      paypalOrderId: string;
      customerId: string;
      sellerId: string;
      buyerName: string;
      buyerEmail: string;
      sku: string;
      qty: number;
      paymentStatus: ServerPaymentStatus;
      escrowState: EscrowState;
      createdAt: string;
    }> = [
      {
        id: 'ord-1',
        orderNumber: '#PP-9821',
        paypalOrderId: 'PAYPAL-SBX-884120A',
        customerId: 'cust-demo-1',
        sellerId: 'seller-demo-1',
        buyerName: 'Aarav Singhania',
        buyerEmail: 'singhania.ai@techcorp.in',
        sku: '#FAN-BLDC-892',
        qty: 2,
        paymentStatus: 'Captured',
        escrowState: 'released',
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 'ord-2',
        orderNumber: '#PP-9820',
        paypalOrderId: 'PAYPAL-SBX-884094B',
        customerId: 'cust-demo-1',
        sellerId: 'seller-demo-1',
        buyerName: 'Priya Kulkarni',
        buyerEmail: 'priya.k@orbitlabs.io',
        sku: '#FAN-VLTX-140',
        qty: 1,
        paymentStatus: 'Captured',
        escrowState: 'in_delivery',
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 'ord-3',
        orderNumber: '#PP-9819',
        paypalOrderId: 'PAYPAL-SBX-883910C',
        customerId: 'cust-demo-2',
        sellerId: 'seller-demo-1',
        buyerName: 'Devendra Mehra',
        buyerEmail: 'dmehra@cloudscale.in',
        sku: '#SPO-YNX-99P',
        qty: 1,
        paymentStatus: 'Captured',
        escrowState: 'funded',
        createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ];

    for (const s of seedOrders) {
      const calc = calculateAuthoritativeOrderTotalsMinor(
        [{ sku: s.sku, quantity: s.qty }],
        CATALOG_PRODUCTS,
        'INR',
        0
      );
      const feeMinor = Math.round((calc.totalMinor * 3.49) / 100) + 1200;
      const netMinor = calc.totalMinor - feeMinor;

      const record: ServerOrderRecord = {
        id: s.id,
        orderNumber: s.orderNumber,
        paypalOrderId: s.paypalOrderId,
        createIdempotencyKey: `seed-create-${s.id}`,
        captureIdempotencyKey: `seed-cap-${s.id}`,
        customerId: s.customerId,
        sellerId: s.sellerId,
        buyerName: s.buyerName,
        buyerEmail: s.buyerEmail,
        shippingAddress: 'Embassy TechVillage, Outer Ring Rd, Bengaluru 560103',
        currency: 'INR',
        subtotalMinor: calc.subtotalMinor,
        taxMinor: calc.taxMinor,
        shippingMinor: 0,
        totalMinor: calc.totalMinor,
        paypalFeeMinor: feeMinor,
        netPayoutMinor: netMinor,
        feesFromProvider: true,
        paymentStatus: s.paymentStatus,
        verifiedByServer: true,
        escrowState: s.escrowState,
        paypalIntent: ESCROW_ARCHITECTURE_DECISION.chosenPaypalIntent,
        paypalCaptureId: `CAP-${s.paypalOrderId}`,
        items: calc.items,
        createdAt: s.createdAt,
        updatedAt: s.createdAt,
      };

      this.ordersById.set(record.id, record);
      this.orderIdByPaypalId.set(record.paypalOrderId, record.id);
      this.escrowEventsByOrderId.set(record.id, [
        {
          id: `evt-seed-1-${s.id}`,
          orderId: record.id,
          fromState: null,
          toState: 'created',
          actorId: s.customerId,
          actorRole: 'customer',
          reason: 'Order created at checkout',
          timestamp: s.createdAt,
        },
        {
          id: `evt-seed-2-${s.id}`,
          orderId: record.id,
          fromState: 'created',
          toState: 'funded',
          actorId: 'system',
          actorRole: 'system',
          reason: `PayPal Sandbox capture verified (${record.paypalCaptureId})`,
          timestamp: s.createdAt,
        },
      ]);
    }
  }

  /**
   * Creates a PayPal Order on the server.
   * - Strictly computes amounts from stored CATALOG_PRODUCTS in integer minor units.
   * - Ignores any total or unit price sent by the browser.
   * - Idempotent: repeated calls with the same `idempotencyKey` return the existing order without creating duplicates.
   */
  async createOrder(rawInput: unknown): Promise<{
    order: ServerOrderRecord;
    escrowEvents: EscrowEventRecord[];
    idempotentReplay: boolean;
    providerMode: string;
  }> {
    const input = CreatePayPalOrderSchema.parse(rawInput);

    // Check idempotency key first
    const existingOrderId = this.orderIdByCreateKey.get(input.idempotencyKey);
    if (existingOrderId) {
      const existingOrder = this.ordersById.get(existingOrderId)!;
      return {
        order: existingOrder,
        escrowEvents: this.escrowEventsByOrderId.get(existingOrderId) || [],
        idempotentReplay: true,
        providerMode: 'idempotent_cache',
      };
    }

    // Authoritative server-side price calculation (ignores any client price/total!)
    const calc = calculateAuthoritativeOrderTotalsMinor(
      input.items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
      CATALOG_PRODUCTS,
      input.currency,
      input.shippingMinor
    );

    const orderId = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const orderNumber = `#PP-${Math.floor(1000 + Math.random() * 9000)}`;

    const providerRes = await this.provider.createOrder({
      currency: calc.currency,
      totalMinor: calc.totalMinor,
      subtotalMinor: calc.subtotalMinor,
      taxMinor: calc.taxMinor,
      shippingMinor: calc.shippingMinor,
      idempotencyKey: input.idempotencyKey,
      referenceId: orderId,
    });

    const now = new Date().toISOString();
    const order: ServerOrderRecord = {
      id: orderId,
      orderNumber,
      paypalOrderId: providerRes.paypalOrderId,
      createIdempotencyKey: input.idempotencyKey,
      customerId: input.customerId,
      sellerId: input.sellerId,
      buyerName: input.buyerName,
      buyerEmail: input.buyerEmail,
      shippingAddress: input.shippingAddress,
      currency: calc.currency,
      subtotalMinor: calc.subtotalMinor,
      taxMinor: calc.taxMinor,
      shippingMinor: calc.shippingMinor,
      totalMinor: calc.totalMinor,
      paypalFeeMinor: null,
      netPayoutMinor: null,
      feesFromProvider: false,
      paymentStatus: 'Pending',
      verifiedByServer: false,
      escrowState: 'created',
      paypalIntent: ESCROW_ARCHITECTURE_DECISION.chosenPaypalIntent,
      items: calc.items,
      createdAt: now,
      updatedAt: now,
    };

    const initialEscrowEvent: EscrowEventRecord = {
      id: `esc-evt-${Date.now()}-init`,
      orderId: order.id,
      fromState: null,
      toState: 'created',
      actorId: input.customerId,
      actorRole: 'customer',
      reason: `PayPal Sandbox Order ${providerRes.paypalOrderId} initialized for ${calc.currency} ${order.totalMinor} minor units`,
      timestamp: now,
    };

    this.ordersById.set(order.id, order);
    this.orderIdByCreateKey.set(input.idempotencyKey, order.id);
    this.orderIdByPaypalId.set(order.paypalOrderId, order.id);
    this.escrowEventsByOrderId.set(order.id, [initialEscrowEvent]);

    return {
      order,
      escrowEvents: [initialEscrowEvent],
      idempotentReplay: false,
      providerMode: providerRes.mode,
    };
  }

  /**
   * Captures a PayPal Order on the server and transitions escrow `created -> funded` ONLY if provider confirms COMPLETED.
   * - Idempotent: repeated calls with the same `idempotencyKey` or on an already-captured order never capture twice.
   * - Handles COMPLETED, DECLINED, PENDING, CANCELLED, and TIMEOUT states cleanly.
   */
  async captureOrder(
    orderOrPaypalId: string,
    rawInput: unknown
  ): Promise<{
    order: ServerOrderRecord;
    payment: ServerPaymentRecord;
    escrowEvents: EscrowEventRecord[];
    idempotentReplay: boolean;
    retryAllowed: boolean;
  }> {
    const input = CapturePayPalOrderSchema.parse(rawInput);

    // 1. Check idempotency key cache
    const cachedByKey = this.captureResultByKey.get(input.idempotencyKey);
    if (cachedByKey) {
      return {
        ...cachedByKey,
        idempotentReplay: true,
        retryAllowed: cachedByKey.order.paymentStatus !== 'Captured',
      };
    }

    // 2. Locate order by internal ID or PayPal Order ID
    const resolvedOrderId =
      this.ordersById.has(orderOrPaypalId)
        ? orderOrPaypalId
        : this.orderIdByPaypalId.get(orderOrPaypalId);

    if (!resolvedOrderId) {
      throw new Error(`Order '${orderOrPaypalId}' not found on server.`);
    }

    const order = this.ordersById.get(resolvedOrderId)!;

    // 3. If order is already Captured, return existing payment idempotently without re-capturing
    if (order.paymentStatus === 'Captured' && order.verifiedByServer) {
      const existingPayment = Array.from(this.paymentsById.values()).find(
        (p) => p.orderId === order.id && p.status === 'Captured'
      )!;
      return {
        order,
        payment: existingPayment,
        escrowEvents: this.escrowEventsByOrderId.get(order.id) || [],
        idempotentReplay: true,
        retryAllowed: false,
      };
    }

    // 4. Invoke PayPal Sandbox provider capture
    let providerCapture;
    try {
      providerCapture = await this.provider.captureOrder({
        paypalOrderId: order.paypalOrderId,
        idempotencyKey: input.idempotencyKey,
        currency: order.currency,
        expectedTotalMinor: order.totalMinor,
        simulateOutcome: input.simulateOutcome,
      });
    } catch (err: any) {
      const now = new Date().toISOString();
      order.paymentStatus = 'Failed';
      order.verifiedByServer = false;
      order.failureReason = err.message || 'Payment provider capture exception';
      order.updatedAt = now;
      throw err;
    }

    const now = new Date().toISOString();
    const feeBreakdown = extractProviderFeeBreakdown(providerCapture, order.currency);

    let mappedStatus: ServerPaymentStatus = 'Pending';
    let verifiedByServer = false;
    let retryAllowed = false;

    switch (providerCapture.providerStatus) {
      case 'COMPLETED':
        mappedStatus = 'Captured';
        verifiedByServer = true;
        retryAllowed = false;
        break;
      case 'PENDING':
        mappedStatus = 'Pending';
        verifiedByServer = false;
        retryAllowed = true;
        break;
      case 'DECLINED':
        mappedStatus = 'Failed';
        verifiedByServer = false;
        retryAllowed = true;
        break;
      case 'CANCELLED':
        mappedStatus = 'Cancelled';
        verifiedByServer = false;
        retryAllowed = false;
        break;
      case 'TIMEOUT':
        mappedStatus = 'Pending';
        verifiedByServer = false;
        retryAllowed = true;
        break;
    }

    order.paymentStatus = mappedStatus;
    order.verifiedByServer = verifiedByServer;
    order.captureIdempotencyKey = input.idempotencyKey;
    order.paypalCaptureId = providerCapture.captureId;
    order.paypalFeeMinor = feeBreakdown.paypalFeeMinor;
    order.netPayoutMinor = feeBreakdown.netAmountMinor;
    order.feesFromProvider = feeBreakdown.feesFromProvider;
    order.failureReason = providerCapture.errorMessage;
    order.updatedAt = now;

    // Transition escrow `created -> funded` ONLY when server verified COMPLETED capture
    const events = this.escrowEventsByOrderId.get(order.id) || [];
    if (mappedStatus === 'Captured' && verifiedByServer && order.escrowState === 'created') {
      const transition = transitionEscrowState({
        orderId: order.id,
        currentState: order.escrowState,
        nextState: 'funded',
        actorId: 'system',
        actorRole: 'system',
        reason: `Server verified PayPal Sandbox capture (${providerCapture.captureId})`,
        timestamp: now,
      });
      if (transition.ok && transition.event) {
        order.escrowState = transition.nextState;
        events.push(transition.event);
        this.escrowEventsByOrderId.set(order.id, events);
      }
    }

    const payment: ServerPaymentRecord = {
      id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      orderId: order.id,
      customerId: order.customerId,
      sellerId: order.sellerId,
      paypalOrderId: order.paypalOrderId,
      paypalCaptureId: providerCapture.captureId,
      intent: order.paypalIntent,
      status: mappedStatus,
      currency: order.currency,
      grossMinor: order.totalMinor,
      paypalFeeMinor: feeBreakdown.paypalFeeMinor,
      netMinor: feeBreakdown.netAmountMinor,
      feesFromProvider: feeBreakdown.feesFromProvider,
      verifiedByServer,
      providerRawStatus: providerCapture.providerStatus,
      createdAt: now,
      updatedAt: now,
    };

    this.paymentsById.set(payment.id, payment);

    // Only lock idempotency key permanently for terminal/completed states; allow retry on TIMEOUT/DECLINED with new key
    if (providerCapture.providerStatus === 'COMPLETED' || providerCapture.providerStatus === 'CANCELLED') {
      this.captureResultByKey.set(input.idempotencyKey, {
        order,
        payment,
        escrowEvents: events,
        idempotentReplay: false,
      });
    }

    return {
      order,
      payment,
      escrowEvents: events,
      idempotentReplay: false,
      retryAllowed,
    };
  }

  /**
   * Marks an order as Cancelled on the server so `/checkout/cancel` reads authoritative server state.
   */
  cancelOrder(orderOrPaypalId: string, rawInput: unknown): ServerOrderRecord {
    const input = CancelPayPalOrderSchema.parse(rawInput);
    const resolvedOrderId =
      this.ordersById.has(orderOrPaypalId)
        ? orderOrPaypalId
        : this.orderIdByPaypalId.get(orderOrPaypalId);

    if (!resolvedOrderId) {
      throw new Error(`Order '${orderOrPaypalId}' not found on server.`);
    }

    const order = this.ordersById.get(resolvedOrderId)!;
    if (order.paymentStatus !== 'Captured') {
      order.paymentStatus = 'Cancelled';
      order.failureReason = input.reason;
      order.updatedAt = new Date().toISOString();
    }
    return order;
  }

  /**
   * Transitions an order's escrow state (`funded -> in_delivery -> released | disputed | refunded`)
   * with strict transition rules, role authorization, and `escrowEvents` logging.
   */
  transitionOrderEscrow(
    orderId: string,
    rawInput: unknown
  ): {
    order: ServerOrderRecord;
    event: EscrowEventRecord;
    escrowEvents: EscrowEventRecord[];
  } {
    const input = EscrowTransitionBodySchema.parse(rawInput);
    const order = this.ordersById.get(orderId);
    if (!order) {
      throw new Error(`Order '${orderId}' not found.`);
    }

    const res = transitionEscrowState({
      orderId: order.id,
      currentState: order.escrowState,
      nextState: input.nextState,
      actorId: input.actorId,
      actorRole: input.actorRole as EscrowActorRole,
      reason: input.reason,
      isAiAutomated: input.isAiAutomated,
    });

    if (!res.ok || !res.event) {
      const err = new Error(res.error || 'Escrow transition rejected');
      (err as Error & { code?: string }).code = res.code || 'ESCROW_TRANSITION_ERROR';
      throw err;
    }

    order.escrowState = res.nextState;
    if (res.nextState === 'refunded') {
      order.paymentStatus = 'Refunded';
    }
    order.updatedAt = res.event.timestamp;

    const events = this.escrowEventsByOrderId.get(order.id) || [];
    events.push(res.event);
    this.escrowEventsByOrderId.set(order.id, events);

    return {
      order,
      event: res.event,
      escrowEvents: events,
    };
  }

  getOrderWithEvents(orderOrPaypalId: string): {
    order: ServerOrderRecord;
    escrowEvents: EscrowEventRecord[];
    payments: ServerPaymentRecord[];
  } | null {
    const resolvedOrderId =
      this.ordersById.has(orderOrPaypalId)
        ? orderOrPaypalId
        : this.orderIdByPaypalId.get(orderOrPaypalId);

    if (!resolvedOrderId) return null;
    const order = this.ordersById.get(resolvedOrderId)!;
    const escrowEvents = this.escrowEventsByOrderId.get(order.id) || [];
    const payments = Array.from(this.paymentsById.values()).filter((p) => p.orderId === order.id);
    return { order, escrowEvents, payments };
  }

  listOrdersForActor(actor: AuthenticatedActor): ServerOrderRecord[] {
    const all = Array.from(this.ordersById.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return all.filter((ord) => {
      const decision = evaluateRoleAccess(actor, 'orders', 'read', {
        customerId: ord.customerId,
        sellerId: ord.sellerId,
      });
      return decision.allowed;
    });
  }

  listAllOrdersInternal(): ServerOrderRecord[] {
    return Array.from(this.ordersById.values());
  }

  listPaymentsForActor(actor: AuthenticatedActor): ServerPaymentRecord[] {
    const all = Array.from(this.paymentsById.values());
    return all.filter((pay) => {
      const decision = evaluateRoleAccess(actor, 'payments', 'read', {
        customerId: pay.customerId,
        sellerId: pay.sellerId,
      });
      return decision.allowed;
    });
  }
}

export const defaultServerLedger = new ServerPaymentLedger();

export function calculateInvoiceOnServer(rawInput: unknown) {
  const input = CalculateInvoiceBodySchema.parse(rawInput);
  const calc = calculateInvoiceTotalsMinor(input.items, input.currency);
  return {
    ...calc,
    invoiceStatus: input.invoiceStatus,
    paymentStatus: input.paymentStatus,
    subtotalMajor: fromMinorUnits(calc.subtotalMinor),
    taxMajor: fromMinorUnits(calc.taxMinor),
    totalMajor: fromMinorUnits(calc.totalMinor),
    unitMinorverified: true,
  };
}
