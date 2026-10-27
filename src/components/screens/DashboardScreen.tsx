import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { formatINR } from '../../utils/finance';
import { downloadTextFile } from '../../utils/export';
import {
  PaymentStateBadge,
  MoneyBreakdownCard,
  DataCollectionBoundary,
  CanonicalPaymentState,
  CollectionViewState,
} from '../ui/HonestTrustComponents';
import { InventoryVelocityD3Widget } from '../dashboard/InventoryVelocityD3Widget';
import { useRole } from '../../context/RoleContext';
import {
  subscribeStoreOrders,
  subscribeNewOrderNotifications,
  LiveOrderNotification,
  updateStorefrontOrderEscrow,
  DEFAULT_BIZ_ID,
} from '../../services/storefrontService';
import { StorefrontOrder } from '../../types/storefront';

interface DashboardScreenProps {
  onOpenCopilot?: (query?: string) => void;
  onOpenFeeAudit?: () => void;
  onNavigateInvoice?: (invoiceId?: string) => void;
  onNavigateWebsite?: () => void;
  showToast?: (msg: string) => void;
}

export function DashboardScreen({
  onOpenCopilot,
  onOpenFeeAudit,
  onNavigateInvoice,
  onNavigateWebsite,
  showToast = console.log,
}: DashboardScreenProps) {
  const navigate = useNavigate();
  const { role, dataSource } = useRole();
  const [feesVerified, setFeesVerified] = useState(true);
  const [serverConfirmed] = useState(true);

  // 7-day Analytics Chart State
  const [activeChartMetric, setActiveChartMetric] = useState<'sales' | 'visitors' | 'conversion'>('sales');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const chartData = [
    { day: 'Mon', date: '08 May', sales: 38500, visitors: 140, conversion: 3.1 },
    { day: 'Tue', date: '09 May', sales: 42000, visitors: 165, conversion: 3.4 },
    { day: 'Wed', date: '10 May', sales: 56000, visitors: 180, conversion: 3.6 },
    { day: 'Thu', date: '11 May', sales: 68000, visitors: 210, conversion: 3.8 },
    { day: 'Fri', date: '12 May', sales: 74000, visitors: 225, conversion: 3.9 },
    { day: 'Sat', date: '13 May', sales: 112000, visitors: 260, conversion: 4.4 },
    { day: 'Sun', date: '14 May', sales: 92000, visitors: 240, conversion: 4.1 },
  ];

  // Payout State
  const [isProcessingWithdrawal, setIsProcessingWithdrawal] = useState(false);
  const [payoutSchedule, setPayoutSchedule] = useState<'daily' | 'weekly'>('daily');

  // Live Storefront Orders from Firestore + Real-time Order Toast
  const [liveOrders, setLiveOrders] = useState<StorefrontOrder[]>([]);
  const [newOrderNotice, setNewOrderNotice] = useState<string | null>(null);
  const [liveOrderToast, setLiveOrderToast] = useState<LiveOrderNotification | null>(null);
  const [volumeSeriesView, setVolumeSeriesView] = useState<'both' | 'orders' | 'settled'>('both');

  // 30-Day Order Volume Trends dataset (merges 30-day baseline with liveOrders in real time)
  const orderVolume30dData = useMemo(() => {
    const baselinePattern = [
      11, 14, 13, 16, 19, 24, 22, 14, 15, 17, 18, 21, 27, 25, 16, 18, 17, 20, 23, 29, 26, 18, 19,
      21, 22, 25, 32, 28, 21, 24,
    ];
    const now = new Date();
    const liveCountsByDate: Record<string, { count: number; settled: number; gmv: number }> = {};

    liveOrders.forEach((ord) => {
      const key = (ord.createdAt || '').slice(0, 10);
      if (!key) return;
      if (!liveCountsByDate[key]) {
        liveCountsByDate[key] = { count: 0, settled: 0, gmv: 0 };
      }
      liveCountsByDate[key].count += 1;
      if (ord.escrowStatus === 'Delivered — Escrow Released') {
        liveCountsByDate[key].settled += 1;
      }
      liveCountsByDate[key].gmv += Number(ord.total || 0);
    });

    return baselinePattern.map((baseOrders, idx) => {
      const daysAgo = 29 - idx;
      const d = new Date(now.getTime() - daysAgo * 86400000);
      const isoDate = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      const liveDelta = liveCountsByDate[isoDate] || { count: 0, settled: 0, gmv: 0 };
      const orders = baseOrders + liveDelta.count;
      const escrowSettled = Math.max(1, Math.round(baseOrders * 0.84)) + liveDelta.settled;
      const gmvInr = baseOrders * 11850 + liveDelta.gmv;

      return {
        isoDate,
        dateLabel: label,
        orders,
        escrowSettled,
        gmvInr,
      };
    });
  }, [liveOrders]);

  const volume30dStats = useMemo(() => {
    const totalOrders = orderVolume30dData.reduce((acc, d) => acc + d.orders, 0);
    const totalSettled = orderVolume30dData.reduce((acc, d) => acc + d.escrowSettled, 0);
    const avgDaily = Math.round((totalOrders / Math.max(1, orderVolume30dData.length)) * 10) / 10;
    const peakDay = orderVolume30dData.reduce(
      (best, cur) => (cur.orders > best.orders ? cur : best),
      orderVolume30dData[0]
    );
    return { totalOrders, totalSettled, avgDaily, peakDay };
  }, [orderVolume30dData]);

  // AI Seller Insights
  const [insights, setInsights] = useState<{
    id: string;
    badge: string;
    title: string;
    description: string;
    actionText: string;
    actionRoute?: string;
    metric?: string;
  }[]>([
    {
      id: 'ins-1',
      badge: 'Weekend Revenue Peak',
      title: 'Higher Weekend Engagement in Smart Hardware',
      description:
        'Your category sees 38% higher conversion rates on Saturday and Sunday. Scheduling a 10% flash coupon PILOT10 captures high-intent shoppers.',
      actionText: 'Manage Promo Codes',
      metric: '+28% Target GMV',
    },
    {
      id: 'ins-2',
      badge: 'Escrow Conversion Booster',
      title: '100% Escrow Protection Builds Shopper Trust',
      description:
        'Storefront visitors who see the PayPal Escrow guarantee banner convert 42% faster on first checkout.',
      actionText: 'Customize Announcement Bar',
      metric: '+42% Trust Index',
    },
  ]);

  // Low stock items
  const [lowStockItems, setLowStockItems] = useState([
    { sku: 'FAN-BLDC-892', name: 'AeroBreeze 1200mm Smart BLDC Fan', stock: 12, minStock: 25 },
    { sku: 'SPO-YNX-99P', name: 'Yonex Astrox 99 Pro Carbon Racket', stock: 6, minStock: 15 },
    { sku: 'AUD-ANC-99', name: 'AcousticSphere ANC Spatial Earbuds', stock: 8, minStock: 20 },
  ]);

  // Subscribe to live storefront orders & real-time customer order notifications
  useEffect(() => {
    const unsubOrders = subscribeStoreOrders(DEFAULT_BIZ_ID, (orders) => {
      setLiveOrders(orders);
    });

    let toastTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubNewOrder = subscribeNewOrderNotifications(DEFAULT_BIZ_ID, (notif) => {
      setLiveOrderToast(notif);
      setNewOrderNotice(
        `New order ${notif.orderNumber} placed by ${notif.customerName} (${formatINR(notif.totalInr)})`
      );
      if (notif.rawOrder) {
        setLiveOrders((prev) => {
          if (
            prev.some(
              (o) => o.id === notif.rawOrder!.id || o.orderNumber === notif.rawOrder!.orderNumber
            )
          ) {
            return prev;
          }
          return [notif.rawOrder!, ...prev];
        });
      }
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        setLiveOrderToast((current) => (current?.id === notif.id ? null : current));
      }, 7000);
    });

    // Fetch AI insights from server
    fetch(`/api/ai/seller-insights?businessName=AeroCool%20Dynamics&category=Smart%20Hardware&ordersCount=14&gmv=₹4,82,500`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.insights) {
          setInsights(data.insights);
        }
      })
      .catch(() => {});

    return () => {
      unsubOrders();
      unsubNewOrder();
      if (toastTimer) clearTimeout(toastTimer);
    };
  }, []);

  // Compute live escrow totals
  const escrowHeldTotal = liveOrders
    .filter((o) => o.escrowStatus === 'Escrow Locked')
    .reduce((acc, o) => acc + o.total, 0);

  const escrowInTransitTotal = liveOrders
    .filter((o) => o.escrowStatus === 'In Transit')
    .reduce((acc, o) => acc + o.total, 0);

  const escrowReleasedTotal = liveOrders
    .filter((o) => o.escrowStatus === 'Delivered — Escrow Released')
    .reduce((acc, o) => acc + o.total, 0);

  const escrowDisputedOrders = liveOrders.filter((o) => o.escrowStatus === 'Disputed');
  const escrowDisputedLiveTotal = escrowDisputedOrders.reduce((acc, o) => acc + o.total, 0);

  // Global Escrow Health Widget State: Supplemental Flagged Disputes & Pending Releases for Rapid Resolution
  const [escrowHealthTab, setEscrowHealthTab] = useState<'all' | 'disputes' | 'pending_releases' | 'held'>('all');
  const [flaggedDisputes, setFlaggedDisputes] = useState<
    {
      id: string;
      orderNumber: string;
      customerName: string;
      productName: string;
      amountInr: number;
      reason: string;
      severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
      slaRemaining: string;
      carrierRef: string;
      status: 'OPEN' | 'RESOLVED_RELEASED' | 'RESOLVED_REFUNDED';
      sourceOrderId?: string;
    }[]
  >([
    {
      id: 'DSP-9041',
      orderNumber: 'ORD-AC-8841',
      customerName: 'Rohan Malhotra',
      productName: 'ProArt Studio Workstation X1',
      amountInr: 42500,
      reason: 'Buyer reported outer carton tamper — awaiting carrier POD signature verification',
      severity: 'CRITICAL',
      slaRemaining: '3h 40m left',
      carrierRef: 'BD-AIR-7749201',
      status: 'OPEN',
    },
    {
      id: 'DSP-9044',
      orderNumber: 'ORD-AC-8836',
      customerName: 'Meera Krishnan',
      productName: 'AeroBreeze 1200mm Smart BLDC Fan (x2)',
      amountInr: 16998,
      reason: 'Delivery scan mismatch at Bengaluru hub — auto-hold triggered by Escrow Sentinel',
      severity: 'HIGH',
      slaRemaining: '9h 15m left',
      carrierRef: 'DLV-EXP-449102',
      status: 'OPEN',
    },
  ]);

  const [supplementalPendingReleases, setSupplementalPendingReleases] = useState<
    {
      id: string;
      orderNumber: string;
      customerName: string;
      productName: string;
      amountInr: number;
      carrierStatus: string;
      etaLabel: string;
      released: boolean;
    }[]
  >([
    {
      id: 'REL-701',
      orderNumber: 'ORD-AC-8849',
      customerName: 'Karthik Sundaram',
      productName: 'UltraSharp 32" 6K Reference Display',
      amountInr: 34900,
      carrierStatus: 'BlueDart POD Signed • Buyer 24h window complete',
      etaLabel: 'Ready for immediate release',
      released: false,
    },
    {
      id: 'REL-702',
      orderNumber: 'ORD-AC-8852',
      customerName: 'Siddharth Verma',
      productName: 'Yonex Astrox 99 Pro Carbon Racket',
      amountInr: 14990,
      carrierStatus: 'Delhivery OTP Verified at doorstep',
      etaLabel: 'Ready for immediate release',
      released: false,
    },
  ]);

  // Global Escrow Health Aggregated Metrics
  const globalEscrowMetrics = useMemo(() => {
    const heldOrders = liveOrders.filter((o) => o.escrowStatus === 'Escrow Locked');
    const inTransitOrders = liveOrders.filter((o) => o.escrowStatus === 'In Transit');
    const releasedOrders = liveOrders.filter((o) => o.escrowStatus === 'Delivered — Escrow Released');
    const liveDisputed = liveOrders.filter((o) => o.escrowStatus === 'Disputed');

    const activeSupplementalDisputes = flaggedDisputes.filter((d) => d.status === 'OPEN');
    const resolvedReleasedDisputesInr = flaggedDisputes
      .filter((d) => d.status === 'RESOLVED_RELEASED')
      .reduce((acc, d) => acc + d.amountInr, 0);

    const activeSupplementalPending = supplementalPendingReleases.filter((r) => !r.released);
    const releasedSupplementalInr = supplementalPendingReleases
      .filter((r) => r.released)
      .reduce((acc, r) => acc + r.amountInr, 0);

    const heldVolumeInr = (heldOrders.reduce((s, o) => s + o.total, 0) || 84990);
    const pendingReleaseVolumeInr =
      inTransitOrders.reduce((s, o) => s + o.total, 0) +
      activeSupplementalPending.reduce((s, r) => s + r.amountInr, 0);
    const disputedVolumeInr =
      liveDisputed.reduce((s, o) => s + o.total, 0) +
      activeSupplementalDisputes.reduce((s, d) => s + d.amountInr, 0);
    const releasedVolumeInr =
      (releasedOrders.reduce((s, o) => s + o.total, 0) || 345110) +
      resolvedReleasedDisputesInr +
      releasedSupplementalInr;

    const totalManagedVolumeInr =
      heldVolumeInr + pendingReleaseVolumeInr + disputedVolumeInr + releasedVolumeInr;

    const totalActiveDisputeCount = liveDisputed.length + activeSupplementalDisputes.length;
    const totalPendingReleaseCount = inTransitOrders.length + activeSupplementalPending.length;
    const totalHeldCount = Math.max(heldOrders.length, 3);

    // Health score: starts at 98, penalizes active dispute volume ratio & count
    const disputeRatioPct =
      totalManagedVolumeInr > 0 ? (disputedVolumeInr / totalManagedVolumeInr) * 100 : 0;
    const healthScore = Math.max(
      62,
      Math.min(100, Math.round(100 - disputeRatioPct * 1.4 - totalActiveDisputeCount * 3))
    );

    return {
      heldVolumeInr,
      pendingReleaseVolumeInr,
      disputedVolumeInr,
      releasedVolumeInr,
      totalManagedVolumeInr,
      totalActiveDisputeCount,
      totalPendingReleaseCount,
      totalHeldCount,
      disputeRatioPct,
      healthScore,
      heldOrders,
      inTransitOrders,
      liveDisputed,
      activeSupplementalDisputes,
      activeSupplementalPending,
    };
  }, [liveOrders, flaggedDisputes, supplementalPendingReleases]);

  // Rapid Resolution Handlers for Global Escrow Health Widget
  const handleRapidResolveDispute = async (
    disputeId: string,
    resolution: 'RESOLVED_RELEASED' | 'RESOLVED_REFUNDED',
    sourceOrderId?: string
  ) => {
    setFlaggedDisputes((prev) =>
      prev.map((d) => (d.id === disputeId ? { ...d, status: resolution } : d))
    );
    if (sourceOrderId) {
      const nextStatus: StorefrontOrder['escrowStatus'] =
        resolution === 'RESOLVED_RELEASED' ? 'Delivered — Escrow Released' : 'Escrow Locked';
      await updateStorefrontOrderEscrow(DEFAULT_BIZ_ID, sourceOrderId, nextStatus);
    }
    showToast(
      resolution === 'RESOLVED_RELEASED'
        ? `Dispute ${disputeId} resolved: Carrier POD verified & escrow funds released to seller balance.`
        : `Dispute ${disputeId} resolved: Buyer refund authorized from escrow reserve.`
    );
  };

  const handleRapidReleasePending = (releaseId: string) => {
    setSupplementalPendingReleases((prev) =>
      prev.map((r) => (r.id === releaseId ? { ...r, released: true } : r))
    );
    showToast(`Pending release ${releaseId} verified and swept to settlement balance.`);
  };

  const handleBatchReleaseAllPending = async () => {
    setSupplementalPendingReleases((prev) => prev.map((r) => ({ ...r, released: true })));
    const inTransit = liveOrders.filter((o) => o.escrowStatus === 'In Transit');
    for (const ord of inTransit) {
      await updateStorefrontOrderEscrow(DEFAULT_BIZ_ID, ord.id, 'Delivered — Escrow Released');
    }
    showToast('All verified pending releases swept into available settlement balance!');
  };

  // Escrow status change action
  const handleUpdateOrderStatus = async (
    orderId: string,
    newStatus: StorefrontOrder['escrowStatus']
  ) => {
    try {
      await updateStorefrontOrderEscrow(DEFAULT_BIZ_ID, orderId, newStatus);
      showToast(`Order ${orderId} updated to "${newStatus}"!`);
    } catch {
      showToast('Failed to update order status');
    }
  };

  // Restock action
  const handleRestock = (sku: string) => {
    setLowStockItems((prev) =>
      prev.map((item) => (item.sku === sku ? { ...item, stock: item.stock + 20 } : item))
    );
    showToast(`Restocked +20 units for SKU ${sku}`);
  };

  // Export CSV
  const handleExportCSV = () => {
    const headers = ['Order ID', 'Customer', 'Date', 'Total', 'Escrow Status', 'Tracking'];
    const rows = liveOrders.map((o) => [
      o.orderNumber,
      o.customerName,
      o.createdAt,
      o.total,
      o.escrowStatus,
      o.trackingId,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    downloadTextFile('storefront-orders.csv', csvContent);
    showToast('Exported storefront orders CSV.');
  };

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto animate-fade-in">
      {/* Subtle Real-Time Seller Toast Notification (triggers when a customer places an order) */}
      {liveOrderToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-20 right-6 z-50 w-full max-w-sm rounded-2xl bg-surface/95 backdrop-blur-md border border-emerald-500/30 shadow-lg p-4 transition-all duration-300"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="mt-0.5 w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                    New Customer Order
                  </span>
                  <span className="text-[11px] font-mono font-semibold text-on-surface-variant">
                    {liveOrderToast.orderNumber}
                  </span>
                </div>
                <p className="text-xs font-bold text-on-surface truncate">
                  {liveOrderToast.customerName}
                </p>
                <p className="text-[11px] text-on-surface-variant truncate">
                  {liveOrderToast.productSummary} •{' '}
                  <span className="font-bold text-on-surface font-tabular-nums">
                    {formatINR(liveOrderToast.totalInr)}
                  </span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLiveOrderToast(null)}
              aria-label="Dismiss order notification"
              className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg hover:bg-surface-container transition-colors shrink-0"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
          <div className="mt-3 pt-2.5 border-t border-outline-variant/20 flex items-center justify-between text-[11px]">
            <span className="text-emerald-700 font-medium flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">lock</span>
              <span>{liveOrderToast.escrowStatus}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setLiveOrderToast(null);
                navigate('/seller/orders');
              }}
              className="font-bold text-primary hover:underline flex items-center gap-1"
            >
              <span>View in Orders</span>
              <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </button>
          </div>
        </div>
      )}

      {/* Top Welcome & Storefront Status Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-surface-container-low via-surface-container to-surface-container-low border border-outline-variant/30 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl lg:text-2xl font-black text-on-surface tracking-tight">
              Seller Command Center
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 text-xs font-bold flex items-center gap-1 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Multi-Tenant Live</span>
            </span>
          </div>
          <p className="text-xs text-on-surface-variant leading-relaxed">
            Real-time business bundle: Seller Portal synced with customer storefront at{' '}
            <a
              href="/s/aerocool"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary font-semibold underline"
            >
              aerocool.acpaypilot.app
            </a>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => onNavigateWebsite && onNavigateWebsite()}
            className="px-4 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold hover:bg-primary/90 transition-all shadow-sm flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">edit_square</span>
            <span>Open Storefront Builder</span>
          </button>

          <a
            href="/s/aerocool"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2.5 rounded-xl bg-surface border border-outline-variant text-xs font-bold text-on-surface hover:bg-surface-container flex items-center gap-1.5 transition-colors"
          >
            <span>View Public Storefront</span>
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
          </a>
        </div>
      </div>

      {/* Real-time Order Notification Inline Strip */}
      {newOrderNotice && (
        <div className="px-4 py-3 rounded-xl bg-emerald-500/5 border border-emerald-500/25 flex items-center justify-between transition-all">
          <div className="flex items-center gap-2.5 text-xs font-semibold text-on-surface">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>{newOrderNotice}</span>
          </div>
          <button
            onClick={() => setNewOrderNotice(null)}
            className="text-xs font-medium text-on-surface-variant hover:text-on-surface"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 4 PRIMARY E-COMMERCE METRICS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Total Storefront Sales',
            value: '₹4,82,500',
            sub: '+24.5% vs last month',
            icon: 'payments',
            trend: 'up',
          },
          {
            label: 'Unique Store Visitors',
            value: '1,420',
            sub: 'Across desktop & mobile',
            icon: 'visibility',
            trend: 'up',
          },
          {
            label: 'Storefront Conversion Rate',
            value: '3.8%',
            sub: 'Benchmark for hardware is 2.4%',
            icon: 'shopping_bag',
            trend: 'up',
          },
          {
            label: 'Average Order Value (AOV)',
            value: '₹12,450',
            sub: 'Zero commission escrow settlement',
            icon: 'analytics',
            trend: 'neutral',
          },
        ].map((metric, idx) => (
          <div
            key={idx}
            className="p-5 rounded-2xl bg-surface-container-low border border-outline-variant/30 flex items-center justify-between shadow-sm"
          >
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                {metric.label}
              </span>
              <h3 className="text-2xl font-black text-on-surface font-tabular-nums">
                {metric.value}
              </h3>
              <p className="text-[11px] text-emerald-600 font-medium">{metric.sub}</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-surface flex items-center justify-center text-primary border border-outline-variant/30">
              <span className="material-symbols-outlined text-[24px]">{metric.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* D3 SMARTCART INVENTORY VELOCITY DASHBOARD WIDGET */}
      <InventoryVelocityD3Widget
        showToast={showToast}
        onNavigateProducts={() => navigate('/seller/products')}
      />

      {/* PERFORMANCE CHARTS & PAYOUT SUMMARY ROW */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 8 Cols: Interactive 7-Day Performance Trends Chart */}
        <div className="lg:col-span-8 p-6 rounded-2xl bg-surface border border-outline-variant/30 shadow-sm space-y-5 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">show_chart</span>
                <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider">
                  Storefront Performance Analytics
                </h3>
              </div>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Real-time 7-day sales velocity, traffic, and checkout conversion rate
              </p>
            </div>

            {/* Metric Switcher Tabs */}
            <div className="flex items-center gap-1 bg-surface-container-low p-1 rounded-xl border border-outline-variant/30 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => {
                  setActiveChartMetric('sales');
                  setHoveredIndex(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeChartMetric === 'sales'
                    ? 'bg-primary text-on-primary shadow-xs'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Revenue (₹)
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveChartMetric('visitors');
                  setHoveredIndex(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeChartMetric === 'visitors'
                    ? 'bg-primary text-on-primary shadow-xs'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Visitors
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveChartMetric('conversion');
                  setHoveredIndex(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeChartMetric === 'conversion'
                    ? 'bg-primary text-on-primary shadow-xs'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Conversion (%)
              </button>
            </div>
          </div>

          {/* SVG Chart Graphic */}
          <div className="relative pt-2">
            {(() => {
              const maxVal =
                activeChartMetric === 'sales'
                  ? 120000
                  : activeChartMetric === 'visitors'
                  ? 300
                  : 5.0;

              const getVal = (d: (typeof chartData)[0]) =>
                activeChartMetric === 'sales'
                  ? d.sales
                  : activeChartMetric === 'visitors'
                  ? d.visitors
                  : d.conversion;

              const formatVal = (v: number) =>
                activeChartMetric === 'sales'
                  ? formatINR(v)
                  : activeChartMetric === 'visitors'
                  ? `${v} visits`
                  : `${v.toFixed(1)}%`;

              const points = chartData.map((d, i) => {
                const x = 45 + i * 85;
                const y = 150 - (getVal(d) / maxVal) * 125;
                return { x, y, data: d, val: getVal(d) };
              });

              const pathD = points.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`, '');
              const areaD = `${pathD} L ${points[points.length - 1].x},150 L ${points[0].x},150 Z`;

              return (
                <div className="space-y-3">
                  <div className="overflow-x-auto">
                    <svg viewBox="0 0 580 180" className="w-full h-48 select-none">
                      <defs>
                        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#004ac6" stopOpacity="0.28" />
                          <stop offset="100%" stopColor="#004ac6" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>

                      {/* Horizontal Gridlines */}
                      {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => {
                        const y = 150 - pct * 125;
                        const labelVal = pct * maxVal;
                        return (
                          <g key={idx}>
                            <line
                              x1="45"
                              y1={y}
                              x2="555"
                              y2={y}
                              stroke="currentColor"
                              strokeOpacity="0.08"
                              strokeDasharray="4 4"
                            />
                            <text
                              x="38"
                              y={y + 3}
                              textAnchor="end"
                              className="text-[9px] fill-current text-secondary font-mono"
                            >
                              {activeChartMetric === 'sales'
                                ? `₹${(labelVal / 1000).toFixed(0)}k`
                                : activeChartMetric === 'visitors'
                                ? labelVal.toFixed(0)
                                : `${labelVal.toFixed(1)}%`}
                            </text>
                          </g>
                        );
                      })}

                      {/* Area Fill */}
                      <path d={areaD} fill="url(#chartGradient)" />

                      {/* Line Path */}
                      <path
                        d={pathD}
                        fill="none"
                        stroke="#004ac6"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />

                      {/* Data Point Circles */}
                      {points.map((p, i) => {
                        const isHovered = hoveredIndex === i;
                        return (
                          <g
                            key={i}
                            className="cursor-pointer group"
                            onMouseEnter={() => setHoveredIndex(i)}
                            onMouseLeave={() => setHoveredIndex(null)}
                          >
                            <circle
                              cx={p.x}
                              cy={p.y}
                              r={isHovered ? 6 : 4}
                              className={`transition-all ${
                                isHovered
                                  ? 'fill-primary stroke-white stroke-2'
                                  : 'fill-white stroke-primary stroke-2'
                              }`}
                            />
                            {/* X-axis Day Label */}
                            <text
                              x={p.x}
                              y="168"
                              textAnchor="middle"
                              className={`text-[10px] font-bold ${
                                isHovered ? 'fill-primary' : 'fill-secondary'
                              }`}
                            >
                              {p.data.day}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>

                  {/* Active Point Details or Weekend Surge Highlight */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs">
                    {hoveredIndex !== null ? (
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-on-surface">
                          {chartData[hoveredIndex].date} ({chartData[hoveredIndex].day}):
                        </span>
                        <span className="font-mono font-bold text-primary">
                          {formatVal(getVal(chartData[hoveredIndex]))}
                        </span>
                        <span className="text-[11px] text-secondary">
                          • {chartData[hoveredIndex].visitors} visitors •{' '}
                          {chartData[hoveredIndex].conversion}% conv
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-on-surface">
                        <span className="material-symbols-outlined text-[18px] text-amber-500">
                          tips_and_updates
                        </span>
                        <span>
                          <strong className="text-on-surface">Weekend Surge Detected:</strong> Sat &amp; Sun generated{' '}
                          <strong className="text-emerald-700">₹2,04,000</strong> (42.3% of 7-day sales) with an average 4.25% conversion rate.
                        </span>
                      </div>
                    )}

                    <span className="text-[11px] font-semibold text-emerald-600 self-end sm:self-auto shrink-0">
                      +18.4% WoW Velocity
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* 30-Day Order Volume Trends (Recharts LineChart) */}
          <div className="pt-5 border-t border-outline-variant/25 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-on-surface tracking-tight">
                  30-Day Order Volume Trends
                </h4>
                <p className="text-xs text-on-surface-variant mt-0.5 font-tabular-nums">
                  <span>{volume30dStats.totalOrders} total orders</span>
                  <span aria-hidden="true"> · </span>
                  <span>{volume30dStats.avgDaily} avg/day</span>
                  <span aria-hidden="true"> · </span>
                  <span>
                    Peak {volume30dStats.peakDay?.orders} orders ({volume30dStats.peakDay?.dateLabel})
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-1 bg-surface-container-low p-1 rounded-xl border border-outline-variant/30 self-start sm:self-auto">
                {(
                  [
                    { id: 'both', label: 'All Series' },
                    { id: 'orders', label: 'Total Orders' },
                    { id: 'settled', label: 'Escrow Settled' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setVolumeSeriesView(tab.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      volumeSeriesView === tab.id
                        ? 'bg-surface text-on-surface shadow-xs border border-outline-variant/30'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-64 w-full" data-testid="order-volume-30d-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={orderVolume30dData}
                  margin={{ top: 10, right: 16, left: -12, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.2)" vertical={false} />
                  <XAxis
                    dataKey="dateLabel"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(148, 163, 184, 0.25)' }}
                    interval={4}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const row = payload[0]?.payload as (typeof orderVolume30dData)[0];
                      return (
                        <div className="rounded-xl bg-surface/95 backdrop-blur-md border border-outline-variant/40 shadow-md px-3.5 py-2.5 text-xs space-y-1 font-tabular-nums">
                          <div className="font-bold text-on-surface">{label}</div>
                          <div className="flex items-center justify-between gap-4 text-on-surface-variant">
                            <span>Orders Placed:</span>
                            <span className="font-mono font-bold text-primary">{row.orders}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4 text-on-surface-variant">
                            <span>Escrow Settled:</span>
                            <span className="font-mono font-bold text-emerald-600">
                              {row.escrowSettled}
                            </span>
                          </div>
                          <div className="pt-1 border-t border-outline-variant/20 flex items-center justify-between gap-4 text-on-surface-variant">
                            <span>Daily GMV:</span>
                             <span className="font-mono font-semibold text-on-surface">
                               {formatINR(row.gmvInr)}
                             </span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <ReferenceLine
                    y={volume30dStats.avgDaily}
                    stroke="#94a3b8"
                    strokeDasharray="4 4"
                  />
                  {(volumeSeriesView === 'both' || volumeSeriesView === 'orders') && (
                    <Line
                      type="monotone"
                      dataKey="orders"
                      name="Orders Placed"
                      stroke="#004ac6"
                      strokeWidth={2.5}
                      dot={{ r: 2.5, fill: '#004ac6', strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: '#004ac6', stroke: '#ffffff', strokeWidth: 2 }}
                    />
                  )}
                  {(volumeSeriesView === 'both' || volumeSeriesView === 'settled') && (
                    <Line
                      type="monotone"
                      dataKey="escrowSettled"
                      name="Escrow Settled"
                      stroke="#059669"
                      strokeWidth={2}
                      strokeDasharray="5 3"
                      dot={false}
                      activeDot={{ r: 4, fill: '#059669', stroke: '#ffffff', strokeWidth: 2 }}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Right 4 Cols: PayPal Settlement & Payout Summary */}
        <div className="lg:col-span-4 p-6 rounded-2xl bg-surface border border-outline-variant/30 shadow-sm flex flex-col justify-start gap-4 min-w-0">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">account_balance</span>
                <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider">
                  Payout &amp; Settlement
                </h3>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 text-[10px] font-bold border border-emerald-500/20">
                Auto-Sweep Active
              </span>
            </div>

            <p className="text-xs text-on-surface-variant leading-relaxed">
              Autonomous daily transfers from PayPal Sandbox business balance to linked Indian bank account.
            </p>

            <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/30 space-y-2">
              <span className="text-[10px] uppercase font-bold text-secondary block">
                Available Withdrawable Balance
              </span>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-black text-on-surface font-tabular-nums">
                  {formatINR(345110)}
                </span>
                <span className="text-xs text-emerald-600 font-bold">100% Cleared</span>
              </div>
              <div className="flex justify-between items-center text-[11px] pt-1 border-t border-outline-variant/20 text-on-surface-variant">
                <span>In Escrow Transit Hold:</span>
                <span className="font-mono font-bold text-amber-700">{formatINR(84990)}</span>
              </div>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between py-1 border-b border-outline-variant/20">
                <span className="text-secondary">Next Scheduled Payout:</span>
                <span className="font-semibold text-on-surface">Tomorrow, 10:00 AM IST</span>
              </div>
              <div className="flex justify-between py-1 border-b border-outline-variant/20">
                <span className="text-secondary">Connected Gateway:</span>
                <span className="font-semibold text-primary font-mono text-[11px]">seller-sandbox@aerocool.io</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-secondary">Settlement Account:</span>
                <span className="font-semibold text-on-surface">HDFC Bank (•••• 4092)</span>
              </div>
            </div>
          </div>

          <div className="pt-2 space-y-2">
            <button
              type="button"
              disabled={isProcessingWithdrawal}
              onClick={() => {
                setIsProcessingWithdrawal(true);
                setTimeout(() => {
                  setIsProcessingWithdrawal(false);
                  showToast('⚡ Instant payout of ₹3,45,110 queued to HDFC Bank A/C •••• 4092 via PayPal Gateway.');
                }, 1000);
              }}
              className="w-full py-2.5 rounded-xl bg-[#003087] hover:bg-[#00256b] text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">bolt</span>
              <span>{isProcessingWithdrawal ? 'Transmitting Payout...' : 'Instant Payout (₹3,45,110)'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const next = payoutSchedule === 'daily' ? 'weekly' : 'daily';
                setPayoutSchedule(next);
                showToast(`Payout frequency updated to ${next.toUpperCase()} auto-sweep.`);
              }}
              className="w-full py-2 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface font-semibold text-xs border border-outline-variant/30 flex items-center justify-center gap-1 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">schedule</span>
              <span>Schedule: {payoutSchedule === 'daily' ? 'Daily Auto-Sweep' : 'Weekly Batch'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* GLOBAL ESCROW HEALTH WIDGET */}
      <div
        data-testid="global-escrow-health-widget"
        className="p-6 rounded-2xl bg-surface border border-outline-variant/30 shadow-sm space-y-6"
      >
        {/* Widget Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-outline-variant/25">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-[20px]">health_metrics</span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-black text-on-surface tracking-tight">
                    Global Escrow Health
                  </h2>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border inline-flex items-center gap-1 ${
                      globalEscrowMetrics.healthScore >= 90
                        ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/25'
                        : globalEscrowMetrics.healthScore >= 80
                        ? 'bg-amber-500/10 text-amber-700 border-amber-500/25'
                        : 'bg-rose-500/10 text-rose-700 border-rose-500/25'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                    <span>Health Score: {globalEscrowMetrics.healthScore}/100</span>
                  </span>
                </div>
                <p className="text-xs text-on-surface-variant">
                  Real-time aggregation of funds locked in escrow, verified pending releases, and flagged disputes for rapid resolution
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {globalEscrowMetrics.totalPendingReleaseCount > 0 && (
              <button
                type="button"
                onClick={handleBatchReleaseAllPending}
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">task_alt</span>
                <span>
                  Release All Verified ({globalEscrowMetrics.totalPendingReleaseCount})
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate('/seller/command-center')}
              className="px-3.5 py-2 rounded-xl bg-surface-container-low hover:bg-surface-container border border-outline-variant/40 text-xs font-bold text-on-surface flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">space_dashboard</span>
              <span>Open AG Studio Ops</span>
            </button>
          </div>
        </div>

        {/* 4 Aggregated Pillar Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. Total Funds Held in Escrow */}
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/25 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
                Funds Held in Escrow
              </span>
              <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-900 font-mono text-[10px] font-bold">
                {globalEscrowMetrics.totalHeldCount} Active Locks
              </span>
            </div>
            <div className="text-2xl font-black text-amber-950 font-tabular-nums">
              {formatINR(globalEscrowMetrics.heldVolumeInr)}
            </div>
            <div className="flex items-center justify-between text-[11px] text-amber-900/80 pt-1 border-t border-amber-500/20">
              <span>Vault Protection: 100%</span>
              <span className="font-mono font-semibold">Avg Hold: 1.8d</span>
            </div>
          </div>

          {/* 2. Pending Releases */}
          <div className="p-4 rounded-xl bg-sky-500/10 border border-sky-500/25 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-sky-800">
                Pending Releases
              </span>
              <span className="px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-900 font-mono text-[10px] font-bold">
                {globalEscrowMetrics.totalPendingReleaseCount} Ready / Transit
              </span>
            </div>
            <div className="text-2xl font-black text-sky-950 font-tabular-nums">
              {formatINR(globalEscrowMetrics.pendingReleaseVolumeInr)}
            </div>
            <div className="flex items-center justify-between text-[11px] text-sky-900/80 pt-1 border-t border-sky-500/20">
              <span>POD Auto-Release Queue</span>
              <button
                type="button"
                onClick={() => setEscrowHealthTab('pending_releases')}
                className="font-bold underline hover:text-sky-950 cursor-pointer"
              >
                Inspect Queue
              </button>
            </div>
          </div>

          {/* 3. Flagged Disputes (Rapid Resolution) */}
          <div
            className={`p-4 rounded-xl border space-y-2 ${
              globalEscrowMetrics.totalActiveDisputeCount > 0
                ? 'bg-rose-500/10 border-rose-500/30'
                : 'bg-emerald-500/10 border-emerald-500/25'
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-[11px] font-bold uppercase tracking-wider ${
                  globalEscrowMetrics.totalActiveDisputeCount > 0
                    ? 'text-rose-800'
                    : 'text-emerald-800'
                }`}
              >
                Flagged Disputes
              </span>
              <span
                className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold ${
                  globalEscrowMetrics.totalActiveDisputeCount > 0
                    ? 'bg-rose-500/20 text-rose-900'
                    : 'bg-emerald-500/20 text-emerald-900'
                }`}
              >
                {globalEscrowMetrics.totalActiveDisputeCount} Flagged
              </span>
            </div>
            <div
              className={`text-2xl font-black font-tabular-nums ${
                globalEscrowMetrics.totalActiveDisputeCount > 0
                  ? 'text-rose-950'
                  : 'text-emerald-950'
              }`}
            >
              {formatINR(globalEscrowMetrics.disputedVolumeInr)}
            </div>
            <div
              className={`flex items-center justify-between text-[11px] pt-1 border-t ${
                globalEscrowMetrics.totalActiveDisputeCount > 0
                  ? 'border-rose-500/20 text-rose-900/80'
                  : 'border-emerald-500/20 text-emerald-900/80'
              }`}
            >
              <span>Dispute Exposure: {globalEscrowMetrics.disputeRatioPct.toFixed(1)}%</span>
              <button
                type="button"
                onClick={() => setEscrowHealthTab('disputes')}
                className="font-bold underline cursor-pointer"
              >
                Rapid Resolve
              </button>
            </div>
          </div>

          {/* 4. Settled & Released Volume */}
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                Released to Settlement
              </span>
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-900 font-mono text-[10px] font-bold">
                Verified POD
              </span>
            </div>
            <div className="text-2xl font-black text-emerald-950 font-tabular-nums">
              {formatINR(globalEscrowMetrics.releasedVolumeInr)}
            </div>
            <div className="flex items-center justify-between text-[11px] text-emerald-900/80 pt-1 border-t border-emerald-500/20">
              <span>Total Escrow Pool</span>
              <span className="font-mono font-bold">
                {formatINR(globalEscrowMetrics.totalManagedVolumeInr)}
              </span>
            </div>
          </div>
        </div>

        {/* Proportional Escrow Capital Allocation Bar */}
        {(() => {
          const total = Math.max(1, globalEscrowMetrics.totalManagedVolumeInr);
          const heldPct = (globalEscrowMetrics.heldVolumeInr / total) * 100;
          const pendingPct = (globalEscrowMetrics.pendingReleaseVolumeInr / total) * 100;
          const disputedPct = (globalEscrowMetrics.disputedVolumeInr / total) * 100;
          const releasedPct = Math.max(0, 100 - heldPct - pendingPct - disputedPct);

          return (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between text-xs gap-2">
                <span className="font-bold text-on-surface">
                  Global Escrow Capital Distribution
                </span>
                <div className="flex flex-wrap items-center gap-4 text-[11px] font-medium text-on-surface-variant font-tabular-nums">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" />
                    <span>Released ({releasedPct.toFixed(1)}%)</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" />
                    <span>Held in Escrow ({heldPct.toFixed(1)}%)</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-sky-500 inline-block" />
                    <span>Pending Release ({pendingPct.toFixed(1)}%)</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-rose-500 inline-block" />
                    <span>Disputed ({disputedPct.toFixed(1)}%)</span>
                  </span>
                </div>
              </div>
              <div className="h-3 w-full rounded-full bg-surface-container overflow-hidden flex border border-outline-variant/30">
                <div
                  style={{ width: `${releasedPct}%` }}
                  className="bg-emerald-500 transition-all duration-500"
                  title={`Released: ${formatINR(globalEscrowMetrics.releasedVolumeInr)}`}
                />
                <div
                  style={{ width: `${heldPct}%` }}
                  className="bg-amber-500 transition-all duration-500"
                  title={`Held in Escrow: ${formatINR(globalEscrowMetrics.heldVolumeInr)}`}
                />
                <div
                  style={{ width: `${pendingPct}%` }}
                  className="bg-sky-500 transition-all duration-500"
                  title={`Pending Release: ${formatINR(globalEscrowMetrics.pendingReleaseVolumeInr)}`}
                />
                <div
                  style={{ width: `${disputedPct}%` }}
                  className="bg-rose-500 transition-all duration-500"
                  title={`Flagged Disputes: ${formatINR(globalEscrowMetrics.disputedVolumeInr)}`}
                />
              </div>
            </div>
          );
        })()}

        {/* Rapid Resolution & Queue Filter Tabs */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1 bg-surface-container-low p-1 rounded-xl border border-outline-variant/30 self-start">
              {(
                [
                  {
                    id: 'all',
                    label: `All Actionable (${
                      globalEscrowMetrics.totalActiveDisputeCount +
                      globalEscrowMetrics.totalPendingReleaseCount
                    })`,
                  },
                  {
                    id: 'disputes',
                    label: `Flagged Disputes (${globalEscrowMetrics.totalActiveDisputeCount})`,
                  },
                  {
                    id: 'pending_releases',
                    label: `Pending Releases (${globalEscrowMetrics.totalPendingReleaseCount})`,
                  },
                  {
                    id: 'held',
                    label: `Escrow Locked (${globalEscrowMetrics.heldOrders.length})`,
                  },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setEscrowHealthTab(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    escrowHealthTab === tab.id
                      ? 'bg-primary text-on-primary shadow-xs'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <span className="text-[11px] text-on-surface-variant">
              Instant resolution updates Firestore escrow state &amp; PayPal settlement queue
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Flagged Disputes Rapid Resolution Column */}
            {(escrowHealthTab === 'all' || escrowHealthTab === 'disputes') && (
              <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-rose-600 text-[18px]">
                      gpp_maybe
                    </span>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface">
                      Flagged Disputes — Rapid Resolution Queue
                    </h3>
                  </div>
                  <span className="text-[11px] font-mono font-semibold text-rose-700">
                    {globalEscrowMetrics.totalActiveDisputeCount} Open
                  </span>
                </div>

                {globalEscrowMetrics.activeSupplementalDisputes.length === 0 &&
                globalEscrowMetrics.liveDisputed.length === 0 ? (
                  <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-xs text-emerald-800 flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-emerald-600 text-[18px]">
                      verified
                    </span>
                    <span>
                      All flagged escrow disputes have been resolved! Zero funds currently at risk.
                    </span>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {globalEscrowMetrics.activeSupplementalDisputes.map((dsp) => (
                      <div
                        key={dsp.id}
                        className="p-3.5 rounded-xl bg-surface border border-rose-500/25 space-y-2.5 shadow-2xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                  dsp.severity === 'CRITICAL'
                                    ? 'bg-rose-600 text-white'
                                    : 'bg-amber-500/20 text-amber-900'
                                }`}
                              >
                                {dsp.severity}
                              </span>
                              <span className="font-mono text-xs font-bold text-primary">
                                {dsp.orderNumber}
                              </span>
                              <span className="text-[11px] text-on-surface-variant">
                                • {dsp.customerName}
                              </span>
                            </div>
                            <p className="text-xs font-bold text-on-surface mt-1">
                              {dsp.productName}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-sm font-black text-rose-700 font-tabular-nums block">
                              {formatINR(dsp.amountInr)}
                            </span>
                            <span className="text-[10px] font-mono text-rose-600">
                              SLA: {dsp.slaRemaining}
                            </span>
                          </div>
                        </div>

                        <p className="text-[11px] text-on-surface-variant leading-relaxed">
                          {dsp.reason} (Carrier Ref:{' '}
                          <span className="font-mono font-semibold text-on-surface">
                            {dsp.carrierRef}
                          </span>
                          )
                        </p>

                        <div className="flex flex-wrap items-center justify-end gap-2 pt-1 border-t border-outline-variant/20">
                          <button
                            type="button"
                            onClick={() =>
                              handleRapidResolveDispute(
                                dsp.id,
                                'RESOLVED_REFUNDED',
                                dsp.sourceOrderId
                              )
                            }
                            className="px-2.5 py-1.5 rounded-lg border border-outline-variant hover:bg-surface-container text-[11px] font-semibold text-on-surface transition-colors cursor-pointer"
                          >
                            Approve Buyer Refund
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleRapidResolveDispute(
                                dsp.id,
                                'RESOLVED_RELEASED',
                                dsp.sourceOrderId
                              )
                            }
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              verified_user
                            </span>
                            <span>Verify POD &amp; Release to Seller</span>
                          </button>
                        </div>
                      </div>
                    ))}

                    {globalEscrowMetrics.liveDisputed.map((ord) => (
                      <div
                        key={ord.id}
                        className="p-3.5 rounded-xl bg-surface border border-rose-500/25 space-y-2 shadow-2xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-rose-600 text-white">
                                LIVE DISPUTE
                              </span>
                              <span className="font-mono text-xs font-bold text-primary">
                                {ord.orderNumber}
                              </span>
                              <span className="text-[11px] text-on-surface-variant">
                                • {ord.customerName}
                              </span>
                            </div>
                            <p className="text-xs font-bold text-on-surface mt-1">
                              {ord.items.map((i) => `${i.name} (x${i.quantity})`).join(', ')}
                            </p>
                          </div>
                          <span className="text-sm font-black text-rose-700 font-tabular-nums">
                            {formatINR(ord.total)}
                          </span>
                        </div>
                        <div className="flex items-center justify-end gap-2 pt-1 border-t border-outline-variant/20">
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateOrderStatus(ord.id, 'Delivered — Escrow Released')
                            }
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer"
                          >
                            Resolve &amp; Release Funds
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Pending Releases & Held Escrow Queue Column */}
            {(escrowHealthTab === 'all' ||
              escrowHealthTab === 'pending_releases' ||
              escrowHealthTab === 'held') && (
              <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-sky-600 text-[18px]">
                      local_shipping
                    </span>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface">
                      {escrowHealthTab === 'held'
                        ? 'Active Escrow Locks (Awaiting Dispatch)'
                        : 'Pending Releases — Carrier Verified Queue'}
                    </h3>
                  </div>
                  <span className="text-[11px] font-mono font-semibold text-sky-700">
                    {formatINR(
                      escrowHealthTab === 'held'
                        ? globalEscrowMetrics.heldVolumeInr
                        : globalEscrowMetrics.pendingReleaseVolumeInr
                    )}
                  </span>
                </div>

                <div className="space-y-2.5">
                  {escrowHealthTab !== 'held' &&
                    globalEscrowMetrics.activeSupplementalPending.map((rel) => (
                      <div
                        key={rel.id}
                        className="p-3.5 rounded-xl bg-surface border border-sky-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-primary">
                              {rel.orderNumber}
                            </span>
                            <span className="text-xs font-semibold text-on-surface">
                              {rel.customerName}
                            </span>
                          </div>
                          <p className="text-xs text-on-surface font-medium">{rel.productName}</p>
                          <p className="text-[11px] text-emerald-700 font-medium">
                            ✓ {rel.carrierStatus}
                          </p>
                        </div>
                        <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">
                          <span className="text-sm font-black text-on-surface font-tabular-nums">
                            {formatINR(rel.amountInr)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRapidReleasePending(rel.id)}
                            className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[14px]">bolt</span>
                            <span>Release Now</span>
                          </button>
                        </div>
                      </div>
                    ))}

                  {escrowHealthTab !== 'held' &&
                    globalEscrowMetrics.inTransitOrders.map((ord) => (
                      <div
                        key={ord.id}
                        className="p-3.5 rounded-xl bg-surface border border-sky-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-primary">
                              {ord.orderNumber}
                            </span>
                            <span className="text-xs font-semibold text-on-surface">
                              {ord.customerName}
                            </span>
                          </div>
                          <p className="text-xs text-on-surface font-medium">
                            {ord.items.map((i) => `${i.name} (x${i.quantity})`).join(', ')}
                          </p>
                          <p className="text-[11px] text-sky-700 font-mono">
                            Carrier: {ord.carrier} • Tracking: {ord.trackingId}
                          </p>
                        </div>
                        <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">
                          <span className="text-sm font-black text-on-surface font-tabular-nums">
                            {formatINR(ord.total)}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateOrderStatus(ord.id, 'Delivered — Escrow Released')
                            }
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer"
                          >
                            Verify &amp; Release
                          </button>
                        </div>
                      </div>
                    ))}

                  {escrowHealthTab === 'held' &&
                    globalEscrowMetrics.heldOrders.map((ord) => (
                      <div
                        key={ord.id}
                        className="p-3.5 rounded-xl bg-surface border border-amber-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-primary">
                              {ord.orderNumber}
                            </span>
                            <span className="text-xs font-semibold text-on-surface">
                              {ord.customerName}
                            </span>
                          </div>
                          <p className="text-xs text-on-surface font-medium">
                            {ord.items.map((i) => `${i.name} (x${i.quantity})`).join(', ')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-sm font-black text-amber-900 font-tabular-nums">
                            {formatINR(ord.total)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleUpdateOrderStatus(ord.id, 'In Transit')}
                            className="px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold cursor-pointer"
                          >
                            Dispatch
                          </button>
                        </div>
                      </div>
                    ))}

                  {escrowHealthTab !== 'held' &&
                    globalEscrowMetrics.activeSupplementalPending.length === 0 &&
                    globalEscrowMetrics.inTransitOrders.length === 0 && (
                      <div className="p-4 rounded-xl bg-surface border border-outline-variant/30 text-xs text-on-surface-variant">
                        All pending carrier-verified releases have been swept to your settlement
                        account.
                      </div>
                    )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ESCROW STATUS BOARD */}
      <div className="p-6 rounded-2xl bg-surface border border-outline-variant/30 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[22px]">shield</span>
            <h2 className="text-sm font-bold text-on-surface uppercase tracking-wider">
              Autonomous Escrow Status Board
            </h2>
          </div>
          <span className="text-xs text-on-surface-variant">
            Verifiable PayPal Escrow Protection
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 block mb-1">
              Funds Held in Escrow
            </span>
            <span className="text-xl font-black text-amber-900 font-tabular-nums">
              {formatINR(escrowHeldTotal || 84990)}
            </span>
            <p className="text-[10px] text-amber-800 mt-1">Pending carrier transit scans</p>
          </div>

          <div className="p-4 rounded-xl bg-sky-500/10 border border-sky-500/20">
            <span className="text-[11px] font-bold uppercase tracking-wider text-sky-700 block mb-1">
              Funds In Transit
            </span>
            <span className="text-xl font-black text-sky-900 font-tabular-nums">
              {formatINR(escrowInTransitTotal || 52400)}
            </span>
            <p className="text-[10px] text-sky-800 mt-1">Shipped via BlueDart Air</p>
          </div>

          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 block mb-1">
              Funds Released to Bank
            </span>
            <span className="text-xl font-black text-emerald-900 font-tabular-nums">
              {formatINR(escrowReleasedTotal || 345110)}
            </span>
            <p className="text-[10px] text-emerald-800 mt-1">Delivered & verified</p>
          </div>

          <div className="p-4 rounded-xl bg-surface-container border border-outline-variant/30">
            <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant block mb-1">
              Disputed / In Review
            </span>
            <span className="text-xl font-black text-on-surface font-tabular-nums">
              {formatINR(escrowDisputedLiveTotal || globalEscrowMetrics.disputedVolumeInr)}
            </span>
            <p className="text-[10px] text-emerald-600 font-medium mt-1">
              {globalEscrowMetrics.totalActiveDisputeCount === 0
                ? '0% Dispute rate'
                : `${globalEscrowMetrics.totalActiveDisputeCount} active in rapid resolution`}
            </p>
          </div>
        </div>
      </div>

      {/* MIDDLE SECTION: Live Storefront Orders Stream & AI Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left 8 Cols: Real-Time Storefront Orders Feed */}
        <div className="lg:col-span-8 space-y-6">
          <div className="p-6 rounded-2xl bg-surface border border-outline-variant/30 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-on-surface">
                  Live Customer Storefront Orders Stream
                </h3>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Orders placed on your public storefront reflect instantly with live escrow status.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportCSV}
                  className="px-3 py-1.5 rounded-lg border border-outline-variant text-xs font-semibold text-on-surface hover:bg-surface-container flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">download</span>
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-outline-variant/30 text-on-surface-variant">
                    <th className="py-2.5 px-3 font-semibold">Order ID</th>
                    <th className="py-2.5 px-3 font-semibold">Customer</th>
                    <th className="py-2.5 px-3 font-semibold">Items</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Amount</th>
                    <th className="py-2.5 px-3 font-semibold">Escrow Status</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/20">
                  {liveOrders.slice(0, 5).map((order) => (
                    <tr key={order.id} className="hover:bg-surface-container-low transition-colors">
                      <td className="py-3 px-3 font-mono font-bold text-primary">
                        {order.orderNumber}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-semibold text-on-surface">{order.customerName}</div>
                        <div className="text-[10px] text-on-surface-variant">{order.customerEmail}</div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="text-[11px] text-on-surface">
                          {order.items.map((i) => `${i.name} (x${i.quantity})`).join(', ')}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-on-surface font-tabular-nums">
                        {formatINR(order.total)}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-bold inline-flex items-center gap-1 ${
                            order.escrowStatus === 'Escrow Locked'
                              ? 'bg-amber-500/10 text-amber-700'
                              : order.escrowStatus === 'In Transit'
                              ? 'bg-sky-500/10 text-sky-700'
                              : 'bg-emerald-500/10 text-emerald-700'
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          <span>{order.escrowStatus}</span>
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        {order.escrowStatus === 'Escrow Locked' && (
                          <button
                            onClick={() => handleUpdateOrderStatus(order.id, 'In Transit')}
                            className="px-2.5 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-[10px] font-bold"
                          >
                            Mark Shipped
                          </button>
                        )}
                        {order.escrowStatus === 'In Transit' && (
                          <button
                            onClick={() =>
                              handleUpdateOrderStatus(order.id, 'Delivered — Escrow Released')
                            }
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold"
                          >
                            Verify Delivery
                          </button>
                        )}
                        {order.escrowStatus === 'Delivered — Escrow Released' && (
                          <span className="text-[10px] text-emerald-600 font-bold">✓ Settled</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Low Stock Alerts Table */}
          <div className="p-6 rounded-2xl bg-surface border border-outline-variant/30 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-500 text-[20px]">warning</span>
                <h3 className="text-sm font-bold text-on-surface">Low-Stock Alert Center</h3>
              </div>
              <span className="text-xs text-on-surface-variant">Auto-detected inventory levels</span>
            </div>

            <div className="space-y-2">
              {lowStockItems.map((item) => (
                <div
                  key={item.sku}
                  className="p-3 bg-surface-container-low border border-outline-variant/30 rounded-xl flex items-center justify-between text-xs"
                >
                  <div>
                    <p className="font-bold text-on-surface">{item.name}</p>
                    <p className="text-[11px] text-on-surface-variant font-mono">
                      SKU: {item.sku} • In Stock: <span className="text-error font-bold">{item.stock}</span> (Min: {item.minStock})
                    </p>
                  </div>
                  <button
                    onClick={() => handleRestock(item.sku)}
                    className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-lg text-xs font-bold transition-colors"
                  >
                    + Restock 20 Units
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right 4 Cols: Gemini AI Insights & Storefront Quick Access */}
        <div className="lg:col-span-4 space-y-6">
          {/* AI Insights Card */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-primary/10 via-surface-container to-surface border border-primary/20 shadow-sm space-y-4">
            <div className="flex items-center gap-2 text-primary font-bold text-sm">
              <span className="material-symbols-outlined text-[22px]">auto_awesome</span>
              <span>Gemini Autonomous Revenue Insights</span>
            </div>

            <div className="space-y-3">
              {insights.map((ins) => (
                <div
                  key={ins.id}
                  className="p-3.5 bg-surface rounded-xl border border-outline-variant/30 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary font-bold text-[10px]">
                      {ins.badge}
                    </span>
                    {ins.metric && (
                      <span className="text-[10px] font-bold text-emerald-600 font-mono">
                        {ins.metric}
                      </span>
                    )}
                  </div>
                  <h4 className="text-xs font-bold text-on-surface">{ins.title}</h4>
                  <p className="text-[11px] text-on-surface-variant leading-relaxed">
                    {ins.description}
                  </p>
                  <button
                    onClick={() => onNavigateWebsite && onNavigateWebsite()}
                    className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
                  >
                    <span>{ins.actionText}</span>
                    <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Top Selling Products */}
          <div className="p-6 rounded-2xl bg-surface border border-outline-variant/30 shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-on-surface">Top Selling Catalog Products</h3>
            <div className="space-y-2.5">
              {[
                { name: 'AeroBreeze 1200mm Smart BLDC Fan', units: 48, revenue: '₹4,07,952' },
                { name: 'Yonex Astrox 99 Pro Carbon Racket', units: 14, revenue: '₹2,09,860' },
                { name: 'AcousticSphere ANC Spatial Earbuds', units: 22, revenue: '₹2,52,978' },
              ].map((p, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-surface-container-low rounded-xl flex items-center justify-between text-xs"
                >
                  <div>
                    <p className="font-bold text-on-surface">{p.name}</p>
                    <p className="text-[10px] text-on-surface-variant">{p.units} units sold</p>
                  </div>
                  <span className="font-black text-on-surface font-tabular-nums">{p.revenue}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Customer Base Intelligence Snippet */}
          <div className="p-6 rounded-2xl bg-surface border border-outline-variant/30 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">group</span>
                <h3 className="text-sm font-bold text-on-surface">Verified Customer Directory</h3>
              </div>
              <button
                type="button"
                onClick={() => navigate('/seller/customers')}
                className="text-xs font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>View All (6)</span>
                <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
              </button>
            </div>

            <p className="text-[11px] text-on-surface-variant">
              Top repeat buyers across your public storefront with zero escrow disputes.
            </p>

            <div className="space-y-2">
              {[
                { name: 'Priya Patel', city: 'Bengaluru', spent: '₹4,21,500', tier: 'VIP', trust: '99%' },
                { name: 'Vikramaditya Rao', city: 'Hyderabad', spent: '₹2,92,000', tier: 'VIP', trust: '100%' },
                { name: 'Ananya Deshmukh', city: 'New Delhi', spent: '₹1,64,000', tier: 'VIP', trust: '100%' },
              ].map((c, idx) => (
                <div
                  key={idx}
                  className="p-2.5 bg-surface-container-low rounded-xl flex items-center justify-between text-xs cursor-pointer hover:bg-surface-container transition-colors"
                  onClick={() => navigate('/seller/customers')}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-primary/10 text-primary font-bold text-[11px] flex items-center justify-center">
                      {c.name.split(' ').map((p) => p[0]).join('')}
                    </div>
                    <div>
                      <span className="font-bold text-on-surface block leading-tight">{c.name}</span>
                      <span className="text-[10px] text-secondary">{c.city} • {c.trust} Escrow Score</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-on-surface font-tabular-nums block leading-tight">{c.spent}</span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-100 text-purple-900 border border-purple-200">
                      {c.tier}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
