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
        quantity: z
          .number()
          .int()
          .positive('Quantity must be a positive integer')
          .max(10000, 'Quantity cannot exceed 10000 units per line item'),
        // Any client-sent price or total is intentionally ignored by the server calculator!
        price: z.number().optional(),
        priceMinor: z.number().optional(),
        clientPriceIgnored: z.number().optional(),
      }).passthrough()
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
  // Optional client total passed by untrusted browser — strictly ignored by authoritative calculator!
  price: z.number().optional(),
  priceMinor: z.number().optional(),
  totalMinor: z.number().optional(),
  clientUntrustedTotalMinor: z.number().optional(),
  isGuestCheckout: z.boolean().optional(),
  guestCheckoutToken: z.string().optional(),
  guestCaptureTokenHash: z.string().optional(),
  guestExpiresAt: z.string().optional(),
}).passthrough();

export const CapturePayPalOrderSchema = z.object({
  idempotencyKey: z.string().min(6, 'idempotencyKey must be at least 6 characters'),
  simulateOutcome: z
    .enum(['COMPLETED', 'DECLINED', 'PENDING', 'CANCELLED', 'TIMEOUT'])
    .optional(),
  actorId: z.string().min(1).default('cust-demo-1'),
  actorRole: z.enum(['customer', 'seller', 'finance', 'business_head']).default('customer'),
  guestCheckoutToken: z.string().optional(),
  guestCaptureToken: z.string().optional(),
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
  guestCaptureTokenHash?: string;
  guestExpiresAt?: string;
  guestTokenUsed?: boolean;
  captureInProgress?: boolean;
  captureLockKey?: string;
  isDemo?: boolean;
  bizId?: string;
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
  isDemo?: boolean;
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
    currency?: SupportedCurrency;
    expectedCurrency?: SupportedCurrency;
    expectedTotalMinor: number;
    orderId?: string;
    rawCaptureResponse?: any;
    simulateOutcome?: 'COMPLETED' | 'DECLINED' | 'PENDING' | 'CANCELLED' | 'TIMEOUT';
  }): Promise<{
    paypalOrderId: string;
    captureId?: string;
    providerStatus: 'COMPLETED' | 'DECLINED' | 'PENDING' | 'CANCELLED' | 'TIMEOUT';
    status?: 'COMPLETED' | 'DECLINED' | 'PENDING' | 'CANCELLED' | 'TIMEOUT';
    capturedAmountMinor?: number;
    capturedCurrency?: SupportedCurrency;
    seller_receivable_breakdown?: {
      gross_amount: { currency_code: string; value: string };
      paypal_fee: { currency_code: string; value: string };
      net_amount: { currency_code: string; value: string };
    };
    errorMessage?: string;
    mode: 'paypal_sandbox_api' | 'sandbox_deterministic_fallback';
  }>;
}

export class PayPalCaptureInvariantError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'PayPalCaptureInvariantError';
    this.code = code;
  }
}

export function validatePayPalCaptureEvidence(
  data: any,
  expected: {
    paypalOrderId: string;
    expectedTotalMinor: number;
    expectedCurrency: SupportedCurrency;
  }
) {
  if (data?.id && typeof data.id === 'string' && data.id !== expected.paypalOrderId) {
    throw new PayPalCaptureInvariantError(
      `PayPal order ID mismatch: response was for order ${data.id}, expected ${expected.paypalOrderId}`,
      'PAYPAL_ORDER_ID_MISMATCH'
    );
  }

  const captures = data?.purchase_units?.[0]?.payments?.captures;
  const capture = Array.isArray(captures) && captures.length > 0 ? captures[0] : null;

  // Strict capture record & ID validation
  if (!capture || typeof capture !== 'object') {
    throw new PayPalCaptureInvariantError('Missing capture record in provider response', 'PAYPAL_CAPTURE_MISSING');
  }
  if (!capture.id || typeof capture.id !== 'string' || capture.id.trim() === '') {
    throw new PayPalCaptureInvariantError('Missing capture ID in provider response', 'PAYPAL_CAPTURE_ID_MISSING');
  }

  // Strict explicit status validation
  if (!capture.status || typeof capture.status !== 'string') {
    throw new PayPalCaptureInvariantError('Missing explicit capture status in provider response', 'PAYPAL_CAPTURE_STATUS_MISSING');
  }

  // Strict captured amount & currency validation
  if (!capture.amount || typeof capture.amount !== 'object') {
    throw new PayPalCaptureInvariantError('Missing capture amount object in provider response', 'PAYPAL_CAPTURE_AMOUNT_MISSING');
  }

  const capturedCurrency = capture.amount.currency_code;
  const capturedValue = capture.amount.value;

  if (!capturedCurrency || typeof capturedCurrency !== 'string') {
    throw new PayPalCaptureInvariantError('Missing capture currency in provider response', 'PAYPAL_CAPTURE_CURRENCY_MISSING');
  }

  if (
    capturedValue === undefined ||
    capturedValue === null ||
    typeof capturedValue !== 'string' ||
    capturedValue.trim() === '' ||
    isNaN(Number(capturedValue)) ||
    Number(capturedValue) < 0
  ) {
    throw new PayPalCaptureInvariantError('Malformed numeric capture amount in provider response', 'PAYPAL_CAPTURE_AMOUNT_INVALID');
  }

  const capturedMinor = toMinorUnits(parseFloat(capturedValue));

  // Strict currency match
  if (capturedCurrency !== expected.expectedCurrency) {
    throw new PayPalCaptureInvariantError(
      `Currency mismatch: PayPal captured ${capturedCurrency}, expected ${expected.expectedCurrency}`,
      'PAYPAL_CAPTURE_CURRENCY_MISMATCH'
    );
  }

  // Strict exact integer minor-unit comparison (zero tolerance)
  if (capturedMinor !== expected.expectedTotalMinor) {
    throw new PayPalCaptureInvariantError(
      `Amount mismatch: PayPal captured minor ${capturedMinor}, expected ${expected.expectedTotalMinor}`,
      'PAYPAL_CAPTURE_AMOUNT_MISMATCH'
    );
  }

  // Escrow requires 100% full authorization capture; partial captures are not supported
  if (capture.final_capture === false) {
    throw new PayPalCaptureInvariantError(
      'Partial capture is not supported; final_capture must be true',
      'PAYPAL_PARTIAL_CAPTURE_NOT_SUPPORTED'
    );
  }

  const isCompleted = capture.status === 'COMPLETED';

  return {
    paypalOrderId: data.id || expected.paypalOrderId,
    captureId: capture.id,
    providerStatus: isCompleted ? ('COMPLETED' as const) : (capture.status as any),
    status: isCompleted ? ('COMPLETED' as const) : (capture.status as any),
    capturedAmountMinor: capturedMinor,
    capturedCurrency: capturedCurrency as SupportedCurrency,
    seller_receivable_breakdown: capture.seller_receivable_breakdown,
    mode: 'paypal_sandbox_api' as const,
  };
}

/**
 * Default PayPal Sandbox Orders v2 Provider Adapter.
 * Uses real PayPal Sandbox REST API (`https://api-m.sandbox.paypal.com`) when
 * PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are configured on the server;
 * otherwise uses a deterministic Sandbox Orders v2 structure so tests and sandbox flows work reliably.
 */
export function createPayPalSandboxAdapter(): PayPalProviderAdapter {
  function getEnvConfig() {
    const clientId = process.env.PAYPAL_CLIENT_ID || '';
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET || '';
    const isExplicitDemo = process.env.DEMO_MODE === 'true';
    const isTestMode = process.env.NODE_ENV === 'test';
    const hasRealCredentials =
      Boolean(clientId && clientSecret) &&
      clientId !== 'MY_PAYPAL_CLIENT_ID' &&
      clientSecret !== 'MY_PAYPAL_CLIENT_SECRET' &&
      !clientId.startsWith('sb-placeholder');
    return { clientId, clientSecret, isExplicitDemo, isTestMode, hasRealCredentials };
  }

  let cachedSandboxToken: { token: string; expiresAt: number } | null = null;

  async function getSandboxAccessToken(): Promise<string> {
    const { clientId, clientSecret, hasRealCredentials } = getEnvConfig();
    if (!hasRealCredentials) {
      throw new Error('PAYPAL_CONFIG_MISSING: PayPal Sandbox credentials are not configured on the server.');
    }
    if (cachedSandboxToken && Date.now() < cachedSandboxToken.expiresAt) {
      return cachedSandboxToken.token;
    }
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    let res: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'grant_type=client_credentials',
        });
        if (res.ok) break;
      } catch (netErr: any) {
        if (attempt === 1) throw netErr;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    if (!res || !res.ok) {
      const errBody = (await res?.text().catch(() => '')) || '';
      throw new Error(`PAYPAL_AUTH_FAILED: PayPal OAuth token request failed with status ${res?.status}: ${errBody}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in?: number };
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    cachedSandboxToken = {
      token: data.access_token,
      expiresAt: Date.now() + Math.max(300, expiresIn - 60) * 1000,
    };
    return data.access_token;
  }

  return {
    async createOrder(params) {
      const { isExplicitDemo, isTestMode, hasRealCredentials } = getEnvConfig();
      if (hasRealCredentials) {
        try {
          const token = await getSandboxAccessToken();
          const majorTotal = fromMinorUnits(params.totalMinor).toFixed(2);
          let res: Response | null = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              res = await fetch('https://api-m.sandbox.paypal.com/v2/checkout/orders', {
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
              break;
            } catch (fetchErr: any) {
              if (attempt === 1) throw fetchErr;
              await new Promise((resolve) => setTimeout(resolve, 300));
            }
          }
          if (res && res.ok) {
            const data = (await res.json()) as { id: string; status: string };
            return {
              paypalOrderId: data.id,
              status: 'CREATED',
              mode: 'paypal_sandbox_api',
            };
          }
          const errBody = (await res?.text().catch(() => '')) || '';
          throw new Error(`PAYPAL_ORDER_CREATION_FAILED (HTTP ${res?.status}): ${errBody}`);
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
        if (params.currency === 'INR') {
          throw new Error('CURRENCY_NOT_SUPPORTED: PayPal Orders v2 does not support INR direct checkout. All checkout orders must be charged in USD.');
        }

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
      const { isExplicitDemo, isTestMode, hasRealCredentials } = getEnvConfig();
      const resolvedCurrency = (params.currency || params.expectedCurrency || 'USD') as SupportedCurrency;

      // 0. Direct raw capture response validation (for targeted invariant testing)
      if (params.rawCaptureResponse) {
        return validatePayPalCaptureEvidence(params.rawCaptureResponse, {
          paypalOrderId: params.paypalOrderId,
          expectedTotalMinor: params.expectedTotalMinor,
          expectedCurrency: resolvedCurrency,
        });
      }

      // 1. Simulation outcomes (when explicitly requested for testing decline, pending, timeout, cancelled, completed)
      if (params.simulateOutcome && (isExplicitDemo || isTestMode)) {
        if (params.simulateOutcome === 'COMPLETED') {
          return {
            paypalOrderId: params.paypalOrderId,
            captureId: `CAP-COMPL-${Date.now().toString(36).toUpperCase()}`,
            providerStatus: 'COMPLETED',
            status: 'COMPLETED',
            capturedAmountMinor: params.expectedTotalMinor,
            capturedCurrency: resolvedCurrency,
            feeAmount: '3.50',
            seller_receivable_breakdown: {
              gross_amount: { currency_code: resolvedCurrency, value: (params.expectedTotalMinor / 100).toFixed(2) },
              paypal_fee: { currency_code: resolvedCurrency, value: '3.50' },
              net_amount: { currency_code: resolvedCurrency, value: ((params.expectedTotalMinor - 350) / 100).toFixed(2) },
            },
            mode: 'sandbox_deterministic_fallback',
          };
        }
        switch (params.simulateOutcome) {
          case 'DECLINED':
            return {
              paypalOrderId: params.paypalOrderId,
              providerStatus: 'DECLINED',
              status: 'DECLINED',
              errorMessage: 'INSTRUMENT_DECLINED: The funding instrument was declined by the issuing bank.',
              mode: 'sandbox_deterministic_fallback',
            };
          case 'PENDING':
            return {
              paypalOrderId: params.paypalOrderId,
              captureId: `CAP-PEND-${Date.now().toString(36).toUpperCase()}`,
              providerStatus: 'PENDING',
              status: 'PENDING',
              errorMessage: 'Payment capture is pending bank clearing review.',
              mode: 'sandbox_deterministic_fallback',
            };
          case 'CANCELLED':
            return {
              paypalOrderId: params.paypalOrderId,
              providerStatus: 'CANCELLED',
              status: 'CANCELLED',
              errorMessage: 'Order was cancelled before capture completion.',
              mode: 'sandbox_deterministic_fallback',
            };
          case 'TIMEOUT':
            return {
              paypalOrderId: params.paypalOrderId,
              providerStatus: 'TIMEOUT',
              status: 'TIMEOUT',
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
            return validatePayPalCaptureEvidence(data, {
              paypalOrderId: params.paypalOrderId,
              expectedTotalMinor: params.expectedTotalMinor,
              expectedCurrency: resolvedCurrency,
            });
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
  private orderIdByCaptureId = new Map<string, string>();
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
  private activeCaptures = new Map<string, { idempotencyKey: string; promise: Promise<any> }>();
  private activeOrderCreations = new Map<
    string,
    Promise<{
      order: ServerOrderRecord;
      escrowEvents: EscrowEventRecord[];
      idempotentReplay: boolean;
      providerMode: string;
    }>
  >();
  private provider: PayPalProviderAdapter;

  constructor(provider?: PayPalProviderAdapter) {
    this.provider = provider || createPayPalSandboxAdapter();
    this.seedInitialLedger();
  }

  private seedInitialLedger() {
    // 1. Seed synthetic financial records only in explicit demo/test mode
    const isExplicitDemo = process.env.DEMO_MODE === 'true';
    const isTestMode = process.env.NODE_ENV === 'test';
    if (!isExplicitDemo && !isTestMode) {
      return;
    }

    // Seed 3 historical server orders across dates for demo/test mode only
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
        paypalFeeMinor: null,
        netPayoutMinor: null,
        // 2. Do not mark synthetic PayPal IDs, fake capture IDs, or estimated fees as provider-verified
        feesFromProvider: false,
        paymentStatus: s.paymentStatus,
        verifiedByServer: false,
        isDemo: true,
        escrowState: s.escrowState,
        paypalIntent: ESCROW_ARCHITECTURE_DECISION.chosenPaypalIntent,
        paypalCaptureId: undefined,
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
          reason: 'Demo order initialized at checkout',
          timestamp: s.createdAt,
        },
      ]);
    }
  }

  /**
   * Creates a PayPal Order on the server.
   * - Authoritative server-side price calculation using catalog records (or CATALOG_PRODUCTS).
   * - Ignores any total or unit price sent by the untrusted client.
   * - Idempotent: repeated calls with the same `idempotencyKey` return the existing order without creating duplicates.
   */
  async createOrder(
    rawInput: unknown,
    options?: { catalogProducts?: any[] }
  ): Promise<{
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

    // Concurrency check: if another request with this idempotency key is already in flight, await it
    const inFlight = this.activeOrderCreations.get(input.idempotencyKey);
    if (inFlight) {
      const inFlightResult = await inFlight;
      return {
        ...inFlightResult,
        idempotentReplay: true,
      };
    }

    const createExecution = async () => {
      // Authoritative single-source price calculation (ignores any client price/total!)
      const catalogSource =
        options?.catalogProducts && options.catalogProducts.length > 0
          ? options.catalogProducts
          : CATALOG_PRODUCTS;

      const calc = calculateAuthoritativeOrderTotalsMinor(
        input.items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
        catalogSource as any,
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
      const isExplicitDemo = process.env.DEMO_MODE === 'true';
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
        bizId: input.sellerId,
        isGuestCheckout: input.isGuestCheckout,
        guestCheckoutToken: input.guestCheckoutToken,
        guestCaptureTokenHash: input.guestCaptureTokenHash,
        guestExpiresAt: input.guestExpiresAt,
        guestTokenUsed: false,
        isDemo: isExplicitDemo,
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
    };

    const promise = createExecution();
    this.activeOrderCreations.set(input.idempotencyKey, promise);

    try {
      return await promise;
    } finally {
      this.activeOrderCreations.delete(input.idempotencyKey);
    }
  }

  /**
   * Captures a PayPal Order on the server and transitions escrow `created -> funded` ONLY if provider confirms COMPLETED.
   * - Atomic: prevents concurrent execution of duplicate captures on the same order.
   * - Strict: verifies capture record, explicit COMPLETED status, and exact integer minor-unit amount.
   * - Idempotent: repeated calls with the same `idempotencyKey` or on an already-captured order never capture twice.
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

    // 3. Concurrency check: prevent two simultaneous requests with different keys
    const inFlight = this.activeCaptures.get(resolvedOrderId);
    if (inFlight) {
      if (inFlight.idempotencyKey === input.idempotencyKey) {
        const inFlightResult = await inFlight.promise;
        return {
          ...inFlightResult,
          idempotentReplay: true,
        };
      } else {
        const err = new Error(
          'CONCURRENT_CAPTURE_CONFLICT: A capture operation is already in progress for this order with a different idempotency key.'
        );
        (err as any).code = 'CONCURRENT_CAPTURE_CONFLICT';
        (err as any).statusCode = 409;
        throw err;
      }
    }

    // 4. If order is already Captured, return existing payment idempotently without re-capturing
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

    // 5. Reject capture of cancelled orders
    if (order.paymentStatus === 'Cancelled') {
      const err = new Error('ORDER_CANCELLED: Cannot capture payment on an order that has been cancelled.');
      (err as any).code = 'ORDER_CANCELLED';
      (err as any).statusCode = 400;
      throw err;
    }

    // 6. Enforce single-use guest token consumption
    if (order.isGuestCheckout && order.guestTokenUsed) {
      const err = new Error('GUEST_TOKEN_REUSED: Guest capture token has already been used and is invalidated.');
      (err as any).code = 'GUEST_TOKEN_REUSED';
      (err as any).statusCode = 403;
      throw err;
    }

    // 7. Execute atomic capture
    const captureExecution = async () => {
      // Mark token used and lock capture in-progress
      if (order.isGuestCheckout) {
        order.guestTokenUsed = true;
      }
      order.captureInProgress = true;
      order.captureLockKey = input.idempotencyKey;

      try {
        const providerCapture = await this.provider.captureOrder({
          paypalOrderId: order.paypalOrderId,
          idempotencyKey: input.idempotencyKey,
          currency: order.currency,
          expectedTotalMinor: order.totalMinor,
          simulateOutcome: input.simulateOutcome,
        });

        // Strict validation of provider capture invariants:
        if (providerCapture.providerStatus === 'COMPLETED') {
          if (!providerCapture.captureId || typeof providerCapture.captureId !== 'string' || providerCapture.captureId.trim() === '') {
            throw new Error('INVARIANT_VIOLATION: Provider marked capture COMPLETED without valid capture ID');
          }
          if (
            this.orderIdByCaptureId.has(providerCapture.captureId) &&
            this.orderIdByCaptureId.get(providerCapture.captureId) !== order.id
          ) {
            const err = new Error(
              `PAYPAL_CAPTURE_REUSED: Capture ID '${providerCapture.captureId}' has already been credited to order '${this.orderIdByCaptureId.get(providerCapture.captureId)}'.`
            );
            (err as any).code = 'PAYPAL_CAPTURE_REUSED';
            (err as any).statusCode = 409;
            throw err;
          }
          if (providerCapture.capturedAmountMinor !== undefined && providerCapture.capturedAmountMinor !== order.totalMinor) {
            throw new Error(
              `INVARIANT_VIOLATION: Amount mismatch: Provider captured minor ${providerCapture.capturedAmountMinor}, expected ${order.totalMinor}`
            );
          }
          if (providerCapture.capturedCurrency !== undefined && providerCapture.capturedCurrency !== order.currency) {
            throw new Error(
              `INVARIANT_VIOLATION: Currency mismatch: Provider captured ${providerCapture.capturedCurrency}, expected ${order.currency}`
            );
          }
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
        order.captureInProgress = false;
        order.updatedAt = now;

        if (mappedStatus === 'Captured' && verifiedByServer && providerCapture.captureId) {
          this.orderIdByCaptureId.set(providerCapture.captureId, order.id);
        }

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
          isDemo: order.isDemo,
          createdAt: now,
          updatedAt: now,
        };

        this.paymentsById.set(payment.id, payment);

        const captureResult = {
          order,
          payment,
          escrowEvents: events,
          idempotentReplay: false,
          retryAllowed,
        };

        // Only lock idempotency key permanently for terminal/completed states
        if (providerCapture.providerStatus === 'COMPLETED' || providerCapture.providerStatus === 'CANCELLED') {
          this.captureResultByKey.set(input.idempotencyKey, captureResult);
        }

        return captureResult;
      } catch (err: any) {
        const now = new Date().toISOString();
        order.paymentStatus = 'Failed';
        order.verifiedByServer = false;
        order.failureReason = err.message || 'Payment provider capture exception';
        order.captureInProgress = false;
        order.updatedAt = now;
        throw err;
      }
    };

    const promise = captureExecution();
    this.activeCaptures.set(resolvedOrderId, { idempotencyKey: input.idempotencyKey, promise });

    try {
      return await promise;
    } finally {
      this.activeCaptures.delete(resolvedOrderId);
    }
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

  hydrateOrderRecord(
    order: ServerOrderRecord,
    escrowEvents: EscrowEventRecord[] = [],
    payments: ServerPaymentRecord[] = []
  ): void {
    this.ordersById.set(order.id, order);
    if (order.paypalOrderId) this.orderIdByPaypalId.set(order.paypalOrderId, order.id);
    if (order.createIdempotencyKey) this.orderIdByCreateKey.set(order.createIdempotencyKey, order.id);
    if (order.paypalCaptureId) this.orderIdByCaptureId.set(order.paypalCaptureId, order.id);
    if (!this.escrowEventsByOrderId.has(order.id)) {
      this.escrowEventsByOrderId.set(order.id, escrowEvents);
    }
    for (const payment of payments) {
      if (payment.id && !this.paymentsById.has(payment.id)) {
        this.paymentsById.set(payment.id, payment);
      }
    }
  }

  listOrdersForActor(actor: AuthenticatedActor): ServerOrderRecord[] {
    const isProduction = process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true';
    let all = Array.from(this.ordersById.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    if (isProduction) {
      all = all.filter((ord) => !ord.isDemo);
    }

    return all.filter((ord) => {
      const decision = evaluateRoleAccess(actor, 'orders', 'read', {
        customerId: ord.customerId,
        sellerId: ord.sellerId,
      });
      return decision.allowed;
    });
  }

  listAllOrdersInternal(): ServerOrderRecord[] {
    const isProduction = process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true';
    const all = Array.from(this.ordersById.values());
    return isProduction ? all.filter((ord) => !ord.isDemo) : all;
  }

  listPaymentsForActor(actor: AuthenticatedActor): ServerPaymentRecord[] {
    const isProduction = process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true';
    let all = Array.from(this.paymentsById.values());
    if (isProduction) {
      all = all.filter((pay) => !pay.isDemo);
    }
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
