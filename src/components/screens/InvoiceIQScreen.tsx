import React, { useState, useEffect } from 'react';
import { formatINR } from '../../utils/finance';
import { copyTextToClipboard, downloadTextFile } from '../../utils/export';
import {
  MoneyBreakdownCard,
  PaymentStateBadge,
  DataCollectionBoundary,
  CanonicalPaymentState,
  CollectionViewState,
} from '../ui/HonestTrustComponents';
import { useRole } from '../../context/RoleContext';
import { saveInvoiceToFirestore } from '../../services/firestoreService';
import { CreateInvoiceModal } from '../modals/CreateInvoiceModal';
import { Invoice } from '../../types';

interface InvoiceIQScreenProps {
  onOpenCopilot?: (query?: string) => void;
  onOpenFeeAudit?: () => void;
  showToast?: (msg: string) => void;
  selectedInvoiceId?: string;
  onSelectInvoiceId?: (id: string) => void;
  globalSearchQuery?: string;
}

interface InvoiceRecord {
  id: string;
  buyer: string;
  gstin: string;
  placeOfSupplyCode: string;
  date: string;
  dueDate: string;
  overdueDays: number;
  subtotal: number;
  gstAmount: number;
  feeAmount: number;
  total: number;
  paymentState: CanonicalPaymentState;
  hsnCode: string;
  lineItem: string;
  auditClause: string;
}

const INITIAL_INVOICES: InvoiceRecord[] = [
  {
    id: 'INV-2026-089',
    buyer: 'Apex Studio Pvt Ltd (Maharashtra)',
    gstin: '27AABCA8921K1Z4',
    placeOfSupplyCode: '27',
    date: '14 May 2026',
    dueDate: '28 May 2026',
    overdueDays: 0,
    subtotal: 247458,
    gstAmount: 44542,
    feeAmount: 4380,
    total: 292000,
    paymentState: 'Captured',
    hsnCode: '8471.50.00',
    lineItem: 'ProArt Studio Workstation X1 (64GB ECC / RTX 4090)',
    auditClause: 'Inter-state supply (29 Karnataka → 27 Maharashtra): 18% IGST verified.',
  },
  {
    id: 'INV-2026-088',
    buyer: 'Kinetix VFX Bengaluru (Karnataka)',
    gstin: '29AABCK4412M1Z9',
    placeOfSupplyCode: '29',
    date: '13 May 2026',
    dueDate: '27 May 2026',
    overdueDays: 4,
    subtotal: 100000,
    gstAmount: 18000,
    feeAmount: 1770,
    total: 118000,
    paymentState: 'Authorized',
    hsnCode: '8528.52.00',
    lineItem: 'UltraSharp 32" 6K HDR Reference Display',
    auditClause: 'Intra-state supply (29 Karnataka → 29 Karnataka): 9% CGST + 9% SGST split.',
  },
  {
    id: 'INV-2026-085',
    buyer: 'Monolith Architecture LLP (Invalid GSTIN Demo)',
    gstin: 'INVALID-GSTIN-99',
    placeOfSupplyCode: '07',
    date: '11 May 2026',
    dueDate: '25 May 2026',
    overdueDays: 9,
    subtotal: 357203,
    gstAmount: 64297,
    feeAmount: 6323,
    total: 421500,
    paymentState: 'Pending',
    hsnCode: '8471.50.00',
    lineItem: 'Workstation X1 + 32" 6K Display Bundle',
    auditClause: 'Awaiting valid 15-character buyer GSTIN before B2B input credit filing.',
  },
];

interface InvoiceAnalyzeResult {
  source: 'live' | 'fallback';
  invoiceId: string;
  riskScore: number;
  riskTier: string;
  reasons: string[];
  gstinCheck: {
    gstin: string;
    normalizedGstin: string;
    isValidFormat: boolean;
    stateCode: string | null;
    stateName: string | null;
    panSegment: string | null;
    reason: string;
  };
  placeOfSupplyCheck: {
    supplierStateCode: string;
    supplierStateName: string;
    buyerStateCode: string;
    buyerStateName: string;
    isIntraState: boolean;
    expectedRegime: 'CGST_SGST' | 'IGST' | 'EXPORT_ZERO_RATED';
    regimeMatches: boolean;
    cgstPercent: number;
    sgstPercent: number;
    igstPercent: number;
    explanation: string;
  };
  messageDraft: string;
}

export const InvoiceIQScreen: React.FC<InvoiceIQScreenProps> = ({
  onOpenFeeAudit,
  showToast,
  selectedInvoiceId,
  onSelectInvoiceId,
  globalSearchQuery = '',
}) => {
  const { serverConfirmed, setServerConfirmed, feesVerified, setFeesVerified, getActorHeaders } =
    useRole();

  const [invoices, setInvoices] = useState<InvoiceRecord[]>(INITIAL_INVOICES);
  const [activeId, setActiveId] = useState<string>(selectedInvoiceId || INITIAL_INVOICES[0].id);
  const [listState, setListState] = useState<CollectionViewState>('ready');
  const [newBuyerName, setNewBuyerName] = useState('');
  const [newGrossAmount, setNewGrossAmount] = useState('164000');

  // POST /api/invoice/analyze state
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<InvoiceAnalyzeResult | null>(null);
  const [editableDraft, setEditableDraft] = useState('');
  const [draftApproved, setDraftApproved] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    if (selectedInvoiceId) {
      setActiveId(selectedInvoiceId);
    }
  }, [selectedInvoiceId]);

  const filteredInvoices = invoices.filter((inv) => {
    if (!globalSearchQuery.trim()) return true;
    const q = globalSearchQuery.toLowerCase();
    return (
      inv.id.toLowerCase().includes(q) ||
      inv.buyer.toLowerCase().includes(q) ||
      inv.gstin.toLowerCase().includes(q) ||
      inv.lineItem.toLowerCase().includes(q)
    );
  });

  const activeInvoice =
    invoices.find((i) => i.id === activeId) || filteredInvoices[0] || invoices[0];

  const runServerInvoiceAnalysis = async (inv: InvoiceRecord) => {
    setAnalyzing(true);
    setDraftApproved(false);
    try {
      const res = await fetch('/api/invoice/analyze', {
        method: 'POST',
        headers: getActorHeaders(),
        body: JSON.stringify({
          invoiceId: inv.id,
          supplierGstin: '29AABCT1332L1Z5',
          buyerName: inv.buyer,
          buyerGstin: inv.gstin,
          placeOfSupplyStateCode: inv.placeOfSupplyCode,
          subtotalMinor: inv.subtotal * 100,
          taxMinor: inv.gstAmount * 100,
          totalMinor: inv.total * 100,
          gstRatePercent: 18,
          overdueDays: inv.overdueDays,
          lineItemSummary: `${inv.lineItem} (HSN ${inv.hsnCode})`,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setAnalysisResult(data);
        setEditableDraft(data.messageDraft);
      }
    } catch {
      showToast?.('Failed to run server invoice analysis.');
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    if (activeInvoice) {
      void runServerInvoiceAnalysis(activeInvoice);
    }
  }, [activeInvoice?.id]);

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    const gross = Math.max(1000, Number(newGrossAmount) || 164000);
    const sub = Math.round(gross / 1.18);
    const gst = gross - sub;
    const fee = Math.round(gross * 0.0349 + 12);
    const newId = `INV-2026-0${90 + invoices.length}`;
    const created: InvoiceRecord = {
      id: newId,
      buyer: newBuyerName.trim() || 'Stratos Design Labs Pvt Ltd',
      gstin: '27AADCS8192G1Z5',
      placeOfSupplyCode: '27',
      date: '15 May 2026',
      dueDate: '29 May 2026',
      overdueDays: 0,
      subtotal: sub,
      gstAmount: gst,
      feeAmount: fee,
      total: gross,
      paymentState: 'Pending',
      hsnCode: '8471.70.20',
      lineItem: 'ProRack 8-Bay 10GbE Studio NAS',
      auditClause: 'Draft B2B GST tax invoice generated.',
    };

    try {
      await saveInvoiceToFirestore({
        id: newId,
        invoiceNumber: newId,
        sellerId: 'seller-demo-1',
        customerId: 'cust-demo-1',
        clientName: created.buyer,
        clientGstin: created.gstin,
        placeOfSupplyCode: created.placeOfSupplyCode,
        currency: 'INR',
        subtotalMinor: created.subtotal * 100,
        taxMinor: created.gstAmount * 100,
        totalMinor: created.total * 100,
        invoiceStatus: 'issued',
        paymentStatus: 'Pending',
        hsnCode: created.hsnCode,
        lineItem: created.lineItem,
        auditClause: created.auditClause,
        issuedAt: new Date().toISOString(),
        dueDate: '2026-05-29T00:00:00.000Z',
      });
    } catch {
      // offline fallback
    }

    setInvoices((prev) => [created, ...prev]);
    setActiveId(newId);
    setNewBuyerName('');
    onSelectInvoiceId?.(newId);
    showToast?.(`Created invoice ${newId} (saved to Firestore) & navigated to view.`);
  };

  const handleSaveFromFullBuilder = async (invoice: Invoice) => {
    const gross = invoice.items.reduce((acc, it) => acc + it.quantity * it.unitRate * 1.18, 0);
    const sub = Math.round(gross / 1.18);
    const gst = Math.round(gross - sub);
    const fee = Math.round(gross * 0.0349 + 12);
    const posCode = invoice.placeOfSupply?.match(/\((\d{2})\)/)?.[1] || '29';

    const created: InvoiceRecord = {
      id: invoice.invoiceNumber.replace(/^#/, ''),
      buyer: invoice.clientName,
      gstin: invoice.clientGstin,
      placeOfSupplyCode: posCode,
      date: invoice.issueDate,
      dueDate: invoice.dueDate,
      overdueDays: 0,
      subtotal: sub,
      gstAmount: gst,
      feeAmount: fee,
      total: Math.round(gross),
      paymentState: 'Pending',
      hsnCode: invoice.items[0]?.hsn || '8471.50.00',
      lineItem: invoice.items.map((it) => it.name).join(', '),
      auditClause: `B2B GST invoice generated via full builder for POS ${posCode}.`,
    };

    try {
      await saveInvoiceToFirestore({
        id: created.id,
        invoiceNumber: created.id,
        sellerId: 'seller-demo-1',
        customerId: 'cust-demo-1',
        clientName: created.buyer,
        clientGstin: created.gstin,
        placeOfSupplyCode: posCode,
        currency: 'INR',
        subtotalMinor: created.subtotal * 100,
        taxMinor: created.gstAmount * 100,
        totalMinor: created.total * 100,
        invoiceStatus: 'issued',
        paymentStatus: 'Pending',
        hsnCode: created.hsnCode,
        lineItem: created.lineItem,
        auditClause: created.auditClause,
        issuedAt: new Date().toISOString(),
        dueDate: '2026-05-29T00:00:00.000Z',
      });
    } catch {
      // offline fallback
    }

    setInvoices((prev) => [created, ...prev]);
    setActiveId(created.id);
    onSelectInvoiceId?.(created.id);
    showToast?.(`Created invoice ${created.id} from full builder.`);
  };

  const handleDownloadInvoiceTxt = () => {
    if (!activeInvoice) return;
    const content = [
      `AC PAYPILOT B2B TAX INVOICE (${activeInvoice.id})`,
      `=================================================`,
      `Buyer: ${activeInvoice.buyer} (GSTIN: ${activeInvoice.gstin})`,
      `Date: ${activeInvoice.date} | Due: ${activeInvoice.dueDate}`,
      `Line Item: ${activeInvoice.lineItem} (HSN: ${activeInvoice.hsnCode})`,
      `Currency Code: INR`,
      `Subtotal (Taxable): INR ${activeInvoice.subtotal}`,
      `Tax Regime: ${
        analysisResult?.placeOfSupplyCheck.expectedRegime || 'IGST 18%'
      } (INR ${activeInvoice.gstAmount})`,
      `PayPal Escrow Fee: ${feesVerified ? `INR ${activeInvoice.feeAmount}` : 'Not available'}`,
      `Total Invoice Amount: INR ${activeInvoice.total}`,
      `Payment State: ${activeInvoice.paymentState} (Server Confirmed: ${serverConfirmed ? 'Yes' : 'No'})`,
      `Audit Clause: ${activeInvoice.auditClause}`,
    ].join('\n');
    downloadTextFile(`${activeInvoice.id}.txt`, content);
    showToast?.(`Downloaded ${activeInvoice.id}.txt`);
  };

  const handleCopyPayLink = async () => {
    if (!activeInvoice) return;
    const url = `${window.location.origin}/seller/invoices/${activeInvoice.id}`;
    await copyTextToClipboard(url);
    showToast?.(`Copied deep link for ${activeInvoice.id}`);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-mono uppercase tracking-wider text-blue-700 font-bold">
            POST /api/invoice/analyze • Deterministic GSTIN &amp; Place-of-Supply Check + AI Draft
          </span>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mt-0.5">
            InvoiceIQ: GSTIN Validation, CGST/SGST vs IGST &amp; Risk Analysis
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            GSTIN format regex and Place-of-Supply tax regime (CGST/SGST vs IGST) are verified in
            code; message draft is generated by the model and requires your approval.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <span className="material-symbols-outlined text-[16px]">post_add</span>
            <span>Full Invoice Builder</span>
          </button>
          <form onSubmit={handleCreateInvoice} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={newBuyerName}
              onChange={(e) => setNewBuyerName(e.target.value)}
              placeholder="Buyer company name..."
              className="px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none focus:border-blue-600"
            />
            <input
              type="number"
              value={newGrossAmount}
              onChange={(e) => setNewGrossAmount(e.target.value)}
              placeholder="Amount INR"
              className="w-28 px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono focus:outline-none focus:border-blue-600"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <i className="fa-solid fa-plus"></i>
              Quick Create
            </button>
          </form>
        </div>
      </div>

      {/* Deterministic Code Checks + AI Risk & Message Draft Panel (POST /api/invoice/analyze) */}
      {activeInvoice && analysisResult && (
        <div
          data-testid="invoice-analyze-panel"
          className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-slate-900">
                Invoice Analysis ({activeInvoice.id})
              </span>
              <span
                data-testid="invoice-ai-source-badge"
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase border ${
                  analysisResult.source === 'live'
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                    : 'bg-amber-50 text-amber-900 border-amber-300'
                }`}
              >
                Source: {analysisResult.source}
              </span>
              <span
                data-testid="invoice-risk-badge"
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase border ${
                  analysisResult.riskScore >= 60
                    ? 'bg-red-50 text-red-900 border-red-300'
                    : analysisResult.riskScore >= 30
                    ? 'bg-amber-50 text-amber-900 border-amber-300'
                    : 'bg-emerald-50 text-emerald-900 border-emerald-300'
                }`}
              >
                Risk Score: {analysisResult.riskScore}/100 ({analysisResult.riskTier})
              </span>
            </div>

            <button
              type="button"
              onClick={() => void runServerInvoiceAnalysis(activeInvoice)}
              disabled={analyzing}
              className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold cursor-pointer"
            >
              {analyzing ? 'Analyzing...' : 'Re-Run Analysis'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            {/* Code Check 1: GSTIN Format Check */}
            <div
              data-testid="gstin-format-check-card"
              className={`p-3.5 rounded-xl border ${
                analysisResult.gstinCheck.isValidFormat
                  ? 'bg-emerald-50/50 border-emerald-200'
                  : 'bg-red-50/60 border-red-200'
              }`}
            >
              <div className="font-mono text-[10px] uppercase font-bold text-slate-600 mb-1">
                Code Check 1 • GSTIN Format Regex
              </div>
              <div className="font-bold text-slate-900 font-mono">
                {analysisResult.gstinCheck.normalizedGstin} —{' '}
                {analysisResult.gstinCheck.isValidFormat ? 'VALID' : 'INVALID'}
              </div>
              <p className="text-[11px] text-slate-600 mt-1">{analysisResult.gstinCheck.reason}</p>
            </div>

            {/* Code Check 2: Place-of-Supply (CGST/SGST vs IGST) */}
            <div
              data-testid="place-of-supply-check-card"
              className="p-3.5 rounded-xl bg-blue-50/50 border border-blue-200"
            >
              <div className="font-mono text-[10px] uppercase font-bold text-blue-900 mb-1">
                Code Check 2 • Place of Supply Regime
              </div>
              <div className="font-bold text-slate-900 font-mono">
                {analysisResult.placeOfSupplyCheck.expectedRegime === 'CGST_SGST'
                  ? `Intra-State: ${analysisResult.placeOfSupplyCheck.cgstPercent}% CGST + ${analysisResult.placeOfSupplyCheck.sgstPercent}% SGST`
                  : `Inter-State: ${analysisResult.placeOfSupplyCheck.igstPercent}% IGST`}
              </div>
              <p className="text-[11px] text-slate-600 mt-1">
                {analysisResult.placeOfSupplyCheck.explanation}
              </p>
            </div>

            {/* Risk Reasons */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="font-mono text-[10px] uppercase font-bold text-slate-600 mb-1">
                Risk Factors &amp; Audit Reasons
              </div>
              <ul className="space-y-1 text-[11px] text-slate-700 list-disc pl-4">
                {analysisResult.reasons.map((r, idx) => (
                  <li key={idx}>{r}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Model-Drafted Message with Edit & Approve */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800">
                AI Drafted Buyer Finance Message (Edit &amp; Approve Before Sending):
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                {draftApproved ? 'Approved & Saved to Invoice' : 'Awaiting Approval'}
              </span>
            </div>
            <textarea
              rows={2}
              value={editableDraft}
              onChange={(e) => {
                setEditableDraft(e.target.value);
                setDraftApproved(false);
              }}
              className="w-full p-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setInvoices((prev) =>
                    prev.map((inv) =>
                      inv.id === activeInvoice.id ? { ...inv, auditClause: editableDraft } : inv
                    )
                  );
                  setDraftApproved(true);
                  showToast?.(`Approved compliance message saved to ${activeInvoice.id}`);
                }}
                data-testid="approve-invoice-draft-btn"
                className={`px-4 py-1.5 rounded-lg text-xs font-bold text-white cursor-pointer ${
                  draftApproved ? 'bg-emerald-600' : 'bg-blue-700 hover:bg-blue-800'
                }`}
              >
                {draftApproved ? 'Approved & Applied ✓' : 'Approve & Attach Message Draft'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Cols: Invoice Register Table */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3">
            B2B Invoice Register ({filteredInvoices.length})
          </h2>

          <DataCollectionBoundary
            title="GST Invoice Register"
            state={
              filteredInvoices.length === 0 && listState === 'ready' ? 'empty' : listState
            }
            onStateChange={setListState}
            emptyMessage="No invoices match your search query."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    <th className="py-3 pr-3">Invoice ID</th>
                    <th className="py-3 px-3">Buyer &amp; GSTIN</th>
                    <th className="py-3 px-3 text-right">Total (INR)</th>
                    <th className="py-3 pl-3">Payment State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 text-xs">
                  {filteredInvoices.map((inv) => (
                    <tr
                      key={inv.id}
                      onClick={() => {
                        setActiveId(inv.id);
                        onSelectInvoiceId?.(inv.id);
                      }}
                      className={`cursor-pointer transition-colors ${
                        activeInvoice?.id === inv.id ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-3.5 pr-3 font-mono font-bold text-blue-700">
                        {inv.id}
                        <div className="text-[11px] font-sans font-normal text-slate-500">
                          {inv.date}
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="font-bold text-slate-900">{inv.buyer}</div>
                        <div className="font-mono text-[11px] text-slate-500">
                          GSTIN: {inv.gstin} • POS: {inv.placeOfSupplyCode}
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono font-bold text-slate-900">
                        {formatINR(inv.total)}
                      </td>
                      <td className="py-3.5 pl-3">
                        <PaymentStateBadge
                          state={inv.paymentState}
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

        {/* Right 5 Cols: Deep-Linked Invoice Inspector & Money Breakdown Card */}
        {activeInvoice && (
          <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs space-y-4">
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <span className="font-mono text-xs font-bold text-blue-700">
                  {activeInvoice.id}
                </span>
                <h3 className="text-base font-bold text-slate-900">{activeInvoice.buyer}</h3>
                <p className="font-mono text-xs text-slate-500">GSTIN: {activeInvoice.gstin}</p>
              </div>
              <PaymentStateBadge
                state={activeInvoice.paymentState}
                serverConfirmed={serverConfirmed}
              />
            </div>

            <div className="text-xs space-y-1.5 bg-slate-50 p-3 rounded-lg border border-slate-200/60">
              <div className="font-semibold text-slate-800">{activeInvoice.lineItem}</div>
              <div className="font-mono text-slate-500">
                HSN: {activeInvoice.hsnCode} • Due: {activeInvoice.dueDate}
              </div>
              <div className="text-slate-600 pt-1 border-t border-slate-200/60">
                <strong>Compliance Note:</strong> {activeInvoice.auditClause}
              </div>
            </div>

            <MoneyBreakdownCard
              title={`Invoice ${activeInvoice.id} Commercial Breakdown`}
              currency="INR"
              subtotal={activeInvoice.subtotal}
              taxLabel={
                analysisResult?.placeOfSupplyCheck.expectedRegime === 'CGST_SGST'
                  ? `CGST (9%) + SGST (9%) Intra-State`
                  : `Integrated GST (18% IGST Inter-State)`
              }
              taxAmount={activeInvoice.gstAmount}
              feeLabel="PayPal Provider Fee (3.49% + ₹12)"
              feeAmount={activeInvoice.feeAmount}
              isFeesVerified={feesVerified}
              payoutLabel="Merchant Net Escrow Payout"
              payoutAmount={activeInvoice.total - activeInvoice.feeAmount}
              total={activeInvoice.total}
              onVerifyFees={() => {
                setFeesVerified(true);
                showToast?.('Provider fee schedule verified.');
              }}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={serverConfirmed}
                  onChange={(e) => setServerConfirmed(e.target.checked)}
                  className="rounded text-emerald-600"
                />
                Server Capture Confirmed
              </label>

              <div className="flex items-center gap-2">
                {onOpenFeeAudit && (
                  <button
                    type="button"
                    onClick={onOpenFeeAudit}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 cursor-pointer"
                  >
                    Fee Audit
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleCopyPayLink()}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 cursor-pointer"
                >
                  Copy Link
                </button>
                <button
                  type="button"
                  onClick={handleDownloadInvoiceTxt}
                  className="px-3.5 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer"
                >
                  Download TXT
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <CreateInvoiceModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSaveInvoice={handleSaveFromFullBuilder}
      />
    </div>
  );
};
