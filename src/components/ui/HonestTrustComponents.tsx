import React, { useState } from 'react';
import { formatINR } from '../../utils/finance';
import { DataSource } from '../../types';

export type CanonicalPaymentState =
  | 'Pending'
  | 'Authorized'
  | 'Captured'
  | 'Failed'
  | 'Cancelled'
  | 'Refunded';

export const PAYMENT_STATE_META: Record<
  CanonicalPaymentState,
  {
    label: string;
    shortDesc: string;
    badgeClass: string;
    dotClass: string;
    icon: string;
  }
> = {
  Pending: {
    label: 'Pending',
    shortDesc: 'Awaiting payment confirmation',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
    dotClass: 'bg-amber-500',
    icon: 'fa-clock',
  },
  Authorized: {
    label: 'Authorized (Held)',
    shortDesc: 'Funds reserved in escrow until delivery',
    badgeClass: 'bg-primary-fixed text-on-primary-fixed border-primary-fixed-dim',
    dotClass: 'bg-primary',
    icon: 'fa-shield-halved',
  },
  Captured: {
    label: 'Paid',
    shortDesc: 'Payment confirmed',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    dotClass: 'bg-emerald-600',
    icon: 'fa-circle-check',
  },
  Failed: {
    label: 'Declined',
    shortDesc: 'Payment declined or timed out',
    badgeClass: 'bg-error-container text-on-error-container border-error/20',
    dotClass: 'bg-error',
    icon: 'fa-triangle-exclamation',
  },
  Cancelled: {
    label: 'Cancelled',
    shortDesc: 'Cancelled before payment completion',
    badgeClass: 'bg-surface-container text-secondary border-outline-variant',
    dotClass: 'bg-outline',
    icon: 'fa-ban',
  },
  Refunded: {
    label: 'Refunded',
    shortDesc: 'Returned to buyer',
    badgeClass: 'bg-tertiary-fixed text-on-tertiary-fixed border-tertiary-fixed-dim',
    dotClass: 'bg-tertiary',
    icon: 'fa-rotate-left',
  },
};

export const PaymentStateBadge: React.FC<{
  state: CanonicalPaymentState;
  serverConfirmed?: boolean;
  size?: 'sm' | 'md';
}> = ({ state, serverConfirmed = true, size = 'sm' }) => {
  const effectiveState: CanonicalPaymentState =
    state === 'Captured' && !serverConfirmed ? 'Authorized' : state;
  const meta = PAYMENT_STATE_META[effectiveState];

  return (
    <span
      data-testid="payment-state-badge"
      data-payment-state={effectiveState}
      title={meta.shortDesc}
      className={`inline-flex items-center gap-1.5 rounded-md border font-semibold whitespace-nowrap tracking-tight ${
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
      } ${meta.badgeClass}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dotClass}`}></span>
      <span>{meta.label}</span>
    </span>

  );
};

export const PaymentStatesLegendStrip: React.FC<{
  serverConfirmed: boolean;
  onToggleServerConfirmed?: () => void;
}> = () => {
  return null;
};

export interface MoneyBreakdownProps {
  title?: string;
  currency?: 'INR' | 'USD';
  subtotal: number;
  taxLabel?: string;
  taxAmount: number;
  feeLabel?: string;
  feeAmount?: number;
  isFeesVerified?: boolean;
  payoutLabel?: string;
  payoutAmount?: number;
  total: number;
  compact?: boolean;
  onVerifyFees?: () => void;
}

export const MoneyBreakdownCard: React.FC<MoneyBreakdownProps> = ({
  title = 'Price Summary',
  currency = 'INR',
  subtotal,
  taxLabel = 'GST (18%)',
  taxAmount,
  feeLabel = 'PayPal Fee',
  feeAmount,
  isFeesVerified = false,
  payoutLabel = 'Net Seller Payout',
  payoutAmount,
  total,
  compact = false,
  onVerifyFees,
}) => {
  const fmt = (val: number) => `${currency} ${formatINR(val)}`;

  return (
    <div
      data-testid="money-breakdown-card"
      className={`rounded-xl bg-surface-container-low border border-surface-container-high ${
        compact ? 'p-3.5 space-y-2' : 'p-5 space-y-3'
      }`}
    >
      <div className="flex items-center justify-between border-b border-surface-container-high pb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-on-surface">
          {title}
        </span>
        <span
          data-testid="money-line-currency"
          className="px-2 py-0.5 rounded bg-surface-container-lowest text-secondary font-tabular-nums text-[11px] font-semibold"
        >
          {currency}
        </span>
      </div>

      <div className="space-y-1.5 text-xs">
        <div
          data-testid="money-line-subtotal"
          className="flex items-center justify-between text-secondary"
        >
          <span>Subtotal</span>
          <span className="font-tabular-nums font-semibold text-on-surface">{fmt(subtotal)}</span>
        </div>

        <div
          data-testid="money-line-tax"
          className="flex items-center justify-between text-secondary"
        >
          <span>{taxLabel}</span>
          <span className="font-tabular-nums font-semibold text-on-surface">{fmt(taxAmount)}</span>
        </div>

        <div
          data-testid="money-line-fees"
          className="flex items-center justify-between text-secondary"
        >
          <span>{feeLabel}</span>
          {isFeesVerified && typeof feeAmount === 'number' ? (
            <span className="font-tabular-nums font-semibold text-on-surface">
              {fmt(feeAmount)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-secondary">Not available</span>
              {onVerifyFees && (
                <button
                  type="button"
                  onClick={onVerifyFees}
                  className="text-[11px] font-semibold text-primary hover:underline cursor-pointer"
                >
                  Load fee
                </button>
              )}
            </span>
          )}
        </div>

        {typeof payoutAmount === 'number' && (
          <div
            data-testid="money-line-payout"
            className="flex items-center justify-between text-secondary"
          >
            <span>{payoutLabel}</span>
            {isFeesVerified ? (
              <span className="font-tabular-nums font-semibold text-emerald-700">
                {fmt(payoutAmount)}
              </span>
            ) : (
              <span className="text-[11px] font-medium text-secondary">Estimated</span>
            )}
          </div>
        )}

        <div
          data-testid="money-line-total"
          className="pt-2 border-t border-surface-container-high flex items-center justify-between text-sm font-bold text-on-surface"
        >
          <span>Total ({currency})</span>
          <span className="font-tabular-nums text-primary">{fmt(total)}</span>
        </div>
      </div>
    </div>
  );
};

export interface AISuggestionCardProps {
  title: string;
  source: DataSource;
  suggestionText: string;
  whyThis: string;
  onApprove?: (editedText: string) => void;
  approveLabel?: string;
  approved?: boolean;
}

export const AISuggestionCard: React.FC<AISuggestionCardProps> = ({
  title,
  source,
  suggestionText,
  whyThis,
  onApprove,
  approveLabel = 'Apply Suggestion',
  approved = false,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState(suggestionText);
  const [localApproved, setLocalApproved] = useState(approved);

  const isDone = approved || localApproved;

  return (
    <div
      data-testid="ai-suggestion-card"
      className="rounded-xl bg-surface-container-low border border-surface-container-high p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[18px]">auto_awesome</span>
          <h4 className="text-xs font-bold text-on-surface uppercase tracking-wider">{title}</h4>
        </div>
        <span
          data-testid="ai-source-badge"
          className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-surface-container-lowest text-secondary border border-surface-container-high"
        >
          {source === 'live' ? 'Live' : 'Estimated'}
        </span>
      </div>

      {isEditing ? (
        <div className="space-y-2">
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={2}
            aria-label="Edit suggestion"
            className="w-full rounded-lg border border-primary bg-surface-container-lowest p-2.5 text-xs text-on-surface focus:outline-none"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDraftText(suggestionText);
                setIsEditing(false);
              }}
              className="px-2.5 py-1 rounded-lg text-xs font-medium text-secondary hover:bg-surface-container cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="px-3 py-1 rounded-lg text-xs font-semibold bg-primary text-on-primary cursor-pointer"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-on-surface leading-relaxed">{draftText}</p>
      )}

      <div
        data-testid="ai-why-this-box"
        className="text-[11px] text-secondary leading-relaxed"
      >
        <span className="font-semibold text-on-surface">Why this: </span>
        {whyThis}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={() => setIsEditing((v) => !v)}
          data-testid="ai-edit-btn"
          className="px-3 py-1.5 rounded-lg text-secondary hover:text-on-surface hover:bg-surface-container text-xs font-semibold transition-colors cursor-pointer"
        >
          {isEditing ? 'Close Editor' : 'Edit'}
        </button>
        <button
          type="button"
          onClick={() => {
            setLocalApproved(true);
            setIsEditing(false);
            onApprove && onApprove(draftText);
          }}
          data-testid="ai-approve-btn"
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
            isDone
              ? 'bg-emerald-600 text-white'
              : 'bg-primary hover:bg-primary-container text-on-primary'
          }`}
        >
          {isDone ? 'Approved ✓' : approveLabel}
        </button>
      </div>
    </div>
  );
};

export type CollectionViewState = 'ready' | 'loading' | 'empty' | 'error';

export const DataCollectionBoundary: React.FC<{
  title: string;
  state: CollectionViewState;
  onStateChange?: (next: CollectionViewState) => void;
  emptyMessage?: string;
  errorMessage?: string;
  children: React.ReactNode;
}> = ({
  title,
  state,
  onStateChange,
  emptyMessage = 'No records match your current filter.',
  errorMessage = 'Unable to load records right now.',
  children,
}) => {
  return (
    <div className="space-y-3" data-testid="data-collection-boundary" data-collection-state={state}>
      {state === 'loading' && (
        <div
          data-testid="collection-loading-state"
          className="p-8 rounded-xl border border-surface-container-high bg-surface-container-low text-center space-y-3"
        >
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto"></div>
          <div className="text-xs font-semibold text-on-surface">Loading {title}...</div>
        </div>
      )}

      {state === 'empty' && (
        <div
          data-testid="collection-empty-state"
          className="p-8 rounded-xl border border-dashed border-outline-variant bg-surface-container-low text-center space-y-2"
        >
          <div className="text-xs font-bold text-on-surface">No Records Found</div>
          <p className="text-xs text-secondary max-w-md mx-auto">{emptyMessage}</p>
          {onStateChange && (
            <button
              type="button"
              onClick={() => onStateChange('ready')}
              className="mt-2 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-surface-container-high text-xs font-semibold text-on-surface hover:bg-surface-container cursor-pointer"
            >
              Reset Filter
            </button>
          )}
        </div>
      )}

      {state === 'error' && (
        <div
          data-testid="collection-error-state"
          className="p-6 rounded-xl border border-error/20 bg-error-container/30 text-center space-y-2"
        >
          <div className="text-xs font-bold text-error">Unable to Load {title}</div>
          <p className="text-xs text-on-error-container max-w-md mx-auto">{errorMessage}</p>
          {onStateChange && (
            <button
              type="button"
              onClick={() => onStateChange('ready')}
              className="mt-2 px-3.5 py-1.5 rounded-lg bg-error text-on-error text-xs font-semibold cursor-pointer"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {state === 'ready' && children}
    </div>
  );
};
