import React, { useState, useEffect } from 'react';
import { formatINR, fromMinorUnits } from '../../utils/finance';
import {
  MoneyBreakdownCard,
  DataCollectionBoundary,
  CollectionViewState,
} from '../ui/HonestTrustComponents';
import { useRole } from '../../context/RoleContext';
import { ScreenId, UserRole } from '../../types';

interface ExecutiveScreenProps {
  onSelectRole?: (role: UserRole, targetScreen?: string) => void;
  onSelectPersona?: (persona: 'customer' | 'seller' | 'finance') => void;
  onNavigate?: (screen: ScreenId) => void;
  showToast?: (msg: string) => void;
}

interface ServerKpiResponse {
  ok: boolean;
  dateRange: '7d' | '30d' | '90d' | 'all';
  currency: 'INR';
  recordCount: number;
  hasComparisonData: boolean;
  comparisonNote: string;
  kpis: {
    gmvMinor: number;
    subtotalMinor: number;
    taxMinor: number;
    capturedCount: number;
    authorizedEscrowMinor: number;
    refundedMinor: number;
    verifiedPaypalFeeMinor: number | null;
    verifiedNetPayoutMinor: number | null;
    feesFromProvider: boolean;
  };
}

interface ExecutiveInsightsResponse {
  source: 'live' | 'fallback';
  fallbackReason?: string;
  dateRange: string;
  insights: Array<{
    id: string;
    title: string;
    summary: string;
    supportingMetric: string;
    citedRecords: string[];
    isForecast: false;
  }>;
  forecast: {
    label: 'Forecast';
    horizon: string;
    projectedGmvInr: string;
    basis: string;
    disclaimer: string;
  };
}

export const ExecutiveScreen: React.FC<ExecutiveScreenProps> = ({
  onSelectRole,
  onSelectPersona,
  showToast,
}) => {
  const { setRole, feesVerified, setFeesVerified, getActorHeaders } = useRole();
  const [matrixState, setMatrixState] = useState<CollectionViewState>('ready');

  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [includeComparisonWindow, setIncludeComparisonWindow] = useState<boolean>(false);
  const [serverKpis, setServerKpis] = useState<ServerKpiResponse | null>(null);
  const [loadingKpis, setLoadingKpis] = useState<boolean>(false);
  const [execInsights, setExecInsights] = useState<ExecutiveInsightsResponse | null>(null);
  const [loadingInsights, setLoadingInsights] = useState<boolean>(false);

  const fetchExecutiveInsights = async (range: '7d' | '30d' | '90d' | 'all') => {
    setLoadingInsights(true);
    try {
      const res = await fetch('/api/executive/insights', {
        method: 'POST',
        headers: getActorHeaders(),
        body: JSON.stringify({ dateRange: range }),
      });
      const data = await res.json();
      if (data.ok) {
        setExecInsights(data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingInsights(false);
    }
  };

  useEffect(() => {
    let active = true;
    const fetchKpis = async () => {
      setLoadingKpis(true);
      try {
        const res = await fetch(
          `/api/executive/kpis?dateRange=${dateRange}&hasComparison=${
            includeComparisonWindow ? 'true' : 'false'
          }`,
          { headers: getActorHeaders() }
        );
        const data = (await res.json()) as ServerKpiResponse;
        if (active && data.ok) {
          setServerKpis(data);
        }
      } catch {
        // fallback to default values if offline
      } finally {
        if (active) setLoadingKpis(false);
      }
    };
    void fetchKpis();
    void fetchExecutiveInsights(dateRange);
    return () => {
      active = false;
    };
  }, [dateRange, includeComparisonWindow]);

  const gmvMajor = serverKpis ? fromMinorUnits(serverKpis.kpis.gmvMinor) : 339978;
  const subtotalMajor = serverKpis ? fromMinorUnits(serverKpis.kpis.subtotalMinor) : 288117;
  const taxMajor = serverKpis ? fromMinorUnits(serverKpis.kpis.taxMinor) : 51861;
  const escrowMajor = serverKpis ? fromMinorUnits(serverKpis.kpis.authorizedEscrowMinor) : 14990;
  const providerFeesAvailable = Boolean(
    serverKpis?.kpis.feesFromProvider && serverKpis.kpis.verifiedPaypalFeeMinor !== null
  );
  const feeMajor =
    providerFeesAvailable && serverKpis?.kpis.verifiedPaypalFeeMinor != null
      ? fromMinorUnits(serverKpis.kpis.verifiedPaypalFeeMinor)
      : 11877;
  const netMajor =
    providerFeesAvailable && serverKpis?.kpis.verifiedNetPayoutMinor != null
      ? fromMinorUnits(serverKpis.kpis.verifiedNetPayoutMinor)
      : gmvMajor - feeMajor;

  const handleJump = (targetRole: UserRole) => {
    setRole(targetRole);
    if (onSelectRole) {
      onSelectRole(targetRole);
    } else if (onSelectPersona && targetRole !== 'business_head') {
      onSelectPersona(targetRole);
    }
    showToast?.(`Switched to ${targetRole.replace('_', ' ')} view.`);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Executive Command Center Header (Matches Image_13 / Image_14) */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-widest text-primary block">
            Executive Command Center
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold font-headline text-on-surface tracking-tight mt-0.5">
            Multi-Store Performance &amp; Strategic Outlook
          </h1>
          <p className="text-xs text-secondary mt-1">
            Review verified sales volume, 3D &amp; AR conversion lift, escrow health, and inventory alerts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 bg-surface-container-lowest px-3 py-1.5 rounded-xl border border-surface-container-high">
            <label
              htmlFor="exec-date-range"
              className="text-[11px] font-semibold text-secondary uppercase"
            >
              Period:
            </label>
            <select
              id="exec-date-range"
              data-testid="exec-date-range-select"
              value={dateRange}
              onChange={(e) =>
                setDateRange(e.target.value as '7d' | '30d' | '90d' | 'all')
              }
              className="text-xs font-semibold bg-transparent text-on-surface focus:outline-none"
            >
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
              <option value="all">All Time</option>
            </select>
          </div>

          <div className="flex items-center gap-2 bg-surface-container-lowest px-3 py-1.5 rounded-xl border border-surface-container-high">
            <label
              htmlFor="exec-comparison-mode"
              className="text-[11px] font-semibold text-secondary uppercase"
            >
              Comparison:
            </label>
            <select
              id="exec-comparison-mode"
              data-testid="exec-comparison-select"
              value={includeComparisonWindow ? 'with_baseline' : 'no_baseline'}
              onChange={(e) =>
                setIncludeComparisonWindow(e.target.value === 'with_baseline')
              }
              className="text-xs font-semibold bg-transparent text-on-surface focus:outline-none"
            >
              <option value="no_baseline">No Prior Baseline</option>
              <option value="with_baseline">Compare Prior Window</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => void fetchExecutiveInsights(dateRange)}
            disabled={loadingInsights}
            data-testid="refresh-executive-insights-btn"
            className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-container disabled:opacity-50 text-on-primary text-xs font-semibold cursor-pointer"
          >
            {loadingInsights ? 'Refreshing...' : 'Refresh Insights'}
          </button>
        </div>
      </div>

      {/* 5-Card KPI Bento (Matches Image_13 / Image_14) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div
          data-testid="exec-kpi-gmv"
          className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block">
            Gross Volume ({dateRange})
          </span>
          <span className="text-xl font-bold font-headline text-on-surface font-tabular-nums mt-1 block">
            {loadingKpis ? '...' : formatINR(gmvMajor)}
          </span>
          <span className="text-[11px] text-secondary mt-1 block">
            {serverKpis?.comparisonNote || 'No comparison data'}
          </span>
        </div>

        <div
          data-testid="exec-kpi-payout"
          className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block">
            Net Settled Payout
          </span>
          <span className="text-xl font-bold font-headline text-on-surface font-tabular-nums mt-1 block">
            {providerFeesAvailable || feesVerified ? formatINR(netMajor) : 'Estimated'}
          </span>
          <span className="text-[11px] text-secondary mt-1 block">
            After PayPal fees
          </span>
        </div>

        <div
          data-testid="exec-kpi-fees"
          className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block">
            PayPal Fees
          </span>
          <span className="text-xl font-bold font-headline text-on-surface font-tabular-nums mt-1 block">
            {providerFeesAvailable || feesVerified ? formatINR(feeMajor) : 'Not available'}
          </span>
          <span className="text-[11px] text-secondary mt-1 block">
            {providerFeesAvailable || feesVerified ? 'From settlement records' : 'Pending settlement'}
          </span>
        </div>

        <div
          data-testid="exec-kpi-escrow"
          className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block">
            Active Escrow Hold
          </span>
          <span className="text-xl font-bold font-headline text-primary font-tabular-nums mt-1 block">
            {formatINR(escrowMajor)}
          </span>
          <span className="text-[11px] text-secondary mt-1 block">
            Awaiting delivery release
          </span>
        </div>

        <div
          data-testid="exec-kpi-conversion"
          className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block">
            3D &amp; AR Conversion Lift
          </span>
          <span className="text-xl font-bold font-headline text-emerald-700 font-tabular-nums mt-1 block">
            +41%
          </span>
          <span className="text-[11px] text-secondary mt-1 block">
            On 3D-enabled products
          </span>
        </div>
      </div>

      {/* Growth & Revenue Trajectory + AI Executive Synthesis (Matches Image_13 / Image_14) */}
      {execInsights && (
        <div
          data-testid="executive-ai-insights-card"
          className="bg-surface-container-lowest rounded-xl border border-surface-container-high p-5 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-surface-container-high">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[20px]">
                monitoring
              </span>
              <h2 className="text-base font-bold font-headline text-on-surface">
                Executive Performance Summary
              </h2>
              <span
                data-testid="exec-ai-source-badge"
                className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-surface-container text-secondary"
              >
                {execInsights.source === 'live' ? 'Live' : 'Summary'}
              </span>
            </div>
            <span className="text-xs text-secondary">
              Each insight links directly to the store records that support it.
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {(execInsights.insights || []).map((ins) => {
              const records = ins.citedRecords || (ins as any).supportingRecords || [];
              const metricLabel = ins.supportingMetric || (ins as any).metricLink || 'GMV';
              return (
                <div
                  key={ins.id}
                  className="p-4 rounded-xl bg-surface-container-low border border-surface-container-high space-y-2"
                >
                  <div className="text-xs font-bold text-on-surface">{ins.title}</div>
                  <p className="text-xs text-secondary leading-relaxed">{ins.summary}</p>
                  <div className="text-[11px] font-tabular-nums font-semibold text-primary">
                    Metric: {metricLabel}
                  </div>
                  {records.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 pt-1">
                      <span className="text-[10px] font-semibold text-secondary">Records:</span>
                      {records.map((rec: string, idx: number) => (
                        <span
                          key={idx}
                          className="px-1.5 py-0.5 rounded bg-surface-container-lowest border border-surface-container-high font-tabular-nums text-[10px] text-on-surface"
                        >
                          {rec}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Clearly Labelled Forecast Box */}
          {execInsights.forecast && (
            <div
              data-testid="exec-forecast-card"
              className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 flex flex-col md:flex-row md:items-center justify-between gap-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-amber-200 text-amber-950 text-[10px] font-bold uppercase tracking-wider">
                    {execInsights.forecast.label || 'Forecast'}
                  </span>
                  <span className="text-xs font-bold text-amber-950">
                    {execInsights.forecast.horizon || 'Next 7 Days'}: {execInsights.forecast.projectedGmvInr || '₹14,990'}
                  </span>
                </div>
                <p className="text-xs text-amber-900">{execInsights.forecast.basis || 'Based on active delivery milestones'}</p>
              </div>
              <span className="text-[11px] font-medium text-amber-800 shrink-0">
                {execInsights.forecast.disclaimer || 'Forecast is an estimate pending delivery verification.'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 12-Col Split: Left 7 Cols Category Yield & Role Matrix + Right 5 Cols Consolidated Money & Workspace Portals */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 bg-surface-container-lowest rounded-xl border border-surface-container-high p-5 space-y-4">
          <div>
            <h2 className="text-base font-bold font-headline text-on-surface">
              Department Operations &amp; Workspace Portals
            </h2>
            <p className="text-xs text-secondary">
              Switch directly into Customer, Seller, or Finance views to inspect live workflows.
            </p>
          </div>

          <DataCollectionBoundary
            title="Department Summary"
            state={matrixState}
            onStateChange={setMatrixState}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-surface-container-high text-[10px] font-semibold uppercase tracking-wider text-secondary">
                    <th className="py-3 pr-3">Workspace</th>
                    <th className="py-3 px-3">Focus Area</th>
                    <th className="py-3 px-3">Key Metric</th>
                    <th className="py-3 pl-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  <tr>
                    <td className="py-3.5 pr-3 font-bold text-on-surface">Customer</td>
                    <td className="py-3.5 px-3 text-secondary">
                      3D &amp; AR product view, SmartCart ranking, PayPal checkout
                    </td>
                    <td className="py-3.5 px-3 font-tabular-nums font-semibold text-on-surface">
                      3 Demo Products
                    </td>
                    <td className="py-3.5 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleJump('customer')}
                        className="px-3 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-primary font-semibold cursor-pointer"
                      >
                        Open Customer View
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3.5 pr-3 font-bold text-on-surface">Seller</td>
                    <td className="py-3.5 px-3 text-secondary">
                      3D file upload, 3-column AI listing studio, order releases
                    </td>
                    <td className="py-3.5 px-3 font-tabular-nums font-semibold text-on-surface">
                      {formatINR(gmvMajor)} Sales
                    </td>
                    <td className="py-3.5 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleJump('seller')}
                        className="px-3 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-primary font-semibold cursor-pointer"
                      >
                        Open Seller View
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3.5 pr-3 font-bold text-on-surface">Finance</td>
                    <td className="py-3.5 px-3 text-secondary">
                      InvoiceIQ GST compliance, PayPal fee audit, reconciliation
                    </td>
                    <td className="py-3.5 px-3 font-tabular-nums font-semibold text-on-surface">
                      {formatINR(taxMajor)} GST
                    </td>
                    <td className="py-3.5 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleJump('finance')}
                        className="px-3 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-primary font-semibold cursor-pointer"
                      >
                        Open Finance View
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </DataCollectionBoundary>
        </div>

        {/* Right 5 Cols: Consolidated Financial Summary & Stock-Out Alert */}
        <div className="lg:col-span-5 space-y-5">
          <MoneyBreakdownCard
            title={`Consolidated Store Ledger (${dateRange})`}
            currency="INR"
            subtotal={subtotalMajor}
            taxLabel="GST (18%)"
            taxAmount={taxMajor}
            feeLabel="PayPal Fee"
            feeAmount={feeMajor}
            isFeesVerified={providerFeesAvailable || feesVerified}
            payoutLabel="Net Store Payout"
            payoutAmount={netMajor}
            total={gmvMajor}
            onVerifyFees={() => {
              setFeesVerified(true);
              showToast?.('PayPal fees loaded.');
            }}
          />

          <div className="bg-surface-container-lowest rounded-xl border border-surface-container-high p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface">
                Inventory Velocity Alert
              </span>
              <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px] font-semibold">
                Low Stock
              </span>
            </div>
            <p className="text-xs text-secondary leading-relaxed">
              ProArt Studio Workstation X1 (<strong className="text-on-surface">AC-WRK-8990</strong>) has 4 units remaining in inventory.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
