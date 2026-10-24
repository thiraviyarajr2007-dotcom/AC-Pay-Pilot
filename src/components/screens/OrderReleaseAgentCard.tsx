import React from 'react';
import { UserRole } from '../../types';
import {
  ALLOWED_ESCROW_TRANSITIONS,
  EscrowState,
  formatEscrowStateLabel,
  isRoleAllowedForEscrowTransition,
} from '../../utils/escrow';
import { OrderRecord } from './OrdersScreen';

export interface EscrowAgentRecommendation {
  source: 'live' | 'fallback';
  fallbackReason?: string;
  orderId: string;
  recommendation: 'release' | 'hold' | 'dispute';
  confidence: number;
  reasons: string[];
}

interface OrderReleaseAgentCardProps {
  activeMoneyOrder: OrderRecord;
  activeEscrowState: EscrowState;
  aiEscrowRec: EscrowAgentRecommendation | null;
  aiRecLoading: boolean;
  role: UserRole;
  onRefreshRecommendation: () => void;
  onTransitionEscrow: (order: OrderRecord, targetState: EscrowState) => void;
}

export const OrderReleaseAgentCard: React.FC<OrderReleaseAgentCardProps> = ({
  activeMoneyOrder,
  activeEscrowState,
  aiEscrowRec,
  aiRecLoading,
  role,
  onRefreshRecommendation,
  onTransitionEscrow,
}) => {
  return (
    <div
      data-testid="ai-escrow-release-agent-card"
      className="bg-surface-container-lowest rounded-xl border border-surface-container-high p-5 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2.5 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed text-[11px] font-semibold uppercase tracking-wider">
            Delivery &amp; Escrow Review
          </span>
          {aiEscrowRec && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-surface-container text-secondary">
              {aiEscrowRec.source === 'live' ? 'Live' : 'Estimated'}
            </span>
          )}
          <span className="text-xs text-secondary">
            Order <strong className="text-on-surface">{activeMoneyOrder.id}</strong> •{' '}
            {formatEscrowStateLabel(activeEscrowState)}
          </span>
        </div>

        <button
          type="button"
          onClick={onRefreshRecommendation}
          disabled={aiRecLoading}
          className="px-3 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-semibold cursor-pointer"
        >
          {aiRecLoading ? 'Checking Delivery...' : 'Refresh Review'}
        </button>
      </div>

      {aiEscrowRec && (
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 rounded-xl bg-surface-container-low border border-surface-container-high">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-on-surface">Suggested Action:</span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase ${
                  aiEscrowRec.recommendation === 'release'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : aiEscrowRec.recommendation === 'dispute'
                    ? 'bg-error-container text-on-error-container'
                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                }`}
              >
                {aiEscrowRec.recommendation}
              </span>
              <span className="text-xs font-tabular-nums text-secondary">
                Confidence: <strong className="text-on-surface">{Math.round(aiEscrowRec.confidence * 100)}%</strong>
              </span>
            </div>
            <ul className="list-disc list-inside text-xs text-secondary space-y-0.5">
              {aiEscrowRec.reasons.map((r, idx) => (
                <li key={idx}>{r}</li>
              ))}
            </ul>
            <p className="text-[11px] text-secondary">
              Funds are held safely until you confirm delivery or open a dispute below.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {aiEscrowRec.recommendation === 'release' &&
              ALLOWED_ESCROW_TRANSITIONS[activeEscrowState]?.includes('released') && (
                <button
                  type="button"
                  disabled={!isRoleAllowedForEscrowTransition('released', role)}
                  onClick={() => onTransitionEscrow(activeMoneyOrder, 'released')}
                  className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-container disabled:opacity-40 text-on-primary text-xs font-semibold cursor-pointer"
                >
                  Confirm &amp; Release Payment
                </button>
              )}
            {aiEscrowRec.recommendation === 'hold' &&
              ALLOWED_ESCROW_TRANSITIONS[activeEscrowState]?.includes('in_delivery') && (
                <button
                  type="button"
                  disabled={!isRoleAllowedForEscrowTransition('in_delivery', role)}
                  onClick={() => onTransitionEscrow(activeMoneyOrder, 'in_delivery')}
                  className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-container disabled:opacity-40 text-on-primary text-xs font-semibold cursor-pointer"
                >
                  Mark In Transit
                </button>
              )}
            {ALLOWED_ESCROW_TRANSITIONS[activeEscrowState]?.includes('disputed') && (
              <button
                type="button"
                disabled={!isRoleAllowedForEscrowTransition('disputed', role)}
                onClick={() => onTransitionEscrow(activeMoneyOrder, 'disputed')}
                className="px-3.5 py-2 rounded-xl bg-surface-container-lowest border border-surface-container-high hover:bg-surface-container disabled:opacity-40 text-on-surface text-xs font-semibold cursor-pointer"
              >
                Open Dispute
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
