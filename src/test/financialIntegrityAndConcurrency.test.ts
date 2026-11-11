import test from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import crypto from 'node:crypto';
import {
  ServerPaymentLedger,
  createPayPalSandboxAdapter,
  defaultServerLedger,
  validatePayPalCaptureEvidence,
} from '../server/paymentEngine';
import {
  setForceDurablePersistence,
  setSimulatedFirestoreError,
  PersistenceError,
  saveOrderForBiz,
  saveProductForBiz,
  savePaymentForBiz,
  recordEscrowEventForBiz,
  getProductBySkuForBiz,
  getOrderByIdForBiz,
  DEFAULT_BIZ_ID,
} from '../server/firebaseAdmin';
import {
  calculateAuthoritativeOrderTotalsMinor,
  computeExecutiveKpisForDateRange,
  DatedOrderRecord,
} from '../utils/finance';
import { validateStartupConfig, ConfigurationError } from '../server/configValidator';
import { CATALOG_PRODUCTS } from '../data/mockData';

// Ensure clean test environment
delete process.env.DEMO_MODE;
process.env.NODE_ENV = 'test';

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
  setForceDurablePersistence(false);
  setSimulatedFirestoreError(null);
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// ============================================================================
// P0: SINGLE AUTHORITATIVE ORDER CALCULATION
// ============================================================================

test('P0 ORDER CALC: Server uses single authoritative catalog calculation; provider, order, and capture match exactly', async () => {
  const customSku = `#CATALOG-DIFF-${Date.now()}`;
  const customCatalogItem = {
    id: customSku,
    sku: customSku,
    name: 'Industrial HVAC Turbo Compressor',
    price: 4500,
    priceMinor: 450000, // $4,500.00
    priceUsd: 4500,
    currency: 'USD' as const,
    gstRatePercent: 18,
    hsnCode: '8414',
  };

  // Save product to database
  await saveProductForBiz(DEFAULT_BIZ_ID, customCatalogItem);

  // Client deliberately sends manipulated prices and totals
  const clientPayload = {
    idempotencyKey: `idem-diff-${Date.now()}`,
    currency: 'USD',
    items: [{ sku: customSku, quantity: 2, price: 10, priceMinor: 1000 }], // Client claims $10 each
    totalMinor: 2000, // Client claims total is $20
    shippingMinor: 5000, // $50 shipping
    sellerId: DEFAULT_BIZ_ID,
  };

  const createRes = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(clientPayload),
  });

  const createText = await createRes.text();
  if (createRes.status !== 201) console.error('DEBUG createRes failed with status:', createRes.status, 'body:', createText);
  assert.equal(createRes.status, 201, `Failed to create order: ${createText}`);
  const createBody = JSON.parse(createText) as any;
  assert.equal(createBody.ok, true);

  // Authoritative expected calculation: 2 * 450000 = 900000 + 5000 shipping = 905000 minor units
  const authoritativeExpected = calculateAuthoritativeOrderTotalsMinor(
    [{ sku: customSku, quantity: 2 }],
    [customCatalogItem as any],
    'USD',
    5000
  );
  assert.equal(authoritativeExpected.totalMinor, 905000);

  // 1. Saved order amount matches authoritative total
  assert.equal(createBody.order.totalMinor, 905000);
  assert.equal(createBody.order.currency, 'USD');

  // 2. Client-provided prices and totals were untrusted and completely ignored
  assert.notEqual(createBody.order.totalMinor, 2000);
  assert.equal(createBody.order.items[0].unitPriceMinor, 450000);

  // 3. Capture matches that same immutable order total
  const capRes = await fetch(`${baseUrl}/api/paypal/capture-order/${createBody.order.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idem-cap-diff-${Date.now()}`,
      guestCaptureToken: createBody.guestCaptureToken,
      simulateOutcome: 'COMPLETED',
    }),
  });

  assert.equal(capRes.status, 200);
  const capBody = (await capRes.json()) as any;
  assert.equal(capBody.ok, true);
  assert.equal(capBody.payment.grossMinor, 905000);
  assert.equal(capBody.order.totalMinor, 905000);
  assert.equal(capBody.payment.currency, 'USD');
  assert.equal(capBody.payment.verifiedByServer, true);
});

test('P0 ORDER CALC: Idempotent create-order retries return original order without altering pricing or token binding', async () => {
  const customSku = `#IDEM-SKU-${Date.now()}`;
  await saveProductForBiz(DEFAULT_BIZ_ID, {
    id: customSku,
    sku: customSku,
    name: 'Precision Pressure Sensor',
    price: 120,
    priceMinor: 12000,
    priceUsd: 120,
    currency: 'USD',
  });

  const sharedIdempotencyKey = `idem-create-retry-${Date.now()}`;

  // 1. Initial create-order
  const firstRes = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: sharedIdempotencyKey,
      currency: 'USD',
      items: [{ sku: customSku, quantity: 1 }],
      shippingMinor: 1000,
      sellerId: DEFAULT_BIZ_ID,
    }),
  });
  assert.equal(firstRes.status, 201);
  const firstBody = (await firstRes.json()) as any;
  const initialOrderId = firstBody.order.id;
  const initialToken = firstBody.guestCaptureToken;
  const initialTotalMinor = firstBody.order.totalMinor;
  assert.ok(initialToken, 'Must generate guestCaptureToken');

  // 2. Retry with same idempotencyKey but attempting to change shipping and quantity
  const retryRes = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: sharedIdempotencyKey,
      currency: 'USD',
      items: [{ sku: customSku, quantity: 5 }], // Attempt modification
      shippingMinor: 99999, // Attempt modification
      sellerId: DEFAULT_BIZ_ID,
    }),
  });
  assert.equal(retryRes.status, 200);
  const retryBody = (await retryRes.json()) as any;
  assert.equal(retryBody.idempotentReplay, true);
  assert.equal(retryBody.order.id, initialOrderId);
  assert.equal(retryBody.order.totalMinor, initialTotalMinor);
  assert.equal(retryBody.guestCaptureToken, initialToken);

  // 3. The returned token remains fully functional to capture the order
  const capRes = await fetch(`${baseUrl}/api/paypal/capture-order/${initialOrderId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idem-cap-retry-${Date.now()}`,
      guestCaptureToken: retryBody.guestCaptureToken,
      simulateOutcome: 'COMPLETED',
    }),
  });
  assert.equal(capRes.status, 200);
  const capBody = (await capRes.json()) as any;
  assert.equal(capBody.ok, true);
  assert.equal(capBody.order.paymentStatus, 'Captured');
});

test('P0 ORDER CALC: Deliberately different Firestore vs static catalog price overrides static catalog price', async () => {
  // Static catalog has #FAN-BLDC-892 at ₹8,499 ($101.99).
  // Save Firestore catalog record with deliberate override price $175.00 (17500 minor units).
  const sku = '#FAN-BLDC-892';
  await saveProductForBiz(DEFAULT_BIZ_ID, {
    id: sku,
    sku: sku,
    name: 'AeroBreeze BLDC Smart Ceiling Fan',
    price: 175,
    priceMinor: 17500,
    priceUsd: 175,
    currency: 'USD',
  });

  const clientPayload = {
    idempotencyKey: `idem-override-catalog-${Date.now()}`,
    currency: 'USD',
    items: [{ sku, quantity: 2, price: 9999 }], // Client attempts price tampering
    shippingMinor: 1000, // $10 shipping
    sellerId: DEFAULT_BIZ_ID,
  };

  const createRes = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(clientPayload),
  });
  assert.equal(createRes.status, 201);
  const createBody = (await createRes.json()) as any;

  // Expected calculation: 2 * 17500 + 1000 = 36000 minor units ($360.00)
  // NOT the static catalog price (2 * 10199 + 1000 = 21398)
  assert.equal(createBody.order.totalMinor, 36000);
  assert.equal(createBody.order.items[0].unitPriceMinor, 17500);

  // Capture matches that same immutable order total
  const capRes = await fetch(`${baseUrl}/api/paypal/capture-order/${createBody.order.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idem-cap-override-${Date.now()}`,
      guestCaptureToken: createBody.guestCaptureToken,
      simulateOutcome: 'COMPLETED',
    }),
  });
  assert.equal(capRes.status, 200);
  const capBody = (await capRes.json()) as any;
  assert.equal(capBody.ok, true);
  assert.equal(capBody.order.totalMinor, 36000);
  assert.equal(capBody.payment.grossMinor, 36000);
});

// ============================================================================
// P0: STRICT PROVIDER CAPTURE VALIDATION
// ============================================================================

test('P0 STRICT CAPTURE: PayPal adapter rejects missing, malformed, or mismatched capture evidence', async () => {
  const adapter = createPayPalSandboxAdapter();
  const testOrderId = `test-order-${Date.now()}`;
  const testPaypalId = `PAYPAL-${Date.now()}`;
  const expectedTotalMinor = 50000; // $500.00
  const expectedCurrency = 'USD';

  // 0a. Missing capture object entirely -> rejected
  await assert.rejects(
    async () => {
      await adapter.captureOrder({
        orderId: testOrderId,
        paypalOrderId: testPaypalId,
        expectedTotalMinor,
        expectedCurrency,
        idempotencyKey: 'idem-test-0a',
        rawCaptureResponse: {
          purchase_units: [
            {
              payments: {
                captures: [],
              },
            },
          ],
        },
      });
    },
    (err: any) => {
      assert.equal(err.code, 'PAYPAL_CAPTURE_MISSING');
      return true;
    }
  );

  // 0b. Missing explicit capture status -> rejected
  await assert.rejects(
    async () => {
      await adapter.captureOrder({
        orderId: testOrderId,
        paypalOrderId: testPaypalId,
        expectedTotalMinor,
        expectedCurrency,
        idempotencyKey: 'idem-test-0b',
        rawCaptureResponse: {
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    id: 'CAP-NO-STATUS',
                    // status missing!
                    amount: { value: '500.00', currency_code: 'USD' },
                  },
                ],
              },
            },
          ],
        },
      });
    },
    (err: any) => {
      assert.equal(err.code, 'PAYPAL_CAPTURE_STATUS_MISSING');
      return true;
    }
  );

  // 0c. Mismatched PayPal Order ID in provider payload -> rejected
  await assert.rejects(
    async () => {
      await adapter.captureOrder({
        orderId: testOrderId,
        paypalOrderId: testPaypalId,
        expectedTotalMinor,
        expectedCurrency,
        idempotencyKey: 'idem-test-0c',
        rawCaptureResponse: {
          id: 'DIFFERENT-PAYPAL-ORDER-ID',
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    id: 'CAP-VALID-1',
                    status: 'COMPLETED',
                    amount: { value: '500.00', currency_code: 'USD' },
                  },
                ],
              },
            },
          ],
        },
      });
    },
    (err: any) => {
      assert.equal(err.code, 'PAYPAL_ORDER_ID_MISMATCH');
      return true;
    }
  );

  // 1. Missing capture ID -> rejected
  await assert.rejects(
    async () => {
      await adapter.captureOrder({
        orderId: testOrderId,
        paypalOrderId: testPaypalId,
        expectedTotalMinor,
        expectedCurrency,
        idempotencyKey: 'idem-test-1',
        rawCaptureResponse: {
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    status: 'COMPLETED',
                    // id is missing!
                    amount: { value: '500.00', currency_code: 'USD' },
                  },
                ],
              },
            },
          ],
        },
      });
    },
    (err: any) => {
      assert.equal(err.code, 'PAYPAL_CAPTURE_ID_MISSING');
      return true;
    }
  );

  // 2. Missing captured amount -> rejected
  await assert.rejects(
    async () => {
      await adapter.captureOrder({
        orderId: testOrderId,
        paypalOrderId: testPaypalId,
        expectedTotalMinor,
        expectedCurrency,
        idempotencyKey: 'idem-test-2',
        rawCaptureResponse: {
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    id: 'CAP-12345',
                    status: 'COMPLETED',
                    // amount object missing!
                  },
                ],
              },
            },
          ],
        },
      });
    },
    (err: any) => {
      assert.equal(err.code, 'PAYPAL_CAPTURE_AMOUNT_MISSING');
      return true;
    }
  );

  // 3. Missing captured currency -> rejected
  await assert.rejects(
    async () => {
      await adapter.captureOrder({
        orderId: testOrderId,
        paypalOrderId: testPaypalId,
        expectedTotalMinor,
        expectedCurrency,
        idempotencyKey: 'idem-test-3',
        rawCaptureResponse: {
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    id: 'CAP-12345',
                    status: 'COMPLETED',
                    amount: { value: '500.00' }, // currency_code missing!
                  },
                ],
              },
            },
          ],
        },
      });
    },
    (err: any) => {
      assert.equal(err.code, 'PAYPAL_CAPTURE_CURRENCY_MISSING');
      return true;
    }
  );

  // 4. Malformed numeric values -> rejected
  await assert.rejects(
    async () => {
      await adapter.captureOrder({
        orderId: testOrderId,
        paypalOrderId: testPaypalId,
        expectedTotalMinor,
        expectedCurrency,
        idempotencyKey: 'idem-test-4',
        rawCaptureResponse: {
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    id: 'CAP-12345',
                    status: 'COMPLETED',
                    amount: { value: 'not-a-number', currency_code: 'USD' },
                  },
                ],
              },
            },
          ],
        },
      });
    },
    (err: any) => {
      assert.equal(err.code, 'PAYPAL_CAPTURE_AMOUNT_INVALID');
      return true;
    }
  );

  // 5. Mismatched currency -> rejected
  await assert.rejects(
    async () => {
      await adapter.captureOrder({
        orderId: testOrderId,
        paypalOrderId: testPaypalId,
        expectedTotalMinor,
        expectedCurrency: 'USD',
        idempotencyKey: 'idem-test-5',
        rawCaptureResponse: {
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    id: 'CAP-12345',
                    status: 'COMPLETED',
                    amount: { value: '500.00', currency_code: 'EUR' },
                  },
                ],
              },
            },
          ],
        },
      });
    },
    (err: any) => {
      assert.equal(err.code, 'PAYPAL_CAPTURE_CURRENCY_MISMATCH');
      return true;
    }
  );

  // 6. Mismatched amount (1 minor unit difference) -> rejected
  await assert.rejects(
    async () => {
      await adapter.captureOrder({
        orderId: testOrderId,
        paypalOrderId: testPaypalId,
        expectedTotalMinor: 50000,
        expectedCurrency: 'USD',
        idempotencyKey: 'idem-test-6',
        rawCaptureResponse: {
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    id: 'CAP-12345',
                    status: 'COMPLETED',
                    amount: { value: '499.99', currency_code: 'USD' }, // 49999 !== 50000
                  },
                ],
              },
            },
          ],
        },
      });
    },
    (err: any) => {
      assert.equal(err.code, 'PAYPAL_CAPTURE_AMOUNT_MISMATCH');
      return true;
    }
  );

  // 7. Non-completed capture status -> leaves verifiedByServer false in ledger
  const pendingCapture = await adapter.captureOrder({
    orderId: testOrderId,
    paypalOrderId: testPaypalId,
    expectedTotalMinor: 50000,
    expectedCurrency: 'USD',
    idempotencyKey: 'idem-test-7',
    rawCaptureResponse: {
      purchase_units: [
        {
          payments: {
            captures: [
              {
                id: 'CAP-PENDING-1',
                status: 'PENDING',
                amount: { value: '500.00', currency_code: 'USD' },
              },
            ],
          },
        },
      ],
    },
  });
  assert.equal(pendingCapture.status, 'PENDING');
  assert.equal(pendingCapture.captureId, 'CAP-PENDING-1');

  // 8. Valid complete capture evidence -> passes all checks
  const validCapture = await adapter.captureOrder({
    orderId: testOrderId,
    paypalOrderId: testPaypalId,
    expectedTotalMinor: 50000,
    expectedCurrency: 'USD',
    idempotencyKey: 'idem-test-8',
    rawCaptureResponse: {
      purchase_units: [
        {
          payments: {
            captures: [
              {
                id: 'CAP-VALID-999',
                status: 'COMPLETED',
                amount: { value: '500.00', currency_code: 'USD' },
              },
            ],
          },
        },
      ],
    },
  });
  assert.equal(validCapture.status, 'COMPLETED');
  assert.equal(validCapture.captureId, 'CAP-VALID-999');
  assert.equal(validCapture.capturedAmountMinor, 50000);
  assert.equal(validCapture.capturedCurrency, 'USD');
});

// ============================================================================
// P0: PRODUCTION PERSISTENCE FAILS CLOSED
// ============================================================================

test('P0 PERSISTENCE: Production persistence fails closed without falling back to memory storage', async () => {
  setForceDurablePersistence(true);
  setSimulatedFirestoreError(new Error('Durable database connection timeout'));

  try {
    // 1. Product write failure throws explicit PersistenceError
    await assert.rejects(
      async () => {
        await saveProductForBiz(DEFAULT_BIZ_ID, {
          sku: '#FAIL-CLOSED-PROD',
          name: 'Fail Closed Widget',
          price: 100,
        });
      },
      (err: any) => {
        assert.ok(err instanceof PersistenceError);
        assert.equal(err.code, 'DURABLE_WRITE_FAILED');
        return true;
      }
    );

    // 2. Order write failure throws explicit PersistenceError
    await assert.rejects(
      async () => {
        await saveOrderForBiz(DEFAULT_BIZ_ID, {
          id: 'ord-fail-closed',
          totalMinor: 10000,
          currency: 'USD',
        });
      },
      (err: any) => {
        assert.ok(err instanceof PersistenceError);
        assert.equal(err.code, 'DURABLE_WRITE_FAILED');
        return true;
      }
    );

    // 3. Payment write failure throws explicit PersistenceError
    await assert.rejects(
      async () => {
        await savePaymentForBiz(DEFAULT_BIZ_ID, {
          id: 'pay-fail-closed',
          amountMinor: 10000,
          currency: 'USD',
        });
      },
      (err: any) => {
        assert.ok(err instanceof PersistenceError);
        assert.equal(err.code, 'DURABLE_WRITE_FAILED');
        return true;
      }
    );

    // 4. Escrow event write failure throws explicit PersistenceError
    await assert.rejects(
      async () => {
        await recordEscrowEventForBiz(DEFAULT_BIZ_ID, {
          orderId: 'ord-fail-closed',
          fromState: 'created',
          toState: 'funded',
          actorId: 'test-actor',
          actorRole: 'customer',
          reason: 'Escrow funded',
          timestamp: new Date().toISOString(),
        });
      },
      (err: any) => {
        assert.ok(err instanceof PersistenceError);
        assert.equal(err.code, 'DURABLE_WRITE_FAILED');
        return true;
      }
    );
  } finally {
    setForceDurablePersistence(false);
    setSimulatedFirestoreError(null);
  }
});

test('P0 RECONCILIATION: Provider capture succeeded but DB write failed produces 502 PAYMENT_CAPTURED_RECONCILIATION_REQUIRED', async () => {
  // 1. Create order normally
  const createRes = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idem-reconcile-${Date.now()}`,
      currency: 'USD',
      items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
      sellerId: DEFAULT_BIZ_ID,
    }),
  });
  const createBody = (await createRes.json()) as any;
  const orderId = createBody.order.id;
  const guestToken = createBody.guestCaptureToken;

  // 2. Simulate database failure right after provider capture
  setForceDurablePersistence(true);
  setSimulatedFirestoreError(new Error('Firestore cluster unavailable during capture commit'));

  try {
    const capRes = await fetch(`${baseUrl}/api/paypal/capture-order/${orderId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: `idem-cap-reconcile-${Date.now()}`,
        guestCaptureToken: guestToken,
        simulateOutcome: 'COMPLETED',
      }),
    });

    // Must return 502 Bad Gateway with explicit reconciliation requirement
    assert.equal(capRes.status, 502);
    const capBody = (await capRes.json()) as any;
    assert.equal(capBody.ok, false);
    assert.equal(capBody.code, 'PAYMENT_CAPTURED_RECONCILIATION_REQUIRED');
    assert.equal(capBody.reconciliationRequired, true);
    assert.ok(capBody.paypalCaptureId, 'Must preserve paypalCaptureId for reconciliation');
    assert.equal(capBody.escrowState, 'created', 'Must NOT release or mark escrow as funded without durable write');
  } finally {
    setForceDurablePersistence(false);
    setSimulatedFirestoreError(null);
  }
});

test('P0 PERSISTENCE: Read-after-write verifies durable Firestore data integrity', async () => {
  const uniqueSku = `#RAW-${Date.now()}`;
  const prodData = {
    id: uniqueSku,
    sku: uniqueSku,
    name: 'Precision Cryo Sensor Module',
    price: 320,
    priceMinor: 32000,
    priceUsd: 320,
    currency: 'USD',
  };

  await saveProductForBiz(DEFAULT_BIZ_ID, prodData);
  const fetchedProd = await getProductBySkuForBiz(DEFAULT_BIZ_ID, uniqueSku);
  assert.ok(fetchedProd, 'Product must be read back after write');
  assert.equal(fetchedProd.sku, uniqueSku);
  assert.equal(fetchedProd.priceMinor, 32000);

  const orderData = {
    id: `ord-raw-${Date.now()}`,
    totalMinor: 64000,
    currency: 'USD',
    paymentStatus: 'Pending',
    items: [{ sku: uniqueSku, quantity: 2 }],
  };
  await saveOrderForBiz(DEFAULT_BIZ_ID, orderData);
  const fetchedOrder = await getOrderByIdForBiz(DEFAULT_BIZ_ID, orderData.id);
  assert.ok(fetchedOrder, 'Order must be read back after write');
  assert.equal(fetchedOrder.totalMinor, 64000);
  assert.equal(fetchedOrder.currency, 'USD');
});

test('P0 PERSISTENCE: Server restart simulation preserves orders and tokens across server lifecycle', async () => {
  // 1. Create order
  const createRes = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idem-restart-${Date.now()}`,
      currency: 'USD',
      items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
      sellerId: DEFAULT_BIZ_ID,
    }),
  });
  assert.equal(createRes.status, 201);
  const createBody = (await createRes.json()) as any;
  const orderId = createBody.order.id;
  const guestToken = createBody.guestCaptureToken;
  const expectedTotalMinor = createBody.order.totalMinor;

  // 2. Simulate server restart: new ServerPaymentLedger instance created without in-memory state
  const restartedLedger = new ServerPaymentLedger();
  // Order exists durably in Firestore
  const durableOrder = await getOrderByIdForBiz(DEFAULT_BIZ_ID, orderId);
  assert.ok(durableOrder, 'Order must exist in durable storage across restart');
  assert.equal(durableOrder.totalMinor, expectedTotalMinor);
  assert.equal(durableOrder.isGuestCheckout, true);
  assert.ok(durableOrder.guestCaptureTokenHash, 'Guest token hash must be persisted');

  // 3. Capturing the order continues to succeed against the authoritative total
  const capRes = await fetch(`${baseUrl}/api/paypal/capture-order/${orderId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idem-cap-restart-${Date.now()}`,
      guestCaptureToken: guestToken,
      simulateOutcome: 'COMPLETED',
    }),
  });
  assert.equal(capRes.status, 200);
  const capBody = (await capRes.json()) as any;
  assert.equal(capBody.ok, true);
  assert.equal(capBody.order.totalMinor, expectedTotalMinor);
  assert.equal(capBody.payment.grossMinor, expectedTotalMinor);
});

// ============================================================================
// P1: ATOMIC GUEST CAPTURE TOKEN LIFECYCLE & CONCURRENCY
// ============================================================================

test('P1 AUTH & GUEST: Invalid Bearer token is rejected with 401 instead of silent guest checkout', async () => {
  const res = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer invalid-malformed-expired-token',
    },
    body: JSON.stringify({
      idempotencyKey: `idem-invalid-bearer-${Date.now()}`,
      currency: 'USD',
      items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
      sellerId: DEFAULT_BIZ_ID,
    }),
  });

  assert.equal(res.status, 401);
  const body = (await res.json()) as any;
  assert.equal(body.ok, false);
  assert.ok(['UNAUTHORIZED', 'INVALID_ID_TOKEN'].includes(body.code));
});

test('P1 GUEST ENTROPY: Guest UID is generated with high cryptographic entropy', async () => {
  const res = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idem-guest-entropy-${Date.now()}`,
      currency: 'USD',
      items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
      sellerId: DEFAULT_BIZ_ID,
    }),
  });

  assert.equal(res.status, 201);
  const body = (await res.json()) as any;
  const uid: string = body.order.customerId;
  assert.ok(uid.startsWith('guest-'));

  // Format: guest-<timestamp>-<32 hex chars>
  const parts = uid.split('-');
  assert.ok(parts.length >= 3);
  const hexPart = parts[parts.length - 1];
  assert.equal(hexPart.length, 32, 'Must contain 16 bytes (32 hex characters) of cryptographic entropy');
});

test('P1 CONCURRENCY: Simultaneous captures with different idempotency keys are rejected with 409 conflict', async () => {
  // 1. Create order
  const createRes = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idem-concurrent-${Date.now()}`,
      currency: 'USD',
      items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
      sellerId: DEFAULT_BIZ_ID,
    }),
  });
  const createBody = (await createRes.json()) as any;
  const orderId = createBody.order.id;
  const guestToken = createBody.guestCaptureToken;

  // 2. Fire two simultaneous capture requests with DIFFERENT idempotency keys
  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/paypal/capture-order/${orderId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: `idem-concurrent-A-${Date.now()}`,
        guestCaptureToken: guestToken,
        simulateOutcome: 'COMPLETED',
      }),
    }),
    fetch(`${baseUrl}/api/paypal/capture-order/${orderId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: `idem-concurrent-B-${Date.now()}`,
        guestCaptureToken: guestToken,
        simulateOutcome: 'COMPLETED',
      }),
    }),
  ]);

  const statuses = [res1.status, res2.status].sort();
  // One request succeeds (200), the conflicting concurrent request is rejected with 409 Conflict or 403 Token Reused
  assert.equal(statuses[0], 200, 'One capture operation must succeed');
  assert.ok([403, 409].includes(statuses[1]), 'Concurrent or duplicate capture must be rejected with 409 or 403');
});

test('P1 CONCURRENCY: ServerPaymentLedger throws CONCURRENT_CAPTURE_CONFLICT on in-flight race condition', async () => {
  const ledger = new ServerPaymentLedger();
  const created = await ledger.createOrder({
    idempotencyKey: `idem-direct-conc-${Date.now()}`,
    currency: 'USD',
    items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
  });

  const orderId = created.order.id;

  // Simulate in-flight capture A
  const capturePromiseA = ledger.captureOrder(orderId, {
    idempotencyKey: `idem-cap-long-A-${Date.now()}`,
    simulateOutcome: 'COMPLETED',
  });

  // Simultaneous capture B with different idempotency key must reject with CONCURRENT_CAPTURE_CONFLICT
  await assert.rejects(
    async () => {
      await ledger.captureOrder(orderId, {
        idempotencyKey: `idem-cap-long-B-${Date.now()}`,
        simulateOutcome: 'COMPLETED',
      });
    },
    (err: any) => {
      assert.ok(err.message.includes('CONCURRENT_CAPTURE_CONFLICT'));
      return true;
    }
  );

  const resA = await capturePromiseA;
  assert.equal(resA.order.paymentStatus, 'Captured');
});

test('P1 CONCURRENCY: Simultaneous create-order calls with different idempotency keys create independent non-colliding orders', async () => {
  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/paypal/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: `idem-create-pair-A-${Date.now()}`,
        currency: 'USD',
        items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
        sellerId: DEFAULT_BIZ_ID,
      }),
    }),
    fetch(`${baseUrl}/api/paypal/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: `idem-create-pair-B-${Date.now()}`,
        currency: 'USD',
        items: [{ sku: '#FAN-BLDC-892', quantity: 2 }],
        sellerId: DEFAULT_BIZ_ID,
      }),
    }),
  ]);

  assert.equal(res1.status, 201);
  assert.equal(res2.status, 201);
  const body1 = (await res1.json()) as any;
  const body2 = (await res2.json()) as any;

  assert.notEqual(body1.order.id, body2.order.id, 'Must produce distinct order IDs');
  assert.notEqual(body1.guestCaptureToken, body2.guestCaptureToken, 'Must produce distinct guest capture tokens');
  assert.notEqual(body1.order.totalMinor, body2.order.totalMinor, 'Totals must reflect separate items');
});

test('P1 CONCURRENCY: Simultaneous in-flight create-order calls with IDENTICAL idempotency key resolve to exact same order', async () => {
  const sharedKey = `idem-create-inflight-shared-${Date.now()}`;
  const [res1, res2, res3] = await Promise.all([
    fetch(`${baseUrl}/api/paypal/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: sharedKey,
        currency: 'USD',
        items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
        sellerId: DEFAULT_BIZ_ID,
      }),
    }),
    fetch(`${baseUrl}/api/paypal/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: sharedKey,
        currency: 'USD',
        items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
        sellerId: DEFAULT_BIZ_ID,
      }),
    }),
    fetch(`${baseUrl}/api/paypal/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: sharedKey,
        currency: 'USD',
        items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
        sellerId: DEFAULT_BIZ_ID,
      }),
    }),
  ]);

  const statuses = [res1.status, res2.status, res3.status];
  assert.ok(statuses.includes(201), 'At least one request must create the order');
  assert.ok(statuses.filter((s) => s === 200 || s === 201).length === 3, 'All concurrent requests must succeed');

  const body1 = (await res1.json()) as any;
  const body2 = (await res2.json()) as any;
  const body3 = (await res3.json()) as any;

  assert.equal(body1.order.id, body2.order.id, 'Concurrent in-flight orders must have identical ID');
  assert.equal(body2.order.id, body3.order.id, 'Concurrent in-flight orders must have identical ID');
  assert.equal(body1.order.paypalOrderId, body2.order.paypalOrderId, 'PayPal order ID must be identical');
});

test('P1 LIFECYCLE: Replay of consumed guest capture token rejected with 403 GUEST_TOKEN_REUSED', async () => {
  // 1. Create order
  const createRes = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idem-replay-test-${Date.now()}`,
      currency: 'USD',
      items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
      sellerId: DEFAULT_BIZ_ID,
    }),
  });
  const createBody = (await createRes.json()) as any;
  const orderId = createBody.order.id;
  const guestToken = createBody.guestCaptureToken;

  // 2. First capture succeeds
  const cap1 = await fetch(`${baseUrl}/api/paypal/capture-order/${orderId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idem-cap-replay-1-${Date.now()}`,
      guestCaptureToken: guestToken,
      simulateOutcome: 'COMPLETED',
    }),
  });
  assert.equal(cap1.status, 200);

  // 3. Replay with different idempotency key must be rejected with 403 GUEST_TOKEN_REUSED
  const cap2 = await fetch(`${baseUrl}/api/paypal/capture-order/${orderId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idem-cap-replay-2-${Date.now()}`,
      guestCaptureToken: guestToken,
      simulateOutcome: 'COMPLETED',
    }),
  });
  assert.equal(cap2.status, 403);
  const cap2Body = (await cap2.json()) as any;
  assert.equal(cap2Body.code, 'GUEST_TOKEN_REUSED');
});

test('P1 LIFECYCLE: Expired guest capture token rejected with 403 GUEST_TOKEN_EXPIRED', async () => {
  const expiredSku = '#FAN-BLDC-892';
  const orderId = `ord-expired-${Date.now()}`;
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  // Save order directly with expired timestamp
  await saveOrderForBiz(DEFAULT_BIZ_ID, {
    id: orderId,
    totalMinor: 10000,
    currency: 'USD',
    isGuestCheckout: true,
    guestCaptureTokenHash: tokenHash,
    guestExpiresAt: new Date(Date.now() - 3600000).toISOString(), // Expired 1 hour ago
    guestTokenUsed: false,
    paymentStatus: 'Pending',
    escrowState: 'created',
  });

  const capRes = await fetch(`${baseUrl}/api/paypal/capture-order/${orderId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idem-expired-attempt-${Date.now()}`,
      guestCaptureToken: rawToken,
      simulateOutcome: 'COMPLETED',
    }),
  });

  assert.equal(capRes.status, 403);
  const capBody = (await capRes.json()) as any;
  assert.equal(capBody.code, 'GUEST_TOKEN_EXPIRED');
});

// ============================================================================
// P1: ISOLATE SEEDED DEMO FINANCIAL DATA
// ============================================================================

test('P1 DEMO ISOLATION: Production starts with 0 fabricated verified payment records', () => {
  const origEnv = process.env.NODE_ENV;
  const origDemo = process.env.DEMO_MODE;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.DEMO_MODE;

    const prodLedger = new ServerPaymentLedger();
    const orders = prodLedger.listAllOrdersInternal();
    const payments = prodLedger.listPaymentsForActor({
      uid: 'admin-1',
      email: 'admin@paypilot.in',
      role: 'business_head',
      bizId: DEFAULT_BIZ_ID,
    });

    assert.equal(orders.length, 0, 'Production must start with 0 orders');
    assert.equal(payments.length, 0, 'Production must start with 0 payments');
  } finally {
    process.env.NODE_ENV = origEnv;
    if (origDemo) process.env.DEMO_MODE = origDemo;
  }
});

test('P1 DEMO ISOLATION: Seeded demo records do not contaminate production executive KPIs', () => {
  const now = new Date();
  const currentStart = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const currentEnd = new Date(now.getTime() + 60 * 1000);
  const orderTime = now.toISOString();

  const testOrders: DatedOrderRecord[] = [
    // Real verified order
    {
      id: 'ord-real-1',
      totalMinor: 50000, // $500.00
      escrowState: 'funded',
      createdAtIso: orderTime,
      isDemo: false,
    },
    // Seeded synthetic demo order
    {
      id: 'ord-demo-seed-1',
      totalMinor: 1000000, // $10,000.00 fake revenue
      escrowState: 'released',
      createdAtIso: orderTime,
      isDemo: true, // Marked as demo
    },
  ];

  const origEnv = process.env.NODE_ENV;
  const origDemo = process.env.DEMO_MODE;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.DEMO_MODE;

    const kpis = computeExecutiveKpisForDateRange(testOrders, currentStart.toISOString(), currentEnd.toISOString());

    // Real order has 50000 minor units
    // Demo order (1,000,000 minor units) must NOT be included in gross merchandise value
    assert.equal(kpis.currentPeriodCount, 1, 'Only real orders should be counted in production');
    assert.equal(kpis.currentGmvMinor, 50000, 'Demo records must not inflate GMV');
  } finally {
    process.env.NODE_ENV = origEnv;
    if (origDemo) process.env.DEMO_MODE = origDemo;
  }
});

// ============================================================================
// P1: CONFIGURATION & ADC VALIDATION
// ============================================================================

test('P1 CONFIG: Production rejects missing or nonexistent GOOGLE_APPLICATION_CREDENTIALS file', () => {
  assert.throws(
    () => {
      validateStartupConfig({
        NODE_ENV: 'production',
        PAYPAL_WEBHOOK_ID: 'WH-VALID-123',
        PAYPAL_CLIENT_ID: 'CLIENT-VALID-123',
        PAYPAL_CLIENT_SECRET: 'SECRET-VALID-123',
        GOOGLE_APPLICATION_CREDENTIALS: '/path/to/nonexistent/service-account.json',
      });
    },
    (err: any) => {
      assert.ok(err instanceof ConfigurationError);
      assert.ok(err.missingVars.includes('GOOGLE_APPLICATION_CREDENTIALS'));
      return true;
    }
  );
});

test('P1 CONFIG: Production supports Google Cloud ADC without local credential file', () => {
  const result = validateStartupConfig({
    NODE_ENV: 'production',
    PAYPAL_WEBHOOK_ID: 'WH-VALID-123',
    PAYPAL_CLIENT_ID: 'CLIENT-VALID-123',
    PAYPAL_CLIENT_SECRET: 'SECRET-VALID-123',
    K_SERVICE: 'paypilot-cloud-run-production', // Google Cloud Run platform env
  });

  assert.equal(result.ok, true);
  assert.equal(result.persistenceMode, 'firestore-admin');
  assert.equal(result.missing.length, 0);
});

// ============================================================================
// ADVERSARIAL SECURITY, TENANT ISOLATION & FINTECH INVARIANT TESTS
// ============================================================================

test('SECURITY: Partial capture (final_capture: false) is rejected with PAYPAL_PARTIAL_CAPTURE_NOT_SUPPORTED', () => {
  assert.throws(
    () => {
      validatePayPalCaptureEvidence(
        {
          id: 'PAYPAL-ORD-PARTIAL-1',
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    id: 'CAP-PARTIAL-1',
                    status: 'COMPLETED',
                    final_capture: false,
                    amount: {
                      currency_code: 'INR',
                      value: '100.00',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          paypalOrderId: 'PAYPAL-ORD-PARTIAL-1',
          expectedTotalMinor: 10000,
          expectedCurrency: 'INR',
        }
      );
    },
    (err: any) => {
      assert.equal(err.code, 'PAYPAL_PARTIAL_CAPTURE_NOT_SUPPORTED');
      return true;
    }
  );
});

test('SECURITY: Excessive item quantity (>10000 units) is rejected by calculator', () => {
  assert.throws(
    () => {
      calculateAuthoritativeOrderTotalsMinor(
        [{ sku: '#FAN-BLDC-892', quantity: 10001 }],
        CATALOG_PRODUCTS,
        'INR'
      );
    },
    (err: any) => {
      assert.match(err.message, /positive integer between 1 and 10000/);
      return true;
    }
  );
});

test('SECURITY: Capture of cancelled order is rejected with 400 ORDER_CANCELLED', async () => {
  const customProvider = {
    async createOrder(params: any) {
      return {
        paypalOrderId: `PAYPAL-MOCK-${Date.now()}`,
        status: 'CREATED' as const,
        currency: params.currency,
        totalMinor: params.expectedTotalMinor,
        mode: 'paypal_sandbox_api' as const,
      };
    },
    async captureOrder(params: any) {
      return {
        paypalOrderId: params.paypalOrderId,
        captureId: `CAP-${Date.now()}`,
        providerStatus: 'COMPLETED' as const,
        status: 'COMPLETED' as const,
        capturedAmountMinor: params.expectedTotalMinor,
        capturedCurrency: params.currency,
        mode: 'paypal_sandbox_api' as const,
      };
    },
  };
  const ledger = new ServerPaymentLedger(customProvider);
  const created = await ledger.createOrder({
    idempotencyKey: 'cancel-cap-test-1',
    currency: 'INR',
    items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
  });
  ledger.cancelOrder(created.order.id, { reason: 'Customer changed mind' });

  await assert.rejects(
    async () => {
      await ledger.captureOrder(created.order.id, {
        idempotencyKey: 'cap-after-cancel-1',
      });
    },
    (err: any) => {
      assert.equal(err.code, 'ORDER_CANCELLED');
      return true;
    }
  );
});

test('SECURITY: Capture ID reuse across distinct orders is rejected with 409 PAYPAL_CAPTURE_REUSED', async () => {
  const sharedCaptureId = 'CAP-SHARED-REPLAY-1';
  const customProvider = {
    async createOrder(params: any) {
      return {
        paypalOrderId: `PAYPAL-MOCK-${Date.now()}`,
        status: 'CREATED' as const,
        currency: params.currency,
        totalMinor: params.expectedTotalMinor,
        mode: 'paypal_sandbox_api' as const,
      };
    },
    async captureOrder(params: any) {
      return {
        paypalOrderId: params.paypalOrderId,
        captureId: sharedCaptureId,
        providerStatus: 'COMPLETED' as const,
        status: 'COMPLETED' as const,
        capturedAmountMinor: params.expectedTotalMinor,
        capturedCurrency: params.currency,
        mode: 'paypal_sandbox_api' as const,
      };
    },
  };

  const ledger = new ServerPaymentLedger(customProvider);
  const orderA = await ledger.createOrder({
    idempotencyKey: 'cap-reuse-order-A',
    currency: 'INR',
    items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
  });
  const orderB = await ledger.createOrder({
    idempotencyKey: 'cap-reuse-order-B',
    currency: 'INR',
    items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
  });

  // Order A captures successfully
  await ledger.captureOrder(orderA.order.id, {
    idempotencyKey: 'cap-idemp-order-A',
  });

  // Order B attempts to capture and receives same captureId -> must be rejected
  await assert.rejects(
    async () => {
      await ledger.captureOrder(orderB.order.id, {
        idempotencyKey: 'cap-idemp-order-B',
      });
    },
    (err: any) => {
      assert.equal(err.code, 'PAYPAL_CAPTURE_REUSED');
      return true;
    }
  );
});

test('SECURITY: Cross-tenant escrow transition is rejected with 403 TENANT_ACCESS_DENIED', async () => {
  const created = await defaultServerLedger.createOrder({
    idempotencyKey: `tenant-escrow-key-${Date.now()}`,
    currency: 'USD',
    items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
  });
  created.order.bizId = 'biz-tenant-alpha';
  created.order.escrowState = 'funded';

  // Seller from biz-tenant-beta tries to transition order from biz-tenant-alpha
  const sellerBetaToken = 'mock-token-seller-sellerBeta-biz-tenant-beta';
  const res = await fetch(`${baseUrl}/api/orders/${created.order.id}/escrow-transition`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sellerBetaToken}`,
    },
    body: JSON.stringify({
      nextState: 'in_delivery',
      reason: 'Malicious cross-tenant attempt',
    }),
  });

  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.code, 'TENANT_ACCESS_DENIED');
});

test('SECURITY: Cross-customer escrow release is rejected with 403 ORDER_ACCESS_DENIED', async () => {
  const orderId = `ord-cust-test-${Date.now()}`;
  const testBizId = 'biz-customer-isolation-1';
  await saveOrderForBiz(testBizId, {
    id: orderId,
    bizId: testBizId,
    orderNumber: '#ORD-CUST-1',
    customerId: 'cust-victim-1',
    paymentStatus: 'Captured',
    escrowState: 'in_delivery',
    totalMinor: 10000,
    currency: 'INR',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Customer Attacker tries to release Customer Victim's escrow order
  const attackerToken = `mock-token-customer-cust-attacker-99-${testBizId}`;
  const res = await fetch(`${baseUrl}/api/orders/${orderId}/escrow-transition`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${attackerToken}`,
    },
    body: JSON.stringify({
      nextState: 'released',
      reason: 'Customer attacker attempting to release victim order',
    }),
  });

  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.code, 'ORDER_ACCESS_DENIED');
});

test('SECURITY: Cross-tenant refund is rejected with 403 TENANT_ACCESS_DENIED', async () => {
  const created = await defaultServerLedger.createOrder({
    idempotencyKey: `tenant-refund-key-${Date.now()}`,
    currency: 'USD',
    items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
  });
  created.order.bizId = 'biz-tenant-merch-a';
  created.order.paymentStatus = 'Captured';
  created.order.escrowState = 'funded';

  // Seller from biz-tenant-merch-b tries to refund order from biz-tenant-merch-a
  const sellerBToken = 'mock-token-seller-sellerB-biz-tenant-merch-b';
  const res = await fetch(`${baseUrl}/api/paypal/refund-order/${created.order.id}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sellerBToken}`,
    },
    body: JSON.stringify({
      reason: 'Cross-tenant refund exploit attempt',
    }),
  });

  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.code, 'TENANT_ACCESS_DENIED');
});

test('SECURITY: Refund of uncaptured order is rejected with 400 INVALID_REFUND_STATE', async () => {
  const orderId = `ord-uncaptured-refund-${Date.now()}`;
  const testBiz = 'biz-refund-uncaptured';
  await saveOrderForBiz(testBiz, {
    id: orderId,
    bizId: testBiz,
    orderNumber: '#ORD-UNCAPTURED-1',
    paymentStatus: 'Pending', // Uncaptured!
    escrowState: 'created',
    totalMinor: 10000,
    currency: 'INR',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const sellerToken = `mock-token-seller-seller1-${testBiz}`;
  const res = await fetch(`${baseUrl}/api/paypal/refund-order/${orderId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sellerToken}`,
    },
    body: JSON.stringify({
      reason: 'Attempting to refund uncaptured order',
    }),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, 'INVALID_REFUND_STATE');
});

test('SECURITY: Refund of already-released escrow order is rejected with 400 INVALID_STATE_TRANSITION', async () => {
  const orderId = `ord-released-refund-${Date.now()}`;
  const testBiz = 'biz-refund-released';
  await saveOrderForBiz(testBiz, {
    id: orderId,
    bizId: testBiz,
    orderNumber: '#ORD-RELEASED-1',
    paymentStatus: 'Captured',
    escrowState: 'released', // Already released to seller!
    totalMinor: 10000,
    currency: 'INR',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const financeToken = `mock-token-finance-fin1-${testBiz}`;
  const res = await fetch(`${baseUrl}/api/paypal/refund-order/${orderId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${financeToken}`,
    },
    body: JSON.stringify({
      reason: 'Attempting to refund already-released funds',
    }),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, 'INVALID_STATE_TRANSITION');
});
