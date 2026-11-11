import React, { useState, useEffect } from 'react';
import { formatINR } from '../../utils/finance';
import {
  MoneyBreakdownCard,
  PaymentStateBadge,
  DataCollectionBoundary,
  CollectionViewState,
} from '../ui/HonestTrustComponents';
import { useRole } from '../../context/RoleContext';

interface SmartCartScreenProps {
  onOpenCheckout: () => void;
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
  onOpenCheckout,
  onSelectProduct,
  onOpenCopilot,
  showToast,
}) => {
  const { serverConfirmed, feesVerified, setFeesVerified, getActorHeaders } = useRole();

  const [cartItems, setCartItems] = useState([
    {
      sku: '#FAN-BLDC-892',
      name: 'AeroBreeze Stealth 1200mm Smart BLDC Ceiling Fan',
      category: 'Smart Ceiling Fans • 28W BLDC',
      hsCode: '8414.51.10',
      unitPrice: 8499,
      qty: 2,
      selected: true,
      img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAdZqURIDL_NaUXiAifTbLg4cem9jV1GV8iZOZph4aZvIM_kBIBsVSYaq0LFoeWQ1Xe11jOuDpYR0RHnVhSurjQprJuCqeXfR6luOW8JojolfW3AL3RlJG5cFe-YmAZaYz7-lll8h5sqcs83z5WRWhCSmB_-pIxVPGanujJtlcWqHaGPRDckKJmoCqqWoVmhA4SIWYCZ53ylY77gEHOrpObunEt2PyFUzIVJzYoOpMS9aQvgYTluWmbLg',
    },
    {
      sku: '#SPO-YNX-99P',
      name: 'Yonex Astrox 99 Pro Carbon Badminton Racket',
      category: 'Sports & Fitness • 4U Carbon',
      hsCode: '9506.59.10',
      unitPrice: 14990,
      qty: 1,
      selected: true,
      img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDURq8df1AvNhd6BXPOnLSDepBVFAZQQdhN7XCJzqUwmcV79SqYGalleVqm5XyenVa4nFesHY7jCNLROrqBHlgtE92aPFjCmcNoiYuJEPzJjul5AYdnnHkeKQevXmwyO8xozEtp1qExjA6sfd8tRUMhTAaE5rLBnqslJx9r-5JgtL82V5kmTgx9bt5QmOiAjh1sa5vjPP7EB5WSaeKeMK9zuVgCH8RJFezfeBmyvYUJuYqroAVrKuYT6A',
    },
    {
      sku: '#AUD-ANC-99',
      name: 'AcousticSphere ANC Wireless Earbuds',
      category: 'Audio & Accessories',
      hsCode: '8518.30.00',
      unitPrice: 11499,
      qty: 1,
      selected: true,
      img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuATX6652NttkNvGUKx5jflqNG9RH8CT1bcmBhwPs5ONeLhU9pt_yu_fLrBW741KftvyB8iGKx74rvwQHwuPCAi3l4R3tYkHwBDG9n3OPdy9Mlu8L_I0x4OPz9BwauAkb1vv9Y9m6inErwdhjPUN3ppwCGPbYGt503flhtRIVgYmpxZIuYY_1j9Rm3YHrFW7YLzOu7wmGH2HMVU6LtZPoH8W80bhQ8Ax7MbgTzEynmMscW556GyOm__wiw',
    },
  ]);

  const [budgetCapInr, setBudgetCapInr] = useState<number>(38000);
  const [priorityGoal, setPriorityGoal] = useState<string>('Energy Savings & Essential Gear');
  const [optLoading, setOptLoading] = useState<boolean>(false);
  const [optResult, setOptResult] = useState<CartOptimizationResult | null>(null);
  const [listState, setListState] = useState<CollectionViewState>('ready');

  const activeItems = cartItems.filter((i) => i.selected && i.qty > 0);
  const grossTotal = activeItems.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
  const taxableSubtotal = Math.round(grossTotal / 1.18);
  const gstAmount = grossTotal - taxableSubtotal;
  const gatewayFee = Math.round(grossTotal * 0.0349 + 12);
  const budgetPct = Math.min(100, Math.round((grossTotal / Math.max(1, budgetCapInr)) * 100));

  const runCartOptimization = async (customBudget?: number) => {
    setOptLoading(true);
    try {
      const res = await fetch('/api/cart/optimize', {
        method: 'POST',
        headers: getActorHeaders(),
        body: JSON.stringify({
          budgetInr: customBudget ?? budgetCapInr,
          items: activeItems.map((i) => ({
            sku: i.sku,
            quantity: i.qty,
          })),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setOptResult(data);
      }
    } catch {
      showToast?.('Could not refresh cart ranking right now.');
    } finally {
      setOptLoading(false);
    }
  };

  useEffect(() => {
    void runCartOptimization();
  }, []);

  const updateQty = (sku: string, delta: number) => {
    setCartItems((prev) =>
      prev.map((item) =>
        item.sku === sku ? { ...item, qty: Math.max(1, item.qty + delta) } : item
      )
    );
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
                          <img
                            src={item.img}
                            alt={item.name}
                            onClick={() => onSelectProduct && onSelectProduct(item)}
                            className="w-16 h-16 rounded-xl object-cover bg-surface-container shrink-0 cursor-pointer"
                          />
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
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </DataCollectionBoundary>
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
              onClick={onOpenCheckout}
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
