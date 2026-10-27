import React, { useState } from 'react';
import { formatINR } from '../../utils/finance';
import { downloadTextFile } from '../../utils/export';
import {
  MoneyBreakdownCard,
  AISuggestionCard,
  DataCollectionBoundary,
  CollectionViewState,
} from '../ui/HonestTrustComponents';
import { useRole } from '../../context/RoleContext';

interface FinancialReportsScreenProps {
  showToast?: (msg: string) => void;
}

const MONTHLY_REPORT_ROWS = [
  {
    period: 'May 2026 (MTD)',
    hsnGroup: '8471.50.00 (Workstations)',
    subtotal: 247458,
    gstAmount: 44542,
    feeAmount: 10203,
    grossTotal: 292000,
  },
  {
    period: 'May 2026 (MTD)',
    hsnGroup: '8528.52.00 (6K Reference Displays)',
    subtotal: 100000,
    gstAmount: 18000,
    feeAmount: 4130,
    grossTotal: 118000,
  },
  {
    period: 'May 2026 (MTD)',
    hsnGroup: '8471.70.20 (Enterprise NAS Storage)',
    subtotal: 138983,
    gstAmount: 25017,
    feeAmount: 5736,
    grossTotal: 164000,
  },
];

export const FinancialReportsScreen: React.FC<FinancialReportsScreenProps> = ({
  showToast,
}) => {
  const { dataSource, feesVerified, setFeesVerified } = useRole();
  const [tableState, setTableState] = useState<CollectionViewState>('ready');
  const [approvedFilingNote, setApprovedFilingNote] = useState<string | null>(null);

  const totalGross = MONTHLY_REPORT_ROWS.reduce((s, r) => s + r.grossTotal, 0);
  const totalSubtotal = MONTHLY_REPORT_ROWS.reduce((s, r) => s + r.subtotal, 0);
  const totalGst = MONTHLY_REPORT_ROWS.reduce((s, r) => s + r.gstAmount, 0);
  const totalFee = MONTHLY_REPORT_ROWS.reduce((s, r) => s + r.feeAmount, 0);

  const handleExportCsv = () => {
    const headers = [
      'Period',
      'HSN Classification',
      'Currency',
      'Taxable Subtotal (INR)',
      'GST 18% (INR)',
      'PayPal Fee (INR)',
      'Gross Total (INR)',
    ];
    const rows = MONTHLY_REPORT_ROWS.map((r) => [
      `"${r.period}"`,
      `"${r.hsnGroup}"`,
      'INR',
      r.subtotal,
      r.gstAmount,
      feesVerified ? r.feeAmount : 'Not available',
      r.grossTotal,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    downloadTextFile('ac-paypilot-gst-financial-report.csv', csv, 'text/csv;charset=utf-8');
    showToast?.('Financial report exported to CSV.');
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-widest text-primary block">
            Tax &amp; Settlement Statements
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold font-headline text-on-surface tracking-tight mt-0.5">
            Financial &amp; GST Reports
          </h1>
          <p className="text-xs text-secondary mt-1">
            Review monthly taxable sales, GST collected by product category, and net payouts.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          <span className="material-symbols-outlined text-[16px]">download</span>
          <span>Download Report CSV</span>
        </button>
      </div>

      {/* 4-Card KPI Ribbon */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block">
            Gross Billed (MTD)
          </span>
          <span className="text-2xl font-bold font-headline text-on-surface font-tabular-nums mt-1 block">
            {formatINR(totalGross)}
          </span>
          <span className="text-[11px] text-secondary mt-1 block">
            May 2026 statement
          </span>
        </div>

        <div className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block">
            Taxable Subtotal
          </span>
          <span className="text-2xl font-bold font-headline text-on-surface font-tabular-nums mt-1 block">
            {formatINR(totalSubtotal)}
          </span>
          <span className="text-[11px] text-secondary mt-1 block">
            Net of 18% GST
          </span>
        </div>

        <div className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block">
            Total GST (18%)
          </span>
          <span className="text-2xl font-bold font-headline text-primary font-tabular-nums mt-1 block">
            {formatINR(totalGst)}
          </span>
          <span className="text-[11px] text-secondary mt-1 block">
            3 HSN categories
          </span>
        </div>

        <div className="bg-surface-container-lowest p-4 rounded-xl border border-surface-container-high">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary block">
            Net Payout
          </span>
          <span className="text-2xl font-bold font-headline text-emerald-700 font-tabular-nums mt-1 block">
            {feesVerified ? formatINR(totalGross - totalFee) : 'Estimated'}
          </span>
          <span className="text-[11px] text-secondary mt-1 block">
            After PayPal fees
          </span>
        </div>
      </div>

      {/* 12-Col Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 bg-surface-container-lowest rounded-xl border border-surface-container-high p-5 space-y-4">
          <h2 className="text-base font-bold font-headline text-on-surface">
            HSN Tax &amp; Settlement Schedule
          </h2>
          <DataCollectionBoundary
            title="HSN Financial Schedule"
            state={tableState}
            onStateChange={setTableState}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-surface-container-high text-[10px] font-semibold uppercase tracking-wider text-secondary">
                    <th className="py-3 pr-3">HSN Category</th>
                    <th className="py-3 px-3 text-right">Subtotal</th>
                    <th className="py-3 px-3 text-right">GST (18%)</th>
                    <th className="py-3 px-3 text-right">PayPal Fee</th>
                    <th className="py-3 pl-3 text-right">Gross Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {MONTHLY_REPORT_ROWS.map((row, idx) => (
                    <tr key={idx} className="hover:bg-surface-container-low/60">
                      <td className="py-3.5 pr-3">
                        <div className="font-bold text-on-surface">{row.hsnGroup}</div>
                        <div className="text-[11px] text-secondary">{row.period}</div>
                      </td>
                      <td className="py-3.5 px-3 text-right font-tabular-nums text-secondary">
                        {formatINR(row.subtotal)}
                      </td>
                      <td className="py-3.5 px-3 text-right font-tabular-nums text-secondary">
                        {formatINR(row.gstAmount)}
                      </td>
                      <td className="py-3.5 px-3 text-right font-tabular-nums text-secondary">
                        {feesVerified ? formatINR(row.feeAmount) : 'Not available'}
                      </td>
                      <td className="py-3.5 pl-3 text-right font-tabular-nums font-bold text-on-surface">
                        {formatINR(row.grossTotal)}
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
            title="May 2026 Consolidated Totals"
            currency="INR"
            subtotal={totalSubtotal}
            taxLabel="GST (18%)"
            taxAmount={totalGst}
            feeLabel="PayPal Fee"
            feeAmount={totalFee}
            isFeesVerified={feesVerified}
            payoutLabel="Net Seller Payout"
            payoutAmount={totalGross - totalFee}
            total={totalGross}
            onVerifyFees={() => {
              setFeesVerified(true);
              showToast?.('PayPal fees loaded.');
            }}
          />

          <AISuggestionCard
            title="Monthly Tax Filing Note"
            source={dataSource}
            suggestionText="Claim ₹3,612 input tax credit on verified PayPal service fees for May 2026."
            whyThis="Calculated at 18% GST on ₹20,069 in verified payment gateway fees."
            approveLabel="Approve Filing Note"
            onApprove={(edited) => {
              setApprovedFilingNote(edited);
              showToast?.('Filing note saved.');
            }}
          />

          {approvedFilingNote && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950">
              <div className="font-bold mb-0.5">Saved Note:</div>
              <div>{approvedFilingNote}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
