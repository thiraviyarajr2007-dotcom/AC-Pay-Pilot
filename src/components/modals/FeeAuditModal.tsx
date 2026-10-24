import React, { useState } from 'react';
import { downloadBlobFile, formatINR } from '../../utils/finance';

interface FeeAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  customerName: string;
  grossAmount: number;
  feeAmount: number;
  tierInfo: string;
}

export const FeeAuditModal: React.FC<FeeAuditModalProps> = ({
  isOpen,
  onClose,
  orderId,
  customerName,
  grossAmount,
  feeAmount,
  tierInfo,
}) => {
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  if (!isOpen) return null;

  const netPayout = grossAmount > 0 ? grossAmount - feeAmount : 0;
  const baseRate = Math.max(0, feeAmount - 12);

  const handleDownload = () => {
    setDownloading(true);
    setTimeout(() => {
      const reportText = [
        'AC PAYPILOT — PAYPAL FEE BREAKDOWN STATEMENT',
        '============================================',
        `Order Reference:      ${orderId}`,
        `Customer Account:     ${customerName}`,
        `Gross Billed Amount:  ${formatINR(grossAmount, true)}`,
        `Gateway Base (3.49%): ${grossAmount < 0 ? '₹0.00' : formatINR(baseRate, true)}`,
        `Fixed Fee:            ${grossAmount < 0 ? '₹0.00' : '₹12.00'}`,
        `Total Deducted Fee:   ${grossAmount < 0 ? '₹0.00' : formatINR(feeAmount, true)}`,
        `Net Seller Payout:    ${grossAmount < 0 ? '₹0.00' : formatINR(netPayout, true)}`,
        `Fee Schedule:         ${tierInfo}`,
      ].join('\n');
      downloadBlobFile(`Fee_Statement_${orderId.replace('#', '')}.txt`, reportText);
      setDownloading(false);
      setDownloaded(true);
      setTimeout(() => {
        setDownloaded(false);
      }, 1500);
    }, 300);
  };

  return (
    <div className="fixed inset-0 bg-on-surface/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface-container-lowest max-w-lg w-full rounded-xl shadow-xl overflow-hidden border border-surface-container-high">
        <div className="p-5 bg-surface-container-low flex items-center justify-between border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary-fixed text-on-primary-fixed flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px]">verified</span>
            </div>
            <div>
              <h4 className="text-sm text-on-surface font-bold font-headline">
                PayPal Fee Breakdown
              </h4>
              <span className="text-[11px] text-secondary font-tabular-nums">
                Order {orderId}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-secondary hover:text-on-surface cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between p-3 bg-surface-container-low rounded-xl">
            <span className="text-xs text-secondary font-medium">Buyer</span>
            <span className="text-xs font-bold text-on-surface">{customerName}</span>
          </div>

          <div className="grid grid-cols-3 gap-2.5 text-center">
            <div className="p-3 bg-surface-container-low rounded-xl">
              <span className="block text-[11px] text-secondary">Gross Billed</span>
              <span className="text-sm font-bold text-on-surface font-tabular-nums">
                {formatINR(grossAmount, true)}
              </span>
            </div>
            <div className="p-3 bg-surface-container-low rounded-xl">
              <span className="block text-[11px] text-secondary">PayPal Fee</span>
              <span className="text-sm font-bold text-primary font-tabular-nums">
                {formatINR(feeAmount, true)}
              </span>
            </div>
            <div className="p-3 bg-surface-container-low rounded-xl">
              <span className="block text-[11px] text-secondary">Net Payout</span>
              <span className="text-sm font-bold text-emerald-700 font-tabular-nums">
                {formatINR(netPayout, true)}
              </span>
            </div>
          </div>

          <div className="space-y-2 pt-2 text-xs">
            <span className="text-[11px] uppercase tracking-wider text-secondary font-semibold block">
              Fee Details
            </span>
            <div className="flex items-center justify-between py-1.5 border-b border-surface-container-low">
              <span className="text-secondary">Standard Rate (3.49%)</span>
              <span className="font-tabular-nums text-on-surface font-semibold">
                {formatINR(baseRate, true)}
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-surface-container-low">
              <span className="text-secondary">Fixed Settlement Fee</span>
              <span className="font-tabular-nums text-on-surface font-semibold">₹12.00</span>
            </div>
            <div className="flex items-center justify-between p-2.5 font-semibold text-on-surface bg-surface-container-low rounded-xl">
              <span>Fee Schedule</span>
              <span className="text-primary font-bold">{tierInfo}</span>
            </div>
          </div>
        </div>

        <div className="p-4 bg-surface-container-low flex items-center justify-end gap-3 border-t border-surface-container-high">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-secondary text-xs font-semibold hover:bg-surface-container cursor-pointer"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">file_download</span>
            <span>{downloading ? 'Saving...' : downloaded ? 'Saved ✓' : 'Download Statement'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
