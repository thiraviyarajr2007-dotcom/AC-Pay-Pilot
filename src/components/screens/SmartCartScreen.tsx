import React, { useState, useEffect } from 'react';
import { formatINR } from '../../utils/finance';
import {
  MoneyBreakdownCard,
  PaymentStateBadge,
  DataCollectionBoundary,
  CollectionViewState,
} from '../ui/HonestTrustComponents';
import { useRole } from '../../context/RoleContext';
import { SAMPLE_CART_ITEMS } from '../../data/cartDefaults';

export interface SmartCartItem {
  sku: string;
  name: string;
  category: string;
  hsCode: string;
  unitPrice: number;
  qty: number;
  selected: boolean;
  img: string;
}

interface SmartCartScreenProps {
  items?: SmartCartItem[];
  onUpdateItems?: React.Dispatch<React.SetStateAction<SmartCartItem[]>>;
  onOpenCheckout: () => void;
  onStartCheckout?: (items: SmartCartItem[]) => void;
  onSelectProduct?: (product: any) => void;
  onOpenCopilot?: (query?: string) => void;
  showToast?: (msg: string) => void;
}

interface CartOptimizationResult {
  source: 'live' | 'fallback';
  fallbackReason?: string;
  currency: 'INR';
  budgetMinor: number;
  cartSubtotalMinor: number;
  cartTaxMinor: number;
  cartTotalMinor: number;
  withinBudget: boolean;
  rankedItems: Array<{
    sku: string;
    name: string;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
    priorityRank: number;
    priorityLabel: 'Must-Have' | 'Recommended' | 'Deferrable';
    explanation: string;
  }>;
  suggestedAlternatives: Array<{
    replacesSku: string;
    alternativeSku: string;
    alternativeName: string;
    unitPriceMinor: number;
    estimatedSavingMinor: number;
    reason: string;
    autoAdded: false;
  }>;
  whyThis: string;
}

export const SmartCartScreen: React.FC<SmartCartScreenProps> = ({
  items: controlledItems,
  onUpdateItems,
  onOpenCheckout,
  onStartCheckout,
  onSelectProduct,
  onOpenCopilot,
  showToast,
}) => {
  const { serverConfirmed, feesVerified, setFeesVerified, authFetch } = useRole();

  const [uncontrolledCartItems, setUncontrolledCartItems] =
    useState<SmartCartItem[]>(SAMPLE_CART_ITEMS);
  const cartItems = controlledItems !== undefined ? controlledItems : uncontrolledCartItems;
  const setCartItems: React.Dispatch<React.SetStateAction<SmartCartItem[]>> =
    onUpdateItems ?? setUncontrolledCartItems;

  const [budgetCapInr, setBudgetCapInr] = useState<number>(38000);
  const [priorityGoal, setPriorityGoal] = useState<string>('Energy Savings & Essential Gear');
  const [optLoading, setOptLoading] = useState<boolean>(false);
  const [optError, setOptError] = useState<string | null>(null);
  const [optResult, setOptResult] = useState<CartOptimizationResult | null>(null);
  const [listState, setListState] = useState<CollectionViewState>('ready');

  const activeItems = cartItems.filter((i) => i.selected && i.qty > 0);
  const activeItemsKey = activeItems.map((i) => `${i.sku}:${i.qty}`).join(',');
  const grossTotal = activeItems.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
  const taxableSubtotal = Math.round(grossTotal / 1.18);
  const gstAmount = grossTotal - taxableSubtotal;
  const gatewayFee = Math.round(grossTotal * 0.0349 + 12);
  const budgetPct = Math.min(100, Math.round((grossTotal / Math.max(1, budgetCapInr)) * 100));

  const runCartOptimization = async (customBudget?: number) => {
    if (activeItems.length === 0) {
      setOptResult(null);
      setOptError(null);
      return;
    }
    setOptLoading(true);
    setOptError(null);
    try {
      const res = await authFetch('/api/cart/optimize', {
        method: 'POST',
        body: JSON.stringify({
          budgetInr: customBudget ?? budgetCapInr,
          items: activeItems.map((i) => ({
            sku: i.sku,
            quantity: i.qty,
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setOptResult(data);
      } else {
        setOptError(data?.error || `Could not optimize cart (HTTP ${res.status}).`);
      }
    } catch {
      setOptError('Network error refreshing SmartCart ranking.');
      showToast?.('Could not refresh cart ranking right now.');
    } finally {
      setOptLoading(false);
    }
  };

  useEffect(() => {
    if (activeItems.length === 0) {
      setOptResult(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void runCartOptimization();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [budgetCapInr, activeItemsKey, authFetch]);

  const updateQty = (sku: string, delta: number) => {
    setCartItems((prev) =>
      prev.map((item) =>
        item.sku === sku ? { ...item, qty: Math.max(1, item.qty + delta) } : item
      )
    );
  };

  const removeItem = (sku: string) => {
    setCartItems((prev) => prev.filter((item) => item.sku !== sku));
    showToast?.(`Removed ${sku} from SmartCart.`);
  };

  const toggleSelect = (sku: string) => {
    setCartItems((prev) =>
      prev.map((item) => (item.sku === sku ? { ...item, selected: !item.selected } : item))
    );
  };

  const handleApplyAlternative = (alt: CartOptimizationResult['suggestedAlternatives'][0]) => {
    setCartItems((prev) =>
      prev.map((item) =>
        item.sku === alt.replacesSku
          ? {
              ...item,
              sku: alt.alternativeSku,
              name: alt.alternativeName,
              unitPrice: Math.round(alt.unitPriceMinor / 100),
            }
          : item
      )
    );
    showToast?.(`Replaced ${alt.replacesSku} with ${alt.alternativeName}.`);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header (Matches Image_3 / Image_4) */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-widest text-primary block">
            SmartCart &amp; Budget Planner
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold font-headline text-on-surface tracking-tight mt-0.5">
            Your Ranked Shopping Cart
          </h1>
          <p className="text-xs text-secondary mt-1">
            Review item priority against your target budget. Nothing is added, removed, or reordered without your click.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void runCartOptimization()}
          disabled={optLoading}
          data-testid="smartcart-optimize-btn"
          className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-container disabled:opacity-50 text-on-primary text-xs font-semibold flex items-center gap-2 shrink-0 cursor-pointer"
        >
          <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
          <span>{optLoading ? 'Ranking Items...' : 'Rank Cart by Priority'}</span>
        </button>
      </div>

      {/* 3-Column Personal Shopping Requirements Bento (Matches Image_3 / Image_4) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block">
            Target Budget Ceiling
          </span>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold font-headline text-on-surface">₹</span>
            <input
              type="number"
              value={budgetCapInr}
              onChange={(e) => setBudgetCapInr(Math.max(1000, Number(e.target.value) || 0))}
              aria-label="Target budget in INR"
              className="w-full px-2.5 py-1 rounded-lg border border-surface-container-high bg-surface-container-low font-tabular-nums text-sm font-bold text-on-surface"
            />
          </div>
        </div>

        <div className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block">
            Ranking Priority
          </span>
          <select
            value={priorityGoal}
            onChange={(e) => setPriorityGoal(e.target.value)}
            aria-label="Ranking priority goal"
            className="w-full px-2.5 py-1.5 rounded-lg border border-surface-container-high bg-surface-container-low text-xs font-semibold text-on-surface"
          >
            <option value="Energy Savings & Essential Gear">Energy Savings &amp; Essential Gear</option>
            <option value="Lowest Total Cost">Lowest Total Cost</option>
            <option value="Fastest In-Stock Dispatch">Fastest In-Stock Dispatch</option>
          </select>
        </div>

        <div className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary">
              Budget Utilization
            </span>
            <span
              className={`text-xs font-bold font-tabular-nums ${
                grossTotal <= budgetCapInr ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {formatINR(grossTotal)} / {formatINR(budgetCapInr)}
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-surface-container overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                grossTotal <= budgetCapInr ? 'bg-emerald-600' : 'bg-amber-500'
              }`}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
          <span className="text-[11px] text-secondary block">
            {grossTotal <= budgetCapInr
              ? `Within budget by ${formatINR(budgetCapInr - grossTotal)}`
              : `Over target budget by ${formatINR(grossTotal - budgetCapInr)}`}
          </span>
        </div>
      </div>

      {/* 12-Col Split: Left 8 Cols Ranked Purchase Stack + Right 4 Cols Sticky Order Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-surface-container-lowest rounded-xl border border-surface-container-high p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold font-headline text-on-surface">
                  Ranked Purchase Stack ({activeItems.length} Active)
                </h2>
                {optResult && (
                  <span
                    data-testid="cart-opt-source-badge"
                    className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-surface-container text-secondary"
                  >
                    {optResult.source === 'live' ? 'Live' : 'Ranked'}
                  </span>
                )}
              </div>
              <span className="text-xs text-secondary">
                {optResult?.withinBudget ? 'Fits target budget' : 'Review optional items'}
              </span>
            </div>

            {optError && (
              <div
                role="alert"
                data-testid="smartcart-opt-error"
                className="p-3 rounded-xl bg-error-container/30 border border-error/40 flex items-center justify-between gap-2 text-xs text-on-surface"
              >
                <span>{optError}</span>
                <button
                  type="button"
                  onClick={() => void runCartOptimization()}
                  className="px-2.5 py-1 rounded-lg bg-primary text-on-primary text-[11px] font-semibold cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}

            {cartItems.length === 0 ? (
              <div className="p-6 rounded-xl border border-dashed border-surface-container-high bg-surface-container-low text-center space-y-3">
                <p className="text-xs font-semibold text-on-surface">
                  Your SmartCart is currently empty.
                </p>
                <p className="text-[11px] text-secondary">
                  Add products from Discovery or load the starter bundle to test priority budget optimization.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setCartItems(SAMPLE_CART_ITEMS)}
                    className="px-3.5 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold cursor-pointer"
                  >
                    Load Starter Cart
                  </button>
                </div>
              </div>
            ) : (
            <DataCollectionBoundary
              title="SmartCart Items"
              state={activeItems.length === 0 && listState === 'ready' ? 'empty' : listState}
              onStateChange={setListState}
              emptyMessage="Your cart is empty. Select items below or browse the catalog."
            >
              <div className="space-y-3" data-testid="smartcart-ranked-list">
                {cartItems.map((item, idx) => {
                  const rankedMeta = optResult?.rankedItems.find((r) => r.sku === item.sku);
                  return (
                    <div
                      key={`${item.sku}-${idx}`}
                      className={`p-4 rounded-xl border transition-colors ${
                        item.selected
                          ? 'bg-surface-container-lowest border-surface-container-high'
                          : 'bg-surface-container-low/50 border-surface-container opacity-60'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-3.5">
                          <input
                            type="checkbox"
                            checked={item.selected}
                            onChange={() => toggleSelect(item.sku)}
                            aria-label={`Include ${item.name}`}
                            className="mt-1.5 w-4 h-4 accent-primary rounded cursor-pointer"
                          />
                          <button
                            type="button"
                            onClick={() => onSelectProduct && onSelectProduct(item)}
                            aria-label={`Inspect ${item.name}`}
                            className="w-16 h-16 rounded-xl overflow-hidden bg-surface-container shrink-0 cursor-pointer"
                          >
                            <img
                              src={item.img}
                              alt={item.name}
                              className="w-full h-full object-cover"
                            />
                          </button>
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded bg-surface-container text-on-surface font-tabular-nums text-[10px] font-semibold">
                                #{rankedMeta?.priorityRank ?? idx + 1}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                  rankedMeta?.priorityLabel === 'Must-Have'
                                    ? 'bg-emerald-50 text-emerald-800'
                                    : rankedMeta?.priorityLabel === 'Recommended'
                                    ? 'bg-primary-fixed text-on-primary-fixed'
                                    : 'bg-amber-50 text-amber-800'
                                }`}
                              >
                                {rankedMeta?.priorityLabel || 'Recommended'}
                              </span>
                              <span className="text-[11px] text-secondary font-tabular-nums">
                                SKU: {item.sku}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => onSelectProduct && onSelectProduct(item)}
                              className="text-sm font-bold text-on-surface hover:text-primary text-left block cursor-pointer"
                            >
                              {item.name}
                            </button>
                            <p className="text-xs text-secondary">
                              {rankedMeta?.explanation || item.category}
                            </p>
                          </div>
                        </div>

                        <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">
                          <div className="text-base font-bold font-headline text-on-surface font-tabular-nums">
                            {formatINR(item.unitPrice * item.qty)}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5 bg-surface-container-low rounded-lg p-1 border border-surface-container-high">
                              <button
                                type="button"
                                onClick={() => updateQty(item.sku, -1)}
                                aria-label={`Decrease quantity for ${item.name}`}
                                className="w-6 h-6 rounded bg-surface-container-lowest text-on-surface font-bold text-xs cursor-pointer"
                              >
                                -
                              </button>
                              <span className="px-2 text-xs font-tabular-nums font-bold">
                                {item.qty}
                              </span>
                              <button
                                type="button"
                                onClick={() => updateQty(item.sku, 1)}
                                aria-label={`Increase quantity for ${item.name}`}
                                className="w-6 h-6 rounded bg-surface-container-lowest text-on-surface font-bold text-xs cursor-pointer"
                              >
                                +
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeItem(item.sku)}
                              aria-label={`Remove ${item.name} from cart`}
                              className="w-7 h-7 rounded-lg bg-surface-container-low hover:bg-error-container/40 text-secondary hover:text-error flex items-center justify-center cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[16px]">delete</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </DataCollectionBoundary>
            )}
          </div>

          {/* Suggested Alternatives (Kept Strictly Separate from Real Cart Items) */}
          {optResult && optResult.suggestedAlternatives.length > 0 && (
            <div
              data-testid="smartcart-suggested-alternatives"
              className="bg-surface-container-low rounded-xl border border-surface-container-high p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface">
                    Optional Lower-Cost Alternatives
                  </h3>
                  <p className="text-xs text-secondary">
                    Kept separate from your cart. Click &ldquo;Swap Item&rdquo; only if you want to replace an item.
                  </p>
                </div>
              </div>

              <div className="space-y-2.5">
                {optResult.suggestedAlternatives.map((alt, altIdx) => (
                  <div
                    key={`${alt.replacesSku || 'alt'}-${alt.alternativeSku}-${altIdx}`}
                    className="p-3.5 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="font-bold text-on-surface">
                        {alt.alternativeName} ({alt.alternativeSku}) — {formatINR(Math.round(alt.unitPriceMinor / 100))}
                      </div>
                      <div className="text-secondary">{alt.reason}</div>
                      <div className="text-emerald-700 font-semibold font-tabular-nums">
                        Saves {formatINR(Math.round(alt.estimatedSavingMinor / 100))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleApplyAlternative(alt)}
                      className="px-3.5 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-semibold shrink-0 cursor-pointer"
                    >
                      Swap Item
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right 4 Columns: Sticky Order Summary & PayPal Checkout (Matches Image_3 / Image_4) */}
        <div className="lg:col-span-4 space-y-5">
          <div className="bg-surface-container-lowest rounded-xl border border-surface-container-high p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-secondary">
                Order Protection
              </span>
              <PaymentStateBadge
                state={serverConfirmed ? 'Captured' : 'Authorized'}
                serverConfirmed={serverConfirmed}
              />
            </div>

            <MoneyBreakdownCard
              title="Order Summary"
              currency="INR"
              subtotal={taxableSubtotal}
              taxLabel="GST (18%)"
              taxAmount={gstAmount}
              feeLabel="PayPal Fee"
              feeAmount={gatewayFee}
              isFeesVerified={feesVerified}
              total={grossTotal}
              onVerifyFees={() => {
                setFeesVerified(true);
                showToast?.('PayPal fee loaded.');
              }}
            />

            <button
              type="button"
              onClick={() => {
                if (onStartCheckout) {
                  onStartCheckout(activeItems);
                } else {
                  onOpenCheckout();
                }
              }}
              disabled={activeItems.length === 0}
              data-testid="smartcart-paypal-checkout-btn"
              className="w-full py-3.5 px-4 rounded-xl bg-primary hover:bg-primary-container disabled:opacity-50 text-on-primary font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <i className="fa-brands fa-paypal text-base"></i>
              <span>Proceed to PayPal Checkout ({formatINR(grossTotal)})</span>
            </button>
          </div>

          {/* Copilot Quick Prompts (Matches Image_3 / Image_4) */}
          <div className="bg-surface-container-low rounded-xl border border-surface-container-high p-4 space-y-2.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-secondary block">
              Ask Copilot About Your Cart
            </span>
            <button
              type="button"
              onClick={() =>
                onOpenCopilot &&
                onOpenCopilot('Simulate my SmartCart against a ₹30,000 budget')
              }
              className="w-full text-left p-2.5 rounded-lg bg-surface-container-lowest hover:bg-surface-container text-xs font-medium text-on-surface border border-surface-container-high transition-colors cursor-pointer"
            >
              &ldquo;How can I keep this cart under ₹30,000?&rdquo;
            </button>
            <button
              type="button"
              onClick={() =>
                onOpenCopilot &&
                onOpenCopilot('Check GST invoice credit on my SmartCart items')
              }
              className="w-full text-left p-2.5 rounded-lg bg-surface-container-lowest hover:bg-surface-container text-xs font-medium text-on-surface border border-surface-container-high transition-colors cursor-pointer"
            >
              &ldquo;Estimate GST input credit for this order&rdquo;
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
