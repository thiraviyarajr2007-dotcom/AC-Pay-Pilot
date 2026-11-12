import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  PaymentStateBadge,
  MoneyBreakdownCard,
  CanonicalPaymentState,
} from '../ui/HonestTrustComponents';
import { useRole } from '../../context/RoleContext';
import { fromMinorUnits, formatMinorUnits } from '../../utils/finance';
import { formatEscrowStateLabel, EscrowState } from '../../utils/escrow';

interface CheckoutResultScreenProps {
  status: 'success' | 'cancel';
}

interface ServerCheckoutStatusResponse {
  ok: boolean;
  order: {
    id: string;
    orderNumber: string;
    paypalOrderId: string;
    paypalCaptureId?: string;
    currency: 'INR' | 'USD';
    subtotalMinor: number;
    taxMinor: number;
    totalMinor: number;
    paypalFeeMinor: number | null;
    netPayoutMinor: number | null;
    feesFromProvider: boolean;
    paymentStatus: CanonicalPaymentState;
    verifiedByServer: boolean;
    escrowState: EscrowState;
    failureReason?: string;
  };
  verifiedByServer: boolean;
}

export const CheckoutResultScreen: React.FC<CheckoutResultScreenProps> = ({ status }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { lastServerOrderId, authFetch } = useRole();

  const lookupId = searchParams.get('orderId') || lastServerOrderId || null;

  const [loading, setLoading] = useState<boolean>(true);
  const [serverData, setServerData] = useState<ServerCheckoutStatusResponse['order'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const fetchFromServer = async () => {
      if (!lookupId) {
        setLoading(false);
        setError('No active order specified. Return to cart to complete checkout.');
        return;
      }

      setLoading(true);
      setError(null);
      try {
        let guestToken = '';
        try {
          guestToken =
            window.sessionStorage.getItem(`ac_paypilot_guest_token:${lookupId}`) || '';
        } catch {
          guestToken = '';
        }
        const res = await authFetch(
          `/api/orders/${encodeURIComponent(lookupId)}/checkout-status`,
          guestToken ? { headers: { 'x-guest-capture-token': guestToken } } : undefined
        );
        const data = (await res.json().catch(() => null)) as
          | (ServerCheckoutStatusResponse & { error?: string })
          | null;
        if (!active) return;
        if (!res.ok || !data?.ok) {
          setError(data?.error || `Could not load order details (HTTP ${res.status}).`);
        } else {
          setServerData(data.order);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Unable to load order details');
      } finally {
        if (active) setLoading(false);
      }
    };
    void fetchFromServer();
    return () => {
      active = false;
    };
  }, [lookupId, authFetch]);

  const subtotalMajor = serverData ? fromMinorUnits(serverData.subtotalMinor) : 0;
  const taxMajor = serverData ? fromMinorUnits(serverData.taxMinor) : 0;
  const totalMajor = serverData ? fromMinorUnits(serverData.totalMinor) : 0;
  const feeMajor =
    serverData && serverData.feesFromProvider && serverData.paypalFeeMinor !== null
      ? fromMinorUnits(serverData.paypalFeeMinor)
      : undefined;
  const netMajor =
    serverData && serverData.feesFromProvider && serverData.netPayoutMinor !== null
      ? fromMinorUnits(serverData.netPayoutMinor)
      : undefined;

  return (
    <div className="flex flex-col items-center justify-center min-h-[75vh] px-4 py-10">
      <div className="max-w-lg w-full bg-surface-container-lowest rounded-xl p-6 sm:p-8 border border-surface-container-high flex flex-col items-center text-center gap-5">
        {loading ? (
          <div className="py-10 text-xs text-secondary font-medium">
            Loading your order confirmation...
          </div>
        ) : error || !serverData ? (
          status === 'cancel' ? (
            <>
              <PaymentStateBadge state="Cancelled" size="md" />
              <div className="flex flex-col gap-1.5">
                <span className="text-xs uppercase tracking-wider text-secondary font-bold">
                  Checkout Cancelled
                </span>
                <h1 className="text-xl font-bold font-headline text-on-surface">
                  No Payment Was Charged
                </h1>
                <p className="text-xs text-secondary">
                  You cancelled the checkout session. Your cart items are still safely saved.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 w-full pt-2">
                <button
                  type="button"
                  onClick={() => navigate('/customer/cart')}
                  className="flex-1 py-3 px-4 rounded-xl bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container transition-colors cursor-pointer"
                >
                  Return to SmartCart
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/customer/discover')}
                  className="py-3 px-4 rounded-xl bg-surface-container-low text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors cursor-pointer"
                >
                  Browse Products
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <PaymentStateBadge state="Failed" size="md" />
              <h1 className="text-lg font-bold font-headline text-on-surface">
                Order Details Unavailable
              </h1>
              <p className="text-xs text-secondary">
                {error || 'We could not find a matching order record.'}
              </p>
              <button
                type="button"
                onClick={() => navigate('/customer/cart')}
                className="py-2.5 px-4 rounded-xl bg-primary text-on-primary text-xs font-semibold cursor-pointer"
              >
                Return to SmartCart
              </button>
            </div>
          )
        ) : status === 'success' ? (
          <>
            <PaymentStateBadge
              state={serverData.paymentStatus}
              serverConfirmed={serverData.verifiedByServer}
              size="md"
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wider text-primary font-bold">
                Order Confirmation
              </span>
              <h1 className="text-xl font-bold font-headline text-on-surface">
                {serverData.verifiedByServer && serverData.paymentStatus === 'Captured'
                  ? 'Payment Confirmed'
                  : serverData.paymentStatus === 'Pending'
                  ? 'Payment Pending Bank Confirmation'
                  : serverData.paymentStatus === 'Failed'
                  ? 'Payment Failed or Declined'
                  : `Order Status: ${serverData.paymentStatus}`}
              </h1>
              <p className="text-xs text-secondary leading-relaxed">
                Order <strong className="text-on-surface">{serverData.orderNumber}</strong> is now{' '}
                <strong className="text-on-surface">
                  {formatEscrowStateLabel(serverData.escrowState)}
                </strong>
                .
              </p>
            </div>

            <div className="w-full text-left">
              <MoneyBreakdownCard
                title={`Receipt (${serverData.orderNumber} • ${formatMinorUnits(
                  serverData.totalMinor,
                  serverData.currency
                )})`}
                currency={serverData.currency}
                subtotal={subtotalMajor}
                taxLabel="GST (18%)"
                taxAmount={taxMajor}
                feeLabel="PayPal Fee"
                feeAmount={feeMajor}
                isFeesVerified={serverData.feesFromProvider}
                payoutLabel="Net Seller Payout"
                payoutAmount={netMajor}
                total={totalMajor}
                compact
              />
            </div>

            <div className="w-full p-3 rounded-xl bg-surface-container-low flex flex-wrap items-center justify-between gap-2 text-xs border border-surface-container-high">
              <div>
                <span className="text-secondary">PayPal Reference: </span>
                <span className="font-bold font-tabular-nums text-on-surface">
                  {serverData.paypalOrderId}
                </span>
              </div>
              <span className="text-[11px] font-semibold text-emerald-700">
                {serverData.verifiedByServer ? '✓ Payment Confirmed' : 'Pending'}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 w-full pt-1">
              <button
                type="button"
                onClick={() =>
                  navigate(`/customer/orders?highlight=${encodeURIComponent(serverData.orderNumber)}`)
                }
                className="flex-1 py-3 px-4 rounded-xl bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container transition-colors cursor-pointer"
              >
                View My Orders
              </button>
              <button
                type="button"
                onClick={() => navigate('/customer/discover')}
                className="py-3 px-4 rounded-xl bg-surface-container-low text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors cursor-pointer"
              >
                Continue Shopping
              </button>
            </div>
          </>
        ) : (
          <>
            <PaymentStateBadge state="Cancelled" size="md" />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wider text-secondary font-bold">
                Checkout Cancelled
              </span>
              <h1 className="text-xl font-bold font-headline text-on-surface">
                No Payment Was Charged
              </h1>
              <p className="text-xs text-secondary">
                Order {serverData.orderNumber} was cancelled and your cart items are still saved.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full pt-2">
              <button
                type="button"
                onClick={() => navigate('/customer/cart')}
                className="flex-1 py-3 px-4 rounded-xl bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container transition-colors cursor-pointer"
              >
                Return to SmartCart
              </button>
              <button
                type="button"
                onClick={() => navigate('/customer/discover')}
                className="py-3 px-4 rounded-xl bg-surface-container-low text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors cursor-pointer"
              >
                Browse Products
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export const NotFoundScreen: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center min-h-[75vh] px-4 py-12">
      <div className="max-w-md w-full bg-surface-container-lowest rounded-xl p-8 border border-surface-container-high flex flex-col items-center text-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-error-container text-error flex items-center justify-center">
          <span className="material-symbols-outlined text-[28px]">explore_off</span>
        </div>
        <span className="text-xs uppercase tracking-widest text-error font-bold">
          Page Not Found
        </span>
        <h1 className="text-xl font-headline text-on-surface font-bold">
          We couldn&apos;t find that page
        </h1>
        <p className="text-xs text-secondary">
          The link you followed doesn&apos;t match an active page in AC PayPilot.
        </p>
        <div className="flex items-center gap-3 w-full pt-2">
          <button
            type="button"
            onClick={() => navigate('/customer/discover')}
            className="flex-1 py-3 px-4 rounded-xl bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">home</span>
            <span>Back to Catalog</span>
          </button>
        </div>
      </div>
    </div>
  );
};
