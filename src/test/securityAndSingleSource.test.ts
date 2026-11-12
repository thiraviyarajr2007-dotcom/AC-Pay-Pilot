import test from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import {
  authenticateRequest,
  performFirestoreHealthCheck,
  getProductsForBiz,
  saveProductForBiz,
  getOrdersForBiz,
  saveOrderForBiz,
  DEFAULT_BIZ_ID,
  FIREBASE_PROJECT_ID,
  FIRESTORE_DATABASE_ID,
} from '../server/firebaseAdmin';
import { runFullSystemDiagnostic } from '../server/healthService';

// Ensure DEMO_MODE is OFF and NODE_ENV is test
delete process.env.DEMO_MODE;
process.env.NODE_ENV = 'test';

process.on('unhandledRejection', (reason: any) => {
  if (
    reason?.message?.includes('Could not load the default credentials') ||
    reason?.message?.includes('MetadataLookupWarning') ||
    reason?.code === 'ENOTFOUND'
  ) {
    return;
  }
  console.error('Unhandled rejection:', reason);
});

let server: Server;
let baseUrl: string;

test.before(async () => {
  const { createAppServer } = await import('../../server');
  const app = await createAppServer();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// ============================================================================
// 1. AUTH: Header Spoofing Protection (x-actor-* headers rejected with 401/403)
// ============================================================================

test('AUTH: /api/products rejects spoofed x-actor headers with 401 when Authorization header is absent', async () => {
  const res = await fetch(`${baseUrl}/api/products`, {
    method: 'GET',
    headers: {
      'x-actor-uid': 'attacker-123',
      'x-actor-role': 'seller',
      'x-actor-email': 'attacker@evil.com',
    },
  });

  assert.equal(res.status, 401, 'Should return 401 Unauthorized for spoofed headers');
  const body = (await res.json()) as any;
  assert.equal(body.ok, false);
  assert.equal(body.code, 'MISSING_AUTH_TOKEN');
});

test('AUTH: /api/orders/:id/escrow-transition rejects spoofed x-actor headers with 401', async () => {
  const res = await fetch(`${baseUrl}/api/orders/ord-test-999/escrow-transition`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-actor-uid': 'attacker-123',
      'x-actor-role': 'finance',
      'x-actor-email': 'attacker@evil.com',
    },
    body: JSON.stringify({
      nextState: 'funded',
      reason: 'Spoofed manual release',
    }),
  });

  assert.equal(res.status, 401, 'Should return 401 Unauthorized for spoofed headers');
  const body = (await res.json()) as any;
  assert.equal(body.ok, false);
  assert.equal(body.code, 'MISSING_AUTH_TOKEN');
});

test('AUTH: /api/payments rejects spoofed x-actor headers with 401', async () => {
  const res = await fetch(`${baseUrl}/api/payments`, {
    method: 'GET',
    headers: {
      'x-actor-uid': 'attacker-123',
      'x-actor-role': 'seller',
      'x-actor-email': 'attacker@evil.com',
    },
  });

  assert.equal(res.status, 401, 'Should return 401 Unauthorized for spoofed payments query');
  const body = (await res.json()) as any;
  assert.equal(body.ok, false);
  assert.equal(body.code, 'MISSING_AUTH_TOKEN');
});

test('AUTH: /api/merchants/profile rejects spoofed x-actor headers with 401', async () => {
  const res = await fetch(`${baseUrl}/api/merchants/profile`, {
    method: 'GET',
    headers: {
      'x-actor-uid': 'attacker-123',
      'x-actor-role': 'seller',
      'x-actor-email': 'attacker@evil.com',
    },
  });

  assert.equal(res.status, 401, 'Should return 401 Unauthorized for spoofed profile request');
  const body = (await res.json()) as any;
  assert.equal(body.ok, false);
  assert.equal(body.code, 'MISSING_AUTH_TOKEN');
});

test('AUTH: Valid Bearer token succeeds and derives role and bizId correctly', async () => {
  // Test Bearer token derivation format: mock-token-{role}-{uid}-{bizId}
  const token = 'mock-token-seller-verifiedUser9-biz-test99';
  const res = await fetch(`${baseUrl}/api/products`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  assert.equal(res.status, 200, 'Authenticated request with Bearer token should succeed');
  const body = (await res.json()) as any;
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.products));
});

test('AUTH: Role-based authorization rejects non-seller customer attempting product mutation with 403', async () => {
  const customerToken = 'mock-token-customer-custUser1-biz-aerocool';
  const res = await fetch(`${baseUrl}/api/products`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${customerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sku: 'TEST-SKU-999',
      name: 'Unauthorized Hack Product',
      price: 1999,
    }),
  });

  assert.equal(res.status, 403, 'Customer role should be forbidden from creating products');
  const body = (await res.json()) as any;
  assert.equal(body.code, 'ROLE_ACCESS_DENIED');
});

test('AUTH: /api/paypal/create-order forces authenticated UID and ignores forged customerId', async () => {
  const customerToken = 'mock-token-customer-realUser88-biz-aerocool';
  const res = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${customerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotencyKey: `idem-auth-test-${Date.now()}`,
      currency: 'USD',
      items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
      customerId: 'ATTACKER-FORGED-CUSTOMER-ID', // Forged ID in body must be ignored!
      sellerId: 'biz-aerocool',
      buyerName: 'Real User',
      buyerEmail: 'real@aerocool.in',
      shippingAddress: '123 Main St, Bengaluru',
    }),
  });

  assert.equal(res.status, 201);
  const body = (await res.json()) as any;
  assert.equal(body.ok, true);
  assert.equal(body.order.customerId, 'realUser88', 'Server must strictly force customerId to actor.uid');
});

test('AUTH: /api/paypal/create-order generates unforgeable guest UID when unauthenticated', async () => {
  const res = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotencyKey: `idem-guest-test-${Date.now()}`,
      currency: 'USD',
      items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
      customerId: 'ATTACKER-FORGED-GUEST-ID', // Must be ignored
      sellerId: 'biz-aerocool',
      buyerName: 'Guest Buyer',
      buyerEmail: 'guest@buyer.in',
      shippingAddress: '456 Guest Way',
    }),
  });

  assert.equal(res.status, 201);
  const body = (await res.json()) as any;
  assert.equal(body.ok, true);
  assert.notEqual(body.order.customerId, 'ATTACKER-FORGED-GUEST-ID');
  assert.ok(body.order.customerId.startsWith('guest-'));
});

test('PROVIDER FAIL-CLOSED: /api/paypal/create-order fails closed and rejects unsupported currency with 400', async () => {
  // Real PayPal Sandbox rejects INR for direct orders with 422 CURRENCY_NOT_SUPPORTED
  const res = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotencyKey: `idem-inr-fail-${Date.now()}`,
      currency: 'INR',
      items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
      sellerId: 'biz-aerocool',
      buyerName: 'INR Buyer',
      buyerEmail: 'buyer@inr.in',
      shippingAddress: '456 MG Road',
    }),
  });

  // Must fail closed with 400 ORDER_CREATION_FAILED, never fabricating synthetic success!
  assert.equal(res.status, 400);
  const body = (await res.json()) as any;
  assert.equal(body.ok, false);
  assert.equal(body.code, 'ORDER_CREATION_FAILED');
  assert.ok(body.error.includes('CURRENCY_NOT_SUPPORTED') || body.error.includes('failed'));
});

test('AUTH: /api/paypal/capture-order/:id rejects unauthenticated request with 401', async () => {
  const res = await fetch(`${baseUrl}/api/paypal/capture-order/ord-1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotencyKey: `idem-unauth-cap-${Date.now()}`,
    }),
  });

  assert.equal(res.status, 401);
  const body = (await res.json()) as any;
  assert.equal(body.code, 'MISSING_AUTH_TOKEN');
});

test('AUTH: /api/paypal/capture-order/:id rejects cross-user capture with 403 ROLE_ACCESS_DENIED', async () => {
  // ord-1 is owned by cust-demo-1; cust-stranger-99 attempts to capture it
  const attackerToken = 'mock-token-customer-cust-stranger-99-biz-aerocool';
  const res = await fetch(`${baseUrl}/api/paypal/capture-order/ord-1`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${attackerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotencyKey: `idem-cross-user-${Date.now()}`,
    }),
  });

  assert.equal(res.status, 403);
  const body = (await res.json()) as any;
  assert.equal(body.code, 'ROLE_ACCESS_DENIED');
});

test('AUTH: /api/paypal/refund-order/:id rejects customer role attempting refund with 403', async () => {
  const customerToken = 'mock-token-customer-cust-demo-1-biz-aerocool';
  const res = await fetch(`${baseUrl}/api/paypal/refund-order/ord-1`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${customerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reason: 'Customer trying to trigger refund directly',
    }),
  });

  assert.equal(res.status, 403);
  const body = (await res.json()) as any;
  assert.equal(body.code, 'ROLE_ACCESS_DENIED');
});

test('AUTH: /api/orders/:id/escrow-transition rejects seller self-releasing escrow to released with 403', async () => {
  const sellerToken = 'mock-token-seller-seller-demo-1-biz-aerocool';
  const res = await fetch(`${baseUrl}/api/orders/ord-2/escrow-transition`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sellerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      nextState: 'released',
      reason: 'Seller attempting self-release of escrow funds',
    }),
  });

  assert.equal(res.status, 403);
  const body = (await res.json()) as any;
  assert.equal(body.code, 'UNAUTHORIZED_ROLE_FOR_TRANSITION');
});

// ============================================================================
// 2. SINGLE SOURCE OF TRUTH: Firestore Scoping by bizId
// ============================================================================

test('SINGLE SOURCE: Products are persisted to and scoped by bizId', async () => {
  const customBizId = 'biz-isolated-tenant-42';
  const testProduct = {
    sku: '#TENANT-SKU-001',
    name: 'Multi-Tenant Precision Cooler',
    price: 4999,
    stock: 25,
    category: 'Cooling Hardware',
  };

  const saved = await saveProductForBiz(customBizId, testProduct);
  assert.equal(saved.sku, '#TENANT-SKU-001');
  assert.equal(saved.bizId, customBizId);

  const products = await getProductsForBiz(customBizId);
  assert.ok(products.length >= 1);
  const found = products.find((p) => p.sku === '#TENANT-SKU-001');
  assert.ok(found, 'Saved product must be retrievable from Firestore businesses/{bizId}/products');
  assert.equal(found.name, 'Multi-Tenant Precision Cooler');
});

test('SINGLE SOURCE: Orders are scoped to bizId and customer role', async () => {
  const customBizId = 'biz-isolated-orders-99';
  const sampleOrder = {
    id: `ord-test-${Date.now()}`,
    customerId: 'cust-verified-77',
    customerName: 'Aarav Patel',
    customerEmail: 'aarav@domain.in',
    items: [{ sku: 'SKU-1', quantity: 2, priceMinor: 20000 }],
    totalAmountMinor: 40000,
    currency: 'INR',
    status: 'paid',
    escrowState: 'funded',
  };

  await saveOrderForBiz(customBizId, sampleOrder);

  // Seller actor sees all orders for bizId
  const sellerActor = {
    uid: 'seller-admin',
    email: 'admin@biz.in',
    role: 'seller' as const,
    bizId: customBizId,
  };
  const sellerOrders = await getOrdersForBiz(customBizId, sellerActor);
  assert.ok(sellerOrders.some((o) => o.id === sampleOrder.id));

  // Customer actor only sees their own orders
  const customerActor = {
    uid: 'cust-verified-77',
    email: 'aarav@domain.in',
    role: 'customer' as const,
    bizId: customBizId,
  };
  const customerOrders = await getOrdersForBiz(customBizId, customerActor);
  assert.equal(customerOrders.length, 1);
  assert.equal(customerOrders[0].customerId, 'cust-verified-77');

  // Different customer sees nothing
  const strangerCustomerActor = {
    uid: 'cust-stranger-99',
    email: 'stranger@domain.in',
    role: 'customer' as const,
    bizId: customBizId,
  };
  const strangerOrders = await getOrdersForBiz(customBizId, strangerCustomerActor);
  assert.equal(strangerOrders.length, 0);
});

// ============================================================================
// 3. PAYPAL: Webhook Signature Verification & Deduplication
// ============================================================================

test('PAYPAL: Webhook rejects unsigned requests with missing signature headers', async () => {
  const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: 'WH-EVENT-UNSIGNED-01',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
    }),
  });

  assert.equal(res.status, 400, 'Unsigned webhook request must return 400');
  const body = (await res.json()) as any;
  assert.equal(body.code, 'WEBHOOK_UNSIGNED');
});

test('PAYPAL: Webhook accepts valid signature headers and dedupes repeated event IDs', async () => {
  const eventId = `WH-EVT-DEDUPE-${Date.now()}`;
  const validHeaders = {
    'Content-Type': 'application/json',
    'paypal-transmission-id': 'trans-id-998811',
    'paypal-transmission-time': new Date().toISOString(),
    'paypal-transmission-sig': 'SAMPLE_HMAC_SHA256_TRANSMISSION_SIGNATURE_PAYPAL',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1234.pem',
    'paypal-auth-algo': 'SHA256withRSA',
  };

  const payload = {
    id: eventId,
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    summary: 'Payment capture completed in sandbox',
    resource: {
      id: 'PAYPAL-SBX-884120A',
    },
  };

  // First delivery: PROCESSED
  const res1 = await fetch(`${baseUrl}/api/paypal/webhook`, {
    method: 'POST',
    headers: validHeaders,
    body: JSON.stringify(payload),
  });

  assert.equal(res1.status, 200);
  const body1 = (await res1.json()) as any;
  assert.equal(body1.ok, true);
  assert.equal(body1.status, 'PROCESSED');
  assert.equal(body1.eventId, eventId);

  // Second delivery: DUPLICATE_IGNORED
  const res2 = await fetch(`${baseUrl}/api/paypal/webhook`, {
    method: 'POST',
    headers: validHeaders,
    body: JSON.stringify(payload),
  });

  assert.equal(res2.status, 200);
  const body2 = (await res2.json()) as any;
  assert.equal(body2.ok, true);
  assert.equal(body2.duplicate, true);
  assert.equal(body2.status, 'DUPLICATE_IGNORED');
});

test('PAYPAL: Webhook rejects unknown order with 404 ORDER_NOT_FOUND', async () => {
  const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'paypal-transmission-id': 'trans-unknown-order',
      'paypal-transmission-time': new Date().toISOString(),
      'paypal-transmission-sig': 'SAMPLE_HMAC_SHA256_TRANSMISSION_SIGNATURE_PAYPAL',
      'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1234.pem',
      'paypal-auth-algo': 'SHA256withRSA',
    },
    body: JSON.stringify({
      id: `WH-UNKNOWN-ORD-${Date.now()}`,
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'NON-EXISTENT-PAYPAL-ORDER-999',
      },
    }),
  });

  assert.equal(res.status, 404);
  const body = (await res.json()) as any;
  assert.equal(body.code, 'ORDER_NOT_FOUND');
});

test('PAYPAL: Webhook rejects currency mismatch with 400 WEBHOOK_CURRENCY_MISMATCH', async () => {
  const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'paypal-transmission-id': 'trans-currency-mismatch',
      'paypal-transmission-time': new Date().toISOString(),
      'paypal-transmission-sig': 'SAMPLE_HMAC_SHA256_TRANSMISSION_SIGNATURE_PAYPAL',
      'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1234.pem',
      'paypal-auth-algo': 'SHA256withRSA',
    },
    body: JSON.stringify({
      id: `WH-CURR-MISMATCH-${Date.now()}`,
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'PAYPAL-SBX-884120A',
        amount: {
          currency_code: 'USD', // Seed order is INR
          value: '16998.00',
        },
      },
    }),
  });

  assert.equal(res.status, 400);
  const body = (await res.json()) as any;
  assert.equal(body.code, 'WEBHOOK_CURRENCY_MISMATCH');
});

test('PAYPAL: Webhook rejects amount mismatch with 400 WEBHOOK_AMOUNT_MISMATCH', async () => {
  const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'paypal-transmission-id': 'trans-amount-mismatch',
      'paypal-transmission-time': new Date().toISOString(),
      'paypal-transmission-sig': 'SAMPLE_HMAC_SHA256_TRANSMISSION_SIGNATURE_PAYPAL',
      'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1234.pem',
      'paypal-auth-algo': 'SHA256withRSA',
    },
    body: JSON.stringify({
      id: `WH-AMT-MISMATCH-${Date.now()}`,
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'PAYPAL-SBX-884120A',
        amount: {
          currency_code: 'INR',
          value: '1.00', // Actual total is 16998.00 INR
        },
      },
    }),
  });

  assert.equal(res.status, 400);
  const body = (await res.json()) as any;
  assert.equal(body.code, 'WEBHOOK_AMOUNT_MISMATCH');
});

test('PAYPAL: Webhook safely ignores unsupported event types with 200', async () => {
  const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'paypal-transmission-id': 'trans-unsupported-type',
      'paypal-transmission-time': new Date().toISOString(),
      'paypal-transmission-sig': 'SAMPLE_HMAC_SHA256_TRANSMISSION_SIGNATURE_PAYPAL',
      'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1234.pem',
      'paypal-auth-algo': 'SHA256withRSA',
    },
    body: JSON.stringify({
      id: `WH-UNSUPPORTED-${Date.now()}`,
      event_type: 'CUSTOMER.DISPUTE.CREATED',
      resource: { id: 'DISPUTE-123' },
    }),
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.status, 'EVENT_IGNORED_UNSUPPORTED_TYPE');
});

test('PAYPAL: Webhook rejects forged/untrusted signature headers with 401', async () => {
  const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'paypal-transmission-id': 'trans-forged-sig',
      'paypal-transmission-time': new Date().toISOString(),
      'paypal-transmission-sig': 'FORGED_INVALID_SIGNATURE_STRING',
      'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1234.pem',
      'paypal-auth-algo': 'SHA256withRSA',
    },
    body: JSON.stringify({
      id: `WH-FORGED-${Date.now()}`,
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: 'PAYPAL-SBX-884120A' },
    }),
  });

  assert.equal(res.status, 401);
  const body = (await res.json()) as any;
  assert.equal(body.code, 'INVALID_WEBHOOK_SIGNATURE');
});

test('PAYPAL: Webhook rejects non-PayPal cert URL with 401', async () => {
  const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'paypal-transmission-id': 'trans-evil-cert',
      'paypal-transmission-time': new Date().toISOString(),
      'paypal-transmission-sig': 'SAMPLE_HMAC_SHA256_TRANSMISSION_SIGNATURE_PAYPAL',
      'paypal-cert-url': 'https://attacker.com/fake-cert.pem',
      'paypal-auth-algo': 'SHA256withRSA',
    },
    body: JSON.stringify({
      id: `WH-EVIL-CERT-${Date.now()}`,
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: 'PAYPAL-SBX-884120A' },
    }),
  });

  assert.equal(res.status, 401);
  const body = (await res.json()) as any;
  assert.equal(body.code, 'INVALID_WEBHOOK_SIGNATURE');
});

// ============================================================================
// 4. DOMAINS: Availability Check as "Estimate" & dns.promises Verification
// ============================================================================

test('DOMAINS: /api/domains/check labels results as "estimate" and never returns isAvailable: true from static data', async () => {
  const res = await fetch(`${baseUrl}/api/domains/check?domain=aerocooltech.store`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;

  assert.equal(body.ok, true);
  assert.equal(body.status, 'estimate', 'Must be labeled as estimate');
  assert.notEqual(
    body.isAvailable,
    true,
    'Static data check must NEVER return isAvailable: true without real provider API'
  );
  assert.ok(body.pricePerYearUsd > 0);
  assert.ok(body.pricePerYearInr > 0);
  assert.ok(body.purchaseUrl.includes('hostinger.com'));
});

test('DOMAINS: /api/domains/verify-dns executes DNS resolution and returns status and expectedRecord', async () => {
  const res = await fetch(`${baseUrl}/api/domains/verify-dns?domain=shop.example.com`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;

  assert.equal(body.ok, true);
  assert.ok(['Verified', 'Pending', 'Failed'].includes(body.status));
  assert.equal(body.expectedRecord.target, 'cname.acpaypilot.app');
  assert.equal(body.expectedRecord.type, 'CNAME');
  assert.ok(Array.isArray(body.resolved.cnames));
  assert.ok(Array.isArray(body.resolved.aRecords));
});

// ============================================================================
// 5. HEALTH: Real Firestore Write+Read+Delete Latency Test & Config Alignment
// ============================================================================

test('HEALTH: performFirestoreHealthCheck executes true write+read+delete on _health and measures latencyMs', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method || 'GET').toUpperCase();
    calls.push({ url, method });

    if (method === 'PATCH') {
      return new Response(JSON.stringify({ fields: { ping: { stringValue: 'pong' } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (method === 'GET') {
      return new Response(JSON.stringify({ fields: { ping: { stringValue: 'pong' } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (method === 'DELETE') {
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  try {
    const result = await performFirestoreHealthCheck();
    assert.equal(result.ok, true, `Health check should succeed. Error: ${result.error}`);
    assert.ok(typeof result.latencyMs === 'number', 'Latency must be numeric');
    assert.ok(result.latencyMs >= 0, 'Latency must be non-negative');
    assert.ok(result.docId.startsWith('health_ping_'));
    assert.deepEqual(
      calls.map((c) => c.method),
      ['PATCH', 'GET', 'DELETE']
    );
    assert.ok(
      calls.every((c) => c.url.includes('/projects/acpaypilot/databases/(default)/documents/_health/')),
      'Health check must target canonical acpaypilot (default) _health path'
    );

    // Also verify honest failure reporting when Firestore rejects writes (e.g. 403 disabled/rules locked)
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'Missing or insufficient permissions.' } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    const denied = await performFirestoreHealthCheck();
    assert.equal(denied.ok, false);
    assert.match(denied.error || '', /permissions/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HEALTH: Firebase project ID and database ID match canonical config', async () => {
  assert.equal(FIREBASE_PROJECT_ID, 'acpaypilot');
  assert.equal(FIRESTORE_DATABASE_ID, '(default)');

  const diag = await runFullSystemDiagnostic();
  assert.equal(diag.ok, true);
  const dbCheck = diag.checks.find((c) => c.category === 'database');
  assert.ok(dbCheck, 'Database health check item must exist');
  assert.equal(dbCheck.details?.projectId, 'acpaypilot');
  assert.equal(dbCheck.details?.databaseId, '(default)');
  assert.ok(dbCheck.latencyMs >= 0);
});

test('AUTH: formatFirebaseAuthError maps unauthorized-domain and disabled providers to clear guidance', async () => {
  const { formatFirebaseAuthError, resolvedFirebaseConfig } = await import('../firebase');
  assert.equal(resolvedFirebaseConfig.projectId, 'acpaypilot');
  assert.equal(resolvedFirebaseConfig.authDomain, 'acpaypilot.firebaseapp.com');
  assert.equal(resolvedFirebaseConfig.measurementId, 'G-E08TP6E1R0');

  const domainMsg = formatFirebaseAuthError({ code: 'auth/unauthorized-domain' });
  assert.match(domainMsg, /Authorized domains/i);
  assert.match(domainMsg, /acpaypilot/);

  const opMsg = formatFirebaseAuthError({ message: 'Firebase: Error (auth/operation-not-allowed).' });
  assert.match(opMsg, /Sign-in method/i);
  assert.match(opMsg, /acpaypilot/);

  const credMsg = formatFirebaseAuthError({ code: 'auth/invalid-credential' });
  assert.match(credMsg, /Invalid email or password/i);
});

// ============================================================================
// 6. PHASE 1 & 2: Auth, Single-Source Profile, Dual-Auth Guest Payments & Config Validator
// ============================================================================

test('AUTH: /api/users/profile rejects self-escalation attempt with 400 VALIDATION_ERROR', async () => {
  const token = 'mock-token-customer-cust-hack-1-biz-aerocool';
  const res = await fetch(`${baseUrl}/api/users/profile`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      role: 'admin', // Self-escalation strictly forbidden by .strict() Zod schema
    }),
  });

  assert.equal(res.status, 400);
  const body = (await res.json()) as any;
  assert.equal(body.ok, false);
  assert.equal(body.code, 'VALIDATION_ERROR');
});

test('AUTH: /api/users/profile accepts valid profile field update', async () => {
  const token = 'mock-token-customer-cust-valid-1-biz-aerocool';
  const res = await fetch(`${baseUrl}/api/users/profile`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      displayName: 'Aarav Updated',
      gender: 'Male',
      phone: '9876543210',
    }),
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.ok, true);
  assert.equal(body.profile.displayName, 'Aarav Updated');
});

test('AUTH: /api/users/profile returns 401 TOKEN_EXPIRED on expired ID token', async () => {
  const res = await fetch(`${baseUrl}/api/users/profile`, {
    headers: {
      Authorization: 'Bearer mock-token-expired',
    },
  });

  assert.equal(res.status, 401);
  const body = (await res.json()) as any;
  assert.equal(body.ok, false);
  assert.equal(body.code, 'TOKEN_EXPIRED');
});

test('AUTH: /api/users/profile returns 401 TOKEN_REVOKED on revoked ID token', async () => {
  const res = await fetch(`${baseUrl}/api/users/profile`, {
    headers: {
      Authorization: 'Bearer mock-token-revoked',
    },
  });

  assert.equal(res.status, 401);
  const body = (await res.json()) as any;
  assert.equal(body.ok, false);
  assert.equal(body.code, 'TOKEN_REVOKED');
});

test('AUTH: updateFirestoreUserRole throws forbidden error on client role change attempt', async () => {
  const { updateFirestoreUserRole } = await import('../firebase');
  await assert.rejects(
    async () => {
      await updateFirestoreUserRole('some-uid', 'admin' as any);
    },
    (err: any) => {
      return (
        err?.message?.includes('ROLE_ESCALATION_FORBIDDEN') ||
        err?.message?.includes('Client cannot update user roles')
      );
    }
  );
});

test('AUTH: ensureFirestoreUserProfile assigns lowest-privilege customer role idempotently', async () => {
  const { ensureFirestoreUserProfile } = await import('../firebase');
  const mockUser: any = {
    uid: `test-signup-${Date.now()}`,
    email: 'newuser@paypilot.in',
    displayName: 'New User',
  };

  const profile1 = await ensureFirestoreUserProfile(mockUser, 'business_head' as any);
  assert.equal(profile1.role, 'customer', 'Default role must be customer (lowest privilege)');
  assert.equal(profile1.uid, mockUser.uid);

  // Subsequent retrieval returns the profile identically
  const profile2 = await ensureFirestoreUserProfile(mockUser);
  assert.equal(profile2.role, 'customer');
  assert.equal(profile2.uid, mockUser.uid);
});

test('AUTH: authenticatedFetch auto-attaches headers and executes clean API request', async () => {
  const { authenticatedFetch } = await import('../services/apiClient');
  const res = await authenticatedFetch(`${baseUrl}/api/health`, { skipAuth: true });
  assert.equal(res.status, 200);
});

test('PAYMENTS: Guest create-order generates single-use guestCaptureToken', async () => {
  const res = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotencyKey: `idem-guest-cap-${Date.now()}`,
      currency: 'USD',
      items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
      sellerId: 'biz-aerocool',
    }),
  });

  assert.equal(res.status, 201);
  const body = (await res.json()) as any;
  assert.equal(body.ok, true);
  assert.ok(body.order.isGuestCheckout, 'Order must be flagged as guest checkout');
  assert.ok(body.guestCaptureToken, 'Server must return guestCaptureToken to guest');
  assert.equal(typeof body.guestCaptureToken, 'string');
  assert.equal(body.guestCaptureToken.length, 64, 'SHA-256 / 32-byte hex token is 64 characters');
});

test('PAYMENTS: Guest capture happy path succeeds with valid guestCaptureToken', async () => {
  // 1. Create guest order
  const createRes = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotencyKey: `idem-guest-happy-${Date.now()}`,
      currency: 'USD',
      items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
      sellerId: 'biz-aerocool',
    }),
  });
  const createBody = (await createRes.json()) as any;
  assert.equal(createRes.status, 201);
  const orderId = createBody.order.id;
  const guestToken = createBody.guestCaptureToken;

  // 2. Capture using valid guestCaptureToken
  const capRes = await fetch(`${baseUrl}/api/paypal/capture-order/${orderId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotencyKey: `idem-cap-happy-${Date.now()}`,
      guestCaptureToken: guestToken,
      simulateOutcome: 'COMPLETED',
    }),
  });

  assert.equal(capRes.status, 200);
  const capBody = (await capRes.json()) as any;
  assert.equal(capBody.ok, true);
  assert.equal(capBody.order.paymentStatus, 'Captured');
  assert.equal(capBody.order.guestTokenUsed, true);
});

test('PAYMENTS: Guest capture rejected with 403 INVALID_GUEST_TOKEN on wrong token', async () => {
  // 1. Create guest order
  const createRes = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotencyKey: `idem-guest-wrong-${Date.now()}`,
      currency: 'USD',
      items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
      sellerId: 'biz-aerocool',
    }),
  });
  const createBody = (await createRes.json()) as any;
  const orderId = createBody.order.id;

  // 2. Attempt capture with wrong token
  const capRes = await fetch(`${baseUrl}/api/paypal/capture-order/${orderId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotencyKey: `idem-cap-wrong-${Date.now()}`,
      guestCaptureToken: 'wrong-token-deadbeef00112233445566778899aabbccddeeff',
      simulateOutcome: 'COMPLETED',
    }),
  });

  assert.equal(capRes.status, 403);
  const capBody = (await capRes.json()) as any;
  assert.equal(capBody.ok, false);
  assert.equal(capBody.code, 'INVALID_GUEST_TOKEN');
});

test('PAYMENTS: Reused guest capture token rejected with 403 GUEST_TOKEN_REUSED', async () => {
  // 1. Create guest order
  const createRes = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotencyKey: `idem-guest-reuse-${Date.now()}`,
      currency: 'USD',
      items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
      sellerId: 'biz-aerocool',
    }),
  });
  const createBody = (await createRes.json()) as any;
  const orderId = createBody.order.id;
  const guestToken = createBody.guestCaptureToken;

  // 2. First capture succeeds
  const firstCap = await fetch(`${baseUrl}/api/paypal/capture-order/${orderId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotencyKey: `idem-cap-first-${Date.now()}`,
      guestCaptureToken: guestToken,
      simulateOutcome: 'COMPLETED',
    }),
  });
  assert.equal(firstCap.status, 200);

  // 3. Second capture with a DIFFERENT idempotencyKey attempting reuse
  const secondCap = await fetch(`${baseUrl}/api/paypal/capture-order/${orderId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotencyKey: `idem-cap-second-reuse-${Date.now()}`,
      guestCaptureToken: guestToken,
      simulateOutcome: 'COMPLETED',
    }),
  });

  assert.equal(secondCap.status, 403);
  const secondBody = (await secondCap.json()) as any;
  assert.equal(secondBody.ok, false);
  assert.equal(secondBody.code, 'GUEST_TOKEN_REUSED');
});

test('PAYMENTS: Expired guest capture token rejected with 403 GUEST_TOKEN_EXPIRED', async () => {
  const { defaultServerLedger } = await import('../server/paymentEngine');
  const crypto = await import('node:crypto');

  // Create an order in the ledger with an already-expired guest token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiredOrderRes = await defaultServerLedger.createOrder({
    idempotencyKey: `idem-expired-${Date.now()}`,
    currency: 'USD',
    items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
    sellerId: 'biz-aerocool',
    customerId: `guest-expired-${Date.now()}`,
    buyerName: 'Expired Guest',
    buyerEmail: 'expired@guest.in',
    shippingAddress: '123 Expired St',
    isGuestCheckout: true,
    guestCaptureTokenHash: tokenHash,
    guestExpiresAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
  });

  const capRes = await fetch(`${baseUrl}/api/paypal/capture-order/${expiredOrderRes.order.id}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotencyKey: `idem-cap-expired-${Date.now()}`,
      guestCaptureToken: rawToken,
      simulateOutcome: 'COMPLETED',
    }),
  });

  assert.equal(capRes.status, 403);
  const capBody = (await capRes.json()) as any;
  assert.equal(capBody.ok, false);
  assert.equal(capBody.code, 'GUEST_TOKEN_EXPIRED');
});

test('PAYMENTS: Token for Order A cannot capture Order B (403 INVALID_GUEST_TOKEN)', async () => {
  // Create Order A
  const resA = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idem-cross-a-${Date.now()}`,
      currency: 'USD',
      items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
      sellerId: 'biz-aerocool',
    }),
  });
  const bodyA = (await resA.json()) as any;

  // Create Order B
  const resB = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idem-cross-b-${Date.now()}`,
      currency: 'USD',
      items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
      sellerId: 'biz-aerocool',
    }),
  });
  const bodyB = (await resB.json()) as any;

  // Try capturing Order B using token from Order A
  const crossCap = await fetch(`${baseUrl}/api/paypal/capture-order/${bodyB.order.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idem-cap-cross-${Date.now()}`,
      guestCaptureToken: bodyA.guestCaptureToken, // Token A on Order B
      simulateOutcome: 'COMPLETED',
    }),
  });

  assert.equal(crossCap.status, 403);
  const crossBody = (await crossCap.json()) as any;
  assert.equal(crossBody.ok, false);
  assert.equal(crossBody.code, 'INVALID_GUEST_TOKEN');
});

test('CONFIG: validateStartupConfig in production throws ConfigurationError listing missing env vars', async () => {
  const { validateStartupConfig, ConfigurationError } = await import('../server/configValidator');

  assert.throws(
    () => {
      validateStartupConfig({
        NODE_ENV: 'production',
      });
    },
    (err: any) => {
      assert.ok(err instanceof ConfigurationError);
      assert.ok(err.missingVars.includes('PAYPAL_WEBHOOK_ID'));
      assert.ok(err.missingVars.includes('PAYPAL_CLIENT_ID'));
      assert.ok(err.missingVars.includes('PAYPAL_CLIENT_SECRET'));
      assert.ok(
        err.missingVars.some((v: string) => v.includes('GOOGLE_APPLICATION_CREDENTIALS')),
        'Production config must require Google credentials or an inline service account'
      );
      return true;
    }
  );
});

test('CONFIG: validateStartupConfig forbids test webhook bypass outside test environment', async () => {
  const { validateStartupConfig, ConfigurationError } = await import('../server/configValidator');

  assert.throws(
    () => {
      validateStartupConfig({
        NODE_ENV: 'production',
        ALLOW_TEST_SIGNATURE_BYPASS: 'true',
      });
    },
    (err: any) => {
      assert.ok(err instanceof ConfigurationError);
      assert.ok(err.message.includes('SECURITY VIOLATION'));
      return true;
    }
  );
});

test('HEALTH: /api/health reports persistenceMode and system status', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.ok, true);
  assert.ok(['firestore-admin', 'memory-volatile'].includes(body.persistenceMode));
  assert.ok(['healthy', 'degraded'].includes(body.status));
});
