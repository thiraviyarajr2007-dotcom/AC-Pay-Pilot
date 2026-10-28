import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toMinorUnits,
  fromMinorUnits,
  formatMinorUnits,
  calculateInvoiceTotals,
  calculateCartMetrics,
  calculateAuthoritativeOrderTotalsMinor,
  extractProviderFeeBreakdown,
  computeExecutiveKpisForDateRange,
  calculatePayPalFee,
  validateGstinFormat,
  validatePlaceOfSupplyTaxRegime,
} from './finance';
import {
  canTransitionEscrow,
  transitionEscrowState,
  ESCROW_ARCHITECTURE_DECISION,
} from './escrow';
import { evaluateRoleAccess } from './rbac';
import {
  ServerPaymentLedger,
  PayPalProviderAdapter,
  calculateInvoiceOnServer,
} from '../server/paymentEngine';
import {
  getGlbBufferForModelKey,
  registerSeller3DAsset,
} from '../server/glbGenerator';
import {
  executeCopilotToolForActor,
  answerProductQaWithGemini,
  recommendEscrowWithGemini,
  optimizeCartWithGemini,
} from '../server/geminiService';
import { CATALOG_PRODUCTS, INITIAL_CART_ITEMS } from '../data/mockData';

// ============================================================================
// 1. Finance & Integer Minor Units (paise / cents) Tests
// ============================================================================

test('Integer minor units conversion and formatting (INR paise & USD cents)', () => {
  assert.equal(toMinorUnits(8499), 849900);
  assert.equal(toMinorUnits(94915.25), 9491525);
  assert.equal(fromMinorUnits(849900), 8499);
  assert.equal(fromMinorUnits(9491525), 94915.25);

  assert.equal(formatMinorUnits(849900, 'INR'), 'INR ₹8,499');
  assert.equal(formatMinorUnits(1999, 'USD'), 'USD $19.99');
});

test('Server-grade invoice minor-unit math keeps invoiceStatus separate from paymentStatus', () => {
  const res = calculateInvoiceOnServer({
    currency: 'INR',
    clientName: 'Apex Cloud Labs Pvt Ltd',
    clientGstin: '29AAAAA0000A1Z5',
    invoiceStatus: 'issued',
    paymentStatus: 'Pending',
    items: [
      {
        sku: 'WRK-PRO-M3-64G',
        name: 'Developer Workstation Pro Bundle',
        hsn: '8471',
        quantity: 2,
        unitRateMinor: 3800000, // ₹38,000.00 in paise
        gstRatePercent: 18,
      },
    ],
  });

  assert.equal(res.subtotalMinor, 7600000); // ₹76,000.00
  assert.equal(res.taxMinor, 1368000); // 18% = ₹13,680.00
  assert.equal(res.totalMinor, 8968000); // ₹89,680.00
  assert.equal(res.invoiceStatus, 'issued');
  assert.equal(res.paymentStatus, 'Pending');
});

test('Cart and budget math in integer minor units detects headroom and over-budget accurately', () => {
  const metricsWithinBudget = calculateCartMetrics(INITIAL_CART_ITEMS, 90000);
  // Active items in INITIAL_CART_ITEMS: 42999 + 16500 + 20000 = 79499 INR = 7949900 paise
  assert.equal(metricsWithinBudget.activeCount, 3);
  assert.equal(metricsWithinBudget.deferredCount, 1);
  assert.equal(metricsWithinBudget.allocatedTotalMinor, 7949900);
  assert.equal(metricsWithinBudget.remainingHeadroomMinor, 1050100);
  assert.equal(metricsWithinBudget.isOverBudget, false);

  const metricsOverBudget = calculateCartMetrics(INITIAL_CART_ITEMS, 70000);
  assert.equal(metricsOverBudget.isOverBudget, true);
  assert.equal(metricsOverBudget.remainingHeadroomMinor, -949900);
});

test('Authoritative server order calculation uses stored catalog prices and rejects unknown SKUs', () => {
  // #FAN-BLDC-892 is ₹8,499 (849900 paise) in CATALOG_PRODUCTS
  const orderCalc = calculateAuthoritativeOrderTotalsMinor(
    [{ sku: '#FAN-BLDC-892', quantity: 2 }],
    CATALOG_PRODUCTS,
    'INR',
    0
  );

  assert.equal(orderCalc.totalMinor, 1699800);
  assert.equal(orderCalc.subtotalMinor + orderCalc.taxMinor, 1699800);

  assert.throws(
    () =>
      calculateAuthoritativeOrderTotalsMinor(
        [{ sku: '#NON-EXISTENT-SKU', quantity: 1 }],
        CATALOG_PRODUCTS,
        'INR',
        0
      ),
    /Unknown SKU/
  );
});

test('PayPal fee extraction shows fees ONLY when present in provider payload; otherwise "Not available"', () => {
  const missingBreakdown = extractProviderFeeBreakdown(null, 'INR');
  assert.equal(missingBreakdown.feesFromProvider, false);
  assert.equal(missingBreakdown.paypalFeeMinor, null);
  assert.equal(missingBreakdown.feeDisplayLabel, 'Not available');
  assert.equal(missingBreakdown.netDisplayLabel, 'Not available');

  const verifiedBreakdown = extractProviderFeeBreakdown(
    {
      seller_receivable_breakdown: {
        gross_amount: { currency_code: 'INR', value: '8499.00' },
        paypal_fee: { currency_code: 'INR', value: '308.62' },
        net_amount: { currency_code: 'INR', value: '8190.38' },
      },
    },
    'INR'
  );
  assert.equal(verifiedBreakdown.feesFromProvider, true);
  assert.equal(verifiedBreakdown.paypalFeeMinor, 30862);
  assert.equal(verifiedBreakdown.netAmountMinor, 819038);
});

test('Executive KPI calculation returns "No baseline" when comparison period has no data', () => {
  const sampleRecords = [
    {
      id: 'ord-101',
      totalMinor: 2500000,
      escrowState: 'released',
      createdAtIso: '2026-10-20T10:00:00.000Z',
    },
  ];

  // Prior period (Sep 20 to Oct 10) has 0 orders -> must return "No baseline"
  const noBaselineReport = computeExecutiveKpisForDateRange(
    sampleRecords,
    '2026-10-10T00:00:00.000Z',
    '2026-10-24T00:00:00.000Z',
    'INR'
  );
  assert.equal(noBaselineReport.hasBaseline, false);
  assert.equal(noBaselineReport.growthPercent, null);
  assert.equal(noBaselineReport.growthLabel, 'No baseline');

  // Add a record in the prior window (Oct 05) -> should compute exact growth percentage
  const withBaselineRecords = [
    ...sampleRecords,
    {
      id: 'ord-100',
      totalMinor: 2000000,
      escrowState: 'released',
      createdAtIso: '2026-10-05T10:00:00.000Z',
    },
  ];
  const baselineReport = computeExecutiveKpisForDateRange(
    withBaselineRecords,
    '2026-10-10T00:00:00.000Z',
    '2026-10-24T00:00:00.000Z',
    'INR'
  );
  assert.equal(baselineReport.hasBaseline, true);
  assert.equal(baselineReport.growthPercent, 25);
  assert.equal(baselineReport.growthLabel, '+25.0% vs prior period');
});

// ============================================================================
// 2. Escrow State Machine (src/utils/escrow.ts) Tests
// ============================================================================

test('Escrow state machine enforces created -> funded -> in_delivery -> released | disputed | refunded', () => {
  assert.equal(ESCROW_ARCHITECTURE_DECISION.chosenPaypalIntent, 'CAPTURE');

  // Valid lifecycle: created -> funded -> in_delivery -> released
  assert.equal(canTransitionEscrow('created', 'funded'), true);
  assert.equal(canTransitionEscrow('funded', 'in_delivery'), true);
  assert.equal(canTransitionEscrow('in_delivery', 'released'), true);
  assert.equal(canTransitionEscrow('in_delivery', 'disputed'), true);
  assert.equal(canTransitionEscrow('disputed', 'refunded'), true);

  // Invalid transitions
  assert.equal(canTransitionEscrow('created', 'released'), false);
  assert.equal(canTransitionEscrow('released', 'refunded'), false);
  assert.equal(canTransitionEscrow('refunded', 'funded'), false);

  // Execute valid transition and verify EscrowEventRecord fields
  const step1 = transitionEscrowState({
    orderId: 'ord-esc-1',
    currentState: 'funded',
    nextState: 'in_delivery',
    actorId: 'seller-demo-1',
    actorRole: 'seller',
    reason: 'Dispatched via BlueDart AWB #99102',
  });
  assert.equal(step1.ok, true);
  assert.equal(step1.nextState, 'in_delivery');
  assert.equal(step1.event?.fromState, 'funded');
  assert.equal(step1.event?.toState, 'in_delivery');
  assert.equal(step1.event?.actorId, 'seller-demo-1');

  // Block AI from directly mutating escrow state
  const aiAttempt = transitionEscrowState({
    orderId: 'ord-esc-1',
    currentState: 'in_delivery',
    nextState: 'released',
    actorId: 'copilot-agent',
    actorRole: 'finance',
    reason: 'AI auto-release attempt',
    isAiAutomated: true,
  });
  assert.equal(aiAttempt.ok, false);
  assert.equal(aiAttempt.code, 'AI_DIRECT_MUTATION_FORBIDDEN');

  // Block unauthorized role (seller cannot release funds to themselves)
  const sellerReleaseAttempt = transitionEscrowState({
    orderId: 'ord-esc-1',
    currentState: 'in_delivery',
    nextState: 'released',
    actorId: 'seller-demo-1',
    actorRole: 'seller',
    reason: 'Seller attempting self-release',
  });
  assert.equal(sellerReleaseAttempt.ok, false);
  assert.equal(sellerReleaseAttempt.code, 'UNAUTHORIZED_ROLE_FOR_TRANSITION');
});

// ============================================================================
// 3. Idempotent PayPal Create & Capture + Server Price Integrity (Mocked Provider)
// ============================================================================

test('Server payment engine ignores tampered client total and enforces idempotent create & capture', async () => {
  let providerCreateCalls = 0;
  let providerCaptureCalls = 0;

  const mockPayPalProvider: PayPalProviderAdapter = {
    async createOrder() {
      providerCreateCalls += 1;
      return {
        paypalOrderId: `MOCK-PP-${providerCreateCalls}`,
        status: 'CREATED',
        mode: 'sandbox_deterministic_fallback',
      };
    },
    async captureOrder(params) {
      providerCaptureCalls += 1;
      if (params.simulateOutcome === 'DECLINED') {
        return {
          paypalOrderId: params.paypalOrderId,
          providerStatus: 'DECLINED',
          errorMessage: 'Card declined by bank',
          mode: 'sandbox_deterministic_fallback',
        };
      }
      return {
        paypalOrderId: params.paypalOrderId,
        captureId: `MOCK-CAP-${providerCaptureCalls}`,
        providerStatus: 'COMPLETED',
        seller_receivable_breakdown: {
          gross_amount: { currency_code: 'INR', value: '8499.00' },
          paypal_fee: { currency_code: 'INR', value: '308.62' },
          net_amount: { currency_code: 'INR', value: '8190.38' },
        },
        mode: 'sandbox_deterministic_fallback',
      };
    },
  };

  const ledger = new ServerPaymentLedger(mockPayPalProvider);

  // 1. Create order with tampered clientPriceIgnored=1 and clientUntrustedTotalMinor=50
  const firstCreate = await ledger.createOrder({
    idempotencyKey: 'idem-create-key-001',
    currency: 'INR',
    items: [{ sku: '#FAN-BLDC-892', quantity: 1, clientPriceIgnored: 1 }],
    clientUntrustedTotalMinor: 50,
    customerId: 'cust-1',
    sellerId: 'seller-1',
  });

  // Server must compute 849900 paise (₹8,499) from CATALOG_PRODUCTS, ignoring client's 50 paise
  assert.equal(firstCreate.order.totalMinor, 849900);
  assert.equal(firstCreate.idempotentReplay, false);
  assert.equal(providerCreateCalls, 1);

  // 2. Duplicate createOrder with same idempotencyKey must NOT call provider again
  const duplicateCreate = await ledger.createOrder({
    idempotencyKey: 'idem-create-key-001',
    currency: 'INR',
    items: [{ sku: '#FAN-BLDC-892', quantity: 1 }],
    customerId: 'cust-1',
    sellerId: 'seller-1',
  });
  assert.equal(duplicateCreate.idempotentReplay, true);
  assert.equal(duplicateCreate.order.id, firstCreate.order.id);
  assert.equal(providerCreateCalls, 1);

  // 3. Test DECLINED capture attempt first (must NOT mark order Captured or transition escrow to funded)
  const declinedCapture = await ledger.captureOrder(firstCreate.order.id, {
    idempotencyKey: 'idem-cap-decline-001',
    simulateOutcome: 'DECLINED',
    actorId: 'cust-1',
    actorRole: 'customer',
  });
  assert.equal(declinedCapture.order.paymentStatus, 'Failed');
  assert.equal(declinedCapture.order.verifiedByServer, false);
  assert.equal(declinedCapture.order.escrowState, 'created');
  assert.equal(declinedCapture.retryAllowed, true);
  assert.equal(providerCaptureCalls, 1);

  // 4. Retry capture with new idempotencyKey and COMPLETED outcome
  const successCapture = await ledger.captureOrder(firstCreate.order.id, {
    idempotencyKey: 'idem-cap-success-002',
    simulateOutcome: 'COMPLETED',
    actorId: 'cust-1',
    actorRole: 'customer',
  });
  assert.equal(successCapture.order.paymentStatus, 'Captured');
  assert.equal(successCapture.order.verifiedByServer, true);
  assert.equal(successCapture.order.escrowState, 'funded');
  assert.equal(successCapture.order.feesFromProvider, true);
  assert.equal(successCapture.order.paypalFeeMinor, 30862);
  assert.equal(providerCaptureCalls, 2);

  // 5. Double-click / refresh with same OR different idempotencyKey on already-captured order must NOT capture again
  const replaySameKey = await ledger.captureOrder(firstCreate.order.id, {
    idempotencyKey: 'idem-cap-success-002',
    actorId: 'cust-1',
    actorRole: 'customer',
  });
  assert.equal(replaySameKey.idempotentReplay, true);
  assert.equal(providerCaptureCalls, 2);

  const replayDifferentKey = await ledger.captureOrder(firstCreate.order.id, {
    idempotencyKey: 'idem-cap-another-003',
    actorId: 'cust-1',
    actorRole: 'customer',
  });
  assert.equal(replayDifferentKey.idempotentReplay, true);
  assert.equal(providerCaptureCalls, 2);
});

// ============================================================================
// 4. Role-Based Access Control (src/utils/rbac.ts) Tests
// ============================================================================

test('RBAC enforces customer, seller, finance, and business_head boundaries across collections', () => {
  const customerA = { uid: 'cust-A', email: 'a@buyer.in', role: 'customer' as const };
  const sellerA = { uid: 'seller-A', email: 'a@seller.in', role: 'seller' as const };
  const financeUser = { uid: 'fin-1', email: 'fin@corp.in', role: 'finance' as const };
  const execUser = { uid: 'exec-1', email: 'vp@corp.in', role: 'business_head' as const };

  // Customers read only their own orders; blocked from reading another customer's order
  assert.equal(
    evaluateRoleAccess(customerA, 'orders', 'read', { customerId: 'cust-A' }).allowed,
    true
  );
  assert.equal(
    evaluateRoleAccess(customerA, 'orders', 'read', { customerId: 'cust-B' }).allowed,
    false
  );

  // Sellers edit only their own products and see only their own orders
  assert.equal(
    evaluateRoleAccess(sellerA, 'products', 'update', { sellerId: 'seller-A' }).allowed,
    true
  );
  assert.equal(
    evaluateRoleAccess(sellerA, 'products', 'update', { sellerId: 'seller-B' }).allowed,
    false
  );
  assert.equal(
    evaluateRoleAccess(sellerA, 'orders', 'read', { sellerId: 'seller-A' }).allowed,
    true
  );
  assert.equal(
    evaluateRoleAccess(sellerA, 'orders', 'read', { sellerId: 'seller-B' }).allowed,
    false
  );

  // Finance reads payments & invoices; customer cannot read unowned payments
  assert.equal(evaluateRoleAccess(financeUser, 'payments', 'read', {}).allowed, true);
  assert.equal(evaluateRoleAccess(financeUser, 'invoices', 'read', {}).allowed, true);
  assert.equal(
    evaluateRoleAccess(customerA, 'payments', 'read', { customerId: 'cust-B' }).allowed,
    false
  );

  // Business Head reads aggregates across collections, but is blocked from mutating products or orders
  assert.equal(evaluateRoleAccess(execUser, 'orders', 'read', {}).allowed, true);
  assert.equal(evaluateRoleAccess(execUser, 'payments', 'read', {}).allowed, true);
  assert.equal(
    evaluateRoleAccess(execUser, 'products', 'update', { sellerId: 'seller-A' }).allowed,
    false
  );
  assert.equal(
    evaluateRoleAccess(execUser, 'orders', 'create', { customerId: 'exec-1' }).allowed,
    false
  );
});

// ============================================================================
// 5. GSTIN Format & Place-of-Supply (CGST/SGST vs IGST) Deterministic Code Tests
// ============================================================================

test('Deterministic GSTIN format check and Place-of-Supply (CGST/SGST vs IGST) validation', () => {
  const validKarnataka = validateGstinFormat('29AABCU9603R1ZM');
  assert.equal(validKarnataka.isValidFormat, true);
  assert.equal(validKarnataka.stateCode, '29');
  assert.equal(validKarnataka.stateName, 'Karnataka');
  assert.equal(validKarnataka.panSegment, 'AABCU9603R');

  const invalidGstin = validateGstinFormat('99INVALIDGST');
  assert.equal(invalidGstin.isValidFormat, false);

  // Intra-state (29 Karnataka -> 29 Karnataka) requires CGST_SGST (9% + 9%)
  const intraStateCheck = validatePlaceOfSupplyTaxRegime({
    supplierGstin: '29AABCT1332L1Z5',
    buyerGstin: '29AABCU9603R1ZM',
    declaredRegime: 'CGST_SGST',
    taxableSubtotalMinor: 1000000, // ₹10,000.00
    gstRatePercent: 18,
  });
  assert.equal(intraStateCheck.regimeMatches, true);
  assert.equal(intraStateCheck.expectedRegime, 'CGST_SGST');
  assert.equal(intraStateCheck.cgstMinor, 90000); // ₹900.00
  assert.equal(intraStateCheck.sgstMinor, 90000); // ₹900.00
  assert.equal(intraStateCheck.igstMinor, 0);

  // Inter-state (29 Karnataka -> 27 Maharashtra) requires IGST (18%); declaring CGST_SGST flags mismatch
  const interStateMismatch = validatePlaceOfSupplyTaxRegime({
    supplierGstin: '29AABCT1332L1Z5',
    buyerGstin: '27AABCU9603R1ZM',
    declaredRegime: 'CGST_SGST',
    taxableSubtotalMinor: 1000000,
    gstRatePercent: 18,
  });
  assert.equal(interStateMismatch.regimeMatches, false);
  assert.equal(interStateMismatch.expectedRegime, 'IGST');
  assert.equal(interStateMismatch.igstMinor, 180000);
});

// ============================================================================
// 6. 3D glTF 2.0 (.glb) Generator & Upload Validator Tests
// ============================================================================

test('Binary glTF 2.0 (.glb) generator produces valid magic header and upload validator checks format/size', () => {
  const fanGlb = getGlbBufferForModelKey('ceiling-fan.glb');
  assert.ok(fanGlb && fanGlb.length > 100);
  // First 4 bytes must equal 0x46546C67 ("glTF" in little-endian)
  assert.equal(fanGlb.readUInt32LE(0), 0x46546c67);
  assert.equal(fanGlb.readUInt32LE(4), 2); // version 2

  const racketGlb = getGlbBufferForModelKey('badminton-racket.glb');
  assert.ok(racketGlb && racketGlb.length > 100);
  assert.equal(racketGlb.readUInt32LE(0), 0x46546c67);

  // Seller upload validation: reject .jpg, accept .glb under 25 MB
  const invalidExt = registerSeller3DAsset({
    sku: '#FAN-BLDC-892',
    fileName: 'photo.jpg',
    sizeBytes: 50000,
    uploadedBy: 'aarav.sharma@techpilot.in',
  });
  assert.equal(invalidExt.status, 'Failed');

  const validGlbUpload = registerSeller3DAsset({
    sku: '#FAN-BLDC-892',
    fileName: 'aerobreeze-fan-v2.glb',
    sizeBytes: 120000,
    uploadedBy: 'aarav.sharma@techpilot.in',
  });
  assert.equal(validGlbUpload.status, 'Ready');
  assert.equal(validGlbUpload.modelUrl, '/api/models/ceiling-fan.glb');
});

// ============================================================================
// 7. Server-side Gemini RBAC Tools & Honest Fallback Tests
// ============================================================================

test('Copilot tools enforce RBAC and Product Q&A returns "not provided" for unknown attributes', async () => {
  const customerActor = { uid: 'cust-demo-1', email: 'priya@buyer.in', role: 'customer' as const };
  const financeActor = { uid: 'fin-demo-1', email: 'rohan@corp.in', role: 'finance' as const };

  // Customer is blocked from calling finance tool getTransactions
  const txForCustomer = executeCopilotToolForActor(customerActor, 'getTransactions', {});
  assert.equal(txForCustomer.allowed, false);

  // Finance is allowed to call getTransactions
  const txForFinance = executeCopilotToolForActor(financeActor, 'getTransactions', {});
  assert.equal(txForFinance.allowed, true);
  assert.ok(txForFinance.recordIds.length > 0);

  // Product Q&A answers unknown attributes with "not_provided"
  const qaUnknown = await answerProductQaWithGemini({
    sku: '#FAN-BLDC-892',
    question: 'Is this ceiling fan IP68 waterproof for outdoor rain?',
  });
  assert.equal(qaUnknown.answerStatus, 'not_provided');
  assert.ok(qaUnknown.answer.toLowerCase().includes('not provided'));

  // Escrow Release Agent returns valid recommendation structure
  const escRec = await recommendEscrowWithGemini({
    orderId: 'ord-1',
    trackingId: 'BLR-DLV-90812',
    deliveryConfirmed: true,
    damageReported: false,
  });
  assert.equal(escRec.recommendation, 'release');
  assert.ok(escRec.reasons.length > 0);
});

test('Legacy calculateInvoiceTotals and calculatePayPalFee remain backward-compatible', () => {
  const inv = calculateInvoiceTotals([
    {
      id: '1',
      sku: 'SKU-1',
      hsn: '8471',
      name: 'Test Item',
      quantity: 1,
      unitRate: 1000,
      gstRatePercent: 18,
    },
  ]);
  assert.equal(inv.subtotal, 1000);
  assert.equal(inv.totalGst, 180);
  assert.equal(inv.grandTotal, 1180);

  const fee = calculatePayPalFee(10000);
  assert.equal(fee.fee, 361);
  assert.equal(fee.netPayout, 9639);
});

test('optimizeCartWithGemini validates SmartCartScreen payload, computes minor units, and respects alternatives', async () => {
  const result = await optimizeCartWithGemini({
    budgetInr: 38000,
    items: [
      { sku: '#FAN-BLDC-892', quantity: 2 },
      { sku: '#SPO-YNX-99P', quantity: 1 },
    ],
  });

  assert.equal(result.ok, true);
  assert.ok(result.source === 'live' || result.source === 'fallback');
  assert.equal(result.currency, 'INR');
  assert.equal(result.budgetMinor, 3800000);
  assert.equal(result.cartSubtotalMinor, 2710800);
  assert.equal(result.cartTaxMinor, 488000); // 18% of 2710800
  assert.equal(result.cartTotalMinor, 3198800);
  assert.equal(result.withinBudget, true);

  // Ranked items contract
  assert.equal(result.rankedItems.length, 2);
  assert.equal(result.rankedItems[0].sku, '#FAN-BLDC-892');
  assert.equal(result.rankedItems[0].priorityRank, 1);
  assert.ok(['Must-Have', 'Recommended', 'Deferrable'].includes(result.rankedItems[0].priorityLabel));
  assert.ok(result.rankedItems[0].explanation.length > 0);

  // Suggested alternatives contract
  assert.ok(result.suggestedAlternatives.length > 0);
  const alt = result.suggestedAlternatives[0];
  assert.ok(alt.replacesSku.length > 0);
  assert.ok(alt.alternativeSku.length > 0);
  assert.equal(alt.autoAdded, false);
  assert.ok(alt.unitPriceMinor > 0);
  assert.ok(alt.estimatedSavingMinor >= 0);
});

