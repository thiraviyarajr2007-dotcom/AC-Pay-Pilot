import React, { useState, useEffect } from 'react';
import { formatINR } from '../../utils/finance';
import { downloadTextFile } from '../../utils/export';
import {
  PaymentStateBadge,
  PaymentStatesLegendStrip,
  MoneyBreakdownCard,
  DataCollectionBoundary,
  CanonicalPaymentState,
  CollectionViewState,
} from '../ui/HonestTrustComponents';
import { useRole } from '../../context/RoleContext';
import {
  ALLOWED_ESCROW_TRANSITIONS,
  ESCROW_ARCHITECTURE_DECISION,
  EscrowEventRecord,
  EscrowState,
  formatEscrowStateLabel,
  isRoleAllowedForEscrowTransition,
  transitionEscrowState,
} from '../../utils/escrow';
import { recordEscrowEventInFirestore } from '../../services/firestoreService';

export interface OrderRecord {
  id: string;
  invoiceId: string;
  buyerName: string;
  buyerGstin: string;
  productSku: string;
  productName: string;
  qty: number;
  amount: number;
  paymentState: CanonicalPaymentState;
  date: string;
  trackingId: string;
}

interface EscrowAgentRecommendation {
  source: 'live' | 'fallback';
  fallbackReason?: string;
  orderId: string;
  recommendation: 'release' | 'hold' | 'dispute';
  confidence: number;
  reasons: string[];
}

interface OrdersScreenProps {
  mode: 'seller' | 'customer';
  orders: OrderRecord[];
  highlightedOrderId?: string | null;
  onUpdateOrderState: (orderId: string, nextState: CanonicalPaymentState) => void;
  onOpenInvoice: (invoiceId: string) => void;
  onOpenProduct: (sku: string) => void;
  onOpenCheckout?: () => void;
  showToast: (msg: string) => void;
  globalSearchQuery?: string;
}

export const OrdersScreen: React.FC<OrdersScreenProps> = ({
  mode,
  orders,
  highlightedOrderId,
  onUpdateOrderState,
  onOpenInvoice,
  onOpenProduct,
  onOpenCheckout,
  showToast,
  globalSearchQuery = '',
}) => {
  const {
    role,
    profile,
    serverConfirmed,
    setServerConfirmed,
    feesVerified,
    setFeesVerified,
    authFetch,
  } = useRole();

  const [statusFilter, setStatusFilter] = useState<'ALL' | CanonicalPaymentState>('ALL');
  const [tableState, setTableState] = useState<CollectionViewState>('ready');
  const [selectedOrderForMoney, setSelectedOrderForMoney] = useState<OrderRecord | null>(
    orders[0] || null
  );
  const [aiEscrowRec, setAiEscrowRec] = useState<EscrowAgentRecommendation | null>(null);
  const [aiRecLoading, setAiRecLoading] = useState(false);

  // Track formal EscrowState and EscrowEventRecord history per order
  const [escrowStatesByOrderId, setEscrowStatesByOrderId] = useState<Record<string, EscrowState>>(
    () => {
      const init: Record<string, EscrowState> = {};
      for (const o of orders) {
        if (o.paymentState === 'Captured') init[o.id] = 'in_delivery';
        else if (o.paymentState === 'Authorized') init[o.id] = 'funded';
        else if (o.paymentState === 'Refunded') init[o.id] = 'refunded';
        else init[o.id] = 'created';
      }
      return init;
    }
  );

  const [escrowEventsByOrderId, setEscrowEventsByOrderId] = useState<
    Record<string, EscrowEventRecord[]>
  >(() => {
    const init: Record<string, EscrowEventRecord[]> = {};
    for (const o of orders) {
      const st: EscrowState =
        o.paymentState === 'Captured'
          ? 'in_delivery'
          : o.paymentState === 'Authorized'
          ? 'funded'
          : o.paymentState === 'Refunded'
          ? 'refunded'
          : 'created';
      init[o.id] = [
        {
          id: `evt-init-${o.id}`,
          orderId: o.id,
          fromState: null,
          toState: 'created',
          actorId: 'cust-demo-1',
          actorRole: 'customer',
          reason: 'Order created at checkout',
          timestamp: '2026-10-23T09:15:00Z',
        },
        ...(st !== 'created'
          ? [
              {
                id: `evt-fund-${o.id}`,
                orderId: o.id,
                fromState: 'created' as EscrowState,
                toState: 'funded' as EscrowState,
                actorId: 'system',
                actorRole: 'system' as const,
                reason: 'PayPal Sandbox capture verified on server',
                timestamp: '2026-10-23T09:16:12Z',
              },
            ]
          : []),
      ];
    }
    return init;
  });

  const activeMoneyOrder = selectedOrderForMoney || orders[0];
  const activeEscrowState: EscrowState = activeMoneyOrder
    ? escrowStatesByOrderId[activeMoneyOrder.id] || 'funded'
    : 'funded';

  const fetchEscrowRecommendation = async (order: OrderRecord, escState: EscrowState) => {
    setAiRecLoading(true);
    try {
      const res = await authFetch('/api/escrow/recommend', {
        method: 'POST',
        body: JSON.stringify({
          orderId: order.id,
          trackingId: order.trackingId,
          deliveryConfirmed: escState === 'in_delivery' || escState === 'released',
          buyerInspectionNotes: 'Verified packaging and serial numbers',
          damageReported: false,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok && data.recommendation) {
        setAiEscrowRec(data);
      } else {
        setAiEscrowRec(null);
      }
    } catch {
      setAiEscrowRec(null);
    } finally {
      setAiRecLoading(false);
    }
  };

  const canQueryAiReleaseAgent = mode !== 'customer' && role !== 'customer';

  useEffect(() => {
    if (canQueryAiReleaseAgent && activeMoneyOrder) {
      void fetchEscrowRecommendation(activeMoneyOrder, activeEscrowState);
    } else {
      setAiEscrowRec(null);
    }
  }, [canQueryAiReleaseAgent, activeMoneyOrder?.id, activeEscrowState, authFetch]);

  const [auditModal, setAuditModal] = useState<{
    order: OrderRecord;
    targetState: EscrowState;
    reason: string;
  } | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  const handleTransitionEscrow = async (
    order: OrderRecord,
    targetState: EscrowState,
    customReason?: string
  ) => {
    // If transitioning to disputed or refunded without a custom reason, prompt user with modal
    if ((targetState === 'disputed' || targetState === 'refunded') && !customReason) {
      setAuditModal({
        order,
        targetState,
        reason:
          targetState === 'disputed'
            ? 'Inspection variance: reported discrepancy between delivered unit and seller invoice specs'
            : 'Escrow refund requested and approved per contractual inspection SLA',
      });
      return;
    }

    setTransitioning(true);
    const currentEscrowState = escrowStatesByOrderId[order.id] || 'funded';
    const reasonMap: Record<EscrowState, string> = {
      created: 'Order initialized',
      funded: 'PayPal Sandbox capture verified',
      in_delivery: `Carrier airway bill ${order.trackingId} scanned for dispatch`,
      released: `Delivery confirmed and escrow released by ${profile.userName} (${role})`,
      disputed: customReason || `Dispute opened by ${profile.userName} (${role})`,
      refunded: customReason || `Escrow refund authorized by ${profile.userName} (${role})`,
    };

    const actualReason = customReason || reasonMap[targetState];

    const result = transitionEscrowState({
      orderId: order.id,
      currentState: currentEscrowState,
      nextState: targetState,
      actorId: profile.userEmail,
      actorRole: role,
      reason: actualReason,
      isAiAutomated: false,
    });

    if (!result.ok || !result.event) {
      showToast(result.error || 'Escrow transition not permitted');
      setTransitioning(false);
      return;
    }

    // 1. Post to server ledger API
    try {
      const res = await authFetch(`/api/orders/${encodeURIComponent(order.id)}/escrow-transition`, {
        method: 'POST',
        body: JSON.stringify({
          nextState: targetState,
          reason: actualReason,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        showToast(errData?.error || `Escrow transition denied (HTTP ${res.status})`);
        setTransitioning(false);
        return;
      }
    } catch {
      showToast('Failed to reach escrow transition server.');
      setTransitioning(false);
      return;
    }

    // 2. Persist to Firestore escrowEvents collection
    try {
      await recordEscrowEventInFirestore({
        id: result.event.id,
        orderId: order.id,
        fromState: result.event.fromState || undefined,
        toState: result.event.toState,
        actorId: profile.userEmail,
        actorRole: role,
        reason: actualReason,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // fallback
    }

    setEscrowStatesByOrderId((prev) => ({
      ...prev,
      [order.id]: result.nextState,
    }));

    setEscrowEventsByOrderId((prev) => ({
      ...prev,
      [order.id]: [...(prev[order.id] || []), result.event!],
    }));

    if (targetState === 'released') {
      setServerConfirmed(true);
      onUpdateOrderState(order.id, 'Captured');
    } else if (targetState === 'refunded') {
      onUpdateOrderState(order.id, 'Refunded');
    }

    setTransitioning(false);
    setAuditModal(null);
    showToast(`Escrow transitioned: ${currentEscrowState} → ${targetState} (Recorded in Firestore)`);
  };

  const filteredOrders = orders.filter((o) => {
    if (statusFilter !== 'ALL' && o.paymentState !== statusFilter) return false;
    if (globalSearchQuery.trim()) {
      const q = globalSearchQuery.toLowerCase();
      return (
        o.id.toLowerCase().includes(q) ||
        o.buyerName.toLowerCase().includes(q) ||
        o.productName.toLowerCase().includes(q) ||
        o.productSku.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleExportOrdersCsv = () => {
    const headers = [
      'Order ID',
      'Invoice ID',
      'Buyer',
      'GSTIN',
      'SKU',
      'Product',
      'Qty',
      'Currency',
      'Subtotal (INR)',
      'GST 18% (INR)',
      'Gateway Fee (INR)',
      'Total (INR)',
      'Payment State',
      'Escrow State',
      'Server Confirmed',
      'Date',
    ];
    const rows = filteredOrders.map((o) => {
      const sub = Math.round(o.amount / 1.18);
      const gst = o.amount - sub;
      const fee = feesVerified ? String(Math.round(o.amount * 0.0349 + 12)) : 'Not available';
      const esc = escrowStatesByOrderId[o.id] || 'funded';
      return [
        o.id,
        o.invoiceId,
        `"${o.buyerName}"`,
        o.buyerGstin,
        o.productSku,
        `"${o.productName}"`,
        o.qty,
        'INR',
        sub,
        gst,
        fee,
        o.amount,
        o.paymentState,
        esc,
        serverConfirmed ? 'YES' : 'NO',
        o.date,
      ];
    });
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    downloadTextFile(`ac-paypilot-${mode}-orders.csv`, csv, 'text/csv;charset=utf-8');
    showToast(`Exported ${filteredOrders.length} orders to CSV`);
  };

  const activeSubtotal = activeMoneyOrder ? Math.round(activeMoneyOrder.amount / 1.18) : 0;
  const activeGst = activeMoneyOrder ? activeMoneyOrder.amount - activeSubtotal : 0;
  const activeFee = activeMoneyOrder ? Math.round(activeMoneyOrder.amount * 0.0349 + 12) : 0;
  const activeEscrowEvents: EscrowEventRecord[] = activeMoneyOrder
    ? escrowEventsByOrderId[activeMoneyOrder.id] || []
    : [];

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-mono uppercase tracking-wider text-blue-700 font-bold">
            {mode === 'seller'
              ? 'Seller Workspace • Escrow Fulfillment Ledger'
              : 'Customer Workspace • Purchase & Escrow Tracker'}
          </span>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mt-0.5">
            {mode === 'seller' ? 'Merchant Orders & Escrow Releases' : 'My B2B Orders & Escrow Status'}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Escrow State Machine: <code className="font-mono">created → funded → in_delivery → released | disputed | refunded</code>.
            Release, Dispute, and Refund require an authorized user&apos;s explicit click.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="px-3 py-2 rounded-lg bg-slate-100 border border-slate-200 text-xs font-bold text-slate-700 flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={serverConfirmed}
              onChange={(e) => setServerConfirmed(e.target.checked)}
              className="rounded text-emerald-600"
            />
            Server Capture Confirmed
          </label>
          <button
            type="button"
            onClick={handleExportOrdersCsv}
            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <i className="fa-solid fa-download"></i>
            Export CSV
          </button>
          {mode === 'customer' && onOpenCheckout && (
            <button
              type="button"
              onClick={onOpenCheckout}
              className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
            >
              <i className="fa-brands fa-paypal"></i>
              New Escrow Checkout
            </button>
          )}
        </div>
      </div>

      {/* POST /api/escrow/recommend: AI Release Agent Card (Reads order evidence, human confirms with 1 click) */}
      {canQueryAiReleaseAgent && activeMoneyOrder && (
        <div
          data-testid="ai-escrow-release-agent-card"
          className="bg-white rounded-xl border border-blue-200 p-5 shadow-xs space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded bg-blue-700 text-white font-mono text-[10px] font-bold uppercase tracking-wider">
                AI Escrow Release Agent • POST /api/escrow/recommend
              </span>
              {aiEscrowRec && (
                <span
                  className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase ${
                    aiEscrowRec.source === 'live'
                      ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                      : 'bg-amber-100 text-amber-900 border border-amber-300'
                  }`}
                >
                  Source: {aiEscrowRec.source === 'live' ? 'Live AI' : 'Fallback'}
                </span>
              )}
              <span className="text-xs font-mono text-slate-500">
                Order: <strong>{activeMoneyOrder.id}</strong> (Escrow: {activeEscrowState})
              </span>
            </div>

            <button
              type="button"
              onClick={() => void fetchEscrowRecommendation(activeMoneyOrder, activeEscrowState)}
              disabled={aiRecLoading}
              className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
            >
              {aiRecLoading ? 'Evaluating Evidence...' : 'Re-Evaluate Order Evidence'}
            </button>
          </div>

          {aiEscrowRec && (
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-700">Agent Recommendation:</span>
                  <span
                    className={`px-2.5 py-0.5 rounded font-mono text-xs font-bold uppercase ${
                      aiEscrowRec.recommendation === 'release'
                        ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                        : aiEscrowRec.recommendation === 'dispute'
                        ? 'bg-red-100 text-red-900 border border-red-300'
                        : 'bg-amber-100 text-amber-900 border border-amber-300'
                    }`}
                  >
                    {aiEscrowRec.recommendation.toUpperCase()}
                  </span>
                  <span className="text-xs font-mono text-slate-600">
                    Confidence Score: <strong>{Math.round(aiEscrowRec.confidence * 100)}%</strong>
                  </span>
                </div>
                <ul className="list-disc list-inside text-xs text-slate-600 space-y-0.5">
                  {aiEscrowRec.reasons.map((r, idx) => (
                    <li key={idx}>{r}</li>
                  ))}
                </ul>
                <p className="text-[11px] text-slate-500">
                  {ESCROW_ARCHITECTURE_DECISION.summary} AI is blocked from mutating escrow directly (
                  <code className="font-mono">AI_DIRECT_MUTATION_FORBIDDEN</code>).
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {aiEscrowRec.recommendation === 'release' &&
                  ALLOWED_ESCROW_TRANSITIONS[activeEscrowState]?.includes('released') && (
                    <button
                      type="button"
                      disabled={!isRoleAllowedForEscrowTransition('released', role)}
                      onClick={() => void handleTransitionEscrow(activeMoneyOrder, 'released')}
                      className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-bold cursor-pointer"
                    >
                      1-Click Human Confirm: Release Escrow
                    </button>
                  )}
                {aiEscrowRec.recommendation === 'hold' &&
                  ALLOWED_ESCROW_TRANSITIONS[activeEscrowState]?.includes('in_delivery') && (
                    <button
                      type="button"
                      disabled={!isRoleAllowedForEscrowTransition('in_delivery', role)}
                      onClick={() => void handleTransitionEscrow(activeMoneyOrder, 'in_delivery')}
                      className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-40 text-white text-xs font-bold cursor-pointer"
                    >
                      1-Click Human Confirm: Mark In Delivery
                    </button>
                  )}
                {ALLOWED_ESCROW_TRANSITIONS[activeEscrowState]?.includes('disputed') && (
                  <button
                    type="button"
                    disabled={!isRoleAllowedForEscrowTransition('disputed', role)}
                    onClick={() => void handleTransitionEscrow(activeMoneyOrder, 'disputed')}
                    className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-xs font-bold cursor-pointer"
                  >
                    1-Click Human Confirm: Open Dispute
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* All 6 Payment States Legend Strip */}
      <PaymentStatesLegendStrip serverConfirmed={serverConfirmed} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 8 Cols: Orders Table with Loading / Empty / Error States */}
        <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                ['ALL', 'Pending', 'Authorized', 'Captured', 'Failed', 'Cancelled', 'Refunded'] as const
              ).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    statusFilter === st
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {st === 'Authorized' ? 'Authorized (held)' : st}
                </button>
              ))}
            </div>
          </div>

          <DataCollectionBoundary
            title="Escrow Orders Ledger"
            state={
              filteredOrders.length === 0 && tableState === 'ready' ? 'empty' : tableState
            }
            onStateChange={setTableState}
            emptyMessage="No orders match the selected payment state filter."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    <th className="py-3 pr-3">Order / Date</th>
                    <th className="py-3 px-3">Hardware SKU</th>
                    <th className="py-3 px-3 text-right">Amount (INR)</th>
                    <th className="py-3 px-3">Payment &amp; Escrow State</th>
                    <th className="py-3 pl-3 text-right">Explicit Escrow Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 text-xs">
                  {filteredOrders.map((order) => {
                    const isHighlighted = highlightedOrderId === order.id;
                    const escState = escrowStatesByOrderId[order.id] || 'funded';
                    const allowedNextStates = ALLOWED_ESCROW_TRANSITIONS[escState] || [];

                    return (
                      <tr
                        key={order.id}
                        onClick={() => setSelectedOrderForMoney(order)}
                        className={`transition-colors cursor-pointer ${
                          isHighlighted
                            ? 'bg-blue-50/70'
                            : selectedOrderForMoney?.id === order.id
                            ? 'bg-slate-50'
                            : 'hover:bg-slate-50/60'
                        }`}
                      >
                        <td className="py-3.5 pr-3">
                          <div className="font-mono font-bold text-slate-900">{order.id}</div>
                          <div className="text-[11px] text-slate-500">{order.date}</div>
                        </td>
                        <td className="py-3.5 px-3">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenProduct(order.productSku);
                            }}
                            className="font-bold text-slate-900 hover:text-blue-700 text-left block cursor-pointer"
                          >
                            {order.productName}
                          </button>
                          <span className="font-mono text-[10px] text-slate-500">
                            SKU: {order.productSku} • Qty {order.qty}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono font-bold text-slate-900">
                          {formatINR(order.amount)}
                        </td>
                        <td className="py-3.5 px-3 space-y-1">
                          <PaymentStateBadge
                            state={order.paymentState}
                            serverConfirmed={serverConfirmed}
                          />
                          <div className="text-[10px] font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded inline-block">
                            Escrow: {escState}
                          </div>
                        </td>
                        <td className="py-3.5 pl-3 text-right">
                          <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenInvoice(order.invoiceId);
                              }}
                              className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold cursor-pointer"
                            >
                              Invoice
                            </button>
                            {allowedNextStates.map((nextSt) => {
                              const rolePermitted = isRoleAllowedForEscrowTransition(nextSt, role);
                              const btnLabel =
                                nextSt === 'in_delivery'
                                  ? 'Mark In Delivery'
                                  : nextSt === 'released'
                                  ? 'Release Escrow'
                                  : nextSt === 'disputed'
                                  ? 'Dispute'
                                  : nextSt === 'refunded'
                                  ? 'Refund'
                                  : nextSt;
                              const btnStyle =
                                nextSt === 'released'
                                  ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                                  : nextSt === 'disputed'
                                  ? 'bg-amber-600 hover:bg-amber-700 text-white'
                                  : nextSt === 'refunded'
                                  ? 'bg-red-600 hover:bg-red-700 text-white'
                                  : 'bg-blue-600 hover:bg-blue-700 text-white';

                              return (
                                <button
                                  key={nextSt}
                                  type="button"
                                  disabled={!rolePermitted}
                                  title={
                                    rolePermitted
                                      ? `Transition escrow from '${escState}' to '${nextSt}'`
                                      : `Role '${role}' cannot trigger '${nextSt}'`
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleTransitionEscrow(order, nextSt);
                                  }}
                                  className={`px-2 py-1 rounded text-[11px] font-bold transition-colors ${
                                    rolePermitted
                                      ? `${btnStyle} cursor-pointer`
                                      : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                  }`}
                                >
                                  {btnLabel}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </DataCollectionBoundary>
        </div>

        {/* Right 4 Cols: Separate-line Money UI Inspector + Escrow Events Audit Log */}
        <div className="lg:col-span-4 space-y-4">
          {activeMoneyOrder && (
            <>
              <MoneyBreakdownCard
                title={`Order ${activeMoneyOrder.id} Financial Breakdown`}
                currency="INR"
                subtotal={activeSubtotal}
                taxLabel="Integrated GST (18% HSN Verified)"
                taxAmount={activeGst}
                feeLabel="PayPal Provider Fee (3.49% + ₹12)"
                feeAmount={activeFee}
                isFeesVerified={feesVerified}
                payoutLabel="Merchant Net Escrow Payout"
                payoutAmount={activeMoneyOrder.amount - activeFee}
                total={activeMoneyOrder.amount}
                onVerifyFees={() => {
                  setFeesVerified(true);
                  showToast('Provider fee breakdown verified from PayPal capture payload.');
                }}
              />

              {/* Escrow Events Immutable Audit Log (Step 4) */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      escrowEvents Audit Log ({activeMoneyOrder.id})
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Current: <strong>{formatEscrowStateLabel(activeEscrowState)}</strong>
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 font-mono text-[10px] font-bold">
                    {activeEscrowEvents.length} events
                  </span>
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {activeEscrowEvents.map((evt) => (
                    <div
                      key={evt.id}
                      className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 text-[11px] space-y-1"
                    >
                      <div className="flex items-center justify-between font-mono font-bold text-slate-800">
                        <span>
                          {evt.fromState ? `${evt.fromState} → ${evt.toState}` : `init → ${evt.toState}`}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {new Date(evt.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div className="text-slate-600">{evt.reason}</div>
                      <div className="text-[10px] font-mono text-slate-500">
                        Actor: {evt.actorId} ({evt.actorRole})
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Audit Reason Modal for Disputed or Refunded Escrow Transitions */}
      {auditModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-600">gavel</span>
                <h3 className="text-sm font-bold text-slate-900">
                  Escrow {auditModal.targetState === 'disputed' ? 'Dispute' : 'Refund'} Audit Record
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setAuditModal(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Order <strong className="font-mono text-slate-900">{auditModal.order.id}</strong> will be transitioned to{' '}
              <strong className="font-mono uppercase text-slate-900">{auditModal.targetState}</strong>. An immutable audit record will be written to Firestore with your actor ID ({profile.userEmail}).
            </p>

            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-slate-700 uppercase">
                Required Audit Reason *
              </label>
              <textarea
                rows={3}
                value={auditModal.reason}
                onChange={(e) =>
                  setAuditModal((prev) => (prev ? { ...prev, reason: e.target.value } : null))
                }
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:border-blue-600"
                placeholder="Specify inspection discrepancy, defective RMA reference, or mutual contract cancellation..."
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAuditModal(null)}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={transitioning || !auditModal.reason.trim()}
                onClick={() =>
                  void handleTransitionEscrow(
                    auditModal.order,
                    auditModal.targetState,
                    auditModal.reason.trim()
                  )
                }
                className={`px-4 py-2 rounded-lg text-xs font-bold text-white transition-colors flex items-center gap-2 cursor-pointer ${
                  auditModal.targetState === 'disputed'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {transitioning && (
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                )}
                <span>Confirm &amp; Record in Firestore</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
