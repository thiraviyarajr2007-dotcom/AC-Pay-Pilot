import {
  InvoiceLineItem,
  PurchaseItem,
  CatalogProduct,
  Invoice,
  RecentTransaction,
  Order,
} from '../types';

export type SupportedCurrency = 'INR' | 'USD';

/**
 * Canonical integer minor-unit money value (paise for INR, cents for USD).
 */
export interface MoneyMinor {
  amountMinor: number;
  currency: SupportedCurrency;
}

/**
 * Converts a major currency unit (e.g., ₹149.50 or $19.99) into integer minor units (paise/cents).
 */
export function toMinorUnits(majorAmount: number): number {
  if (!Number.isFinite(majorAmount)) return 0;
  return Math.round(majorAmount * 100);
}

/**
 * Converts integer minor units (paise/cents) back into major decimal units.
 */
export function fromMinorUnits(minorAmount: number): number {
  if (!Number.isFinite(minorAmount)) return 0;
  return Math.round(minorAmount) / 100;
}

/**
 * Formats integer minor units with explicit currency code and locale formatting.
 */
export function formatMinorUnits(
  amountMinor: number,
  currency: SupportedCurrency = 'INR',
  includeCurrencyCode: boolean = true
): string {
  const safeMinor = Math.round(amountMinor);
  const sign = safeMinor < 0 ? '-' : '';
  const absMajor = Math.abs(safeMinor) / 100;
  const hasSubunits = Math.abs(safeMinor) % 100 !== 0;

  if (currency === 'USD') {
    const formatted = absMajor.toLocaleString('en-US', {
      minimumFractionDigits: hasSubunits ? 2 : 0,
      maximumFractionDigits: 2,
    });
    return includeCurrencyCode ? `${sign}USD $${formatted}` : `${sign}$${formatted}`;
  }

  const formatted = absMajor.toLocaleString('en-IN', {
    minimumFractionDigits: hasSubunits ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return includeCurrencyCode ? `${sign}INR ₹${formatted}` : `${sign}₹${formatted}`;
}

/**
 * Server-grade integer minor-unit invoice calculation.
 * Keeps invoice status separate from payment status.
 */
export interface MinorInvoiceLineInput {
  sku: string;
  name: string;
  hsn?: string;
  quantity: number;
  unitRateMinor: number;
  gstRatePercent: number;
}

export interface MinorInvoiceCalculationResult {
  currency: SupportedCurrency;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  lineBreakdowns: Array<{
    sku: string;
    quantity: number;
    unitRateMinor: number;
    lineSubtotalMinor: number;
    lineTaxMinor: number;
    lineTotalMinor: number;
  }>;
}

export function calculateInvoiceTotalsMinor(
  items: MinorInvoiceLineInput[],
  currency: SupportedCurrency = 'INR'
): MinorInvoiceCalculationResult {
  let subtotalMinor = 0;
  let taxMinor = 0;

  const lineBreakdowns = items.map((item) => {
    const qty = Math.max(0, Math.floor(item.quantity));
    const unitRateMinor = Math.max(0, Math.round(item.unitRateMinor));
    const gstRate = Math.max(0, item.gstRatePercent);

    const lineSubtotalMinor = qty * unitRateMinor;
    const lineTaxMinor = Math.round((lineSubtotalMinor * gstRate) / 100);
    const lineTotalMinor = lineSubtotalMinor + lineTaxMinor;

    subtotalMinor += lineSubtotalMinor;
    taxMinor += lineTaxMinor;

    return {
      sku: item.sku,
      quantity: qty,
      unitRateMinor,
      lineSubtotalMinor,
      lineTaxMinor,
      lineTotalMinor,
    };
  });

  return {
    currency,
    subtotalMinor,
    taxMinor,
    totalMinor: subtotalMinor + taxMinor,
    lineBreakdowns,
  };
}

/**
 * Server-authoritative cart & order calculation in integer minor units.
 * Looks up prices strictly from the stored catalog products and ignores any client-supplied price or total.
 */
export interface ServerOrderLineRequest {
  sku: string;
  quantity: number;
}

export interface ServerOrderCalculationResult {
  currency: SupportedCurrency;
  subtotalMinor: number;
  taxMinor: number;
  shippingMinor: number;
  totalMinor: number;
  items: Array<{
    productId: string;
    sku: string;
    name: string;
    quantity: number;
    unitPriceMinor: number; // tax-inclusive catalog price in paise/cents
    taxableUnitMinor: number;
    gstRatePercent: number;
    lineSubtotalMinor: number;
    lineTaxMinor: number;
    lineTotalMinor: number;
  }>;
}

export function calculateAuthoritativeOrderTotalsMinor(
  requestedItems: ServerOrderLineRequest[],
  catalogProducts: CatalogProduct[],
  currency: SupportedCurrency = 'INR',
  shippingMinor: number = 0
): ServerOrderCalculationResult {
  if (!requestedItems || requestedItems.length === 0) {
    throw new Error('Order must contain at least one item.');
  }

  let subtotalMinor = 0;
  let taxMinor = 0;
  const resolvedItems: ServerOrderCalculationResult['items'] = [];

  for (const reqItem of requestedItems) {
    const qty = Math.floor(reqItem.quantity);
    if (qty <= 0) {
      throw new Error(`Invalid quantity for SKU ${reqItem.sku}: must be a positive integer.`);
    }

    const normalizedReqSku = reqItem.sku.replace(/^#/, '').trim().toLowerCase();
    const product = catalogProducts.find(
      (p) =>
        p.sku.replace(/^#/, '').trim().toLowerCase() === normalizedReqSku ||
        p.id.trim().toLowerCase() === normalizedReqSku
    );

    if (!product) {
      throw new Error(`Unknown SKU '${reqItem.sku}' not found in server catalog.`);
    }

    const unitPriceMinor = toMinorUnits(product.price);
    const gstRatePercent = 18;
    const lineTotalMinor = unitPriceMinor * qty;
    const lineSubtotalMinor = Math.round((lineTotalMinor * 100) / (100 + gstRatePercent));
    const lineTaxMinor = lineTotalMinor - lineSubtotalMinor;

    subtotalMinor += lineSubtotalMinor;
    taxMinor += lineTaxMinor;

    resolvedItems.push({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      quantity: qty,
      unitPriceMinor,
      taxableUnitMinor: Math.round((unitPriceMinor * 100) / (100 + gstRatePercent)),
      gstRatePercent,
      lineSubtotalMinor,
      lineTaxMinor,
      lineTotalMinor,
    });
  }

  const safeShippingMinor = Math.max(0, Math.round(shippingMinor));
  const totalMinor = subtotalMinor + taxMinor + safeShippingMinor;

  return {
    currency,
    subtotalMinor,
    taxMinor,
    shippingMinor: safeShippingMinor,
    totalMinor,
    items: resolvedItems,
  };
}

/**
 * Extracts PayPal fee and net settlement strictly from provider capture data.
 * If provider breakdown is missing, fees are marked unverified and "Not available".
 */
export interface ProviderFeeBreakdown {
  feesFromProvider: boolean;
  paypalFeeMinor: number | null;
  netAmountMinor: number | null;
  feeDisplayLabel: string;
  netDisplayLabel: string;
}

export function extractProviderFeeBreakdown(
  providerPayload: {
    seller_receivable_breakdown?: {
      gross_amount?: { currency_code?: string; value?: string };
      paypal_fee?: { currency_code?: string; value?: string };
      net_amount?: { currency_code?: string; value?: string };
    };
  } | null | undefined,
  currency: SupportedCurrency = 'INR'
): ProviderFeeBreakdown {
  const breakdown = providerPayload?.seller_receivable_breakdown;
  if (
    !breakdown ||
    !breakdown.paypal_fee ||
    typeof breakdown.paypal_fee.value !== 'string' ||
    !breakdown.net_amount ||
    typeof breakdown.net_amount.value !== 'string'
  ) {
    return {
      feesFromProvider: false,
      paypalFeeMinor: null,
      netAmountMinor: null,
      feeDisplayLabel: 'Not available',
      netDisplayLabel: 'Not available',
    };
  }

  const feeMajor = Number.parseFloat(breakdown.paypal_fee.value);
  const netMajor = Number.parseFloat(breakdown.net_amount.value);
  if (!Number.isFinite(feeMajor) || !Number.isFinite(netMajor)) {
    return {
      feesFromProvider: false,
      paypalFeeMinor: null,
      netAmountMinor: null,
      feeDisplayLabel: 'Not available',
      netDisplayLabel: 'Not available',
    };
  }

  const paypalFeeMinor = toMinorUnits(feeMajor);
  const netAmountMinor = toMinorUnits(netMajor);

  return {
    feesFromProvider: true,
    paypalFeeMinor,
    netAmountMinor,
    feeDisplayLabel: formatMinorUnits(paypalFeeMinor, currency),
    netDisplayLabel: formatMinorUnits(netAmountMinor, currency),
  };
}

/**
 * Computes Executive KPIs from stored records for a chosen date range [startMs, endMs].
 * Compares against the immediately preceding window of identical duration.
 * If the comparison period has no data (0 records or 0 GMV), returns "No baseline" instead of a growth percentage.
 */
export interface DatedOrderRecord {
  id: string;
  totalMinor: number;
  escrowState: string;
  createdAtIso: string;
}

export interface ExecutiveKpiReport {
  currency: SupportedCurrency;
  currentPeriodCount: number;
  previousPeriodCount: number;
  currentGmvMinor: number;
  previousGmvMinor: number;
  releasedGmvMinor: number;
  heldInEscrowMinor: number;
  disputedCount: number;
  hasBaseline: boolean;
  growthPercent: number | null;
  growthLabel: string;
}

export function computeExecutiveKpisForDateRange(
  records: DatedOrderRecord[],
  startIso: string,
  endIso: string,
  currency: SupportedCurrency = 'INR'
): ExecutiveKpiReport {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const windowDurationMs = Math.max(1, endMs - startMs);
  const prevStartMs = startMs - windowDurationMs;
  const prevEndMs = startMs - 1;

  const currentRecords = records.filter((r) => {
    const t = new Date(r.createdAtIso).getTime();
    return t >= startMs && t <= endMs;
  });

  const previousRecords = records.filter((r) => {
    const t = new Date(r.createdAtIso).getTime();
    return t >= prevStartMs && t <= prevEndMs;
  });

  const currentGmvMinor = currentRecords.reduce((acc, r) => acc + Math.round(r.totalMinor), 0);
  const previousGmvMinor = previousRecords.reduce((acc, r) => acc + Math.round(r.totalMinor), 0);

  const releasedGmvMinor = currentRecords
    .filter((r) => r.escrowState === 'released')
    .reduce((acc, r) => acc + Math.round(r.totalMinor), 0);

  const heldInEscrowMinor = currentRecords
    .filter((r) => r.escrowState === 'funded' || r.escrowState === 'in_delivery')
    .reduce((acc, r) => acc + Math.round(r.totalMinor), 0);

  const disputedCount = currentRecords.filter((r) => r.escrowState === 'disputed').length;

  if (previousRecords.length === 0 || previousGmvMinor <= 0) {
    return {
      currency,
      currentPeriodCount: currentRecords.length,
      previousPeriodCount: previousRecords.length,
      currentGmvMinor,
      previousGmvMinor,
      releasedGmvMinor,
      heldInEscrowMinor,
      disputedCount,
      hasBaseline: false,
      growthPercent: null,
      growthLabel: 'No baseline',
    };
  }

  const rawGrowth = ((currentGmvMinor - previousGmvMinor) / previousGmvMinor) * 100;
  const growthPercent = Math.round(rawGrowth * 10) / 10;
  const sign = growthPercent > 0 ? '+' : '';

  return {
    currency,
    currentPeriodCount: currentRecords.length,
    previousPeriodCount: previousRecords.length,
    currentGmvMinor,
    previousGmvMinor,
    releasedGmvMinor,
    heldInEscrowMinor,
    disputedCount,
    hasBaseline: true,
    growthPercent,
    growthLabel: `${sign}${growthPercent.toFixed(1)}% vs prior period`,
  };
}

/**
 * Calculates subtotal, GST amounts, and total payable for invoice line items (using integer paise internally).
 */
export function calculateInvoiceTotals(items: InvoiceLineItem[]) {
  const minorItems: MinorInvoiceLineInput[] = items.map((item) => ({
    sku: item.sku,
    name: item.name,
    hsn: item.hsn,
    quantity: item.quantity,
    unitRateMinor: toMinorUnits(item.unitRate),
    gstRatePercent: item.gstRatePercent,
  }));

  const minorResult = calculateInvoiceTotalsMinor(minorItems, 'INR');
  const subtotal = fromMinorUnits(minorResult.subtotalMinor);
  const totalGst = fromMinorUnits(minorResult.taxMinor);
  const rawTotal = subtotal + totalGst;
  const grandTotal = Math.round(rawTotal);
  const roundOff = Math.round((grandTotal - rawTotal) * 100) / 100;

  return {
    subtotal,
    totalGst,
    roundOff,
    grandTotal,
    subtotalMinor: minorResult.subtotalMinor,
    taxMinor: minorResult.taxMinor,
    totalMinor: toMinorUnits(grandTotal),
  };
}

/**
 * Calculates cart metrics including active checkout total, authorized cap, and remaining headroom
 * using integer minor units (paise) internally to avoid floating-point drift.
 */
export function calculateCartMetrics(items: PurchaseItem[], budgetCeiling: number) {
  const activeItems = items.filter((item) => !item.isDeferred);
  const deferredItems = items.filter((item) => item.isDeferred);

  const budgetCeilingMinor = toMinorUnits(budgetCeiling);
  const allocatedTotalMinor = activeItems.reduce((acc, item) => acc + toMinorUnits(item.price), 0);
  const remainingHeadroomMinor = budgetCeilingMinor - allocatedTotalMinor;

  const allocatedTotal = fromMinorUnits(allocatedTotalMinor);
  const remainingHeadroom = fromMinorUnits(remainingHeadroomMinor);

  const headroomPercentage =
    budgetCeilingMinor > 0 ? (remainingHeadroomMinor / budgetCeilingMinor) * 100 : 0;
  const utilizationPercentage =
    budgetCeilingMinor > 0 ? (allocatedTotalMinor / budgetCeilingMinor) * 100 : 0;

  // Breakdown subtotal and GST assuming included 18% GST in price
  const selectedSubtotal = Math.round(allocatedTotal / 1.18);
  const integratedGst = allocatedTotal - selectedSubtotal;

  const deferredSavingsMinor = deferredItems.reduce((acc, item) => acc + toMinorUnits(item.price), 0);
  const deferredSavings = fromMinorUnits(deferredSavingsMinor);

  return {
    activeCount: activeItems.length,
    deferredCount: deferredItems.length,
    allocatedTotal,
    allocatedTotalMinor,
    budgetCeiling,
    budgetCeilingMinor,
    remainingHeadroom,
    remainingHeadroomMinor,
    headroomPercentage,
    utilizationPercentage,
    selectedSubtotal,
    selectedSubtotalMinor: toMinorUnits(selectedSubtotal),
    integratedGst,
    integratedGstMinor: toMinorUnits(integratedGst),
    deferredSavings,
    deferredSavingsMinor,
    isOverBudget: remainingHeadroomMinor < 0,
  };
}

/**
 * Moves an item up or down in priority rank while recalculating order.
 */
export function reorderPurchaseItems(
  items: PurchaseItem[],
  index: number,
  direction: 'up' | 'down'
): PurchaseItem[] {
  const newIndex = direction === 'up' ? index - 1 : index + 1;
  if (newIndex < 0 || newIndex >= items.length) return items;

  const updated = [...items];
  const [removed] = updated.splice(index, 1);
  updated.splice(newIndex, 0, removed);

  return updated.map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));
}

/**
 * Formats an amount in Indian Rupee currency format (e.g., ₹1,42,800.00).
 */
export function formatINR(amount: number, showDecimals: boolean = false): string {
  const sign = amount < 0 ? '-' : '';
  const absVal = Math.abs(amount);

  const formatted = absVal.toLocaleString('en-IN', {
    maximumFractionDigits: showDecimals ? 2 : 0,
    minimumFractionDigits: showDecimals ? 2 : 0,
  });

  return `${sign}₹${formatted}`;
}

/**
 * Calculates standard PayPal India transaction fee: Flat ₹12 + 3.49% of gross (using integer paise).
 */
export function calculatePayPalFee(
  grossAmount: number,
  fixedFee: number = 12,
  percentage: number = 3.49
) {
  if (grossAmount <= 0) return { fee: 0, netPayout: 0, effectiveRatePercent: 0, feeMinor: 0, netPayoutMinor: 0 };
  const grossMinor = toMinorUnits(grossAmount);
  const fixedMinor = toMinorUnits(fixedFee);
  const percentageFeeMinor = Math.round((grossMinor * percentage) / 100);
  const totalFeeMinor = percentageFeeMinor + fixedMinor;
  const netPayoutMinor = grossMinor - totalFeeMinor;

  const totalFee = fromMinorUnits(totalFeeMinor);
  const netPayout = fromMinorUnits(netPayoutMinor);
  const effectiveRatePercent = Math.round((totalFeeMinor / grossMinor) * 10000) / 100;

  return {
    fee: totalFee,
    netPayout,
    effectiveRatePercent,
    feeMinor: totalFeeMinor,
    netPayoutMinor,
  };
}

/**
 * Reorders purchase items by id and direction ('up' | 'down')
 */
export function reorderItems(
  items: PurchaseItem[],
  id: string,
  direction: 'up' | 'down'
): PurchaseItem[] {
  const index = items.findIndex((i) => i.id === id);
  if (index === -1) return items;
  return reorderPurchaseItems(items, index, direction);
}

/**
 * Normalizes a SKU for clean URL routing (strips leading '#' and encodes).
 */
export function normalizeSkuForUrl(sku: string): string {
  return encodeURIComponent(sku.replace(/^#/, '').trim());
}

/**
 * Finds a product in the catalog by a URL `:sku` parameter (matching with or without leading '#').
 */
export function findProductBySkuParam(
  products: CatalogProduct[],
  skuParam?: string
): CatalogProduct | undefined {
  if (!skuParam) return products[0];
  const decoded = decodeURIComponent(skuParam).replace(/^#/, '').toLowerCase();
  return products.find(
    (p) =>
      p.sku.replace(/^#/, '').toLowerCase() === decoded || p.id.toLowerCase() === decoded
  );
}

/**
 * Filters catalog products by a search query across name, SKU, category, and tags.
 */
export function filterCatalogProducts(
  products: CatalogProduct[],
  query: string
): CatalogProduct[] {
  const q = query.trim().toLowerCase();
  if (!q) return products;
  return products.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q))
  );
}

/**
 * Filters invoices by search query across invoiceNumber, clientName, GSTIN, txRef, and line items.
 */
export function filterInvoices(invoices: Invoice[], query: string): Invoice[] {
  const q = query.trim().toLowerCase();
  if (!q) return invoices;
  return invoices.filter(
    (inv) =>
      inv.invoiceNumber.toLowerCase().includes(q) ||
      inv.clientName.toLowerCase().includes(q) ||
      inv.clientGstin.toLowerCase().includes(q) ||
      inv.txRef.toLowerCase().includes(q) ||
      inv.items.some(
        (it) => it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q)
      )
  );
}

/**
 * Filters transactions by search query across orderId, customerName, customerEmail, and tierInfo.
 */
export function filterTransactions(
  transactions: RecentTransaction[],
  query: string
): RecentTransaction[] {
  const q = query.trim().toLowerCase();
  if (!q) return transactions;
  return transactions.filter(
    (tx) =>
      tx.orderId.toLowerCase().includes(q) ||
      tx.customerName.toLowerCase().includes(q) ||
      tx.customerEmail.toLowerCase().includes(q) ||
      tx.status.toLowerCase().includes(q) ||
      tx.tierInfo.toLowerCase().includes(q)
  );
}

/**
 * Filters orders by search query across orderNumber, buyerName, buyerEmail, trackingId, and items.
 */
export function filterOrders(orders: Order[], query: string): Order[] {
  const q = query.trim().toLowerCase();
  if (!q) return orders;
  return orders.filter(
    (ord) =>
      ord.orderNumber.toLowerCase().includes(q) ||
      ord.buyerName.toLowerCase().includes(q) ||
      ord.buyerEmail.toLowerCase().includes(q) ||
      (ord.trackingId || '').toLowerCase().includes(q) ||
      ord.escrowStatus.toLowerCase().includes(q) ||
      ord.items.some(
        (it) => it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q)
      )
  );
}

/**
 * Triggers a real browser file download using a Blob.
 */
export function downloadBlobFile(
  filename: string,
  content: string,
  mimeType: string = 'text/plain;charset=utf-8'
) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ============================================================================
// Deterministic Indian GSTIN Format & Place-of-Supply Tax Regime Validation
// (Used by POST /api/invoice/analyze and unit tests)
// ============================================================================

export const INDIAN_STATE_CODE_MAP: Record<string, string> = {
  '07': 'Delhi',
  '19': 'West Bengal',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '33': 'Tamil Nadu',
  '36': 'Telangana',
  '96': 'Foreign / Export',
  '99': 'Other Territory / Non-Resident',
};

export interface GstinValidationResult {
  gstin: string;
  normalizedGstin: string;
  isValidFormat: boolean;
  stateCode: string | null;
  stateName: string | null;
  panSegment: string | null;
  reason: string;
}

/**
 * Validates standard 15-character Indian GSTIN format in code:
 * 2 digits state code + 10 chars PAN (5 letters, 4 digits, 1 letter) + 1 entity code + 'Z' + 1 check char.
 */
export function validateGstinFormat(rawGstin: string): GstinValidationResult {
  const normalized = (rawGstin || '').trim().toUpperCase().split(/\s+/)[0];
  const gstinRegex = /^([0-9]{2})([A-Z]{5}[0-9]{4}[A-Z]{1})([1-9A-Z]{1})Z([0-9A-Z]{1})$/;
  const match = normalized.match(gstinRegex);

  if (!match) {
    return {
      gstin: rawGstin,
      normalizedGstin: normalized,
      isValidFormat: false,
      stateCode: null,
      stateName: null,
      panSegment: null,
      reason: `GSTIN "${rawGstin}" does not match the statutory 15-character Indian GSTIN pattern (2-digit State Code + 10-char PAN + Entity Code + Z + Checksum).`,
    };
  }

  const stateCode = match[1];
  const panSegment = match[2];
  const stateName = INDIAN_STATE_CODE_MAP[stateCode] || `State Code ${stateCode}`;

  return {
    gstin: rawGstin,
    normalizedGstin: normalized,
    isValidFormat: true,
    stateCode,
    stateName,
    panSegment,
    reason: `Valid 15-character GSTIN registered in ${stateName} (${stateCode}), PAN ${panSegment}.`,
  };
}

export interface PlaceOfSupplyCheckResult {
  supplierStateCode: string;
  supplierStateName: string;
  buyerStateCode: string;
  buyerStateName: string;
  isIntraState: boolean;
  expectedRegime: 'CGST_SGST' | 'IGST' | 'EXPORT_ZERO_RATED';
  declaredRegime?: 'CGST_SGST' | 'IGST' | 'EXPORT_ZERO_RATED';
  regimeMatches: boolean;
  cgstPercent: number;
  sgstPercent: number;
  igstPercent: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  explanation: string;
}

/**
 * Deterministic Place-of-Supply tax regime verification done in code:
 * - Same state code (e.g. Supplier 29 Karnataka -> Buyer 29 Karnataka) => Intra-state: split equally into CGST (9%) + SGST (9%).
 * - Different state code (e.g. Supplier 29 Karnataka -> Buyer 27 Maharashtra) => Inter-state: full IGST (18%).
 * - Export / Non-resident ('96' or '99') => Export Zero-Rated / LUT (0%).
 */
export function validatePlaceOfSupplyTaxRegime(params: {
  supplierGstin?: string;
  buyerGstin: string;
  placeOfSupplyStateCode?: string;
  taxableSubtotalMinor: number;
  gstRatePercent?: number;
  declaredRegime?: 'CGST_SGST' | 'IGST' | 'EXPORT_ZERO_RATED';
}): PlaceOfSupplyCheckResult {
  const supplierCheck = validateGstinFormat(params.supplierGstin || '29AABCT1332L1Z5');
  const buyerCheck = validateGstinFormat(params.buyerGstin);

  const supplierStateCode = supplierCheck.stateCode || '29';
  const supplierStateName = INDIAN_STATE_CODE_MAP[supplierStateCode] || `State ${supplierStateCode}`;

  const extractedPosMatch = (params.placeOfSupplyStateCode || '').match(/([0-9]{2})/);
  const buyerStateCode =
    buyerCheck.stateCode || (extractedPosMatch ? extractedPosMatch[1] : '27');
  const buyerStateName = INDIAN_STATE_CODE_MAP[buyerStateCode] || `State ${buyerStateCode}`;

  const gstRate = params.gstRatePercent ?? 18;
  const totalTaxMinor = Math.round((params.taxableSubtotalMinor * gstRate) / 100);

  let expectedRegime: 'CGST_SGST' | 'IGST' | 'EXPORT_ZERO_RATED';
  let isIntraState = false;
  let cgstPercent = 0;
  let sgstPercent = 0;
  let igstPercent = 0;
  let cgstMinor = 0;
  let sgstMinor = 0;
  let igstMinor = 0;

  if (buyerStateCode === '96' || buyerStateCode === '99' || gstRate === 0) {
    expectedRegime = 'EXPORT_ZERO_RATED';
  } else if (supplierStateCode === buyerStateCode) {
    expectedRegime = 'CGST_SGST';
    isIntraState = true;
    cgstPercent = gstRate / 2;
    sgstPercent = gstRate / 2;
    cgstMinor = Math.floor(totalTaxMinor / 2);
    sgstMinor = totalTaxMinor - cgstMinor;
  } else {
    expectedRegime = 'IGST';
    isIntraState = false;
    igstPercent = gstRate;
    igstMinor = totalTaxMinor;
  }

  const declared = params.declaredRegime || expectedRegime;
  const regimeMatches = declared === expectedRegime;

  const explanation =
    expectedRegime === 'CGST_SGST'
      ? `Intra-state supply within ${supplierStateName} (${supplierStateCode} → ${buyerStateCode}): requires ${cgstPercent}% CGST + ${sgstPercent}% SGST split.`
      : expectedRegime === 'IGST'
      ? `Inter-state supply from ${supplierStateName} (${supplierStateCode}) to ${buyerStateName} (${buyerStateCode}): requires ${igstPercent}% Integrated GST (IGST).`
      : `Cross-border / Non-resident supply (${buyerStateCode}): Zero-rated export under LUT.`;

  return {
    supplierStateCode,
    supplierStateName,
    buyerStateCode,
    buyerStateName,
    isIntraState,
    expectedRegime,
    declaredRegime: declared,
    regimeMatches,
    cgstPercent,
    sgstPercent,
    igstPercent,
    cgstMinor,
    sgstMinor,
    igstMinor,
    explanation,
  };
}

