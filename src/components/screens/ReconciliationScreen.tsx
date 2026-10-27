import React, { useState } from 'react';
import { formatINR } from '../../utils/finance';
import { downloadTextFile } from '../../utils/export';
import {
  PaymentStateBadge,
  MoneyBreakdownCard,
  AISuggestionCard,
  DataCollectionBoundary,
  CanonicalPaymentState,
  CollectionViewState,
} from '../ui/HonestTrustComponents';
import { useRole } from '../../context/RoleContext';

interface ReconciliationScreenProps {
  onOpenInvoice?: (invoiceId: string) => void;
  onOpenFeeAudit?: () => void;
  showToast?: (msg: string) => void;
}

interface ReconRecord {
  id: string;
  invoiceId: string;
  orderId: string;
  buyer: string;
  subtotal: number;
  gstAmount: number;
  feeAmount: number;
  grossAmount: number;
  paymentState: CanonicalPaymentState;
  bankUtr: string;
  reconStatus: 'Matched' | 'Pending Settlement' | 'Variance Flagged';
}

const RECON_ITEMS: ReconRecord[] = [
  {
    id: 'REC-2026-01',
    invoiceId: 'INV-2026-089',
    orderId: '#PP-9821',
    buyer: 'Apex Studio Pvt Ltd',
    subtotal: 247458,
    gstAmount: 44542,
    feeAmount: 10203,
    grossAmount: 292000,
    paymentState: 'Captured',
    bankUtr: 'HDFCN2026051499812',
    reconStatus: 'Matched',
  },
  {
    id: 'REC-2026-02',
    invoiceId: 'INV-2026-088',
    orderId: '#PP-9820',
    buyer: 'Kinetix VFX Bengaluru',
    subtotal: 100000,
    gstAmount: 18000,
    feeAmount: 4130,
    grossAmount: 118000,
    paymentState: 'Authorized',
    bankUtr: 'ESCROW-HELD-IN-DELIVERY',
    reconStatus: 'Pending Settlement',
  },
  {
    id: 'REC-2026-03',
    invoiceId: 'INV-2026-085',
    orderId: '#PP-9814',
    buyer: 'Monolith Architecture LLP',
    subtotal: 138983,
    gstAmount: 25017,
    feeAmount: 5736,
    grossAmount: 164000,
    paymentState: 'Pending',
    bankUtr: 'AWAITING-BUYER-PAYMENT',
    reconStatus: 'Pending Settlement',
  },
  {
    id: 'REC-2026-04',
    invoiceId: 'INV-2026-079',
    orderId: '#PP-9805',
    buyer: 'Horizon CAD Labs',
    subtotal: 100000,
    gstAmount: 18000,
    feeAmount: 4130,
    grossAmount: 118000,
    paymentState: 'Failed',
    bankUtr: 'DECLINED-NO-SETTLEMENT',
    reconStatus: 'Variance Flagged',
  },
];

export const ReconciliationScreen: React.FC<ReconciliationScreenProps> = ({
  onOpenInvoice,
  showToast,
}) => {
  const {
    dataSource,
    serverConfirmed,
    feesVerified,
    setFeesVerified,
  } = useRole();

  const [tableState, setTableState] = useState<CollectionViewState>('ready');
  const [selectedRecon, setSelectedRecon] = useState<ReconRecord>(RECON_ITEMS[0]);
  const [approvedReconNote, setApprovedReconNote] = useState<string | null>(null);

  const handleExportReconCsv = () => {
    const headers = [
      'Recon ID',
      'Invoice ID',
      'Order ID',
      'Buyer',
      'Currency',
      'Subtotal (INR)',
      'GST 18% (INR)',
      'PayPal Fee (INR)',
      'Gross (INR)',
      'Payment Status',
      'Bank Reference',
      'Reconciliation Status',
    ];
    const rows = RECON_ITEMS.map((r) => [
      r.id,
      r.invoiceId,
      r.orderId,
      `"${r.buyer}"`,
      'INR',
      r.subtotal,
      r.gstAmount,
      feesVerified ? r.feeAmount : 'Not available',
      r.grossAmount,
      r.paymentState,
      r.bankUtr,
      r.reconStatus,
    ]);
    const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    downloadTextFile('ac-paypilot-reconciliation.csv', csv, 'text/csv;charset=utf-8');
    showToast?.('Reconciliation report exported to CSV.');
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-widest text-primary block">
            Three-Way Settlement Matching
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold font-headline text-on-surface tracking-tight mt-0.5">
            Bank &amp; PayPal Reconciliation
          </h1>
          <p className="text-xs text-secondary mt-1">
            Match issued tax invoices against PayPal payouts and bank deposit references.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportReconCsv}
          className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          <span className="material-symbols-outlined text-[16px]">download</span>
          <span>Export Reconciliation CSV</span>
        </button>
      </div>

      {/* 4-Card KPI Ribbon */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block">
            Matched to Bank
          </span>
          <span className="text-2xl font-bold font-headline text-emerald-700 font-tabular-nums mt-1 block">
            {formatINR(292000)}
          </span>
          <span className="text-[11px] text-emerald-700 mt-1 block">
            UTR verified
          </span>
        </div>

        <div className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block">
            Pending Settlement
          </span>
          <span className="text-2xl font-bold font-headline text-primary font-tabular-nums mt-1 block">
            {formatINR(282000)}
          </span>
          <span className="text-[11px] text-secondary mt-1 block">
            In delivery / awaiting payment
          </span>
        </div>

        <div className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block">
            Flagged Variances
          </span>
          <span className="text-2xl font-bold font-headline text-error font-tabular-nums mt-1 block">
            1 Invoice
          </span>
          <span className="text-[11px] text-secondary mt-1 block">
            Declined payment (#PP-9805)
          </span>
        </div>

        <div className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block">
            Net Bank Deposit
          </span>
          <span className="text-2xl font-bold font-headline text-on-surface font-tabular-nums mt-1 block">
            {feesVerified ? formatINR(281797) : 'Estimated'}
          </span>
          <span className="text-[11px] text-secondary mt-1 block">
            After PayPal fee deduction
          </span>
        </div>
      </div>

      {/* 12-Col Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 bg-surface-container-lowest rounded-xl border border-surface-container-high p-5 space-y-4">
          <DataCollectionBoundary
            title="Reconciliation Records"
            state={tableState}
            onStateChange={setTableState}
            emptyMessage="No reconciliation items found."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-surface-container-high text-[10px] font-semibold uppercase tracking-wider text-secondary">
                    <th className="py-3 pr-3">Invoice / Order</th>
                    <th className="py-3 px-3">Bank Reference</th>
                    <th className="py-3 px-3 text-right">Gross (INR)</th>
                    <th className="py-3 px-3">Payment Status</th>
                    <th className="py-3 pl-3 text-right">Match Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container text-xs">
                  {RECON_ITEMS.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedRecon(item)}
                      className={`cursor-pointer transition-colors ${
                        selectedRecon.id === item.id
                          ? 'bg-primary-fixed/25'
                          : 'hover:bg-surface-container-low/60'
                      }`}
                    >
                      <td className="py-3.5 pr-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenInvoice && onOpenInvoice(item.invoiceId);
                          }}
                          className="font-bold text-primary hover:underline block cursor-pointer"
                        >
                          {item.invoiceId}
                        </button>
                        <span className="text-[11px] text-secondary">
                          {item.orderId} • {item.buyer}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 font-tabular-nums text-secondary">
                        {item.bankUtr}
                      </td>
                      <td className="py-3.5 px-3 text-right font-tabular-nums font-bold text-on-surface">
                        {formatINR(item.grossAmount)}
                      </td>
                      <td className="py-3.5 px-3">
                        <PaymentStateBadge
                          state={item.paymentState}
                          serverConfirmed={serverConfirmed}
                        />
                      </td>
                      <td className="py-3.5 pl-3 text-right">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                            item.reconStatus === 'Matched'
                              ? 'bg-emerald-50 text-emerald-800'
                              : item.reconStatus === 'Variance Flagged'
                              ? 'bg-error-container text-on-error-container'
                              : 'bg-amber-50 text-amber-800'
                          }`}
                        >
                          {item.reconStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DataCollectionBoundary>
        </div>

        <div className="lg:col-span-4 space-y-5">
          <MoneyBreakdownCard
            title={`Reconciliation (${selectedRecon.invoiceId})`}
            currency="INR"
            subtotal={selectedRecon.subtotal}
            taxLabel="GST (18%)"
            taxAmount={selectedRecon.gstAmount}
            feeLabel="PayPal Fee"
            feeAmount={selectedRecon.feeAmount}
            isFeesVerified={feesVerified}
            payoutLabel="Net Bank Settlement"
            payoutAmount={selectedRecon.grossAmount - selectedRecon.feeAmount}
            total={selectedRecon.grossAmount}
            onVerifyFees={() => {
              setFeesVerified(true);
              showToast?.('PayPal fee loaded.');
            }}
          />

          <AISuggestionCard
            title="Reconciliation Note"
            source={dataSource}
            suggestionText={`Hold GSTR-1 filing on ${selectedRecon.invoiceId} until bank settlement reference (${selectedRecon.bankUtr}) is marked Paid.`}
            whyThis="Prevents reporting unsettled or declined orders in monthly tax returns."
            approveLabel="Save Reconciliation Note"
            onApprove={(edited) => {
              setApprovedReconNote(edited);
              showToast?.('Saved reconciliation note.');
            }}
          />

          {approvedReconNote && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950">
              <div className="font-bold mb-0.5">Saved Note:</div>
              <div>{approvedReconNote}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
