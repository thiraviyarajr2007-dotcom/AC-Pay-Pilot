import React, { useState } from 'react';
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

interface TransactionsScreenProps {
  onOpenFeeAudit?: () => void;
  onOpenInvoice?: (invoiceId: string) => void;
  showToast?: (msg: string) => void;
  globalSearchQuery?: string;
}

interface TransactionRow {
  txId: string;
  orderId: string;
  invoiceId: string;
  counterparty: string;
  subtotal: number;
  gstAmount: number;
  feeAmount: number;
  grossAmount: number;
  state: CanonicalPaymentState;
  timestamp: string;
}

const TRANSACTIONS: TransactionRow[] = [
  {
    txId: 'PP-TX-94821-IN',
    orderId: '#PP-9821',
    invoiceId: 'INV-2026-089',
    counterparty: 'Apex Studio Pvt Ltd',
    subtotal: 247458,
    gstAmount: 44542,
    feeAmount: 10203,
    grossAmount: 292000,
    state: 'Captured',
    timestamp: '14 May 2026, 14:22 IST',
  },
  {
    txId: 'PP-TX-94819-IN',
    orderId: '#PP-9820',
    invoiceId: 'INV-2026-088',
    counterparty: 'Kinetix VFX Bengaluru',
    subtotal: 100000,
    gstAmount: 18000,
    feeAmount: 4130,
    grossAmount: 118000,
    state: 'Authorized',
    timestamp: '13 May 2026, 11:05 IST',
  },
  {
    txId: 'PP-TX-94790-IN',
    orderId: '#PP-9814',
    invoiceId: 'INV-2026-085',
    counterparty: 'Monolith Architecture LLP',
    subtotal: 138983,
    gstAmount: 25017,
    feeAmount: 5736,
    grossAmount: 164000,
    state: 'Pending',
    timestamp: '11 May 2026, 16:40 IST',
  },
  {
    txId: 'PP-TX-94742-IN',
    orderId: '#PP-9809',
    invoiceId: 'INV-2026-081',
    counterparty: 'Vertex Industrial Design',
    subtotal: 38136,
    gstAmount: 6864,
    feeAmount: 1583,
    grossAmount: 45000,
    state: 'Refunded',
    timestamp: '09 May 2026, 09:15 IST',
  },
  {
    txId: 'PP-TX-94711-IN',
    orderId: '#PP-9805',
    invoiceId: 'INV-2026-079',
    counterparty: 'Horizon CAD Labs',
    subtotal: 100000,
    gstAmount: 18000,
    feeAmount: 4130,
    grossAmount: 118000,
    state: 'Failed',
    timestamp: '07 May 2026, 18:02 IST',
  },
  {
    txId: 'PP-TX-94688-IN',
    orderId: '#PP-9801',
    invoiceId: 'INV-2026-076',
    counterparty: 'Prism Sound Studios',
    subtotal: 38136,
    gstAmount: 6864,
    feeAmount: 1583,
    grossAmount: 45000,
    state: 'Cancelled',
    timestamp: '05 May 2026, 12:30 IST',
  },
];

export const TransactionsScreen: React.FC<TransactionsScreenProps> = ({
  onOpenFeeAudit,
  onOpenInvoice,
  showToast,
  globalSearchQuery = '',
}) => {
  const { serverConfirmed, feesVerified, setFeesVerified } = useRole();

  const [stateFilter, setStateFilter] = useState<'ALL' | CanonicalPaymentState>('ALL');
  const [tableState, setTableState] = useState<CollectionViewState>('ready');
  const [selectedTx, setSelectedTx] = useState<TransactionRow>(TRANSACTIONS[0]);

  const filtered = TRANSACTIONS.filter((t) => {
    if (stateFilter !== 'ALL' && t.state !== stateFilter) return false;
    if (globalSearchQuery.trim()) {
      const q = globalSearchQuery.toLowerCase();
      return (
        t.txId.toLowerCase().includes(q) ||
        t.orderId.toLowerCase().includes(q) ||
        t.counterparty.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleExportCsv = () => {
    const headers = [
      'Transaction ID',
      'Order ID',
      'Invoice ID',
      'Buyer',
      'Currency',
      'Subtotal (INR)',
      'GST 18% (INR)',
      'PayPal Fee (INR)',
      'Total (INR)',
      'Payment Status',
      'Timestamp',
    ];
    const rows = filtered.map((t) => [
      t.txId,
      t.orderId,
      t.invoiceId,
      `"${t.counterparty}"`,
      'INR',
      t.subtotal,
      t.gstAmount,
      feesVerified ? t.feeAmount : 'Not available',
      t.grossAmount,
      t.state,
      `"${t.timestamp}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    downloadTextFile('ac-paypilot-transactions.csv', csv, 'text/csv;charset=utf-8');
    showToast?.('Transactions exported to CSV.');
  };

  const totalVolume = TRANSACTIONS.reduce((acc, t) => acc + t.grossAmount, 0);

  return (
    <div className="space-y-6 pb-12">
      {/* Header (Matches Stitch Pattern) */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-widest text-primary block">
            Finance &amp; Payment Ledger
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold font-headline text-on-surface tracking-tight mt-0.5">
            PayPal Transactions &amp; Fee Breakdown
          </h1>
          <p className="text-xs text-secondary mt-1">
            Inspect payment status, GST tax components, and PayPal settlement fees for every order.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onOpenFeeAudit && (
            <button
              type="button"
              onClick={onOpenFeeAudit}
              className="px-3.5 py-2 rounded-xl border border-surface-container-high bg-surface-container-lowest hover:bg-surface-container-low text-on-surface text-xs font-semibold cursor-pointer"
            >
              Fee Certificate
            </button>
          )}
          <button
            type="button"
            onClick={handleExportCsv}
            className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* 4-Card KPI Ribbon */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block">
            Total Processed Volume
          </span>
          <span className="text-2xl font-bold font-headline text-on-surface font-tabular-nums mt-1 block">
            {formatINR(totalVolume)}
          </span>
          <span className="text-[11px] text-secondary mt-1 block">
            {TRANSACTIONS.length} recorded transactions
          </span>
        </div>

        <div className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block">
            Completed Settlements
          </span>
          <span className="text-2xl font-bold font-headline text-emerald-700 font-tabular-nums mt-1 block">
            {formatINR(292000)}
          </span>
          <span className="text-[11px] text-emerald-700 mt-1 block">
            Paid to bank account
          </span>
        </div>

        <div className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block">
            Held in Escrow
          </span>
          <span className="text-2xl font-bold font-headline text-primary font-tabular-nums mt-1 block">
            {formatINR(118000)}
          </span>
          <span className="text-[11px] text-secondary mt-1 block">
            Awaiting delivery confirmation
          </span>
        </div>

        <div className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block">
            PayPal Fees
          </span>
          <span className="text-2xl font-bold font-headline text-on-surface font-tabular-nums mt-1 block">
            {feesVerified ? formatINR(10203) : 'Not available'}
          </span>
          <span className="text-[11px] text-secondary mt-1 block">
            3.49% + ₹12 standard tier
          </span>
        </div>
      </div>

      {/* 12-Col Split: Left 8 Cols Transactions Table + Right 4 Cols Selected Transaction Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 bg-surface-container-lowest rounded-xl border border-surface-container-high p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              ['ALL', 'Pending', 'Authorized', 'Captured', 'Failed', 'Cancelled', 'Refunded'] as const
            ).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStateFilter(st)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  stateFilter === st
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container-low text-secondary hover:text-on-surface'
                }`}
              >
                {st === 'Authorized' ? 'Authorized (Held)' : st === 'Captured' ? 'Paid' : st}
              </button>
            ))}
          </div>

          <DataCollectionBoundary
            title="Transactions"
            state={filtered.length === 0 && tableState === 'ready' ? 'empty' : tableState}
            onStateChange={setTableState}
            emptyMessage="No transactions match the selected filter."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-surface-container-high text-[10px] font-semibold uppercase tracking-wider text-secondary">
                    <th className="py-3 pr-3">Transaction / Time</th>
                    <th className="py-3 px-3">Buyer</th>
                    <th className="py-3 px-3 text-right">Subtotal</th>
                    <th className="py-3 px-3 text-right">GST (18%)</th>
                    <th className="py-3 px-3 text-right">PayPal Fee</th>
                    <th className="py-3 px-3 text-right">Total</th>
                    <th className="py-3 pl-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container text-xs">
                  {filtered.map((tx) => (
                    <tr
                      key={tx.txId}
                      onClick={() => setSelectedTx(tx)}
                      className={`cursor-pointer transition-colors ${
                        selectedTx.txId === tx.txId
                          ? 'bg-primary-fixed/25'
                          : 'hover:bg-surface-container-low/60'
                      }`}
                    >
                      <td className="py-3.5 pr-3">
                        <div className="font-bold text-on-surface font-tabular-nums">{tx.txId}</div>
                        <div className="text-[11px] text-secondary">{tx.timestamp}</div>
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="font-semibold text-on-surface">{tx.counterparty}</div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenInvoice && onOpenInvoice(tx.invoiceId);
                          }}
                          className="text-[11px] font-semibold text-primary hover:underline cursor-pointer"
                        >
                          {tx.invoiceId}
                        </button>
                      </td>
                      <td className="py-3.5 px-3 text-right font-tabular-nums text-secondary">
                        {formatINR(tx.subtotal)}
                      </td>
                      <td className="py-3.5 px-3 text-right font-tabular-nums text-secondary">
                        {formatINR(tx.gstAmount)}
                      </td>
                      <td className="py-3.5 px-3 text-right font-tabular-nums text-secondary">
                        {feesVerified ? formatINR(tx.feeAmount) : 'Not available'}
                      </td>
                      <td className="py-3.5 px-3 text-right font-tabular-nums font-bold text-on-surface">
                        {formatINR(tx.grossAmount)}
                      </td>
                      <td className="py-3.5 pl-3">
                        <PaymentStateBadge
                          state={tx.state}
                          serverConfirmed={serverConfirmed}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DataCollectionBoundary>
        </div>

        <div className="lg:col-span-4">
          <MoneyBreakdownCard
            title={`Transaction ${selectedTx.txId}`}
            currency="INR"
            subtotal={selectedTx.subtotal}
            taxLabel="GST (18%)"
            taxAmount={selectedTx.gstAmount}
            feeLabel="PayPal Fee (3.49% + ₹12)"
            feeAmount={selectedTx.feeAmount}
            isFeesVerified={feesVerified}
            payoutLabel="Net Seller Payout"
            payoutAmount={selectedTx.grossAmount - selectedTx.feeAmount}
            total={selectedTx.grossAmount}
            onVerifyFees={() => {
              setFeesVerified(true);
              showToast?.('PayPal fees loaded.');
            }}
          />
        </div>
      </div>
    </div>
  );
};
