import React, { useState, useEffect } from 'react';
import { formatINR } from '../../utils/finance';
import { downloadTextFile } from '../../utils/export';
import {
  PaymentStateBadge,
  MoneyBreakdownCard,
  DataCollectionBoundary,
  CanonicalPaymentState,
  CollectionViewState,
} from '../ui/HonestTrustComponents';
import { useRole } from '../../context/RoleContext';
import {
  subscribeStoreOrders,
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
  const { role, dataSource } = useRole();
  const [feesVerified, setFeesVerified] = useState(true);
  const [serverConfirmed] = useState(true);

  // Live Storefront Orders from Firestore
  const [liveOrders, setLiveOrders] = useState<StorefrontOrder[]>([]);
  const [newOrderNotice, setNewOrderNotice] = useState<string | null>(null);

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

  // Subscribe to live storefront orders
  useEffect(() => {
    const unsub = subscribeStoreOrders(DEFAULT_BIZ_ID, (orders) => {
      setLiveOrders((prev) => {
        if (prev.length > 0 && orders.length > prev.length) {
          const newest = orders[0];
          setNewOrderNotice(`⚡ New order received: ${newest.orderNumber} (${newest.customerName})`);
          showToast(`⚡ New order received: ${newest.orderNumber}`);
        }
        return orders;
      });
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

    return () => unsub();
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
    <div className="p-6 lg:p-8 space-y-8 max-w-[1600px] mx-auto animate-fade-in">
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

      {/* Real-time Order Notification Banner */}
      {newOrderNotice && (
        <div className="p-4 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-between animate-bounce">
          <div className="flex items-center gap-2.5 text-xs font-bold text-primary">
            <span className="material-symbols-outlined text-[20px]">notifications_active</span>
            <span>{newOrderNotice}</span>
          </div>
          <button
            onClick={() => setNewOrderNotice(null)}
            className="text-xs text-on-surface-variant hover:text-on-surface"
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
              ₹{formatINR(escrowHeldTotal || 84990)}
            </span>
            <p className="text-[10px] text-amber-800 mt-1">Pending carrier transit scans</p>
          </div>

          <div className="p-4 rounded-xl bg-sky-500/10 border border-sky-500/20">
            <span className="text-[11px] font-bold uppercase tracking-wider text-sky-700 block mb-1">
              Funds In Transit
            </span>
            <span className="text-xl font-black text-sky-900 font-tabular-nums">
              ₹{formatINR(escrowInTransitTotal || 52400)}
            </span>
            <p className="text-[10px] text-sky-800 mt-1">Shipped via BlueDart Air</p>
          </div>

          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 block mb-1">
              Funds Released to Bank
            </span>
            <span className="text-xl font-black text-emerald-900 font-tabular-nums">
              ₹{formatINR(escrowReleasedTotal || 345110)}
            </span>
            <p className="text-[10px] text-emerald-800 mt-1">Delivered & verified</p>
          </div>

          <div className="p-4 rounded-xl bg-surface-container border border-outline-variant/30">
            <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant block mb-1">
              Disputed / In Review
            </span>
            <span className="text-xl font-black text-on-surface font-tabular-nums">₹0</span>
            <p className="text-[10px] text-emerald-600 font-medium mt-1">0% Dispute rate</p>
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
                        ₹{formatINR(order.total)}
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
        </div>
      </div>
    </div>
  );
}
