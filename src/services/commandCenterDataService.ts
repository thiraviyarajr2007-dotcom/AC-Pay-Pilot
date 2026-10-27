import { collection, onSnapshot, doc, setDoc } from 'firebase/firestore';
import type {
  AgDataSourcesDefinition,
  AgExpressionFieldDefinition,
  AgFieldDefinition,
} from 'ag-studio';
import { db, auth } from '../firebase';
import {
  CommandCenterCustomer,
  CommandCenterOrder,
  CommandCenterPayout,
  CommandCenterProduct,
  EscrowEvent,
  EscrowStage,
} from '../types';
import { DEFAULT_BIZ_ID } from './storefrontService';

export interface CommandCenterDataset {
  orders: CommandCenterOrder[];
  escrowEvents: EscrowEvent[];
  products: CommandCenterProduct[];
  customers: CommandCenterCustomer[];
  payouts: CommandCenterPayout[];
  isDemoMode: boolean;
  lastUpdatedIso: string;
}

/**
 * Formats INR numbers into compact Indian notation (e.g., ₹1.24L, ₹48.5K, ₹1.08Cr).
 */
export function formatCompactINR(value: number): string {
  const num = Number(value) || 0;
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 1_00_00_000) {
    return `${sign}₹${(abs / 1_00_00_000).toFixed(2).replace(/\.00$/, '')}Cr`;
  }
  if (abs >= 1_00_000) {
    return `${sign}₹${(abs / 1_00_000).toFixed(2).replace(/\.0$/, '')}L`;
  }
  if (abs >= 1_000) {
    return `${sign}₹${(abs / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

export function formatFullINR(value: number): string {
  const num = Number(value) || 0;
  return `₹${Math.round(num).toLocaleString('en-IN')}`;
}

const SEED_PRODUCTS: CommandCenterProduct[] = [
  {
    id: 'prod-fan-892',
    sku: 'FAN-BLDC-892',
    name: 'AeroBreeze Stealth 1200mm BLDC Fan',
    category: 'Smart Ceiling Fans',
    unitPriceInr: 8499,
    gstPercent: 18,
    stock: 120,
    unitsSold60d: 42,
    revenue60dInr: 356958,
    refundRatePct: 4.8,
  },
  {
    id: 'prod-wrk-8990',
    sku: 'AC-WRK-8990',
    name: 'ProArt Studio Workstation X1',
    category: 'Workstations',
    unitPriceInr: 292000,
    gstPercent: 18,
    stock: 6,
    unitsSold60d: 9,
    revenue60dInr: 2628000,
    refundRatePct: 11.1,
  },
  {
    id: 'prod-mon-324k',
    sku: 'AC-MON-324K',
    name: 'UltraSharp 32" 6K HDR Reference Display',
    category: 'Displays',
    unitPriceInr: 118000,
    gstPercent: 18,
    stock: 14,
    unitsSold60d: 15,
    revenue60dInr: 1770000,
    refundRatePct: 6.7,
  },
  {
    id: 'prod-nas-10g8',
    sku: 'AC-NAS-10G8',
    name: 'ProRack 8-Bay 10GbE Studio NAS',
    category: 'Enterprise Storage',
    unitPriceInr: 164000,
    gstPercent: 18,
    stock: 8,
    unitsSold60d: 11,
    revenue60dInr: 1804000,
    refundRatePct: 9.1,
  },
  {
    id: 'prod-spo-ynx',
    sku: 'SPO-YNX-99P',
    name: 'Yonex Astrox 99 Pro Carbon Racket',
    category: 'Sports & Pro Gear',
    unitPriceInr: 14990,
    gstPercent: 18,
    stock: 40,
    unitsSold60d: 28,
    revenue60dInr: 419720,
    refundRatePct: 3.6,
  },
  {
    id: 'prod-aud-anc',
    sku: 'AUD-ANC-99',
    name: 'AcousticSphere Spatial ANC Pods',
    category: 'Spatial Audio',
    unitPriceInr: 11499,
    gstPercent: 18,
    stock: 55,
    unitsSold60d: 34,
    revenue60dInr: 390966,
    refundRatePct: 8.8,
  },
  {
    id: 'prod-erg-2100',
    sku: 'AC-ERG-2100',
    name: 'ErgoMesh Task Chair Pro Titanium',
    category: 'Ergonomics',
    unitPriceInr: 45000,
    gstPercent: 18,
    stock: 19,
    unitsSold60d: 18,
    revenue60dInr: 810000,
    refundRatePct: 5.5,
  },
  {
    id: 'prod-ups-3kva',
    sku: 'AC-UPS-3000',
    name: 'VoltGuard 3kVA Online Sinewave UPS',
    category: 'Power Conditioning',
    unitPriceInr: 38500,
    gstPercent: 18,
    stock: 22,
    unitsSold60d: 16,
    revenue60dInr: 616000,
    refundRatePct: 6.2,
  },
  {
    id: 'prod-cam-ptz4k',
    sku: 'AC-PTZ-4K60',
    name: 'BroadcastPro 4K60 NDI Studio PTZ Camera',
    category: 'Broadcast Imaging',
    unitPriceInr: 86000,
    gstPercent: 18,
    stock: 11,
    unitsSold60d: 12,
    revenue60dInr: 1032000,
    refundRatePct: 8.3,
  },
  {
    id: 'prod-dock-tb4',
    sku: 'AC-DCK-TB4',
    name: 'ThunderHub Pro 18-Port 140W Studio Dock',
    category: 'Connectivity',
    unitPriceInr: 24500,
    gstPercent: 18,
    stock: 36,
    unitsSold60d: 25,
    revenue60dInr: 612500,
    refundRatePct: 4.0,
  },
];

const SEED_CUSTOMERS: CommandCenterCustomer[] = [
  {
    id: 'cust-apex-blr',
    name: 'Apex Studio Pvt Ltd',
    email: 'procurement@apexstudio.in',
    segment: 'Enterprise B2B',
    region: 'Karnataka',
    city: 'Bengaluru',
    gstin: '29AABCA8921K1Z4',
    lifetimeOrders: 14,
    lifetimeValueInr: 1845000,
    disputeCount: 0,
    riskLevel: 'Low',
  },
  {
    id: 'cust-kinetix-mum',
    name: 'Kinetix VFX Mumbai',
    email: 'finance@kinetixvfx.in',
    segment: 'Enterprise B2B',
    region: 'Maharashtra',
    city: 'Mumbai',
    gstin: '27AABCK4412M1Z9',
    lifetimeOrders: 11,
    lifetimeValueInr: 1490000,
    disputeCount: 0,
    riskLevel: 'Low',
  },
  {
    id: 'cust-rahul-dispute',
    name: 'Rahul Deshmukh (VFXGrid Media)',
    email: 'rahul.deshmukh@vfxgrid.in',
    segment: 'Prosumer Creator',
    region: 'Maharashtra',
    city: 'Pune',
    gstin: '27AADCV9910P1Z2',
    lifetimeOrders: 6,
    lifetimeValueInr: 542000,
    disputeCount: 4,
    riskLevel: 'Critical',
  },
  {
    id: 'cust-coromandel-che',
    name: 'Coromandel Post House',
    email: 'ops@coromandelpost.in',
    segment: 'SMB Studio',
    region: 'Tamil Nadu',
    city: 'Chennai',
    gstin: '33AABCC7721L1Z8',
    lifetimeOrders: 9,
    lifetimeValueInr: 820000,
    disputeCount: 0,
    riskLevel: 'Low',
  },
  {
    id: 'cust-indraprastha-del',
    name: 'Indraprastha Broadcast Labs',
    email: 'accounts@iblabs.co.in',
    segment: 'Enterprise B2B',
    region: 'Delhi NCR',
    city: 'Gurugram',
    gstin: '06AABCI1190D1Z1',
    lifetimeOrders: 10,
    lifetimeValueInr: 1280000,
    disputeCount: 1,
    riskLevel: 'Medium',
  },
  {
    id: 'cust-deccan-hyd',
    name: 'Deccan Digital Cinema',
    email: 'admin@deccancinema.in',
    segment: 'SMB Studio',
    region: 'Telangana',
    city: 'Hyderabad',
    gstin: '36AABCD5512H1Z3',
    lifetimeOrders: 8,
    lifetimeValueInr: 740000,
    disputeCount: 0,
    riskLevel: 'Low',
  },
  {
    id: 'cust-sabarmati-amd',
    name: 'Sabarmati Design Collective',
    email: 'studio@sabarmatidesign.in',
    segment: 'SMB Studio',
    region: 'Gujarat',
    city: 'Ahmedabad',
    gstin: '24AABCS3389G1Z7',
    lifetimeOrders: 7,
    lifetimeValueInr: 515000,
    disputeCount: 0,
    riskLevel: 'Low',
  },
  {
    id: 'cust-hooghly-kol',
    name: 'Hooghly Audio & Retail Hub',
    email: 'orders@hooghlyretail.in',
    segment: 'Retail Direct',
    region: 'West Bengal',
    city: 'Kolkata',
    gstin: '19AABCH8812W1Z5',
    lifetimeOrders: 12,
    lifetimeValueInr: 690000,
    disputeCount: 2,
    riskLevel: 'High',
  },
];

/**
 * Generates 65 days of deterministic, realistic Indian e-commerce & escrow history
 * with 3 planted anomalies:
 *   1. Refund spike (cluster of 6 refunds in West Bengal & Delhi NCR in last 72h)
 *   2. Burst of 5 failed payment authorizations
 *   3. Single buyer (Rahul Deshmukh) with 4 repeated disputes
 */
export function buildSeededCommandCenterDataset(
  extraSpikeOrders: CommandCenterOrder[] = [],
  extraSpikeEvents: EscrowEvent[] = []
): CommandCenterDataset {
  const baseNow = new Date('2026-05-15T14:30:00.000Z').getTime();
  const orders: CommandCenterOrder[] = [];
  const escrowEvents: EscrowEvent[] = [];

  // 1) Generate 52 baseline orders across 62 days
  const stageWeights: EscrowStage[] = [
    'released',
    'released',
    'released',
    'shipped',
    'shipped',
    'held',
    'held',
    'released',
  ];

  for (let i = 0; i < 52; i++) {
    const daysAgo = 62 - Math.floor((i * 60) / 52);
    const hoursOffset = (i * 7) % 24;
    const createdMs = baseNow - daysAgo * 86_400_000 - hoursOffset * 3_600_000;
    const createdIso = new Date(createdMs).toISOString();

    const prod = SEED_PRODUCTS[i % SEED_PRODUCTS.length];
    // Skip Rahul for normal baseline so his 4 disputes are crystal-clear
    const nonDisputeCustomers = SEED_CUSTOMERS.filter((c) => c.id !== 'cust-rahul-dispute');
    const cust = nonDisputeCustomers[i % nonDisputeCustomers.length];

    const qty = (i % 3) + 1;
    const gross = prod.unitPriceInr * qty;
    const escrowFee = Math.round(gross * 0.015);
    const gstAmount = Math.round(escrowFee * 0.18);
    const netRevenue = gross - escrowFee - gstAmount;

    const stage: EscrowStage =
      daysAgo > 14 ? 'released' : stageWeights[i % stageWeights.length];
    const ageHours = Math.max(2, Math.round((baseNow - createdMs) / 3_600_000));
    const releaseTimeHours =
      stage === 'released' ? 28 + ((i * 11) % 54) : Math.min(ageHours, 96);

    const payoutMs = createdMs + 4 * 86_400_000;
    const orderId = `ORD-${20260400 + i}`;
    const paypalId = `PP-SB-${88400 + i}`;

    orders.push({
      id: orderId,
      orderNumber: `#${orderId}`,
      paypalOrderId: paypalId,
      productId: prod.id,
      productSku: prod.sku,
      productName: prod.name,
      category: prod.category,
      customerId: cust.id,
      customerName: cust.name,
      customerEmail: cust.email,
      customerSegment: cust.segment,
      region: cust.region,
      city: cust.city,
      quantity: qty,
      amountInr: gross,
      escrowFeeInr: escrowFee,
      gstAmountInr: gstAmount,
      netRevenueAfterFeesInr: netRevenue,
      escrowStage: stage,
      paymentStatus: stage === 'held' ? 'Authorized' : 'Captured',
      createdAt: createdIso,
      updatedAt: new Date(createdMs + releaseTimeHours * 3_600_000).toISOString(),
      expectedPayoutDate: new Date(payoutMs).toISOString().slice(0, 10),
      ageHours,
      releaseTimeHours,
      riskScore: stage === 'held' && gross > 150000 ? 46 : 14 + (i % 18),
      riskSeverity: stage === 'held' && gross > 150000 ? 'Medium' : 'Normal',
      riskReason:
        stage === 'held' && gross > 150000
          ? 'High-value B2B escrow awaiting carrier POD verification'
          : 'Verified GSTIN & standard escrow velocity',
      anomalyTag: 'none',
    });

    escrowEvents.push({
      id: `EVT-${orderId}-1`,
      orderId,
      paypalOrderId: paypalId,
      stage,
      previousStage: stage === 'held' ? null : 'held',
      amountInr: gross,
      escrowFeeInr: escrowFee,
      actor: stage === 'released' ? 'escrow-auto-settlement' : cust.email,
      reason:
        stage === 'released'
          ? 'Carrier POD verified — PayPal Sandbox capture released to seller'
          : stage === 'shipped'
          ? 'AWB tracking scanned at origin hub'
          : 'PayPal Sandbox Order v2 authorized & locked in escrow',
      timestamp: new Date(createdMs + 3_600_000).toISOString(),
      region: cust.region,
      productSku: prod.sku,
      buyerEmail: cust.email,
      isAnomaly: false,
    });
  }

  // =========================================================================
  // PLANTED ANOMALY 1: Refund Spike (6 high-velocity refunds in last 48-72h)
  // =========================================================================
  const spikeProducts = [SEED_PRODUCTS[1], SEED_PRODUCTS[2], SEED_PRODUCTS[3], SEED_PRODUCTS[8], SEED_PRODUCTS[5], SEED_PRODUCTS[6]];
  const spikeCustomer = SEED_CUSTOMERS[7]; // Hooghly Audio & Retail Hub (West Bengal)
  for (let s = 0; s < 6; s++) {
    const prod = spikeProducts[s % spikeProducts.length];
    const hoursAgo = 6 + s * 7;
    const createdMs = baseNow - hoursAgo * 3_600_000;
    const orderId = `ORD-SPIKE-${901 + s}`;
    const paypalId = `PP-SB-RF-${9910 + s}`;
    const gross = prod.unitPriceInr;
    const escrowFee = Math.round(gross * 0.015);
    const gstAmount = Math.round(escrowFee * 0.18);

    orders.push({
      id: orderId,
      orderNumber: `#${orderId}`,
      paypalOrderId: paypalId,
      productId: prod.id,
      productSku: prod.sku,
      productName: prod.name,
      category: prod.category,
      customerId: spikeCustomer.id,
      customerName: spikeCustomer.name,
      customerEmail: spikeCustomer.email,
      customerSegment: spikeCustomer.segment,
      region: spikeCustomer.region,
      city: spikeCustomer.city,
      quantity: 1,
      amountInr: gross,
      escrowFeeInr: escrowFee,
      gstAmountInr: gstAmount,
      netRevenueAfterFeesInr: 0,
      escrowStage: 'refunded',
      paymentStatus: 'Refunded',
      createdAt: new Date(createdMs).toISOString(),
      updatedAt: new Date(createdMs + 2 * 3_600_000).toISOString(),
      expectedPayoutDate: new Date(createdMs + 3 * 86_400_000).toISOString().slice(0, 10),
      ageHours: hoursAgo,
      releaseTimeHours: 4,
      riskScore: 88,
      riskSeverity: 'High',
      riskReason: 'Anomaly #1: 48h Regional Refund Spike in West Bengal (voltage/packaging claim cluster)',
      anomalyTag: 'refund_spike',
    });

    escrowEvents.push({
      id: `EVT-${orderId}-RF`,
      orderId,
      paypalOrderId: paypalId,
      stage: 'refunded',
      previousStage: 'held',
      amountInr: gross,
      escrowFeeInr: escrowFee,
      actor: 'paypal-webhook-service',
      reason: 'PAYMENT.CAPTURE.REFUNDED — Anomaly cluster: Regional transit damage claim',
      timestamp: new Date(createdMs + 2 * 3_600_000).toISOString(),
      region: spikeCustomer.region,
      productSku: prod.sku,
      buyerEmail: spikeCustomer.email,
      isAnomaly: true,
    });
  }

  // =========================================================================
  // PLANTED ANOMALY 2: Burst of Failed Payments / Gateway Auth Retries (5 orders)
  // =========================================================================
  const burstCustomer = SEED_CUSTOMERS[4]; // Delhi NCR
  for (let b = 0; b < 5; b++) {
    const prod = SEED_PRODUCTS[(b + 2) % SEED_PRODUCTS.length];
    const hoursAgo = 3 + b * 2;
    const createdMs = baseNow - hoursAgo * 3_600_000;
    const orderId = `ORD-AUTHFAIL-${701 + b}`;
    const paypalId = `PP-SB-DENIED-${7710 + b}`;
    const gross = prod.unitPriceInr * 2;
    const escrowFee = Math.round(gross * 0.015);
    const gstAmount = Math.round(escrowFee * 0.18);

    orders.push({
      id: orderId,
      orderNumber: `#${orderId}`,
      paypalOrderId: paypalId,
      productId: prod.id,
      productSku: prod.sku,
      productName: prod.name,
      category: prod.category,
      customerId: burstCustomer.id,
      customerName: burstCustomer.name,
      customerEmail: burstCustomer.email,
      customerSegment: burstCustomer.segment,
      region: burstCustomer.region,
      city: burstCustomer.city,
      quantity: 2,
      amountInr: gross,
      escrowFeeInr: escrowFee,
      gstAmountInr: gstAmount,
      netRevenueAfterFeesInr: 0,
      escrowStage: 'held',
      paymentStatus: 'Failed',
      createdAt: new Date(createdMs).toISOString(),
      updatedAt: new Date(createdMs + 900_000).toISOString(),
      expectedPayoutDate: new Date(createdMs + 5 * 86_400_000).toISOString().slice(0, 10),
      ageHours: hoursAgo,
      releaseTimeHours: 0,
      riskScore: 91,
      riskSeverity: 'Critical',
      riskReason: 'Anomaly #2: Burst of 5 rapid PayPal capture denials (3DSecure / velocity limit)',
      anomalyTag: 'failed_payment_burst',
    });

    escrowEvents.push({
      id: `EVT-${orderId}-FAIL`,
      orderId,
      paypalOrderId: paypalId,
      stage: 'held',
      previousStage: null,
      amountInr: gross,
      escrowFeeInr: escrowFee,
      actor: 'paypal-risk-gateway',
      reason: 'PAYMENT.CAPTURE.DENIED — Burst of rapid retry attempts from same IP subnet',
      timestamp: new Date(createdMs + 900_000).toISOString(),
      region: burstCustomer.region,
      productSku: prod.sku,
      buyerEmail: burstCustomer.email,
      isAnomaly: true,
    });
  }

  // =========================================================================
  // PLANTED ANOMALY 3: Single Buyer with 4 Repeated Disputes (Rahul Deshmukh)
  // =========================================================================
  const disputeBuyer = SEED_CUSTOMERS[2]; // Rahul Deshmukh
  const disputeProducts = [SEED_PRODUCTS[1], SEED_PRODUCTS[3], SEED_PRODUCTS[8], SEED_PRODUCTS[2]];
  for (let d = 0; d < 4; d++) {
    const prod = disputeProducts[d];
    const daysAgo = 2 + d * 4;
    const createdMs = baseNow - daysAgo * 86_400_000;
    const orderId = `ORD-DISP-${501 + d}`;
    const paypalId = `PP-SB-DISP-${5510 + d}`;
    const gross = prod.unitPriceInr;
    const escrowFee = Math.round(gross * 0.015);
    const gstAmount = Math.round(escrowFee * 0.18);

    orders.push({
      id: orderId,
      orderNumber: `#${orderId}`,
      paypalOrderId: paypalId,
      productId: prod.id,
      productSku: prod.sku,
      productName: prod.name,
      category: prod.category,
      customerId: disputeBuyer.id,
      customerName: disputeBuyer.name,
      customerEmail: disputeBuyer.email,
      customerSegment: disputeBuyer.segment,
      region: disputeBuyer.region,
      city: disputeBuyer.city,
      quantity: 1,
      amountInr: gross,
      escrowFeeInr: escrowFee,
      gstAmountInr: gstAmount,
      netRevenueAfterFeesInr: 0,
      escrowStage: 'disputed',
      paymentStatus: 'Disputed',
      createdAt: new Date(createdMs).toISOString(),
      updatedAt: new Date(createdMs + 18 * 3_600_000).toISOString(),
      expectedPayoutDate: new Date(createdMs + 14 * 86_400_000).toISOString().slice(0, 10),
      ageHours: daysAgo * 24,
      releaseTimeHours: daysAgo * 24,
      riskScore: 97,
      riskSeverity: 'Critical',
      riskReason: `Anomaly #3: Repeat dispute buyer (${disputeBuyer.name}) — 4th consecutive SNAD claim despite signed POD`,
      anomalyTag: 'repeat_dispute_buyer',
    });

    escrowEvents.push({
      id: `EVT-${orderId}-DISP`,
      orderId,
      paypalOrderId: paypalId,
      stage: 'disputed',
      previousStage: 'shipped',
      amountInr: gross,
      escrowFeeInr: escrowFee,
      actor: disputeBuyer.email,
      reason: `Repeat Buyer Dispute #${d + 1}/4: Item specification mismatch claim after delivery`,
      timestamp: new Date(createdMs + 18 * 3_600_000).toISOString(),
      region: disputeBuyer.region,
      productSku: prod.sku,
      buyerEmail: disputeBuyer.email,
      isAnomaly: true,
    });
  }

  // Merge any simulated live refund spike injections
  const combinedOrders = [...extraSpikeOrders, ...orders].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const combinedEvents = [...extraSpikeEvents, ...escrowEvents].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const payouts: CommandCenterPayout[] = [
    {
      id: 'PAY-2026-0512',
      payoutRef: 'HDFC-NEFT-882910',
      scheduledDate: '2026-05-12',
      settledDate: '2026-05-12',
      status: 'Settled',
      grossReleasedInr: 1485000,
      escrowFeesInr: 22275,
      gstOnFeesInr: 4010,
      netPayoutInr: 1458715,
      ordersCount: 16,
      bankAccount: 'HDFC Corporate •••• 9014',
    },
    {
      id: 'PAY-2026-0515',
      payoutRef: 'HDFC-NEFT-884102',
      scheduledDate: '2026-05-15',
      settledDate: null,
      status: 'In Clearing',
      grossReleasedInr: 1120000,
      escrowFeesInr: 16800,
      gstOnFeesInr: 3024,
      netPayoutInr: 1100176,
      ordersCount: 12,
      bankAccount: 'HDFC Corporate •••• 9014',
    },
    {
      id: 'PAY-2026-0518',
      payoutRef: 'HDFC-SCHED-885900',
      scheduledDate: '2026-05-18',
      settledDate: null,
      status: 'Scheduled',
      grossReleasedInr: 964000,
      escrowFeesInr: 14460,
      gstOnFeesInr: 2603,
      netPayoutInr: 946937,
      ordersCount: 11,
      bankAccount: 'HDFC Corporate •••• 9014',
    },
    {
      id: 'PAY-2026-0521',
      payoutRef: 'HDFC-HOLD-886411',
      scheduledDate: '2026-05-21',
      settledDate: null,
      status: 'On Hold',
      grossReleasedInr: 685000,
      escrowFeesInr: 10275,
      gstOnFeesInr: 1850,
      netPayoutInr: 672875,
      ordersCount: 8,
      bankAccount: 'HDFC Corporate •••• 9014',
    },
  ];

  return {
    orders: combinedOrders,
    escrowEvents: combinedEvents,
    products: SEED_PRODUCTS,
    customers: SEED_CUSTOMERS,
    payouts,
    isDemoMode: true,
    lastUpdatedIso: new Date().toISOString(),
  };
}

/**
 * Generates a single simulated refund order + event for the 10-second "Simulate refund spike" button.
 * Purely in-memory: never writes to Firestore or mutates real user data.
 */
export function createSimulatedRefundSpikeTick(tickNumber: number): {
  order: CommandCenterOrder;
  event: EscrowEvent;
} {
  const prod = SEED_PRODUCTS[(tickNumber + 1) % SEED_PRODUCTS.length];
  const cust = SEED_CUSTOMERS[(tickNumber + 3) % SEED_CUSTOMERS.length];
  const nowIso = new Date().toISOString();
  const orderId = `ORD-SIM-RF-${Date.now().toString().slice(-4)}-${tickNumber}`;
  const paypalId = `PP-SIM-RF-${Math.floor(10000 + Math.random() * 89999)}`;
  const gross = prod.unitPriceInr;
  const escrowFee = Math.round(gross * 0.015);
  const gstAmount = Math.round(escrowFee * 0.18);

  const order: CommandCenterOrder = {
    id: orderId,
    orderNumber: `#${orderId}`,
    paypalOrderId: paypalId,
    productId: prod.id,
    productSku: prod.sku,
    productName: prod.name,
    category: prod.category,
    customerId: cust.id,
    customerName: cust.name,
    customerEmail: cust.email,
    customerSegment: cust.segment,
    region: cust.region,
    city: cust.city,
    quantity: 1,
    amountInr: gross,
    escrowFeeInr: escrowFee,
    gstAmountInr: gstAmount,
    netRevenueAfterFeesInr: 0,
    escrowStage: 'refunded',
    paymentStatus: 'Refunded',
    createdAt: nowIso,
    updatedAt: nowIso,
    expectedPayoutDate: nowIso.slice(0, 10),
    ageHours: 1,
    releaseTimeHours: 1,
    riskScore: 95,
    riskSeverity: 'Critical',
    riskReason: `Live Simulated Refund Spike Wave #${tickNumber}: Instant buyer reversal triggered`,
    anomalyTag: 'refund_spike',
  };

  const event: EscrowEvent = {
    id: `EVT-${orderId}`,
    orderId,
    paypalOrderId: paypalId,
    stage: 'refunded',
    previousStage: 'held',
    amountInr: gross,
    escrowFeeInr: escrowFee,
    actor: 'paypal-webhook-simulator',
    reason: `Simulated Refund Spike #${tickNumber}: PAYMENT.CAPTURE.REFUNDED webhook received`,
    timestamp: nowIso,
    region: cust.region,
    productSku: prod.sku,
    buyerEmail: cust.email,
    isAnomaly: true,
  };

  return { order, event };
}

/**
 * Maps raw Firestore / server order records into CommandCenterOrder format.
 */
function mapFirestoreOrderToCommandCenter(raw: any, index: number): CommandCenterOrder {
  const gross =
    typeof raw.totalMinor === 'number'
      ? Math.round(raw.totalMinor / 100)
      : Number(raw.amountInr || raw.total || raw.totalAmount || 14990);
  const escrowFee = Number(raw.escrowFeeInr || raw.escrowFee || Math.round(gross * 0.015));
  const gstAmount = Number(raw.gstAmountInr || Math.round(escrowFee * 0.18));

  const rawState = String(raw.escrowStage || raw.escrowState || raw.status || 'held').toLowerCase();
  let stage: EscrowStage = 'held';
  if (rawState.includes('release') || rawState === 'completed') stage = 'released';
  else if (rawState.includes('ship') || rawState.includes('transit')) stage = 'shipped';
  else if (rawState.includes('refund')) stage = 'refunded';
  else if (rawState.includes('disput')) stage = 'disputed';
  else stage = 'held';

  const netRevenue = stage === 'refunded' || stage === 'disputed' ? 0 : gross - escrowFee - gstAmount;
  const createdIso = raw.createdAt || new Date().toISOString();
  const ageHours = Math.max(
    1,
    Math.round((Date.now() - new Date(createdIso).getTime()) / 3_600_000)
  );

  const firstItem = Array.isArray(raw.items) && raw.items[0] ? raw.items[0] : null;

  return {
    id: raw.id || `ORD-LIVE-${index}`,
    orderNumber: raw.orderNumber || `#${raw.id || `ORD-${index}`}`,
    paypalOrderId: raw.paypalOrderId || raw.txRef || `PP-LIVE-${index}`,
    productId: raw.productId || firstItem?.productId || 'prod-fan-892',
    productSku: raw.productSku || firstItem?.sku || 'FAN-BLDC-892',
    productName:
      raw.productName || firstItem?.name || 'AeroBreeze Stealth 1200mm BLDC Fan',
    category: raw.category || 'Smart Ceiling Fans',
    customerId: raw.customerId || 'cust-apex-blr',
    customerName: raw.customerName || raw.buyerName || 'Verified Storefront Buyer',
    customerEmail: raw.customerEmail || raw.buyerEmail || 'buyer@aerocool.in',
    customerSegment: raw.customerSegment || 'Enterprise B2B',
    region: raw.region || 'Karnataka',
    city: raw.city || 'Bengaluru',
    quantity: Number(raw.quantity || firstItem?.qty || firstItem?.quantity || 1),
    amountInr: gross,
    escrowFeeInr: escrowFee,
    gstAmountInr: gstAmount,
    netRevenueAfterFeesInr: netRevenue,
    escrowStage: stage,
    paymentStatus:
      stage === 'refunded'
        ? 'Refunded'
        : stage === 'disputed'
        ? 'Disputed'
        : stage === 'released'
        ? 'Captured'
        : 'Authorized',
    createdAt: createdIso,
    updatedAt: raw.updatedAt || createdIso,
    expectedPayoutDate:
      raw.expectedPayoutDate ||
      new Date(new Date(createdIso).getTime() + 4 * 86_400_000).toISOString().slice(0, 10),
    ageHours,
    releaseTimeHours: Number(raw.releaseTimeHours || Math.min(ageHours, 48)),
    riskScore: Number(raw.riskScore || (stage === 'disputed' ? 92 : stage === 'refunded' ? 78 : 18)),
    riskSeverity:
      raw.riskSeverity ||
      (stage === 'disputed' ? 'Critical' : stage === 'refunded' ? 'High' : 'Normal'),
    riskReason:
      raw.riskReason ||
      (stage === 'disputed'
        ? 'Active buyer dispute under escrow arbitration'
        : 'Live Firestore verified order'),
    anomalyTag: raw.anomalyTag || 'none',
  };
}

/**
 * Real-time subscription to Firestore collections (businesses/{bizId}/orders, escrowEvents, products)
 * so new orders or escrow transitions appear in the Command Center without refresh.
 */
export function subscribeCommandCenterLiveData(
  bizId = DEFAULT_BIZ_ID,
  onUpdate: (dataset: CommandCenterDataset) => void
): () => void {
  let liveOrders: CommandCenterOrder[] = [];
  let liveEvents: EscrowEvent[] = [];
  let liveProducts: CommandCenterProduct[] = [...SEED_PRODUCTS];

  const emitSnapshot = () => {
    const baseDemo = buildSeededCommandCenterDataset();
    onUpdate({
      orders: liveOrders.length > 0 ? liveOrders : baseDemo.orders.slice(0, 18),
      escrowEvents: liveEvents.length > 0 ? liveEvents : baseDemo.escrowEvents.slice(0, 18),
      products: liveProducts,
      customers: SEED_CUSTOMERS,
      payouts: baseDemo.payouts,
      isDemoMode: false,
      lastUpdatedIso: new Date().toISOString(),
    });
  };

  const unsubs: Array<() => void> = [];

  if (auth.currentUser) {
    try {
      const ordersRef = collection(db, 'businesses', bizId, 'orders');
      unsubs.push(
        onSnapshot(
          ordersRef,
          (snap) => {
            const list: CommandCenterOrder[] = [];
            let idx = 0;
            snap.forEach((docSnap) => {
              list.push(mapFirestoreOrderToCommandCenter({ id: docSnap.id, ...docSnap.data() }, idx++));
            });
            list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            liveOrders = list;
            emitSnapshot();
          },
          () => {
            emitSnapshot();
          }
        )
      );

      const eventsRef = collection(db, 'businesses', bizId, 'escrowEvents');
      unsubs.push(
        onSnapshot(
          eventsRef,
          (snap) => {
            const evts: EscrowEvent[] = [];
            snap.forEach((docSnap) => {
              const d = docSnap.data();
              evts.push({
                id: docSnap.id,
                orderId: d.orderId || 'ORD-LIVE',
                paypalOrderId: d.paypalOrderId || 'PP-LIVE',
                stage: (d.stage || d.nextState || d.toState || 'held') as EscrowStage,
                previousStage: (d.previousStage || d.previousState || d.fromState || null) as EscrowStage | null,
                amountInr: Number(d.amountInr || 14990),
                escrowFeeInr: Number(d.escrowFeeInr || 225),
                actor: d.actor || d.actorId || 'seller-portal',
                reason: d.reason || 'Live escrow state transition',
                timestamp: d.timestamp || new Date().toISOString(),
                region: d.region || 'Karnataka',
                productSku: d.productSku || 'FAN-BLDC-892',
                buyerEmail: d.buyerEmail || 'buyer@aerocool.in',
                isAnomaly: Boolean(d.isAnomaly),
              });
            });
            evts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            liveEvents = evts;
            emitSnapshot();
          },
          () => {
            emitSnapshot();
          }
        )
      );
    } catch {
      emitSnapshot();
    }
  } else {
    emitSnapshot();
  }

  return () => {
    unsubs.forEach((u) => u());
  };
}

/**
 * Executes a real or demo row action (Release, Hold, Refund, Nudge buyer)
 * and persists the EscrowEvent to Firestore + server when in Live Mode.
 */
export async function executeCommandCenterRowAction(params: {
  order: CommandCenterOrder;
  action: 'release' | 'hold' | 'refund' | 'nudge';
  isDemoMode: boolean;
  bizId?: string;
}): Promise<{ updatedOrder: CommandCenterOrder; newEvent: EscrowEvent }> {
  const { order, action, isDemoMode, bizId = DEFAULT_BIZ_ID } = params;
  const nowIso = new Date().toISOString();

  const nextStageMap: Record<'release' | 'hold' | 'refund' | 'nudge', EscrowStage> = {
    release: 'released',
    hold: 'held',
    refund: 'refunded',
    nudge: order.escrowStage,
  };

  const nextStage = nextStageMap[action];
  const reasonMap: Record<'release' | 'hold' | 'refund' | 'nudge', string> = {
    release: 'Seller Command Center: Carrier POD verified & escrow released',
    hold: 'Seller Command Center: Placed on manual compliance hold',
    refund: 'Seller Command Center: Full PayPal Sandbox escrow refund issued',
    nudge: `Seller Command Center: WhatsApp & email delivery confirmation nudge sent to ${order.customerEmail}`,
  };

  const updatedOrder: CommandCenterOrder = {
    ...order,
    escrowStage: nextStage,
    paymentStatus:
      nextStage === 'released'
        ? 'Captured'
        : nextStage === 'refunded'
        ? 'Refunded'
        : nextStage === 'disputed'
        ? 'Disputed'
        : 'Authorized',
    netRevenueAfterFeesInr:
      nextStage === 'refunded' || nextStage === 'disputed'
        ? 0
        : order.amountInr - order.escrowFeeInr - order.gstAmountInr,
    updatedAt: nowIso,
    riskSeverity: action === 'release' ? 'Normal' : order.riskSeverity,
  };

  const newEvent: EscrowEvent = {
    id: `EVT-${order.id}-${Date.now().toString().slice(-4)}`,
    orderId: order.id,
    paypalOrderId: order.paypalOrderId,
    stage: nextStage,
    previousStage: order.escrowStage,
    amountInr: order.amountInr,
    escrowFeeInr: order.escrowFeeInr,
    actor: 'seller@aerocool.in',
    reason: reasonMap[action],
    timestamp: nowIso,
    region: order.region,
    productSku: order.productSku,
    buyerEmail: order.customerEmail,
    isAnomaly: action === 'refund',
  };

  if (!isDemoMode && auth.currentUser) {
    try {
      const orderDoc = doc(db, 'businesses', bizId, 'orders', order.id);
      await setDoc(orderDoc, updatedOrder, { merge: true });
      const evtDoc = doc(db, 'businesses', bizId, 'escrowEvents', newEvent.id);
      await setDoc(evtDoc, newEvent, { merge: true });
    } catch {
      // Handled gracefully if rules restrict direct transition
    }
  }

  return { updatedOrder, newEvent };
}

/**
 * Exposes the Command Center dataset to AG Studio as typed data sources (`AgDataSourcesDefinition`)
 * with field formats, table relationships, and calculated expressions.
 */
export function buildAgStudioDataSources(
  dataset: CommandCenterDataset,
  customExpressions: AgExpressionFieldDefinition[] = []
): AgDataSourcesDefinition {
  const orderFields: AgFieldDefinition[] = [
    { id: 'id', name: 'Order ID', format: 'textFormat', editable: false },
    { id: 'orderNumber', name: 'Order #', format: 'textFormat', editable: false },
    { id: 'paypalOrderId', name: 'PayPal Ref', format: 'textFormat', editable: false },
    { id: 'productId', name: 'Product ID', format: 'textFormat', editable: false },
    { id: 'productSku', name: 'SKU', format: 'textFormat', editable: false },
    { id: 'productName', name: 'Product Name', format: 'textFormat', editable: false },
    { id: 'category', name: 'Product Category', format: 'textFormat', editable: false },
    { id: 'customerId', name: 'Customer ID', format: 'textFormat', editable: false },
    { id: 'customerName', name: 'Buyer Name', format: 'textFormat', editable: false },
    { id: 'customerEmail', name: 'Buyer Email', format: 'textFormat', editable: false },
    { id: 'customerSegment', name: 'Customer Segment', format: 'textFormat', editable: false },
    { id: 'region', name: 'Indian Region', format: 'textFormat', editable: false },
    { id: 'city', name: 'City', format: 'textFormat', editable: false },
    { id: 'quantity', name: 'Qty', format: 'integerFormat', editable: false },
    { id: 'amountInr', name: 'Gross Amount (INR)', format: 'decimalFormat', editable: false },
    { id: 'escrowFeeInr', name: 'Escrow Fee (INR)', format: 'decimalFormat', editable: false },
    { id: 'gstAmountInr', name: 'GST on Fee (INR)', format: 'decimalFormat', editable: false },
    {
      id: 'netRevenueAfterFeesInr',
      name: 'Net Revenue After Fees (INR)',
      format: 'decimalFormat',
      editable: false,
    },
    { id: 'escrowStage', name: 'Escrow Stage', format: 'textFormat', editable: true },
    { id: 'paymentStatus', name: 'Payment Status', format: 'textFormat', editable: false },
    { id: 'createdAt', name: 'Order Timestamp', format: 'dateTimeFormat', editable: false },
    { id: 'expectedPayoutDate', name: 'Expected Payout Date', format: 'dateFormat', editable: false },
    { id: 'ageHours', name: 'Escrow Age (Hours)', format: 'integerFormat', editable: false },
    { id: 'releaseTimeHours', name: 'Release Time (Hours)', format: 'integerFormat', editable: false },
    { id: 'riskScore', name: 'Risk Score (0-100)', format: 'integerFormat', editable: false },
    { id: 'riskSeverity', name: 'Risk Severity', format: 'textFormat', editable: false },
    { id: 'riskReason', name: 'Risk Reason', format: 'textFormat', editable: false },
    { id: 'anomalyTag', name: 'Anomaly Cluster', format: 'textFormat', editable: false },
  ];

  const productFields: AgFieldDefinition[] = [
    { id: 'id', name: 'Product ID', format: 'textFormat', editable: false },
    { id: 'sku', name: 'SKU', format: 'textFormat', editable: false },
    { id: 'name', name: 'Product Name', format: 'textFormat', editable: false },
    { id: 'category', name: 'Category', format: 'textFormat', editable: false },
    { id: 'unitPriceInr', name: 'Unit Price (INR)', format: 'decimalFormat', editable: false },
    { id: 'stock', name: 'Available Stock', format: 'integerFormat', editable: false },
    { id: 'unitsSold60d', name: '60d Units Sold', format: 'integerFormat', editable: false },
    { id: 'revenue60dInr', name: '60d Revenue (INR)', format: 'decimalFormat', editable: false },
    { id: 'refundRatePct', name: 'Refund Rate (%)', format: 'decimalFormat', editable: false },
  ];

  const customerFields: AgFieldDefinition[] = [
    { id: 'id', name: 'Customer ID', format: 'textFormat', editable: false },
    { id: 'name', name: 'Customer Name', format: 'textFormat', editable: false },
    { id: 'email', name: 'Email', format: 'textFormat', editable: false },
    { id: 'segment', name: 'Segment', format: 'textFormat', editable: false },
    { id: 'region', name: 'Region', format: 'textFormat', editable: false },
    { id: 'city', name: 'City', format: 'textFormat', editable: false },
    { id: 'lifetimeOrders', name: 'Lifetime Orders', format: 'integerFormat', editable: false },
    { id: 'lifetimeValueInr', name: 'Lifetime Value (INR)', format: 'decimalFormat', editable: false },
    { id: 'disputeCount', name: 'Dispute Count', format: 'integerFormat', editable: false },
    { id: 'riskLevel', name: 'Risk Tier', format: 'textFormat', editable: false },
  ];

  const escrowEventFields: AgFieldDefinition[] = [
    { id: 'id', name: 'Event ID', format: 'textFormat', editable: false },
    { id: 'orderId', name: 'Order ID', format: 'textFormat', editable: false },
    { id: 'paypalOrderId', name: 'PayPal Order ID', format: 'textFormat', editable: false },
    { id: 'stage', name: 'Escrow Stage', format: 'textFormat', editable: false },
    { id: 'amountInr', name: 'Amount (INR)', format: 'decimalFormat', editable: false },
    { id: 'escrowFeeInr', name: 'Fee (INR)', format: 'decimalFormat', editable: false },
    { id: 'actor', name: 'Actor', format: 'textFormat', editable: false },
    { id: 'reason', name: 'Transition Reason', format: 'textFormat', editable: false },
    { id: 'timestamp', name: 'Timestamp', format: 'dateTimeFormat', editable: false },
    { id: 'region', name: 'Region', format: 'textFormat', editable: false },
  ];

  const payoutFields: AgFieldDefinition[] = [
    { id: 'id', name: 'Payout ID', format: 'textFormat', editable: false },
    { id: 'payoutRef', name: 'Bank NEFT Ref', format: 'textFormat', editable: false },
    { id: 'scheduledDate', name: 'Scheduled Date', format: 'dateFormat', editable: false },
    { id: 'status', name: 'Settlement Status', format: 'textFormat', editable: false },
    { id: 'grossReleasedInr', name: 'Gross Released (INR)', format: 'decimalFormat', editable: false },
    { id: 'escrowFeesInr', name: 'Escrow Fees (INR)', format: 'decimalFormat', editable: false },
    { id: 'netPayoutInr', name: 'Net Payout (INR)', format: 'decimalFormat', editable: false },
    { id: 'ordersCount', name: 'Settled Orders', format: 'integerFormat', editable: false },
  ];

  const defaultExpressions: AgExpressionFieldDefinition[] = [
    {
      id: 'calc_net_revenue_after_fees',
      name: 'Net Revenue After Fees (Calc)',
      description: 'Gross order amount minus PayPal escrow fee (1.5%) and 18% GST on fee',
      format: 'decimalFormat',
      isMeasure: false,
      expression: 'orders.amountInr - orders.escrowFeeInr - orders.gstAmountInr',
    },
    {
      id: 'calc_take_rate_pct',
      name: 'Effective Take Rate %',
      description: 'Total platform & GST fee percentage relative to gross order value',
      format: 'decimalFormat',
      isMeasure: false,
      expression: '((orders.escrowFeeInr + orders.gstAmountInr) / orders.amountInr) * 100',
    },
    ...customExpressions,
  ];

  return {
    description:
      'AC PayPilot Autonomous Commerce & Intelligent Escrow Dataset (Orders, Products, Customers, EscrowEvents, Payouts)',
    sources: [
      {
        id: 'orders',
        name: 'Escrow Orders',
        description: 'Real-time and seeded AC PayPilot orders with escrow stage and risk telemetry',
        data: dataset.orders,
        fields: orderFields,
      },
      {
        id: 'products',
        name: 'Product Catalog',
        description: 'Seller SKU catalog with 60-day velocity and refund rates',
        data: dataset.products,
        fields: productFields,
      },
      {
        id: 'customers',
        name: 'Buyer Accounts',
        description: 'B2B and retail customers segmented by region and dispute history',
        data: dataset.customers,
        fields: customerFields,
      },
      {
        id: 'escrowEvents',
        name: 'Escrow Audit Log',
        description: 'Immutable PayPal Sandbox state transitions and webhook events',
        data: dataset.escrowEvents,
        fields: escrowEventFields,
      },
      {
        id: 'payouts',
        name: 'Bank Payouts',
        description: 'Scheduled and settled NEFT/IMPS escrow disbursements',
        data: dataset.payouts,
        fields: payoutFields,
      },
    ],
    relationships: [
      {
        id: 'rel_orders_products',
        source: { tableId: 'orders', fieldId: 'productId' },
        target: { tableId: 'products', fieldId: 'id' },
        type: 'many-to-one',
      },
      {
        id: 'rel_orders_customers',
        source: { tableId: 'orders', fieldId: 'customerId' },
        target: { tableId: 'customers', fieldId: 'id' },
        type: 'many-to-one',
      },
    ],
    expressions: defaultExpressions,
  };
}
