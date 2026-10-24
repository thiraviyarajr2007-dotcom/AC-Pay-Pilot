import React, { useState, useEffect } from 'react';
import { useRole } from '../../context/RoleContext';
import {
  saveMerchantProfileToFirestore,
  getMerchantProfileFromFirestore,
} from '../../services/firestoreService';

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export const SettingsScreen: React.FC = () => {
  const { role, firebaseUser, getActorHeaders } = useRole();

  const [merchantName, setMerchantName] = useState('TechPilot Solutions Store (IN)');
  const [merchantGstin, setMerchantGstin] = useState('29AABCC1234D1Z9');
  const [settlementBank, setSettlementBank] = useState(
    'HDFC Bank Corporate •••• 9014 (IFSC: HDFC0001204)'
  );
  const [sandboxConnected, setSandboxConnected] = useState(true);
  const [testingPing, setTestingPing] = useState(false);
  const [pingResult, setPingResult] = useState('114ms • PayPal India Sandbox Gateway Connected');
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [formErrors, setFormErrors] = useState<{
    merchantName?: string;
    merchantGstin?: string;
    settlementBank?: string;
  }>({});

  const [notifications, setNotifications] = useState({
    escrowRelease: true,
    overdueAutoChase: true,
    lowStockReorder: true,
    feeTierAlerts: true,
  });

  // Load existing profile from Firestore / Server on mount
  useEffect(() => {
    let isMounted = true;
    async function loadProfile() {
      const targetUid = firebaseUser?.uid || 'seller-demo-1';
      try {
        const profile = await getMerchantProfileFromFirestore(targetUid);
        if (profile && isMounted) {
          setMerchantName(profile.storeName);
          setMerchantGstin(profile.gstin);
          setSettlementBank(profile.settlementAccount);
          if (profile.notifications) {
            setNotifications(profile.notifications);
          }
        }
      } catch {
        // Fallback to initial defaults if offline
      }
    }
    void loadProfile();
    return () => {
      isMounted = false;
    };
  }, [firebaseUser?.uid]);

  const validateForm = () => {
    const errors: {
      merchantName?: string;
      merchantGstin?: string;
      settlementBank?: string;
    } = {};

    const cleanName = merchantName.trim();
    if (!cleanName) {
      errors.merchantName = 'Store display name is required.';
    } else if (cleanName.length < 3) {
      errors.merchantName = 'Store name must be at least 3 characters.';
    }

    const cleanGstin = merchantGstin.trim().toUpperCase();
    if (!cleanGstin) {
      errors.merchantGstin = 'Registered GSTIN is required.';
    } else if (!GSTIN_REGEX.test(cleanGstin)) {
      errors.merchantGstin =
        'Invalid 15-character GSTIN format (e.g. 29AABCC1234D1Z9). Check state code & checksum.';
    }

    const cleanBank = settlementBank.trim();
    if (!cleanBank) {
      errors.settlementBank = 'Settlement bank account details are required.';
    } else if (cleanBank.length < 5) {
      errors.settlementBank = 'Enter valid bank name, account number, or IFSC.';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSaving(true);
    setStatusMessage(null);

    const uid = firebaseUser?.uid || 'seller-demo-1';
    const cleanGstin = merchantGstin.trim().toUpperCase();

    try {
      // 1. Save to server REST API
      const serverRes = await fetch('/api/merchants/profile', {
        method: 'POST',
        headers: getActorHeaders(),
        body: JSON.stringify({
          uid,
          storeName: merchantName.trim(),
          gstin: cleanGstin,
          settlementAccount: settlementBank.trim(),
          notifications,
        }),
      });

      if (!serverRes.ok) {
        const errJson = await serverRes.json();
        throw new Error(errJson.error || 'Server rejected merchant profile update');
      }

      // 2. Persist to Firestore
      await saveMerchantProfileToFirestore({
        uid,
        storeName: merchantName.trim(),
        gstin: cleanGstin,
        settlementAccount: settlementBank.trim(),
        email: firebaseUser?.email || 'seller@paypilot.in',
        role: (role === 'customer' || role === 'finance' || role === 'business_head') ? role : 'seller',
        notifications,
        updatedAt: new Date().toISOString(),
      });

      setStatusMessage({
        type: 'success',
        text: 'Merchant configuration successfully saved to Firestore & Server API.',
      });
      setTimeout(() => setStatusMessage(null), 4500);
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save merchant configuration.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTestingPing(true);
    const start = performance.now();
    try {
      const res = await fetch('/api/health/system-check', {
        headers: getActorHeaders(),
      });
      const data = await res.json();
      const latency = Math.round(performance.now() - start);
      if (res.ok) {
        setPingResult(`${latency}ms • Node runtime healthy (${data.checks?.length || 4} subsystems operational)`);
      } else {
        setPingResult(`${latency}ms • Diagnostic check reported issue: ${data.status || 'unknown'}`);
      }
    } catch {
      const latency = Math.round(performance.now() - start);
      setPingResult(`${latency}ms • Connection error reaching /api/health/system-check`);
    } finally {
      setTestingPing(false);
    }
  };

  return (
    <div className="flex flex-col w-full max-w-5xl mx-auto px-4 md:px-8 py-6 gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-surface-container-high/60">
        <div>
          <span className="font-label-sm text-[11px] uppercase tracking-wider text-primary font-bold">
            Merchant &amp; Gateway Configuration
          </span>
          <h1 className="font-headline-xl text-headline-xl text-on-surface font-bold tracking-tight mt-0.5">
            Platform Settings &amp; PayPal Sandbox Integration
          </h1>
          <p className="font-body-md text-secondary text-sm">
            Manage merchant identity, registered GSTIN, settlement bank, escrow notifications, and API security status.
          </p>
        </div>

        {statusMessage && (
          <div
            className={`px-4 py-2 rounded-xl font-label-md text-xs font-bold flex items-center gap-2 border ${
              statusMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">
              {statusMessage.type === 'success' ? 'check_circle' : 'error'}
            </span>
            <span>{statusMessage.text}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Cols: Merchant Profile Form */}
        <form
          onSubmit={handleSaveProfile}
          noValidate
          className="lg:col-span-7 bg-surface-container-lowest rounded-2xl shadow-sm p-6 border border-surface-container-high/60 flex flex-col gap-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-headline-md text-headline-md text-on-surface font-bold">
              Merchant Profile &amp; Settlement Bank
            </h2>
            <span className="px-2.5 py-0.5 rounded-full bg-surface-container text-primary font-label-sm text-xs font-bold">
              Tier 1 Verified
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-label-sm text-xs text-secondary uppercase font-semibold">
              Store Display Name *
            </label>
            <input
              type="text"
              value={merchantName}
              disabled={isSaving}
              onChange={(e) => {
                setMerchantName(e.target.value);
                if (formErrors.merchantName) setFormErrors((prev) => ({ ...prev, merchantName: undefined }));
              }}
              className={`h-10 px-3.5 rounded-lg bg-surface-container-low text-on-surface font-body-md text-sm border focus:outline-none transition-colors ${
                formErrors.merchantName
                  ? 'border-error focus:border-error bg-error/5'
                  : 'border-surface-container-high/60 focus:border-primary'
              }`}
            />
            {formErrors.merchantName && (
              <span className="text-[11px] text-error font-medium">{formErrors.merchantName}</span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-label-sm text-xs text-secondary uppercase font-semibold">
              Registered GSTIN (India) *
            </label>
            <input
              type="text"
              value={merchantGstin}
              disabled={isSaving}
              onChange={(e) => {
                setMerchantGstin(e.target.value.toUpperCase());
                if (formErrors.merchantGstin) setFormErrors((prev) => ({ ...prev, merchantGstin: undefined }));
              }}
              placeholder="e.g. 29AABCC1234D1Z9"
              maxLength={15}
              className={`h-10 px-3.5 rounded-lg bg-surface-container-low text-on-surface font-mono text-sm border uppercase focus:outline-none transition-colors ${
                formErrors.merchantGstin
                  ? 'border-error focus:border-error bg-error/5'
                  : 'border-surface-container-high/60 focus:border-primary'
              }`}
            />
            {formErrors.merchantGstin ? (
              <span className="text-[11px] text-error font-medium">{formErrors.merchantGstin}</span>
            ) : (
              <span className="text-[10px] text-secondary">
                15-character alphanumeric format: 2-digit state code + 10-char PAN + 1 entity + Z + checksum.
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-label-sm text-xs text-secondary uppercase font-semibold">
              Primary Settlement Account (NEFT / IMPS T+0) *
            </label>
            <input
              type="text"
              value={settlementBank}
              disabled={isSaving}
              onChange={(e) => {
                setSettlementBank(e.target.value);
                if (formErrors.settlementBank) setFormErrors((prev) => ({ ...prev, settlementBank: undefined }));
              }}
              className={`h-10 px-3.5 rounded-lg bg-surface-container-low text-on-surface font-body-md text-sm border focus:outline-none transition-colors ${
                formErrors.settlementBank
                  ? 'border-error focus:border-error bg-error/5'
                  : 'border-surface-container-high/60 focus:border-primary'
              }`}
            />
            {formErrors.settlementBank && (
              <span className="text-[11px] text-error font-medium">{formErrors.settlementBank}</span>
            )}
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-xs font-bold hover:bg-primary-container disabled:opacity-50 transition-colors shadow-sm flex items-center gap-2 cursor-pointer"
            >
              {isSaving && (
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
              )}
              <span>{isSaving ? 'Saving Configuration...' : 'Save Merchant Profile'}</span>
            </button>
          </div>
        </form>

        {/* Right 5 Cols: PayPal Sandbox & API Telemetry */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <div className="bg-surface-container-lowest rounded-2xl shadow-sm p-6 border border-surface-container-high/60 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#003087] text-white flex items-center justify-center font-bold text-sm">
                  PP
                </div>
                <div>
                  <h2 className="font-headline-sm text-sm text-on-surface font-bold">
                    PayPal Sandbox Gateway
                  </h2>
                  <span className="text-xs text-secondary font-mono">
                    sb-merchant-ind@business.example.com
                  </span>
                </div>
              </div>
              <span
                className={`px-2.5 py-0.5 rounded-full font-label-sm text-xs font-bold ${
                  sandboxConnected
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-error-container text-on-error-container'
                }`}
              >
                {sandboxConnected ? 'Connected' : 'Paused'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-surface-container-low text-xs text-on-surface flex items-center justify-between border border-surface-container-high/50">
              <span>Live Telemetry:</span>
              <span className="font-mono font-bold text-primary truncate max-w-[240px]">
                {pingResult}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testingPing}
                className="flex-1 py-2 px-3 rounded-lg bg-surface-container text-primary font-label-md text-xs font-bold hover:bg-surface-container-high disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {testingPing ? (
                  <>
                    <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
                    <span>Pinging Gateway...</span>
                  </>
                ) : (
                  <span>Test Gateway Latency</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setSandboxConnected((c) => !c)}
                className="py-2 px-3 rounded-lg bg-surface-container-low text-on-surface-variant font-label-md text-xs font-semibold hover:text-on-surface transition-colors cursor-pointer"
              >
                {sandboxConnected ? 'Pause Sync' : 'Resume Sync'}
              </button>
            </div>
          </div>

          {/* Autonomous Notification Toggles */}
          <div className="bg-surface-container-lowest rounded-2xl shadow-sm p-6 border border-surface-container-high/60 flex flex-col gap-3.5">
            <h2 className="font-headline-sm text-sm text-on-surface font-bold">
              Autonomous Engine Notifications
            </h2>

            {[
              {
                key: 'escrowRelease',
                label: 'Instant Escrow Release Alerts',
                desc: 'Notify when buyer delivery token unlocks funds',
              },
              {
                key: 'overdueAutoChase',
                label: 'InvoiceIQ Auto-Chase Dispatch',
                desc: 'Send automated reminders on Day 2 overdue',
              },
              {
                key: 'lowStockReorder',
                label: 'Predictive Stockout Warnings',
                desc: 'Alert when SKU velocity breaches 72h buffer',
              },
              {
                key: 'feeTierAlerts',
                label: 'Micropayment Fee Optimization',
                desc: 'Flag transactions eligible for lower gateway tiers',
              },
            ].map((item) => {
              const checked = notifications[item.key as keyof typeof notifications];
              return (
                <label
                  key={item.key}
                  className="flex items-center justify-between py-1.5 cursor-pointer border-b border-surface-container-low last:border-0"
                >
                  <div className="flex flex-col pr-3">
                    <span className="font-label-md text-xs font-bold text-on-surface">
                      {item.label}
                    </span>
                    <span className="text-[11px] text-secondary">{item.desc}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setNotifications((prev) => ({ ...prev, [item.key]: e.target.checked }))
                    }
                    className="w-4 h-4 accent-primary rounded cursor-pointer"
                  />
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
