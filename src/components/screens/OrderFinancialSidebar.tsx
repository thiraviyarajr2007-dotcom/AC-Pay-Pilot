import React from 'react';
import { MoneyBreakdownCard } from '../ui/HonestTrustComponents';
import {
  EscrowEventRecord,
  EscrowState,
  formatEscrowStateLabel,
} from '../../utils/escrow';
import { OrderRecord } from './OrdersScreen';

interface OrderFinancialSidebarProps {
  activeMoneyOrder: OrderRecord;
  activeSubtotal: number;
  activeGst: number;
  activeFee: number;
  feesVerified: boolean;
  onVerifyFees: () => void;
  activeEscrowState: EscrowState;
  activeEscrowEvents: EscrowEventRecord[];
}

export const OrderFinancialSidebar: React.FC<OrderFinancialSidebarProps> = ({
  activeMoneyOrder,
  activeSubtotal,
  activeGst,
  activeFee,
  feesVerified,
  onVerifyFees,
  activeEscrowState,
  activeEscrowEvents,
}) => {
  return (
    <div className="space-y-5">
      <MoneyBreakdownCard
        title={`Order ${activeMoneyOrder.id} Summary`}
        currency="INR"
        subtotal={activeSubtotal}
        taxLabel="GST (18%)"
        taxAmount={activeGst}
        feeLabel="PayPal Fee"
        feeAmount={activeFee}
        isFeesVerified={feesVerified}
        payoutLabel="Net Seller Payout"
        payoutAmount={activeMoneyOrder.amount - activeFee}
        total={activeMoneyOrder.amount}
        onVerifyFees={onVerifyFees}
      />

      {/* Escrow Status Timeline */}
      <div className="bg-surface-container-lowest rounded-xl border border-surface-container-high p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold text-on-surface uppercase tracking-wider">
              Escrow Activity ({activeMoneyOrder.id})
            </h3>
            <p className="text-[11px] text-secondary">
              Status: <strong className="text-on-surface">{formatEscrowStateLabel(activeEscrowState)}</strong>
            </p>
          </div>
          <span className="px-2 py-0.5 rounded bg-surface-container text-secondary font-tabular-nums text-[10px] font-semibold">
            {activeEscrowEvents.length} steps
          </span>
        </div>

        <div className="space-y-2 max-h-60 overflow-y-auto">
          {activeEscrowEvents.map((evt) => (
            <div
              key={evt.id}
              className="p-3 rounded-xl bg-surface-container-low border border-surface-container-high text-xs space-y-1"
            >
              <div className="flex items-center justify-between font-semibold text-on-surface">
                <span className="capitalize">
                  {evt.fromState
                    ? `${evt.fromState.replace('_', ' ')} → ${evt.toState.replace('_', ' ')}`
                    : `Created`}
                </span>
                <span className="text-[10px] font-tabular-nums text-secondary">
                  {new Date(evt.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <div className="text-secondary">{evt.reason}</div>
              <div className="text-[10px] text-outline">
                By {evt.actorId} ({evt.actorRole.replace('_', ' ')})
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
