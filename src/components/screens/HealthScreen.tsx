import React, { useState, useEffect } from 'react';
import { HealthCheckItem, SystemHealthReport } from '../../server/healthService';
import { useRole } from '../../context/RoleContext';

export const HealthScreen: React.FC = () => {
  const { role, getActorHeaders } = useRole();
  const [report, setReport] = useState<SystemHealthReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [testingWebhook, setTestingWebhook] = useState<boolean>(false);
  const [webhookResult, setWebhookResult] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState<boolean>(false);

  const fetchHealthReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/health/system-check', {
        headers: getActorHeaders(),
      });
      const data = (await res.json()) as SystemHealthReport;
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to query /api/health/system-check');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchHealthReport();
  }, []);

  const handleTestWebhook = async () => {
    setTestingWebhook(true);
    setWebhookResult(null);
    try {
      const res = await fetch('/api/paypal/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getActorHeaders(),
        },
        body: JSON.stringify({
          id: `WH-TEST-${Date.now()}`,
          event_type: 'PAYMENT.CAPTURE.COMPLETED',
          summary: 'Diagnostic health check test capture event',
          resource: {
            id: 'ord-1',
            order_id: 'ord-1',
            status: 'COMPLETED',
          },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setWebhookResult(`✓ Webhook accepted (HTTP 200) — Event '${data.receivedEventType}' processed`);
      } else {
        setWebhookResult(`✗ Webhook rejected: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      setWebhookResult(`✗ Webhook dispatch failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTestingWebhook(false);
    }
  };

  const getStatusBadge = (status: 'healthy' | 'degraded' | 'error') => {
    if (status === 'healthy') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
          <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
          HEALTHY
        </span>
      );
    }
    if (status === 'degraded') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
          <span className="w-2 h-2 rounded-full bg-amber-600"></span>
          DEGRADED / FALLBACK
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
        <span className="w-2 h-2 rounded-full bg-rose-600"></span>
        FAILED
      </span>
    );
  };

  const getCategoryIcon = (category: HealthCheckItem['category']) => {
    switch (category) {
      case 'database':
        return 'database';
      case 'paypal':
        return 'payments';
      case 'gemini':
        return 'psychology';
      case 'storage':
        return 'view_in_ar';
      default:
        return 'health_and_safety';
    }
  };

  return (
    <div className="flex flex-col w-full max-w-6xl mx-auto px-4 md:px-8 py-6 gap-6">
      {/* Top Header */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded bg-blue-100 text-blue-900 font-mono text-[10px] font-bold uppercase tracking-wider">
              Diagnostic Desk • /health
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
              Caller Role: {role}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <span className="material-symbols-outlined text-blue-600 text-[28px]">
              health_and_safety
            </span>
            <span>AC PayPilot Live System Health Check</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Live real-time verification of Cloud Firestore, PayPal Sandbox OAuth2 token generation,
            server-side Gemini AI engine, and binary glTF 2.0 3D asset storage.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={fetchHealthReport}
            disabled={loading}
            className="px-4 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white font-label-md text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            <span
              className={`material-symbols-outlined text-[16px] ${
                loading ? 'animate-spin' : ''
              }`}
            >
              refresh
            </span>
            <span>{loading ? 'Running Diagnostics...' : 'Run Live Diagnostic'}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowRawJson((prev) => !prev)}
            className="px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer"
          >
            {showRawJson ? 'Hide JSON' : 'View JSON'}
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-rose-600">error</span>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={fetchHealthReport}
            className="underline font-bold hover:text-rose-950"
          >
            Retry
          </button>
        </div>
      )}

      {/* Diagnostic Cards Grid */}
      {report && (
        <div className="space-y-6">
          {/* Status summary banner */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
              <span className="text-[11px] font-mono text-slate-400 uppercase">System Status</span>
              <div className="mt-1 flex items-center gap-2">
                {getStatusBadge(report.status)}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
              <span className="text-[11px] font-mono text-slate-400 uppercase">Node Runtime</span>
              <div className="mt-1 text-sm font-bold text-slate-900 font-mono">
                {report.nodeVersion} (Uptime: {report.uptimeSeconds}s)
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
              <span className="text-[11px] font-mono text-slate-400 uppercase">Active Subsystems</span>
              <div className="mt-1 text-sm font-bold text-slate-900 font-mono">
                {report.checks.filter((c) => c.status === 'healthy').length} / {report.checks.length} Operational
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
              <span className="text-[11px] font-mono text-slate-400 uppercase">Timestamp</span>
              <div className="mt-1 text-xs font-semibold text-slate-700 font-mono truncate">
                {new Date(report.serverTime).toLocaleTimeString()} IST
              </div>
            </div>
          </div>

          {/* Subsystem Inspection Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {report.checks.map((chk, idx) => (
              <div
                key={idx}
                className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-800 shadow-2xs">
                        <span className="material-symbols-outlined text-[20px]">
                          {getCategoryIcon(chk.category)}
                        </span>
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-slate-900">{chk.name}</h2>
                        <span className="text-[10px] font-mono text-slate-400 uppercase">
                          Category: {chk.category}
                        </span>
                      </div>
                    </div>
                    {getStatusBadge(chk.status)}
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100 font-mono">
                    {chk.message}
                  </p>

                  {chk.details && (
                    <div className="text-[11px] font-mono text-slate-500 bg-slate-50/50 p-2.5 rounded-lg border border-slate-200/60 overflow-x-auto">
                      <pre className="whitespace-pre-wrap">{JSON.stringify(chk.details, null, 2)}</pre>
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-mono text-slate-500">
                  <span>Latency: <strong className="text-slate-800">{chk.latencyMs}ms</strong></span>
                  <span>Checked: {new Date(chk.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>

          {/* PayPal Webhook Simulation Test Box */}
          <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <span className="material-symbols-outlined text-blue-600 text-[18px]">webhook</span>
                  <span>Test PayPal Sandbox Webhook Dispatch (POST /api/paypal/webhook)</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Simulates a <code>PAYMENT.CAPTURE.COMPLETED</code> webhook payload sent to the backend to verify state transition & audit recording.
                </p>
              </div>

              <button
                type="button"
                onClick={handleTestWebhook}
                disabled={testingWebhook}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer shrink-0"
              >
                {testingWebhook ? 'Testing...' : 'Dispatch Test Webhook'}
              </button>
            </div>

            {webhookResult && (
              <div
                className={`p-3 rounded-xl text-xs font-mono font-semibold ${
                  webhookResult.startsWith('✓')
                    ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                    : 'bg-rose-50 text-rose-900 border border-rose-200'
                }`}
              >
                {webhookResult}
              </div>
            )}
          </div>

          {/* Raw JSON viewer */}
          {showRawJson && (
            <div className="p-4 rounded-2xl bg-slate-900 text-emerald-400 font-mono text-xs overflow-x-auto shadow-inner">
              <pre>{JSON.stringify(report, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
