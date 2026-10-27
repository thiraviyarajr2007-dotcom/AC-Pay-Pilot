import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AgStudio, AgStudioProvider, createWidgets } from 'ag-studio-react';
import {
  AgStudioLicenseManager,
  enableStudioDevValidations,
  studioTheme,
  type AgExpressionFieldDefinition,
  type AgReportState,
  type AgStudioApi,
  type AgStudioApiReadyEvent,
  type AgStudioMode,
  type AgStudioStateUpdatedEvent,
  type AgWidgetFormParams,
  type AgWidgetParams,
} from 'ag-studio';
import {
  CommandCenterDataset,
  buildAgStudioDataSources,
  buildSeededCommandCenterDataset,
  createSimulatedRefundSpikeTick,
  executeCommandCenterRowAction,
  formatCompactINR,
  formatFullINR,
  subscribeCommandCenterLiveData,
} from '../../services/commandCenterDataService';
import { CommandCenterOrder, EscrowStage } from '../../types';
import {
  DEFAULT_BIZ_ID,
  LiveOrderNotification,
  subscribeNewOrderNotifications,
} from '../../services/storefrontService';

// Assumption: AG Studio license key is read strictly from VITE_AG_STUDIO_LICENSE env variable;
// if unset or placeholder, AG Studio runs in evaluation/trial mode for the hackathon.
const rawAgStudioLicense = (import.meta.env.VITE_AG_STUDIO_LICENSE as string | undefined) || '';
const cleanAgStudioLicense =
  rawAgStudioLicense && rawAgStudioLicense !== 'MY_AG_STUDIO_LICENSE_KEY'
    ? rawAgStudioLicense.trim()
    : '';

if (cleanAgStudioLicense) {
  AgStudioLicenseManager.setLicenseKey(cleanAgStudioLicense);
}

if (import.meta.env.DEV) {
  try {
    enableStudioDevValidations();
  } catch {
    // Dev validations already enabled
  }
}

export type SavedViewPresetId = 'overview' | 'escrow_ops' | 'risk';

export interface ActiveCrossFilter {
  dimension: 'escrowStage' | 'region' | 'productSku' | 'customerSegment' | null;
  value: string | null;
}

interface CommandCenterWidgetContextValue {
  dataset: CommandCenterDataset;
  filteredOrders: CommandCenterOrder[];
  crossFilter: ActiveCrossFilter;
  setCrossFilter: (next: ActiveCrossFilter) => void;
  onRowAction: (
    order: CommandCenterOrder,
    action: 'release' | 'hold' | 'refund' | 'nudge'
  ) => Promise<void>;
  isLoading: boolean;
  errorMessage: string | null;
  isDark: boolean;
  isSimulatingSpike: boolean;
}

const CommandCenterWidgetContext = createContext<CommandCenterWidgetContextValue | null>(null);

function useCommandCenterWidgetContext(): CommandCenterWidgetContextValue {
  const ctx = useContext(CommandCenterWidgetContext);
  if (!ctx) {
    throw new Error('useCommandCenterWidgetContext must be used inside CommandCenterWidgetContext');
  }
  return ctx;
}

// ============================================================================
// CUSTOM WIDGET 1: ESCROW PIPELINE (Held -> Shipped -> Released + Refunded / Disputed)
// ============================================================================
const EscrowPipelineWidgetComp: React.FC<AgWidgetParams<any>> = ({
  widgetApi,
}) => {
  const { filteredOrders, crossFilter, setCrossFilter, isLoading, errorMessage, isDark } =
    useCommandCenterWidgetContext();

  useEffect(() => {
    if (isLoading) {
      widgetApi.setDisplayState('loading');
    } else if (filteredOrders.length === 0 && !crossFilter.value) {
      widgetApi.setDisplayState('noData');
    } else {
      widgetApi.setDisplayState('displayed');
    }
  }, [widgetApi, isLoading, filteredOrders.length, crossFilter.value]);

  const stageStats = useMemo(() => {
    const stages: EscrowStage[] = ['held', 'shipped', 'released', 'refunded', 'disputed'];
    return stages.reduce(
      (acc, st) => {
        const matching = filteredOrders.filter((o) => o.escrowStage === st);
        const totalInr = matching.reduce((sum, o) => sum + o.amountInr, 0);
        const avgAgeHours =
          matching.length > 0
            ? Math.round(matching.reduce((sum, o) => sum + o.ageHours, 0) / matching.length)
            : 0;
        acc[st] = {
          count: matching.length,
          totalInr,
          avgAgeHours,
        };
        return acc;
      },
      {} as Record<EscrowStage, { count: number; totalInr: number; avgAgeHours: number }>
    );
  }, [filteredOrders]);

  const handleSelectStage = (stage: EscrowStage) => {
    const isSame = crossFilter.dimension === 'escrowStage' && crossFilter.value === stage;
    const nextFilter: ActiveCrossFilter = isSame
      ? { dimension: null, value: null }
      : { dimension: 'escrowStage', value: stage };
    setCrossFilter(nextFilter);

    try {
      if (isSame) {
        widgetApi.resetCrossFilter();
      }
    } catch {
      // Cross-filter state synced via context
    }
  };

  if (errorMessage) {
    return (
      <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 text-xs font-medium">
        Pipeline Error: {errorMessage}
      </div>
    );
  }

  const primaryFlow: Array<{
    stage: EscrowStage;
    label: string;
    subtitle: string;
    badgeClass: string;
    icon: string;
  }> = [
    {
      stage: 'held',
      label: '1. Escrow Held',
      subtitle: 'PayPal Auth Locked',
      badgeClass: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300',
      icon: 'lock_clock',
    },
    {
      stage: 'shipped',
      label: '2. In Transit',
      subtitle: 'AWB Scanned • POD Pending',
      badgeClass: 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-300',
      icon: 'local_shipping',
    },
    {
      stage: 'released',
      label: '3. Released',
      subtitle: 'POD Verified • Disbursed',
      badgeClass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
      icon: 'verified',
    },
  ];

  const exceptionBranches: Array<{
    stage: EscrowStage;
    label: string;
    subtitle: string;
    badgeClass: string;
    icon: string;
  }> = [
    {
      stage: 'refunded',
      label: 'Refunded Branch',
      subtitle: 'Buyer Reversal / Spike',
      badgeClass: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300',
      icon: 'currency_exchange',
    },
    {
      stage: 'disputed',
      label: 'Disputed Branch',
      subtitle: 'Escrow Arbitration Hold',
      badgeClass: 'border-purple-500/40 bg-purple-500/10 text-purple-600 dark:text-purple-300',
      icon: 'gavel',
    },
  ];

  return (
    <div
      className={`h-full w-full flex flex-col justify-start gap-2 p-3 rounded-xl border transition-colors overflow-y-auto min-h-0 ${
        isDark
          ? 'bg-slate-900/95 border-slate-800 text-slate-100'
          : 'bg-white border-slate-200/90 text-slate-900'
      }`}
      role="region"
      aria-label="Escrow Pipeline Stage Flow"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-sky-500">account_tree</span>
          <div>
            <h3 className="text-xs font-extrabold tracking-tight uppercase">
              Autonomous Escrow Pipeline
            </h3>
            <p className="text-[11px] opacity-70">
              Click any stage to cross-filter all widgets • Held → Shipped → Released
            </p>
          </div>
        </div>
        {crossFilter.dimension === 'escrowStage' && crossFilter.value && (
          <button
            type="button"
            onClick={() => handleSelectStage(crossFilter.value as EscrowStage)}
            className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-sky-500/15 text-sky-500 hover:bg-sky-500/25 cursor-pointer"
          >
            Clear Stage Filter ({crossFilter.value.toUpperCase()})
          </button>
        )}
      </div>

      {/* Main 3-Stage Flow */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 items-stretch">
        {primaryFlow.map((item, idx) => {
          const stat = stageStats[item.stage];
          const isSelected =
            crossFilter.dimension === 'escrowStage' && crossFilter.value === item.stage;
          return (
            <div key={item.stage} className="relative flex items-center">
              <div
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`${item.label}: ${stat.count} orders, ${formatCompactINR(
                  stat.totalInr
                )}`}
                onClick={() => handleSelectStage(item.stage)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelectStage(item.stage);
                  }
                }}
                className={`w-full p-3 rounded-xl border text-left transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                  isSelected
                    ? 'ring-2 ring-sky-500 bg-sky-500/10 border-sky-500'
                    : isDark
                    ? 'bg-slate-800/70 border-slate-700/80 hover:border-slate-600'
                    : 'bg-slate-50/90 border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${item.badgeClass}`}
                  >
                    <span className="material-symbols-outlined text-[13px]">{item.icon}</span>
                    <span>{item.label}</span>
                  </span>
                  <span className="text-[11px] font-extrabold opacity-80">
                    {stat.count} orders
                  </span>
                </div>
                <div className="text-lg font-black tracking-tight mt-1">
                  {formatCompactINR(stat.totalInr)}
                </div>
                <div className="flex items-center justify-between text-[10px] opacity-75 mt-1">
                  <span>{item.subtitle}</span>
                  <span className="font-mono font-semibold">
                    Avg age: {stat.avgAgeHours >= 48 ? `${Math.round(stat.avgAgeHours / 24)}d` : `${stat.avgAgeHours}h`}
                  </span>
                </div>
              </div>
              {idx < primaryFlow.length - 1 && (
                <span className="hidden md:flex material-symbols-outlined text-[16px] opacity-40 mx-0.5 select-none">
                  arrow_forward
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Exception Branches: Refunded & Disputed */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-2.5 pt-2.5 border-t border-slate-500/15">
        {exceptionBranches.map((branch) => {
          const stat = stageStats[branch.stage];
          const isSelected =
            crossFilter.dimension === 'escrowStage' && crossFilter.value === branch.stage;
          return (
            <div
              key={branch.stage}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              onClick={() => handleSelectStage(branch.stage)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSelectStage(branch.stage);
                }
              }}
              className={`p-2.5 rounded-xl border flex items-center justify-between transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-rose-500 ${
                isSelected
                  ? 'ring-2 ring-rose-500 bg-rose-500/10 border-rose-500'
                  : isDark
                  ? 'bg-slate-800/50 border-slate-700/70 hover:border-slate-600'
                  : 'bg-slate-50/70 border-slate-200/80 hover:border-slate-300'
              }`}
            >
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${branch.badgeClass}`}
                  >
                    <span className="material-symbols-outlined text-[12px]">{branch.icon}</span>
                    <span>{branch.label}</span>
                  </span>
                  <span className="text-[11px] font-bold">{stat.count} orders</span>
                </div>
                <span className="text-[10px] opacity-70">{branch.subtitle}</span>
              </div>
              <div className="text-right">
                <div className="text-sm font-black">{formatCompactINR(stat.totalInr)}</div>
                <div className="text-[10px] font-mono opacity-75">
                  Avg age: {stat.avgAgeHours}h
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// CUSTOM WIDGET 2: ESCROW HEALTH SCORE (0-100 + Trend Arrow + "Why this score" Tooltip)
// ============================================================================
const EscrowHealthScoreWidgetComp: React.FC<AgWidgetParams<any>> = ({
  widgetApi,
}) => {
  const { filteredOrders, isLoading, isDark, isSimulatingSpike } =
    useCommandCenterWidgetContext();
  const [showWhyTooltip, setShowWhyTooltip] = useState(false);

  useEffect(() => {
    widgetApi.setDisplayState(isLoading ? 'loading' : 'displayed');
  }, [widgetApi, isLoading]);

  const metrics = useMemo(() => {
    const total = Math.max(1, filteredOrders.length);
    const refundedCount = filteredOrders.filter((o) => o.escrowStage === 'refunded').length;
    const disputedCount = filteredOrders.filter((o) => o.escrowStage === 'disputed').length;
    const releasedOrders = filteredOrders.filter((o) => o.escrowStage === 'released');

    const refundRatePct = (refundedCount / total) * 100;
    const disputeRatePct = (disputedCount / total) * 100;
    const avgReleaseHours =
      releasedOrders.length > 0
        ? releasedOrders.reduce((s, o) => s + o.releaseTimeHours, 0) / releasedOrders.length
        : 42;

    // Penalty calculation
    const refundPenalty = Math.min(40, Math.round(refundRatePct * 2.2));
    const disputePenalty = Math.min(35, Math.round(disputeRatePct * 3.4));
    const velocityPenalty = Math.min(20, Math.max(0, Math.round((avgReleaseHours - 36) * 0.4)));

    const rawScore = Math.max(12, Math.min(99, 100 - refundPenalty - disputePenalty - velocityPenalty));
    const trendDelta = isSimulatingSpike || refundRatePct > 12 ? -6.4 : +3.2;

    return {
      score: rawScore,
      trendDelta,
      refundRatePct: refundRatePct.toFixed(1),
      disputeRatePct: disputeRatePct.toFixed(1),
      avgReleaseHours: Math.round(avgReleaseHours),
      refundPenalty,
      disputePenalty,
      velocityPenalty,
    };
  }, [filteredOrders, isSimulatingSpike]);

  const scoreTone =
    metrics.score >= 80
      ? 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10'
      : metrics.score >= 60
      ? 'text-amber-500 border-amber-500/30 bg-amber-500/10'
      : 'text-rose-500 border-rose-500/30 bg-rose-500/10';

  return (
    <div
      className={`h-full w-full flex flex-col justify-start gap-2 p-3 rounded-xl border relative overflow-y-auto min-h-0 ${
        isDark
          ? 'bg-slate-900/95 border-slate-800 text-slate-100'
          : 'bg-white border-slate-200/90 text-slate-900'
      }`}
      role="region"
      aria-label="Escrow Health Score"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
            Composite Trust Index
          </span>
          <h3 className="text-xs font-extrabold">Escrow Health Score</h3>
        </div>
        <button
          type="button"
          onClick={() => setShowWhyTooltip((prev) => !prev)}
          onMouseEnter={() => setShowWhyTooltip(true)}
          onMouseLeave={() => setShowWhyTooltip(false)}
          aria-expanded={showWhyTooltip}
          className="px-2 py-1 rounded-lg text-[10px] font-bold border border-sky-500/30 bg-sky-500/10 text-sky-500 hover:bg-sky-500/20 flex items-center gap-1 cursor-pointer"
        >
          <span className="material-symbols-outlined text-[13px]">help</span>
          <span>Why this score?</span>
        </button>
      </div>

      <div className="flex items-baseline gap-3 my-2">
        <div
          className={`px-3.5 py-2 rounded-2xl border text-3xl font-black tracking-tight ${scoreTone}`}
        >
          {metrics.score}
          <span className="text-xs font-bold opacity-70 ml-1">/100</span>
        </div>
        <div className="flex flex-col">
          <span
            className={`inline-flex items-center gap-0.5 text-xs font-extrabold ${
              metrics.trendDelta >= 0 ? 'text-emerald-500' : 'text-rose-500'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">
              {metrics.trendDelta >= 0 ? 'trending_up' : 'trending_down'}
            </span>
            <span>
              {metrics.trendDelta >= 0 ? `+${metrics.trendDelta}` : metrics.trendDelta} pts vs 30d
            </span>
          </span>
          <span className="text-[10px] opacity-70">
            {metrics.score >= 80
              ? 'Optimal settlement tier'
              : metrics.score >= 60
              ? 'Elevated refund watch'
              : 'Critical anomaly intervention needed'}
          </span>
        </div>
      </div>

      {/* Factor Breakdown Pills */}
      <div className="grid grid-cols-3 gap-1.5 text-[10px] pt-2 border-t border-slate-500/15">
        <div className="p-1.5 rounded-lg bg-slate-500/5">
          <div className="opacity-70">Refund Rate</div>
          <div className="font-bold text-xs">{metrics.refundRatePct}%</div>
        </div>
        <div className="p-1.5 rounded-lg bg-slate-500/5">
          <div className="opacity-70">Dispute Rate</div>
          <div className="font-bold text-xs">{metrics.disputeRatePct}%</div>
        </div>
        <div className="p-1.5 rounded-lg bg-slate-500/5">
          <div className="opacity-70">Avg Release</div>
          <div className="font-bold text-xs">{metrics.avgReleaseHours}h</div>
        </div>
      </div>

      {/* Why This Score Tooltip / Popover */}
      {showWhyTooltip && (
        <div
          role="tooltip"
          className={`absolute inset-x-3 bottom-3 z-20 p-3 rounded-xl border shadow-xl text-[11px] leading-relaxed ${
            isDark
              ? 'bg-slate-950 border-slate-700 text-slate-100'
              : 'bg-slate-900 border-slate-800 text-white'
          }`}
        >
          <div className="flex items-center justify-between font-bold text-sky-400 mb-1">
            <span>Why Score is {metrics.score}/100 (Formula Breakdown)</span>
            <button
              type="button"
              onClick={() => setShowWhyTooltip(false)}
              className="text-[10px] text-slate-400 hover:text-white"
            >
              Close
            </button>
          </div>
          <ul className="space-y-1 text-[10px]">
            <li className="flex justify-between">
              <span>Base Autonomous Trust Score:</span>
              <span className="font-mono font-bold">100 pts</span>
            </li>
            <li className="flex justify-between text-rose-300">
              <span>• Refund Rate Impact ({metrics.refundRatePct}%):</span>
              <span className="font-mono font-bold">-{metrics.refundPenalty} pts</span>
            </li>
            <li className="flex justify-between text-amber-300">
              <span>• Dispute Rate Impact ({metrics.disputeRatePct}%):</span>
              <span className="font-mono font-bold">-{metrics.disputePenalty} pts</span>
            </li>
            <li className="flex justify-between text-sky-300">
              <span>• Release Time SLA ({metrics.avgReleaseHours}h vs 36h target):</span>
              <span className="font-mono font-bold">-{metrics.velocityPenalty} pts</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// CUSTOM WIDGET 3: CASH FLOW TIMELINE (Escrow Locked vs Released vs Expected Payouts)
// ============================================================================
const CashFlowTimelineWidgetComp: React.FC<AgWidgetParams<any>> = ({
  widgetApi,
}) => {
  const { dataset, filteredOrders, isLoading, isDark } = useCommandCenterWidgetContext();

  useEffect(() => {
    widgetApi.setDisplayState(isLoading ? 'loading' : 'displayed');
  }, [widgetApi, isLoading]);

  const buckets = useMemo(() => {
    const inEscrowInr = filteredOrders
      .filter((o) => o.escrowStage === 'held' || o.escrowStage === 'shipped')
      .reduce((s, o) => s + o.amountInr, 0);
    const releasedInr = filteredOrders
      .filter((o) => o.escrowStage === 'released')
      .reduce((s, o) => s + o.netRevenueAfterFeesInr, 0);

    const timelineRows = dataset.payouts.map((p) => ({
      id: p.id,
      date: p.scheduledDate,
      ref: p.payoutRef,
      status: p.status,
      grossReleasedInr: p.grossReleasedInr,
      netPayoutInr: p.netPayoutInr,
      ordersCount: p.ordersCount,
    }));

    const maxAmount = Math.max(
      1,
      ...timelineRows.map((r) => r.grossReleasedInr),
      inEscrowInr / 2
    );

    return {
      inEscrowInr,
      releasedInr,
      timelineRows,
      maxAmount,
    };
  }, [dataset.payouts, filteredOrders]);

  return (
    <div
      className={`h-full w-full flex flex-col justify-start gap-2 p-3 rounded-xl border overflow-y-auto min-h-0 ${
        isDark
          ? 'bg-slate-900/95 border-slate-800 text-slate-100'
          : 'bg-white border-slate-200/90 text-slate-900'
      }`}
      role="region"
      aria-label="Cash Flow Timeline"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
            Liquidity & Settlement Schedule
          </span>
          <h3 className="text-xs font-extrabold">
            Cash Flow Timeline (In Escrow vs Released vs Expected Payouts)
          </h3>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1 font-bold text-amber-500">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            In Escrow: {formatCompactINR(buckets.inEscrowInr)}
          </span>
          <span className="inline-flex items-center gap-1 font-bold text-emerald-500">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Net Released: {formatCompactINR(buckets.releasedInr)}
          </span>
        </div>
      </div>

      <div className="space-y-2 my-auto">
        {buckets.timelineRows.map((row) => {
          const widthPct = Math.min(100, Math.max(14, Math.round((row.netPayoutInr / buckets.maxAmount) * 100)));
          const barColor =
            row.status === 'Settled'
              ? 'bg-emerald-500'
              : row.status === 'In Clearing'
              ? 'bg-sky-500'
              : row.status === 'Scheduled'
              ? 'bg-indigo-500'
              : 'bg-amber-500';

          return (
            <div key={row.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold">{row.date}</span>
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-slate-500/10">
                    {row.status}
                  </span>
                  <span className="text-[10px] opacity-70 hidden sm:inline">
                    {row.ref} ({row.ordersCount} orders)
                  </span>
                </div>
                <span className="font-mono font-extrabold text-xs">
                  {formatCompactINR(row.netPayoutInr)}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-500/15 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// CUSTOM WIDGET 4: KPI SPARKLINE TILES (Revenue, Refund Rate, Dispute Rate, Avg Release Time)
// ============================================================================
const KpiSparklineTilesWidgetComp: React.FC<AgWidgetParams<any>> = ({
  widgetApi,
}) => {
  const { filteredOrders, isLoading, isDark } = useCommandCenterWidgetContext();

  useEffect(() => {
    widgetApi.setDisplayState(isLoading ? 'loading' : 'displayed');
  }, [widgetApi, isLoading]);

  const kpis = useMemo(() => {
    const totalCount = Math.max(1, filteredOrders.length);
    const grossRevenue = filteredOrders.reduce((s, o) => s + o.amountInr, 0);
    const netRevenue = filteredOrders.reduce((s, o) => s + o.netRevenueAfterFeesInr, 0);
    const refunded = filteredOrders.filter((o) => o.escrowStage === 'refunded').length;
    const disputed = filteredOrders.filter((o) => o.escrowStage === 'disputed').length;
    const refundRate = (refunded / totalCount) * 100;
    const disputeRate = (disputed / totalCount) * 100;
    const avgRelease =
      filteredOrders.reduce((s, o) => s + o.releaseTimeHours, 0) / totalCount;

    return [
      {
        id: 'kpi-revenue',
        label: 'Gross Escrow GMV',
        value: formatCompactINR(grossRevenue),
        subValue: `Net after fees: ${formatCompactINR(netRevenue)}`,
        points: '4,22 18,19 32,15 46,17 60,11 74,8 88,5',
        threshold: 'healthy' as const,
        badge: '+18.4%',
      },
      {
        id: 'kpi-refund-rate',
        label: 'Refund Rate',
        value: `${refundRate.toFixed(1)}%`,
        subValue: `${refunded} of ${filteredOrders.length} orders`,
        points:
          refundRate > 10
            ? '4,22 18,21 32,20 46,16 60,10 74,6 88,3'
            : '4,10 18,12 32,14 46,13 60,16 74,18 88,20',
        threshold: refundRate > 10 ? ('critical' as const) : refundRate > 6 ? ('warning' as const) : ('healthy' as const),
        badge: refundRate > 10 ? 'Spike Alert' : 'Within SLA',
      },
      {
        id: 'kpi-dispute-rate',
        label: 'Dispute Rate',
        value: `${disputeRate.toFixed(1)}%`,
        subValue: `${disputed} active arbitration holds`,
        points: '4,18 18,17 32,16 46,12 60,9 74,8 88,7',
        threshold: disputeRate > 6 ? ('critical' as const) : disputeRate > 3 ? ('warning' as const) : ('healthy' as const),
        badge: disputeRate > 5 ? 'Repeat Buyer Flag' : 'Normal',
      },
      {
        id: 'kpi-release-time',
        label: 'Avg Release Time',
        value: `${Math.round(avgRelease)}h`,
        subValue: 'Target SLA: < 48h post-dispatch',
        points: '4,8 18,10 32,12 46,15 60,17 74,18 88,20',
        threshold: avgRelease > 60 ? ('warning' as const) : ('healthy' as const),
        badge: avgRelease <= 48 ? 'Fast Track' : 'POD Delay',
      },
    ];
  }, [filteredOrders]);

  return (
    <div
      className="h-full w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 overflow-y-auto min-h-0"
      role="region"
      aria-label="Key Performance Indicator Tiles with Sparklines"
    >
      {kpis.map((tile) => {
        const toneColor =
          tile.threshold === 'healthy'
            ? 'text-emerald-500 stroke-emerald-500'
            : tile.threshold === 'warning'
            ? 'text-amber-500 stroke-amber-500'
            : 'text-rose-500 stroke-rose-500';
        const pillClass =
          tile.threshold === 'healthy'
            ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
            : tile.threshold === 'warning'
            ? 'bg-amber-500/10 text-amber-500 border-amber-500/30'
            : 'bg-rose-500/10 text-rose-500 border-rose-500/30';

        return (
          <div
            key={tile.id}
            className={`p-3.5 rounded-xl border flex flex-col justify-between ${
              isDark
                ? 'bg-slate-900/95 border-slate-800 text-slate-100'
                : 'bg-white border-slate-200/90 text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-[11px] font-bold opacity-75">{tile.label}</span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${pillClass}`}>
                {tile.badge}
              </span>
            </div>

            <div className="flex items-end justify-between gap-2 my-1.5">
              <div>
                <div className="text-xl font-black tracking-tight">{tile.value}</div>
                <div className="text-[10px] opacity-70 mt-0.5">{tile.subValue}</div>
              </div>
              <svg
                width="92"
                height="26"
                viewBox="0 0 92 26"
                className="shrink-0 overflow-visible"
                aria-hidden="true"
              >
                <polyline
                  fill="none"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={toneColor}
                  points={tile.points}
                />
              </svg>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ============================================================================
// CUSTOM WIDGET 5: RISK FEED (Flagged Transactions + Severity Badge + Quick Actions)
// ============================================================================
const RiskFeedWidgetComp: React.FC<AgWidgetParams<any>> = ({ widgetApi }) => {
  const { filteredOrders, onRowAction, isLoading, isDark } = useCommandCenterWidgetContext();
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  useEffect(() => {
    widgetApi.setDisplayState(isLoading ? 'loading' : 'displayed');
  }, [widgetApi, isLoading]);

  const flaggedOrders = useMemo(() => {
    return filteredOrders
      .filter((o) => o.anomalyTag !== 'none' || o.riskScore >= 70 || o.escrowStage === 'disputed')
      .slice(0, 12);
  }, [filteredOrders]);

  const triggerAction = async (
    order: CommandCenterOrder,
    action: 'release' | 'hold' | 'refund' | 'nudge'
  ) => {
    setBusyOrderId(order.id);
    try {
      await onRowAction(order, action);
    } finally {
      setBusyOrderId(null);
    }
  };

  return (
    <div
      className={`h-full w-full flex flex-col justify-start gap-2 p-3 rounded-xl border overflow-y-auto min-h-0 ${
        isDark
          ? 'bg-slate-900/95 border-slate-800 text-slate-100'
          : 'bg-white border-slate-200/90 text-slate-900'
      }`}
      role="region"
      aria-label="Autonomous Risk Feed and Anomaly Triage"
    >
      <div className="flex items-center justify-between gap-2 mb-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-rose-500">shield_With_heart</span>
          <div>
            <h3 className="text-xs font-extrabold uppercase tracking-tight">
              Autonomous Risk Feed ({flaggedOrders.length} Flagged)
            </h3>
            <p className="text-[10px] opacity-70">
              Surfaces planted anomalies: Refund Spike, Failed Auth Burst & Repeat Dispute Buyer
            </p>
          </div>
        </div>
      </div>

      {flaggedOrders.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 opacity-70 text-xs">
          <span className="material-symbols-outlined text-2xl text-emerald-500 mb-1">
            verified_user
          </span>
          <span>No high-risk transactions match the active cross-filter.</span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {flaggedOrders.map((ord) => {
            const sevBadge =
              ord.riskSeverity === 'Critical'
                ? 'bg-rose-500/15 text-rose-500 border-rose-500/40'
                : ord.riskSeverity === 'High'
                ? 'bg-amber-500/15 text-amber-500 border-amber-500/40'
                : 'bg-sky-500/15 text-sky-500 border-sky-500/40';

            const isBusy = busyOrderId === ord.id;

            return (
              <div
                key={ord.id}
                className={`p-2.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                  isDark
                    ? 'bg-slate-800/60 border-slate-700/80'
                    : 'bg-slate-50/90 border-slate-200/90'
                }`}
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${sevBadge}`}>
                      {ord.riskSeverity} • {ord.riskScore}
                    </span>
                    <span className="font-mono text-xs font-bold">{ord.orderNumber}</span>
                    <span className="text-xs font-semibold truncate">{ord.customerName}</span>
                    <span className="text-[10px] opacity-70">({ord.region})</span>
                  </div>
                  <p className="text-[11px] opacity-85 leading-snug">{ord.riskReason}</p>
                  <div className="text-[10px] opacity-70 font-mono">
                    {ord.productName} • {formatCompactINR(ord.amountInr)} • Stage:{' '}
                    <strong className="uppercase">{ord.escrowStage}</strong>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => triggerAction(ord, 'hold')}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 cursor-pointer"
                  >
                    Hold
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => triggerAction(ord, 'release')}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 cursor-pointer"
                  >
                    Release
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => triggerAction(ord, 'refund')}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold bg-rose-500/15 text-rose-500 hover:bg-rose-500/25 cursor-pointer"
                  >
                    Refund
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => triggerAction(ord, 'nudge')}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold bg-sky-500/15 text-sky-500 hover:bg-sky-500/25 cursor-pointer"
                  >
                    Nudge
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// REGISTER REAL AG STUDIO CUSTOM WIDGETS VIA createWidgets
// ============================================================================
const COMMAND_CENTER_WIDGETS = (createWidgets as any)({
  additionalTypes: [
    {
      id: 'escrow-pipeline',
      label: 'Escrow Pipeline',
      icon: 'data-flow',
      dataMapping: {
        fields: {
          type: 'fieldset',
          supportedRoles: ['column', 'measure'],
        },
      },
      form: (params: AgWidgetFormParams<any, any>) =>
        params.createDefaults({
          dataMappingItems: [{ key: 'fields', label: 'Pipeline Fields' }],
        }),
      comp: EscrowPipelineWidgetComp,
      defaultSize: { width: 8, height: 5 },
      minSize: { width: 4, height: 4 },
      ai: {
        description:
          'Displays AC PayPilot Escrow Pipeline (Held -> Shipped -> Released + Refunded & Disputed branches) with cross-filtering.',
      },
    },
    {
      id: 'escrow-health-score',
      label: 'Escrow Health Score',
      icon: 'gauge',
      dataMapping: {
        fields: {
          type: 'fieldset',
          supportedRoles: ['column', 'measure'],
        },
      },
      form: (params: AgWidgetFormParams<any, any>) =>
        params.createDefaults({
          dataMappingItems: [{ key: 'fields', label: 'Score Metrics' }],
        }),
      comp: EscrowHealthScoreWidgetComp,
      defaultSize: { width: 4, height: 5 },
      minSize: { width: 3, height: 4 },
      ai: {
        description:
          'Single 0-100 Escrow Health Score tile with trend arrow and Why This Score breakdown.',
      },
    },
    {
      id: 'cash-flow-timeline',
      label: 'Cash Flow Timeline',
      icon: 'line-chart',
      dataMapping: {
        fields: {
          type: 'fieldset',
          supportedRoles: ['column', 'measure'],
        },
      },
      form: (params: AgWidgetFormParams<any, any>) =>
        params.createDefaults({
          dataMappingItems: [{ key: 'fields', label: 'Cash Flow Fields' }],
        }),
      comp: CashFlowTimelineWidgetComp,
      defaultSize: { width: 6, height: 5 },
      minSize: { width: 4, height: 4 },
      ai: {
        description: 'Money in escrow vs released vs expected payout settlement dates.',
      },
    },
    {
      id: 'kpi-sparkline-tiles',
      label: 'KPI Sparkline Strip',
      icon: 'kpi-card',
      dataMapping: {
        fields: {
          type: 'fieldset',
          supportedRoles: ['column', 'measure'],
        },
      },
      form: (params: AgWidgetFormParams<any, any>) =>
        params.createDefaults({
          dataMappingItems: [{ key: 'fields', label: 'KPI Fields' }],
        }),
      comp: KpiSparklineTilesWidgetComp,
      defaultSize: { width: 12, height: 3 },
      minSize: { width: 6, height: 3 },
      ai: {
        description:
          'KPI tiles for Revenue, Refund Rate, Dispute Rate, and Avg Release Time with sparklines.',
      },
    },
    {
      id: 'risk-feed',
      label: 'Autonomous Risk Feed',
      icon: 'warning',
      dataMapping: {
        fields: {
          type: 'fieldset',
          supportedRoles: ['column', 'measure'],
        },
      },
      form: (params: AgWidgetFormParams<any, any>) =>
        params.createDefaults({
          dataMappingItems: [{ key: 'fields', label: 'Risk Fields' }],
        }),
      comp: RiskFeedWidgetComp,
      defaultSize: { width: 6, height: 5 },
      minSize: { width: 4, height: 4 },
      ai: {
        description:
          'List of flagged transactions with severity badge, anomaly reason, and quick actions.',
      },
    },
  ],
  menu: [
    {
      label: 'AC PayPilot Custom Widgets',
      widgetIds: [
        'kpi-sparkline-tiles',
        'escrow-pipeline',
        'escrow-health-score',
        'cash-flow-timeline',
        'risk-feed',
      ],
    },
    {
      label: 'Standard AG Charts & Grid',
      widgetIds: ['bar-chart-grouped', 'donut-chart', 'line-chart', 'area-chart', 'grid'],
    },
  ],
});

// ============================================================================
// SAVED VIEW REPORT STATE PRESETS ("Overview", "Escrow Ops", "Risk")
// ============================================================================
function buildReportStateForPreset(preset: SavedViewPresetId): AgReportState<any> {
  if (preset === 'escrow_ops') {
    return {
      version: '3.0.0',
      selectedPageId: 'page-escrow-ops',
      pages: [
        {
          id: 'page-escrow-ops',
          widgetLayout: {
            'w-pipeline': { xTrack: 0, yTrack: 0, xSpan: 8, ySpan: 5 },
            'w-health': { xTrack: 8, yTrack: 0, xSpan: 4, ySpan: 5 },
            'w-cashflow': { xTrack: 0, yTrack: 5, xSpan: 6, ySpan: 5 },
            'w-region-bar': { xTrack: 6, yTrack: 5, xSpan: 6, ySpan: 5 },
            'w-live-grid': { xTrack: 0, yTrack: 10, xSpan: 12, ySpan: 6 },
          },
          widgets: {
            'w-pipeline': {
              type: 'escrow-pipeline',
              dataMapping: { fields: [{ id: 'orders.escrowStage' }, { id: 'orders.amountInr' }] },
            },
            'w-health': {
              type: 'escrow-health-score',
              dataMapping: { fields: [{ id: 'orders.riskScore' }] },
            },
            'w-cashflow': {
              type: 'cash-flow-timeline',
              dataMapping: { fields: [{ id: 'orders.netRevenueAfterFeesInr' }] },
            },
            'w-region-bar': {
              type: 'bar-chart-grouped',
              format: {
                title: { text: 'Escrow Volume by Indian Region (INR)', enabled: true },
              },
              dataMapping: {
                categoryKey: [{ id: 'orders.region' }],
                valueKey: [{ id: 'orders.amountInr', aggregation: 'sum' }],
              },
            },
            'w-live-grid': {
              type: 'grid',
              format: {
                title: { text: 'Live Escrow Operations Ledger (AG Grid)', enabled: true },
              },
              dataMapping: {
                cols: [
                  { id: 'orders.orderNumber' },
                  { id: 'orders.customerName' },
                  { id: 'orders.productName' },
                  { id: 'orders.region' },
                  { id: 'orders.escrowStage' },
                  { id: 'orders.amountInr' },
                  { id: 'orders.netRevenueAfterFeesInr' },
                  { id: 'orders.ageHours' },
                  { id: 'orders.expectedPayoutDate' },
                ],
              },
            },
          } as any,
        },
      ],
    };
  }

  if (preset === 'risk') {
    return {
      version: '3.0.0',
      selectedPageId: 'page-risk',
      pages: [
        {
          id: 'page-risk',
          widgetLayout: {
            'w-kpis': { xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 3 },
            'w-risk-feed': { xTrack: 0, yTrack: 3, xSpan: 7, ySpan: 6 },
            'w-health': { xTrack: 7, yTrack: 3, xSpan: 5, ySpan: 6 },
            'w-live-grid': { xTrack: 0, yTrack: 9, xSpan: 12, ySpan: 6 },
          },
          widgets: {
            'w-kpis': {
              type: 'kpi-sparkline-tiles',
              dataMapping: { fields: [{ id: 'orders.amountInr' }] },
            },
            'w-risk-feed': {
              type: 'risk-feed',
              dataMapping: { fields: [{ id: 'orders.riskScore' }] },
            },
            'w-health': {
              type: 'escrow-health-score',
              dataMapping: { fields: [{ id: 'orders.riskScore' }] },
            },
            'w-live-grid': {
              type: 'grid',
              format: {
                title: { text: 'Flagged & Anomaly Orders Audit Grid', enabled: true },
              },
              dataMapping: {
                cols: [
                  { id: 'orders.orderNumber' },
                  { id: 'orders.customerName' },
                  { id: 'orders.region' },
                  { id: 'orders.anomalyTag' },
                  { id: 'orders.riskSeverity' },
                  { id: 'orders.riskScore' },
                  { id: 'orders.riskReason' },
                  { id: 'orders.amountInr' },
                  { id: 'orders.escrowStage' },
                ],
              },
            },
          } as any,
        },
      ],
    };
  }

  // Default: "overview" preset with all 5 custom widgets + 4 standard widgets
  return {
    version: '3.0.0',
    selectedPageId: 'page-overview',
    pages: [
      {
        id: 'page-overview',
        widgetLayout: {
          'w-kpis': { xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 3 },
          'w-pipeline': { xTrack: 0, yTrack: 3, xSpan: 8, ySpan: 5 },
          'w-health': { xTrack: 8, yTrack: 3, xSpan: 4, ySpan: 5 },
          'w-cashflow': { xTrack: 0, yTrack: 8, xSpan: 6, ySpan: 5 },
          'w-risk-feed': { xTrack: 6, yTrack: 8, xSpan: 6, ySpan: 5 },
          'w-prod-bar': { xTrack: 0, yTrack: 13, xSpan: 4, ySpan: 5 },
          'w-seg-donut': { xTrack: 4, yTrack: 13, xSpan: 4, ySpan: 5 },
          'w-region-bar': { xTrack: 8, yTrack: 13, xSpan: 4, ySpan: 5 },
          'w-live-grid': { xTrack: 0, yTrack: 18, xSpan: 12, ySpan: 6 },
        },
        widgets: {
          'w-kpis': {
            type: 'kpi-sparkline-tiles',
            dataMapping: { fields: [{ id: 'orders.amountInr' }] },
          },
          'w-pipeline': {
            type: 'escrow-pipeline',
            dataMapping: { fields: [{ id: 'orders.escrowStage' }, { id: 'orders.amountInr' }] },
          },
          'w-health': {
            type: 'escrow-health-score',
            dataMapping: { fields: [{ id: 'orders.riskScore' }] },
          },
          'w-cashflow': {
            type: 'cash-flow-timeline',
            dataMapping: { fields: [{ id: 'orders.netRevenueAfterFeesInr' }] },
          },
          'w-risk-feed': {
            type: 'risk-feed',
            dataMapping: { fields: [{ id: 'orders.riskScore' }] },
          },
          'w-prod-bar': {
            type: 'bar-chart-grouped',
            format: {
              title: { text: 'Revenue by Product (INR)', enabled: true },
            },
            dataMapping: {
              categoryKey: [{ id: 'orders.productSku' }],
              valueKey: [{ id: 'orders.amountInr', aggregation: 'sum' }],
            },
          },
          'w-seg-donut': {
            type: 'donut-chart',
            format: {
              title: { text: 'Revenue by Customer Segment', enabled: true },
            },
            dataMapping: {
              categoryKey: [{ id: 'orders.customerSegment' }],
              valueKey: [{ id: 'orders.amountInr', aggregation: 'sum' }],
            },
          },
          'w-region-bar': {
            type: 'bar-chart-grouped',
            format: {
              title: { text: 'Sales by Indian Region (Ranked Bars)', enabled: true },
            },
            dataMapping: {
              categoryKey: [{ id: 'orders.region' }],
              valueKey: [{ id: 'orders.amountInr', aggregation: 'sum' }],
            },
          },
          'w-live-grid': {
            type: 'grid',
            format: {
              title: { text: 'Live Transactions & Escrow Ledger', enabled: true },
            },
            dataMapping: {
              cols: [
                { id: 'orders.orderNumber' },
                { id: 'orders.paypalOrderId' },
                { id: 'orders.customerName' },
                { id: 'orders.customerSegment' },
                { id: 'orders.productName' },
                { id: 'orders.region' },
                { id: 'orders.escrowStage' },
                { id: 'orders.amountInr' },
                { id: 'orders.escrowFeeInr' },
                { id: 'orders.netRevenueAfterFeesInr' },
                { id: 'orders.riskSeverity' },
              ],
            },
          },
        } as any,
      },
    ],
  };
}

interface SellerCommandCenterScreenProps {
  showToast: (msg: string) => void;
}

export const SellerCommandCenterScreen: React.FC<SellerCommandCenterScreenProps> = ({
  showToast,
}) => {
  const studioApiRef = useRef<AgStudioApi | null>(null);

  // Persisted Light / Dark theme toggle
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ac_paypilot_cc_theme') === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('ac_paypilot_cc_theme', isDark ? 'dark' : 'light');
    } catch {
      // Ignore storage quota errors
    }
  }, [isDark]);

  // Demo Mode vs Live Firestore Mode toggle (defaults to Demo Mode so 60+ days + 3 anomalies are immediately visible)
  const [isDemoMode, setIsDemoMode] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Simulated Refund Spike state (injects new refunds over ~10 seconds)
  const [isSimulatingSpike, setIsSimulatingSpike] = useState<boolean>(false);
  const [spikeTickCount, setSpikeTickCount] = useState<number>(0);
  const [simulatedOrders, setSimulatedOrders] = useState<CommandCenterOrder[]>([]);
  const spikeIntervalRef = useRef<number | null>(null);

  // Live dataset state + Real-time Order Toast
  const [liveDataset, setLiveDataset] = useState<CommandCenterDataset | null>(null);
  const [liveOrderToast, setLiveOrderToast] = useState<LiveOrderNotification | null>(null);

  // Local overrides when user clicks Release, Hold, Refund, Nudge buyer
  const [orderOverrides, setOrderOverrides] = useState<Record<string, CommandCenterOrder>>({});

  // Saved Views ("Overview", "Escrow Ops", "Risk") & Studio Mode ("edit" | "view")
  const [activeView, setActiveView] = useState<SavedViewPresetId>('overview');
  const [studioMode, setStudioMode] = useState<AgStudioMode>('edit');
  const [reportState, setReportState] = useState<AgReportState>(() =>
    buildReportStateForPreset('overview')
  );

  // Cross-filtering state shared across all widgets
  const [crossFilter, setCrossFilter] = useState<ActiveCrossFilter>({
    dimension: null,
    value: null,
  });

  // Custom Calculations UI state
  const [showCalcModal, setShowCalcModal] = useState<boolean>(false);
  const [customExpressions, setCustomExpressions] = useState<AgExpressionFieldDefinition[]>([]);
  const [newCalcName, setNewCalcName] = useState<string>('Net Margin After Logistics');
  const [newCalcFormula, setNewCalcFormula] = useState<string>(
    'orders.amountInr - orders.escrowFeeInr - orders.gstAmountInr - 450'
  );

  // Subscribe to real-time Firestore updates when in Live Mode
  useEffect(() => {
    if (isDemoMode) return;
    setIsLoading(true);
    const unsub = subscribeCommandCenterLiveData(DEFAULT_BIZ_ID, (data) => {
      setLiveDataset(data);
      setIsLoading(false);
    });
    return () => unsub();
  }, [isDemoMode]);

  // Subscribe to real-time customer order notifications (Storefront, PayPal Checkout, Cross-Tab, SSE)
  useEffect(() => {
    let toastTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeNewOrderNotifications(DEFAULT_BIZ_ID, (notif) => {
      setLiveOrderToast(notif);
      const amountInr = Number(notif.totalInr || 8499);
      const feeInr = Math.round(amountInr * 0.015);
      const gstInr = Math.round(amountInr * 0.18);
      const incomingOrder: CommandCenterOrder = {
        id: notif.id,
        orderNumber: notif.orderNumber,
        paypalOrderId: `PP-LIVE-${notif.id.slice(-6).toUpperCase()}`,
        customerId: 'cust-live',
        customerName: notif.customerName,
        customerEmail: notif.rawOrder?.customerEmail || 'buyer@verified.in',
        customerSegment: amountInr >= 50000 ? 'Enterprise B2B' : 'Retail Direct',
        productId: 'prod-live',
        productSku: notif.rawOrder?.items?.[0]?.sku || 'FAN-BLDC-892',
        productName: notif.productSummary,
        category: 'Smart Appliances',
        region: 'Maharashtra',
        city: 'Mumbai',
        quantity: notif.rawOrder?.items?.[0]?.quantity || 1,
        amountInr,
        escrowFeeInr: feeInr,
        gstAmountInr: gstInr,
        netRevenueAfterFeesInr: amountInr - feeInr - Math.round(feeInr * 0.18),
        escrowStage: 'held',
        paymentStatus: 'Captured',
        ageHours: 1,
        releaseTimeHours: 0,
        riskScore: 12,
        riskSeverity: 'Normal',
        riskReason: 'Verified PayPal Escrow Lock',
        anomalyTag: 'none',
        createdAt: notif.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expectedPayoutDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      };
      setSimulatedOrders((prev) =>
        prev.some((o) => o.id === incomingOrder.id || o.orderNumber === incomingOrder.orderNumber)
          ? prev
          : [incomingOrder, ...prev]
      );
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        setLiveOrderToast((current) => (current?.id === notif.id ? null : current));
      }, 7000);
    });

    return () => {
      unsub();
      if (toastTimer) clearTimeout(toastTimer);
    };
  }, []);

  // Clean up simulation timer on unmount
  useEffect(() => {
    return () => {
      if (spikeIntervalRef.current) {
        window.clearInterval(spikeIntervalRef.current);
      }
    };
  }, []);

  // Build active dataset (strictly isolating Demo Mode seed data from real user data)
  const activeDataset = useMemo<CommandCenterDataset>(() => {
    const base = isDemoMode
      ? buildSeededCommandCenterDataset(simulatedOrders, [])
      : liveDataset || buildSeededCommandCenterDataset([], []);

    const mergedOrders = base.orders.map((ord) => orderOverrides[ord.id] || ord);
    return {
      ...base,
      orders: mergedOrders,
    };
  }, [isDemoMode, simulatedOrders, liveDataset, orderOverrides]);

  // Filtered orders based on active cross-filter (Product, Region, Segment, or Escrow Stage)
  const filteredOrders = useMemo<CommandCenterOrder[]>(() => {
    if (!crossFilter.dimension || !crossFilter.value) {
      return activeDataset.orders;
    }
    return activeDataset.orders.filter((o) => {
      if (crossFilter.dimension === 'escrowStage') return o.escrowStage === crossFilter.value;
      if (crossFilter.dimension === 'region') return o.region === crossFilter.value;
      if (crossFilter.dimension === 'productSku') return o.productSku === crossFilter.value;
      if (crossFilter.dimension === 'customerSegment')
        return o.customerSegment === crossFilter.value;
      return true;
    });
  }, [activeDataset.orders, crossFilter]);

  // Build AG Studio data sources definition with filtered data & custom expressions
  const agDataSources = useMemo(() => {
    return buildAgStudioDataSources(
      {
        ...activeDataset,
        orders: filteredOrders,
      },
      customExpressions
    );
  }, [activeDataset, filteredOrders, customExpressions]);

  // Custom AG Studio Theme matching AC PayPilot brand (Light & Dark modes)
  const customAgTheme = useMemo(() => {
    return studioTheme.withParams(
      {
        accentColor: isDark ? '#38BDF8' : '#0052CC',
        backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
        foregroundColor: isDark ? '#F8FAFC' : '#0F172A',
        borderColor: isDark ? '#1E293B' : '#E2E8F0',
        borderRadius: 12,
        fontFamily: '"Plus Jakarta Sans", "Inter", system-ui, sans-serif',
        fontSize: 13,
        browserColorScheme: isDark ? 'dark' : 'light',
      },
      isDark ? 'acPayPilotDark' : 'acPayPilotLight'
    );
  }, [isDark]);

  // Handle "Simulate refund spike" (~10 seconds progressive injection)
  const handleSimulateRefundSpike = useCallback(() => {
    if (isSimulatingSpike) return;
    if (!isDemoMode) {
      setIsDemoMode(true);
    }
    setIsSimulatingSpike(true);
    setSpikeTickCount(0);
    showToast('Simulating real-time Refund Spike over 10 seconds (Demo Sandbox isolated)...');

    let currentTick = 0;
    const totalTicks = 5; // 5 waves every 2 seconds = 10 seconds
    spikeIntervalRef.current = window.setInterval(() => {
      currentTick += 1;
      const { order } = createSimulatedRefundSpikeTick(currentTick);
      setSimulatedOrders((prev) => [order, ...prev]);
      setSpikeTickCount(currentTick);

      if (currentTick >= totalTicks) {
        if (spikeIntervalRef.current) {
          window.clearInterval(spikeIntervalRef.current);
          spikeIntervalRef.current = null;
        }
        setIsSimulatingSpike(false);
        showToast('Refund Spike simulation complete: 5 high-velocity refunds injected.');
      }
    }, 2000);
  }, [isSimulatingSpike, isDemoMode, showToast]);

  // Handle row actions: Release, Hold, Refund, Nudge buyer
  const handleRowAction = useCallback(
    async (order: CommandCenterOrder, action: 'release' | 'hold' | 'refund' | 'nudge') => {
      const { updatedOrder } = await executeCommandCenterRowAction({
        order,
        action,
        isDemoMode,
      });

      setOrderOverrides((prev) => ({
        ...prev,
        [order.id]: updatedOrder,
      }));

      const actionLabels: Record<'release' | 'hold' | 'refund' | 'nudge', string> = {
        release: `Escrow released for ${order.orderNumber} (${formatCompactINR(order.amountInr)})`,
        hold: `Compliance hold placed on ${order.orderNumber}`,
        refund: `PayPal Sandbox refund issued for ${order.orderNumber} (${formatCompactINR(order.amountInr)})`,
        nudge: `Delivery confirmation nudge sent to ${order.customerName} (${order.customerEmail})`,
      };
      showToast(actionLabels[action]);
    },
    [isDemoMode, showToast]
  );

  // Switch Saved View preset ("Overview", "Escrow Ops", "Risk")
  const handleSwitchSavedView = (preset: SavedViewPresetId) => {
    setActiveView(preset);
    const nextState = buildReportStateForPreset(preset);
    setReportState(nextState);
    if (studioApiRef.current) {
      try {
        studioApiRef.current.setState(nextState);
      } catch {
        // Fallback handled by controlled state prop
      }
    }
    const labelMap: Record<SavedViewPresetId, string> = {
      overview: 'Overview',
      escrow_ops: 'Escrow Ops',
      risk: 'Risk & Anomalies',
    };
    showToast(`Switched Command Center view to "${labelMap[preset]}"`);
  };

  // Undo / Redo handlers using AG Studio API
  const handleUndo = () => {
    try {
      studioApiRef.current?.undo();
    } catch {
      // No undo steps available
    }
  };

  const handleRedo = () => {
    try {
      studioApiRef.current?.redo();
    } catch {
      // No redo steps available
    }
  };

  // Add custom calculated expression field
  const handleAddCustomCalculation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCalcName.trim() || !newCalcFormula.trim()) return;
    const exprId = `calc_${Date.now().toString().slice(-5)}`;
    const newExpr: AgExpressionFieldDefinition = {
      id: exprId,
      name: newCalcName.trim(),
      description: `Custom seller formula: ${newCalcFormula.trim()}`,
      format: 'decimalFormat',
      isMeasure: false,
      expression: newCalcFormula.trim(),
    };
    setCustomExpressions((prev) => [...prev, newExpr]);
    setShowCalcModal(false);
    showToast(`Added custom calculation "${newExpr.name}" to AG Studio schema.`);
  };

  const widgetContextValue = useMemo<CommandCenterWidgetContextValue>(
    () => ({
      dataset: activeDataset,
      filteredOrders,
      crossFilter,
      setCrossFilter,
      onRowAction: handleRowAction,
      isLoading,
      errorMessage,
      isDark,
      isSimulatingSpike,
    }),
    [
      activeDataset,
      filteredOrders,
      crossFilter,
      handleRowAction,
      isLoading,
      errorMessage,
      isDark,
      isSimulatingSpike,
    ]
  );

  // Distinct regions & products for quick cross-filter bar
  const regions = useMemo(
    () => Array.from(new Set(activeDataset.orders.map((o) => o.region))),
    [activeDataset.orders]
  );
  const topProducts = useMemo(
    () => activeDataset.products.slice(0, 6),
    [activeDataset.products]
  );

  return (
    <div
      data-testid="seller-command-center-screen"
      className={`min-h-[calc(100vh-6rem)] rounded-2xl border p-4 sm:p-6 transition-colors flex flex-col gap-5 ${
        isDark
          ? 'bg-slate-950 border-slate-800 text-slate-100'
          : 'bg-slate-50/70 border-slate-200/80 text-slate-900'
      }`}
    >
      {/* Subtle Real-Time Seller Toast Notification */}
      {liveOrderToast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-20 right-6 z-50 w-full max-w-sm rounded-2xl backdrop-blur-md border border-emerald-500/35 shadow-lg p-4 transition-all duration-300 ${
            isDark ? 'bg-slate-900/95 text-slate-100' : 'bg-white/95 text-slate-900'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="mt-0.5 w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-500">
                    New Customer Order
                  </span>
                  <span className="text-[11px] font-mono font-semibold opacity-75">
                    {liveOrderToast.orderNumber}
                  </span>
                </div>
                <p className="text-xs font-bold truncate">{liveOrderToast.customerName}</p>
                <p className="text-[11px] opacity-80 truncate">
                  {liveOrderToast.productSummary} •{' '}
                  <span className="font-bold font-mono">
                    {formatFullINR(liveOrderToast.totalInr)}
                  </span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLiveOrderToast(null)}
              aria-label="Dismiss order notification"
              className="opacity-65 hover:opacity-100 p-1 rounded-lg transition-opacity shrink-0"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        </div>
      )}

      {/* Top Command Center Header & Controls Bar */}
      <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-4 border-b border-slate-500/15">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-sky-500/15 text-sky-500 border border-sky-500/30">
              <span className="material-symbols-outlined text-[13px]">bolt</span>
              <span>AG Studio Enterprise • Seller Command Center</span>
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                isDemoMode
                  ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
                  : 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
              }`}
            >
              {isDemoMode
                ? 'Demo Mode (65d Seed + 3 Anomalies • Isolated)'
                : 'Live Firestore + PayPal Sandbox Stream'}
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight mt-0.5">
            AC PayPilot Seller Command Center
          </h1>
          <p className="text-xs opacity-75">
            Autonomous Escrow Telemetry, Cross-Filtered AG Studio Custom Widgets & Live Sandbox Action Center
          </p>
        </div>

        {/* Action Toolbar: Saved Views, Demo Mode, Simulate Refund Spike, Undo/Redo, Calculations, Theme */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Saved Views Switcher */}
          <div
            className={`inline-flex items-center p-1 rounded-xl border ${
              isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}
            role="group"
            aria-label="Saved Views Switcher"
          >
            {(
              [
                { id: 'overview', label: 'Overview', icon: 'dashboard' },
                { id: 'escrow_ops', label: 'Escrow Ops', icon: 'account_tree' },
                { id: 'risk', label: 'Risk', icon: 'gpp_maybe' },
              ] as const
            ).map((v) => {
              const active = activeView === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => handleSwitchSavedView(v.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                    active
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'opacity-75 hover:opacity-100'
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px]">{v.icon}</span>
                  <span>{v.label}</span>
                </button>
              );
            })}
          </div>

          {/* Demo Mode Toggle */}
          <button
            type="button"
            data-testid="command-center-demo-toggle"
            onClick={() => {
              setIsDemoMode((prev) => !prev);
              setCrossFilter({ dimension: null, value: null });
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all cursor-pointer ${
              isDemoMode
                ? 'bg-amber-500/15 text-amber-500 border-amber-500/40 hover:bg-amber-500/25'
                : 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40 hover:bg-emerald-500/25'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">
              {isDemoMode ? 'science' : 'cloud_sync'}
            </span>
            <span>{isDemoMode ? 'Demo Mode: ON' : 'Live Mode: ON'}</span>
          </button>

          {/* Simulate Refund Spike Button (~10s live stream) */}
          <button
            type="button"
            data-testid="simulate-refund-spike-btn"
            disabled={isSimulatingSpike}
            onClick={handleSimulateRefundSpike}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all cursor-pointer ${
              isSimulatingSpike
                ? 'bg-rose-600 text-white border-rose-500 animate-pulse'
                : 'bg-rose-500/15 text-rose-500 border-rose-500/40 hover:bg-rose-500/25'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">warning</span>
            <span>
              {isSimulatingSpike
                ? `Simulating Spike (${spikeTickCount}/5)...`
                : 'Simulate refund spike'}
            </span>
          </button>

          {/* Calculations UI Trigger */}
          <button
            type="button"
            onClick={() => setShowCalcModal(true)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 cursor-pointer ${
              isDark
                ? 'bg-slate-900 border-slate-700 hover:bg-slate-800'
                : 'bg-white border-slate-200 hover:bg-slate-100'
            }`}
          >
            <span className="material-symbols-outlined text-[15px] text-sky-500">function</span>
            <span>Calculations ({2 + customExpressions.length})</span>
          </button>

          {/* Drag/Resize Edit vs View Mode + Undo/Redo */}
          <div
            className={`inline-flex items-center p-1 rounded-xl border gap-1 ${
              isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            <button
              type="button"
              onClick={() => setStudioMode((m) => (m === 'edit' ? 'view' : 'edit'))}
              title="Toggle Drag/Resize Layout Mode"
              className="px-2 py-1 rounded-lg text-[11px] font-bold bg-sky-500/10 text-sky-500 hover:bg-sky-500/20 cursor-pointer"
            >
              {studioMode === 'edit' ? 'Layout: Edit' : 'Layout: Locked'}
            </button>
            <button
              type="button"
              onClick={handleUndo}
              title="Undo Layout Change"
              aria-label="Undo"
              className="p-1 rounded-lg hover:bg-slate-500/10 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">undo</span>
            </button>
            <button
              type="button"
              onClick={handleRedo}
              title="Redo Layout Change"
              aria-label="Redo"
              className="p-1 rounded-lg hover:bg-slate-500/10 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">redo</span>
            </button>
          </div>

          {/* Persisted Light / Dark Theme Toggle */}
          <button
            type="button"
            data-testid="command-center-theme-toggle"
            onClick={() => setIsDark((d) => !d)}
            aria-label="Toggle Command Center Light or Dark Theme"
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1 cursor-pointer ${
              isDark
                ? 'bg-slate-900 border-slate-700 text-amber-400'
                : 'bg-white border-slate-200 text-slate-700'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">
              {isDark ? 'light_mode' : 'dark_mode'}
            </span>
            <span>{isDark ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </header>

      {/* Interactive Cross-Filter Pill Strip (Product, Region, Escrow Stage) */}
      <section
        aria-label="Cross-Filtering Bar"
        className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs ${
          isDark
            ? 'bg-slate-900/80 border-slate-800'
            : 'bg-white border-slate-200/80'
        }`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-bold uppercase tracking-wider text-[10px] opacity-70 mr-1 flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px] text-sky-500">filter_alt</span>
            Cross-Filter All Widgets:
          </span>

          {/* Region pills */}
          {regions.map((reg) => {
            const active = crossFilter.dimension === 'region' && crossFilter.value === reg;
            return (
              <button
                key={reg}
                type="button"
                onClick={() =>
                  setCrossFilter(
                    active ? { dimension: null, value: null } : { dimension: 'region', value: reg }
                  )
                }
                className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                  active
                    ? 'bg-sky-600 text-white border-sky-500'
                    : 'border-slate-500/20 hover:border-sky-500/40'
                }`}
              >
                {reg}
              </button>
            );
          })}

          <span className="opacity-30 mx-1">|</span>

          {/* Top Product SKU pills */}
          {topProducts.map((prod) => {
            const active =
              crossFilter.dimension === 'productSku' && crossFilter.value === prod.sku;
            return (
              <button
                key={prod.sku}
                type="button"
                onClick={() =>
                  setCrossFilter(
                    active
                      ? { dimension: null, value: null }
                      : { dimension: 'productSku', value: prod.sku }
                  )
                }
                className={`px-2 py-0.5 rounded-lg text-[11px] font-mono font-semibold border transition-all cursor-pointer ${
                  active
                    ? 'bg-indigo-600 text-white border-indigo-500'
                    : 'border-slate-500/20 hover:border-indigo-500/40'
                }`}
              >
                {prod.sku}
              </button>
            );
          })}
        </div>

        {crossFilter.dimension && crossFilter.value && (
          <button
            type="button"
            onClick={() => setCrossFilter({ dimension: null, value: null })}
            className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-500/15 text-rose-500 hover:bg-rose-500/25 cursor-pointer flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[13px]">close</span>
            <span>
              Reset Filter ({crossFilter.dimension}: {crossFilter.value})
            </span>
          </button>
        )}
      </section>

      {/* AG STUDIO CANVAS (Custom Widgets + Standard AG Charts & AG Grid) */}
      <CommandCenterWidgetContext.Provider value={widgetContextValue}>
        <AgStudioProvider licenseKey={cleanAgStudioLicense || undefined}>
          <div
            className={`w-full min-h-[760px] rounded-2xl border overflow-hidden shadow-xs ${
              isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            <AgStudio
              mode={studioMode}
              theme={customAgTheme}
              data={agDataSources}
              widgets={COMMAND_CENTER_WIDGETS}
              initialState={reportState}
              onApiReady={(event: AgStudioApiReadyEvent) => {
                studioApiRef.current = event.api;
              }}
              onStateUpdated={(event: AgStudioStateUpdatedEvent) => {
                setReportState(event.state);
              }}
            />
          </div>
        </AgStudioProvider>
      </CommandCenterWidgetContext.Provider>

      {/* Live Transactions Interactive Row Action Dock (Release, Hold, Refund, Nudge Buyer) */}
      <section
        aria-label="Live Transactions Row Actions"
        className={`p-4 rounded-2xl border ${
          isDark ? 'bg-slate-900/95 border-slate-800' : 'bg-white border-slate-200'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-sm font-extrabold flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-sky-500">
                table_view
              </span>
              <span>Live Transactions Action Center (Direct Escrow & Buyer Controls)</span>
            </h2>
            <p className="text-[11px] opacity-70">
              Showing {Math.min(10, filteredOrders.length)} of {filteredOrders.length} cross-filtered orders • Every action records an immutable EscrowEvent
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-500/20 text-[10px] uppercase tracking-wider opacity-70">
                <th className="py-2 px-2.5">Order / PayPal ID</th>
                <th className="py-2 px-2.5">Buyer & Segment</th>
                <th className="py-2 px-2.5">Product & Region</th>
                <th className="py-2 px-2.5">Escrow Stage</th>
                <th className="py-2 px-2.5 text-right">Gross (INR)</th>
                <th className="py-2 px-2.5 text-right">Net After Fees</th>
                <th className="py-2 px-2.5 text-right">Row Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-500/10">
              {filteredOrders.slice(0, 10).map((ord) => {
                const stageBadge =
                  ord.escrowStage === 'released'
                    ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
                    : ord.escrowStage === 'shipped'
                    ? 'bg-sky-500/15 text-sky-500 border-sky-500/30'
                    : ord.escrowStage === 'held'
                    ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
                    : ord.escrowStage === 'refunded'
                    ? 'bg-rose-500/15 text-rose-500 border-rose-500/30'
                    : 'bg-purple-500/15 text-purple-500 border-purple-500/30';

                return (
                  <tr key={ord.id} className="hover:bg-slate-500/5 transition-colors">
                    <td className="py-2.5 px-2.5 font-mono">
                      <div className="font-bold">{ord.orderNumber}</div>
                      <div className="text-[10px] opacity-65">{ord.paypalOrderId}</div>
                    </td>
                    <td className="py-2.5 px-2.5">
                      <div className="font-bold">{ord.customerName}</div>
                      <div className="text-[10px] opacity-70">
                        {ord.customerSegment} • {ord.customerEmail}
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5">
                      <div className="font-semibold truncate max-w-[200px]">{ord.productName}</div>
                      <div className="text-[10px] opacity-70">
                        {ord.productSku} • {ord.region} ({ord.city})
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border ${stageBadge}`}
                      >
                        {ord.escrowStage}
                      </span>
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono font-bold">
                      <div>{formatCompactINR(ord.amountInr)}</div>
                      <div className="text-[10px] opacity-60">{formatFullINR(ord.amountInr)}</div>
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono font-bold text-emerald-500">
                      {formatCompactINR(ord.netRevenueAfterFeesInr)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleRowAction(ord, 'release')}
                          className="px-2 py-1 rounded-lg text-[10px] font-bold bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 cursor-pointer"
                        >
                          Release
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRowAction(ord, 'hold')}
                          className="px-2 py-1 rounded-lg text-[10px] font-bold bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 cursor-pointer"
                        >
                          Hold
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRowAction(ord, 'refund')}
                          className="px-2 py-1 rounded-lg text-[10px] font-bold bg-rose-500/15 text-rose-500 hover:bg-rose-500/25 cursor-pointer"
                        >
                          Refund
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRowAction(ord, 'nudge')}
                          className="px-2 py-1 rounded-lg text-[10px] font-bold bg-sky-500/15 text-sky-500 hover:bg-sky-500/25 cursor-pointer"
                        >
                          Nudge buyer
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Custom Calculations Builder Modal */}
      {showCalcModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="AG Studio Custom Calculations Builder"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            className={`w-full max-w-lg rounded-2xl border p-5 shadow-2xl ${
              isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-500/20">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-sky-500">function</span>
                <h3 className="text-sm font-extrabold">
                  AG Studio Calculations UI (Custom Expression Fields)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCalcModal(false)}
                className="text-xs opacity-70 hover:opacity-100 cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="my-3 space-y-2 text-xs">
              <div className="font-bold opacity-80">Active Calculated Fields in Schema:</div>
              <div className="p-2.5 rounded-xl bg-slate-500/10 font-mono text-[11px] space-y-1">
                <div>
                  <strong className="text-sky-500">Net Revenue After Fees:</strong>{' '}
                  orders.amountInr - orders.escrowFeeInr - orders.gstAmountInr
                </div>
                <div>
                  <strong className="text-sky-500">Effective Take Rate %:</strong>{' '}
                  ((orders.escrowFeeInr + orders.gstAmountInr) / orders.amountInr) * 100
                </div>
                {customExpressions.map((exp) => (
                  <div key={exp.id}>
                    <strong className="text-emerald-500">{exp.name}:</strong>{' '}
                    {String(exp.expression)}
                  </div>
                ))}
              </div>
            </div>

            <form onSubmit={handleAddCustomCalculation} className="space-y-3 mt-4">
              <div>
                <label className="block text-xs font-bold mb-1">Field Label</label>
                <input
                  type="text"
                  value={newCalcName}
                  onChange={(e) => setNewCalcName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-500/30 bg-transparent text-xs font-semibold"
                  placeholder="e.g. Net Revenue After Courier Reserve"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">
                  AG Studio Expression Formula
                </label>
                <input
                  type="text"
                  value={newCalcFormula}
                  onChange={(e) => setNewCalcFormula(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-500/30 bg-transparent text-xs font-mono"
                  placeholder="orders.amountInr - orders.escrowFeeInr - orders.gstAmountInr"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCalcModal(false)}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-500/30 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl text-xs font-bold bg-sky-600 text-white hover:bg-sky-500 cursor-pointer"
                >
                  Add Expression to AG Studio
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
