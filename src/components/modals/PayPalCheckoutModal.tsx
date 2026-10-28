import React, { useState, useEffect, useRef } from 'react';
import { fromMinorUnits, formatMinorUnits } from '../../utils/finance';
import {
  MoneyBreakdownCard,
  PaymentStateBadge,
  CanonicalPaymentState,
} from '../ui/HonestTrustComponents';
import { useRole } from '../../context/RoleContext';
import { formatEscrowStateLabel, EscrowState } from '../../utils/escrow';

interface PayPalCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onSimulateRedirectReturn?: () => void;
  onSimulateRedirectCancel?: () => void;
}

interface ServerOrderSummary {
  id: string;
  orderNumber: string;
  paypalOrderId: string;
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
}

declare global {
  interface Window {
    paypal?: {
      Buttons: (config: {
        style?: Record<string, string | number>;
        createOrder: () => Promise<string>;
        onApprove: (data: { orderID: string }) => Promise<void>;
        onCancel?: () => void;
        onError?: (err: unknown) => void;
      }) => {
        render: (selector: string | HTMLElement) => Promise<void>;
      };
    };
  }
}

export const PayPalCheckoutModal: React.FC<PayPalCheckoutModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onSimulateRedirectReturn,
  onSimulateRedirectCancel,
}) => {
  const {
    dataSource,
    authFetch,
    getActorHeaders,
    setServerConfirmed,
    setFeesVerified,
    setLastServerOrderId,
  } = useRole();

  const [paypalClientId, setPaypalClientId] = useState<string>('sb');
  const [sdkReady, setSdkReady] = useState<boolean>(false);

  const [createIdempotencyKey, setCreateIdempotencyKey] = useState<string>(
    () => `idem-create-${Date.now()}`
  );
  const [captureIdempotencyKey, setCaptureIdempotencyKey] = useState<string>(
    () => `idem-cap-${Date.now()}`
  );

  const [serverOrder, setServerOrder] = useState<ServerOrderSummary | null>(null);
  const [guestCaptureToken, setGuestCaptureToken] = useState<string | null>(null);
  const [loadingServerOrder, setLoadingServerOrder] = useState<boolean>(false);
  const [capturingOnServer, setCapturingOnServer] = useState<boolean>(false);
  const [idempotentReplayNotice, setIdempotentReplayNotice] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [simulatedOutcome, setSimulatedOutcome] = useState<
    'COMPLETED' | 'DECLINED' | 'PENDING' | 'TIMEOUT'
  >('COMPLETED');

  const sdkContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const freshCreateKey = `idem-create-${Date.now()}`;
    const freshCaptureKey = `idem-cap-${Date.now()}`;
    setCreateIdempotencyKey(freshCreateKey);
    setCaptureIdempotencyKey(freshCaptureKey);
    setIdempotentReplayNotice(null);
    setServerError(null);
    setGuestCaptureToken(null);

    const initServerCheckout = async () => {
      setLoadingServerOrder(true);
      try {
        const cfgRes = await fetch('/api/config');
        if (cfgRes.ok) {
          const cfg = await cfgRes.json();
          setPaypalClientId(cfg.paypalClientId || 'sb');
        }

        const createRes = await authFetch('/api/paypal/create-order', {
          method: 'POST',
          body: JSON.stringify({
            idempotencyKey: freshCreateKey,
            currency: 'USD',
            items: [
              { sku: '#FAN-BLDC-892', quantity: 1, clientPriceIgnored: 1 },
              { sku: '#SPO-YNX-99P', quantity: 1, clientPriceIgnored: 1 },
            ],
            clientUntrustedTotalMinor: 100,
          }),
        });

        let data: any = null;
        try {
          data = await createRes.json();
        } catch (_) {}

        if (!createRes.ok || !data?.ok) {
          const errMsg = data?.error || `Server order creation failed (HTTP ${createRes.status})`;
          setServerError(errMsg);
          setServerOrder(null);
        } else {
          setServerOrder(data.order);
          if (data.guestCaptureToken) {
            setGuestCaptureToken(data.guestCaptureToken);
          }
          setLastServerOrderId(data.order.id);
        }
      } catch (err) {
        setServerError(err instanceof Error ? err.message : 'Unable to start checkout');
      } finally {
        setLoadingServerOrder(false);
      }
    };

    void initServerCheckout();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !paypalClientId) return;

    if (window.paypal) {
      setSdkReady(true);
      return;
    }

    const existingScript = document.getElementById(
      'paypal-js-sdk-script'
    ) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener('load', () => setSdkReady(true));
      return;
    }

    const script = document.createElement('script');
    script.id = 'paypal-js-sdk-script';
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      paypalClientId
    )}&currency=USD&intent=capture`;
    script.async = true;
    script.onload = () => setSdkReady(true);
    script.onerror = () => setSdkReady(false);
    document.body.appendChild(script);
  }, [isOpen, paypalClientId]);

  useEffect(() => {
    if (!isOpen || !sdkReady || !window.paypal || !serverOrder || !sdkContainerRef.current) return;
    sdkContainerRef.current.innerHTML = '';

    try {
      window.paypal
        .Buttons({
          style: {
            layout: 'horizontal',
            color: 'gold',
            shape: 'rect',
            label: 'paypal',
            height: 40,
          },
          createOrder: async () => {
            return serverOrder.paypalOrderId;
          },
          onApprove: async (data) => {
            await handleServerCapture(data.orderID || serverOrder.id, 'COMPLETED');
          },
          onCancel: () => {
            void handleServerCancel();
          },
          onError: () => {
            setServerError(
              'PayPal popup could not complete in this preview window. Use the Complete Payment button below.'
            );
          },
        })
        .render(sdkContainerRef.current)
        .catch(() => {
          // ignore
        });
    } catch {
      // ignore
    }
  }, [isOpen, sdkReady, serverOrder?.paypalOrderId]);

  if (!isOpen) return null;

  const handleServerCapture = async (
    targetId: string,
    outcomeOverride?: 'COMPLETED' | 'DECLINED' | 'PENDING' | 'TIMEOUT'
  ) => {
    if (capturingOnServer) return;
    setCapturingOnServer(true);
    setServerError(null);

    const outcomeToUse = outcomeOverride || simulatedOutcome;

    try {
      const res = await authFetch(`/api/paypal/capture-order/${encodeURIComponent(targetId)}`, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: captureIdempotencyKey,
          simulateOutcome: outcomeToUse,
          ...(guestCaptureToken ? { guestCaptureToken } : {}),
        }),
      });

      let data: any = null;
      try {
        if (res.ok) {
          data = await res.json();
        }
      } catch (_) {}

      if (!data || !data.ok) {
        const failureMessage =
          data?.error || `Capture failed (HTTP ${res.status}). No payment was confirmed.`;
        setServerError(failureMessage);
        setServerConfirmed(false);
        if (data?.order) {
          setServerOrder(data.order);
          setLastServerOrderId(data.order.id);
        }
        if (data?.retryAllowed) {
          setCaptureIdempotencyKey(`idem-cap-retry-${Date.now()}`);
        }
        return;
      }

      setServerOrder(data.order);
      setLastServerOrderId(data.order.id);

      if (data.idempotentReplay) {
        setIdempotentReplayNotice(
          'Duplicate click ignored: your order was only charged once.'
        );
      } else {
        setIdempotentReplayNotice(null);
      }

      if (data.order.verifiedByServer && data.order.paymentStatus === 'Captured') {
        setServerConfirmed(true);
        setFeesVerified(Boolean(data.order.feesFromProvider));
      } else {
        setServerConfirmed(false);
      }

      if (data.retryAllowed && data.order.paymentStatus !== 'Captured') {
        setCaptureIdempotencyKey(`idem-cap-retry-${Date.now()}`);
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Network error during payment');
    } finally {
      setCapturingOnServer(false);
    }
  };

  const handleTestIdempotentDoubleClick = async () => {
    if (!serverOrder) return;
    await handleServerCapture(serverOrder.id, 'COMPLETED');
  };

  const handleServerCancel = async () => {
    if (!serverOrder) {
      onSimulateRedirectCancel?.();
      return;
    }
    try {
      const res = await authFetch(`/api/paypal/cancel-order/${encodeURIComponent(serverOrder.id)}`, {
        method: 'POST',
        body: JSON.stringify({
          reason: 'Buyer cancelled checkout',
          ...(guestCaptureToken ? { guestCaptureToken } : {}),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setServerOrder(data.order);
        setLastServerOrderId(data.order.id);
      }
    } catch {
      // ignore
    }
    onSimulateRedirectCancel?.();
  };

  const subtotalMajor = serverOrder ? fromMinorUnits(serverOrder.subtotalMinor) : 0;
  const taxMajor = serverOrder ? fromMinorUnits(serverOrder.taxMinor) : 0;
  const totalMajor = serverOrder ? fromMinorUnits(serverOrder.totalMinor) : 0;
  const feeMajor =
    serverOrder && serverOrder.feesFromProvider && serverOrder.paypalFeeMinor !== null
      ? fromMinorUnits(serverOrder.paypalFeeMinor)
      : undefined;
  const payoutMajor =
    serverOrder && serverOrder.feesFromProvider && serverOrder.netPayoutMinor !== null
      ? fromMinorUnits(serverOrder.netPayoutMinor)
      : undefined;

  return (
    <div className="fixed inset-0 bg-on-surface/50 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-surface-container-lowest border border-surface-container-high w-full max-w-lg rounded-xl shadow-xl overflow-hidden my-auto">
        {/* PayPal Header */}
        <div className="bg-primary px-5 py-4 flex items-center justify-between text-on-primary">
          <div className="flex items-center gap-2.5">
            <i className="fa-brands fa-paypal text-2xl text-primary bg-surface-container-lowest p-1.5 rounded-lg"></i>
            <div>
              <div className="font-bold text-base font-headline tracking-tight leading-none flex items-center gap-2">
                PayPal Checkout &amp; Escrow
                <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-white/15">
                  {dataSource === 'live' ? 'Live' : 'Demo data'}
                </span>
              </div>
              <span className="text-[11px] text-on-primary-container block mt-1 font-tabular-nums">
                {serverOrder
                  ? `${serverOrder.orderNumber} • PayPal Ref: ${serverOrder.paypalOrderId}`
                  : 'Preparing order...'}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-on-primary/80 hover:text-white transition-colors w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer"
            aria-label="Close PayPal Checkout"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
          {/* Payment & Escrow Status */}
          <div className="p-3.5 rounded-xl bg-surface-container-low border border-surface-container-high flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-on-surface">
                Order &amp; Escrow Status
              </div>
              <div className="text-[11px] text-secondary">
                {serverOrder
                  ? formatEscrowStateLabel(serverOrder.escrowState)
                  : 'Preparing order...'}
              </div>
            </div>
            <PaymentStateBadge
              state={serverOrder ? serverOrder.paymentStatus : 'Pending'}
              serverConfirmed={Boolean(serverOrder?.verifiedByServer)}
            />
          </div>

          {/* Honest Currency Notice */}
          <div className="p-3 rounded-xl bg-surface-container-low border border-surface-container-high flex items-center justify-between text-xs">
            <span className="font-semibold text-on-surface flex items-center gap-1.5">
              <i className="fa-solid fa-dollar-sign text-primary"></i>
              Charged in USD
            </span>
            <span className="text-[11px] text-secondary font-tabular-nums">
              Catalog converted at fixed rate (1 USD ≈ 83.33 INR)
            </span>
          </div>

          <div className="p-3 rounded-xl bg-primary-fixed/30 border border-primary-fixed-dim text-xs text-on-surface leading-relaxed">
            <strong>Buyer Protection:</strong> Your payment is held safely in escrow and released to the seller only after you confirm delivery.
          </div>

          {loadingServerOrder ? (
            <div className="p-6 rounded-xl border border-surface-container-high text-center text-xs text-secondary">
              Calculating item total and 18% GST...
            </div>
          ) : (
            serverOrder && (
              <MoneyBreakdownCard
                title={`Order Summary (${formatMinorUnits(
                  serverOrder.totalMinor,
                  serverOrder.currency
                )})`}
                currency={serverOrder.currency}
                subtotal={subtotalMajor}
                taxLabel="GST (18%)"
                taxAmount={taxMajor}
                feeLabel="PayPal Fee"
                feeAmount={feeMajor}
                isFeesVerified={serverOrder.feesFromProvider}
                payoutLabel="Net Seller Payout"
                payoutAmount={payoutMajor}
                total={totalMajor}
              />
            )
          )}

          {(serverError || serverOrder?.failureReason) && (
            <div className="p-3 rounded-xl bg-error-container text-xs text-on-error-container">
              <strong>Payment Notice:</strong> {serverError || serverOrder?.failureReason}
            </div>
          )}

          {idempotentReplayNotice && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
              {idempotentReplayNotice}
            </div>
          )}

          {/* Official PayPal Button Container */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-secondary font-semibold">
              <span>Pay with PayPal</span>
              <span className="font-tabular-nums text-[10px]">
                Ref: {createIdempotencyKey.slice(-8)}
              </span>
            </div>
            <div
              ref={sdkContainerRef}
              id="paypal-sdk-button-container"
              className="min-h-[42px] rounded-xl bg-surface-container-low border border-surface-container-high p-2 flex items-center justify-center"
            >
              {!sdkReady && (
                <span className="text-xs text-secondary">
                  Loading PayPal button...
                </span>
              )}
            </div>
          </div>

          {/* Sandbox Payment Outcome Selector */}
          <div className="p-3.5 rounded-xl bg-surface-container-low border border-surface-container-high space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="sandbox-outcome-select"
                className="text-[11px] font-bold text-on-surface uppercase tracking-wider"
              >
                Test Payment Scenario
              </label>
              <select
                id="sandbox-outcome-select"
                value={simulatedOutcome}
                onChange={(e) =>
                  setSimulatedOutcome(
                    e.target.value as 'COMPLETED' | 'DECLINED' | 'PENDING' | 'TIMEOUT'
                  )
                }
                aria-label="Select PayPal test scenario"
                className="text-xs font-semibold bg-surface-container-lowest border border-surface-container-high rounded-lg px-2 py-1 text-on-surface"
              >
                <option value="COMPLETED">Completed Payment</option>
                <option value="DECLINED">Card Declined</option>
                <option value="PENDING">Pending Bank Hold</option>
                <option value="TIMEOUT">Connection Timeout (Retry)</option>
              </select>
            </div>

            <div className="flex flex-wrap gap-2">
              {serverOrder?.paymentStatus !== 'Captured' ? (
                <button
                  type="button"
                  disabled={!serverOrder || capturingOnServer}
                  onClick={() => serverOrder && handleServerCapture(serverOrder.id)}
                  data-testid="confirm-paypal-authorize-btn"
                  className="flex-1 py-2.5 px-4 bg-primary hover:bg-primary-container disabled:opacity-50 text-on-primary font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 text-xs cursor-pointer"
                >
                  <i className="fa-solid fa-lock"></i>
                  <span>
                    {capturingOnServer
                      ? 'Completing Payment...'
                      : `Complete PayPal Payment (${
                          serverOrder
                            ? formatMinorUnits(serverOrder.totalMinor, serverOrder.currency)
                            : '...'
                        })`}
                  </span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onSuccess}
                    data-testid="confirm-paypal-authorize-btn"
                    className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 text-xs cursor-pointer"
                  >
                    <i className="fa-solid fa-circle-check"></i>
                    <span>View Order in My Orders →</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleTestIdempotentDoubleClick}
                    className="py-2.5 px-3 bg-surface-container hover:bg-surface-container-high text-on-surface font-semibold rounded-xl text-xs cursor-pointer"
                  >
                    Test Double-Click Protection
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-surface-container-high flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-secondary">
              Preview Return Pages:
            </span>
            <div className="flex items-center gap-2">
              {onSimulateRedirectReturn && (
                <button
                  type="button"
                  onClick={onSimulateRedirectReturn}
                  className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-semibold border border-emerald-200 transition-colors cursor-pointer"
                >
                  Success Page
                </button>
              )}
              <button
                type="button"
                onClick={handleServerCancel}
                className="px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-secondary text-[11px] font-semibold transition-colors cursor-pointer"
              >
                Cancel Order
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
