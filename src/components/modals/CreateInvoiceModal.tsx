import React, { useState } from 'react';
import { Invoice, InvoiceLineItem } from '../../types';
import { calculateInvoiceTotals, formatINR } from '../../utils/finance';

interface CreateInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveInvoice: (invoice: Invoice) => void;
}

export const CreateInvoiceModal: React.FC<CreateInvoiceModalProps> = ({
  isOpen,
  onClose,
  onSaveInvoice,
}) => {
  const [clientName, setClientName] = useState('');
  const [clientGstin, setClientGstin] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientContact, setClientContact] = useState('');
  const [placeOfSupply, setPlaceOfSupply] = useState('Karnataka (29)');
  const [itemName, setItemName] = useState('');
  const [sku, setSku] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unitRate, setUnitRate] = useState(25000);
  const [gstRate, setGstRate] = useState(18);

  const [items, setItems] = useState<InvoiceLineItem[]>([
    {
      id: 'item-demo-1',
      sku: 'SRV-AI-PRO',
      hsn: '8471',
      name: 'High Performance Neural Engine Server',
      quantity: 1,
      unitRate: 45000,
      gstRatePercent: 18,
    },
  ]);

  if (!isOpen) return null;

  const handleAddItem = () => {
    if (!itemName) return;
    const newItem: InvoiceLineItem = {
      id: `item-${Date.now()}`,
      sku: sku || 'GEN-SKU-99',
      hsn: '8471',
      name: itemName,
      quantity: Math.max(1, quantity),
      unitRate: Math.max(0, unitRate),
      gstRatePercent: gstRate,
    };
    setItems([...items, newItem]);
    setItemName('');
    setSku('');
  };

  const handleRemoveItem = (id: string) => {
    setItems(items.filter((it) => it.id !== id));
  };

  const totals = calculateInvoiceTotals(items);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName) return;

    const newInvoice: Invoice = {
      id: `inv-${Date.now()}`,
      invoiceNumber: `#INV-2024-0${Math.floor(Math.random() * 90 + 90)}`,
      clientName,
      clientGstin: clientGstin || '29AAAAA1234Z9',
      clientAddress: clientAddress || 'Tech Park, Bangalore, Karnataka, India',
      clientContact: clientContact || 'accounts@client.io',
      clientType: 'B2B Bangalore',
      issueDate: 'Oct 23, 2024',
      dueDate: 'Nov 06, 2024',
      placeOfSupply,
      status: 'unpaid',
      dueInDays: 14,
      riskScore: 0.15,
      riskTier: 'Low Risk',
      txRef: `PP-TX-${Math.floor(Math.random() * 89999 + 10000)}-SB`,
      autoChaseStatus: 'Auto-chase scheduled in 3 days',
      paymentMode: 'PayPal Sandbox Direct API',
      items: items.length > 0 ? items : [
        {
          id: 'item-1',
          sku: 'SVC-CONSULT',
          hsn: '9983',
          name: 'Autonomous Architecture Consulting',
          quantity: 1,
          unitRate: 15000,
          gstRatePercent: 18,
        },
      ],
    };

    onSaveInvoice(newInvoice);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-container-lowest max-w-2xl w-full rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 bg-surface-container-low flex items-center justify-between border-b border-surface-container-high/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary text-on-primary flex items-center justify-center shadow-xs">
              <span className="material-symbols-outlined text-[22px]">add_circle</span>
            </div>
            <div>
              <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                Create Smart GST Invoice
              </h3>
              <p className="font-body-sm text-[11px] text-secondary">
                Auto-validates GSTIN, computes IGST/CGST, and integrates PayPal Escrow settlement link.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-outline hover:text-on-surface hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="font-label-sm text-[11px] uppercase tracking-wider text-secondary font-semibold">
                Client / Company Name *
              </label>
              <input
                type="text"
                required
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="e.g. Apex Cloud Labs Pvt Ltd"
                className="h-10 px-3 rounded-lg bg-surface-container-low text-on-surface font-body-sm border border-surface-container-high/60 focus:outline-none focus:border-primary"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-label-sm text-[11px] uppercase tracking-wider text-secondary font-semibold">
                Client GSTIN
              </label>
              <input
                type="text"
                value={clientGstin}
                onChange={(e) => setClientGstin(e.target.value)}
                placeholder="e.g. 29AAAAA0000A1Z5"
                className="h-10 px-3 rounded-lg bg-surface-container-low text-on-surface font-body-sm border border-surface-container-high/60 focus:outline-none focus:border-primary uppercase font-mono"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-label-sm text-[11px] uppercase tracking-wider text-secondary font-semibold">
                Contact Email
              </label>
              <input
                type="email"
                value={clientContact}
                onChange={(e) => setClientContact(e.target.value)}
                placeholder="finance@company.com"
                className="h-10 px-3 rounded-lg bg-surface-container-low text-on-surface font-body-sm border border-surface-container-high/60 focus:outline-none focus:border-primary"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-label-sm text-[11px] uppercase tracking-wider text-secondary font-semibold">
                Place of Supply
              </label>
              <select
                value={placeOfSupply}
                onChange={(e) => setPlaceOfSupply(e.target.value)}
                className="h-10 px-3 rounded-lg bg-surface-container-low text-on-surface font-body-sm border border-surface-container-high/60 focus:outline-none focus:border-primary"
              >
                <option value="Karnataka (29)">Karnataka (29)</option>
                <option value="Telangana (36)">Telangana (36)</option>
                <option value="Maharashtra (27)">Maharashtra (27)</option>
                <option value="Delhi (07)">Delhi (07)</option>
                <option value="Cross-Border Export (96)">Cross-Border Export (96)</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-label-sm text-[11px] uppercase tracking-wider text-secondary font-semibold">
              Billed Address
            </label>
            <input
              type="text"
              value={clientAddress}
              onChange={(e) => setClientAddress(e.target.value)}
              placeholder="Full registered address..."
              className="h-10 px-3 rounded-lg bg-surface-container-low text-on-surface font-body-sm border border-surface-container-high/60 focus:outline-none focus:border-primary"
            />
          </div>

          {/* Line Items Section */}
          <div className="p-4 rounded-xl bg-surface-container-low flex flex-col gap-3">
            <span className="font-label-sm text-[11px] uppercase tracking-wider text-secondary font-bold">
              Line Items
            </span>

            {/* List */}
            <div className="flex flex-col gap-2">
              {items.map((it) => (
                <div
                  key={it.id}
                  className="p-2.5 rounded-lg bg-surface-container-lowest flex items-center justify-between text-body-sm shadow-xs"
                >
                  <div className="flex flex-col">
                    <span className="font-semibold text-on-surface">{it.name}</span>
                    <span className="text-[11px] text-secondary">
                      SKU: {it.sku} • Qty: {it.quantity} × {formatINR(it.unitRate)} ({it.gstRatePercent}% GST)
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold font-tabular-nums text-on-surface">
                      {formatINR(it.quantity * it.unitRate)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(it.id)}
                      className="text-outline hover:text-error"
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Line Item Mini-Row */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-2 border-t border-surface-container-high/50">
              <input
                type="text"
                placeholder="New item name..."
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                className="sm:col-span-6 h-9 px-2.5 rounded bg-surface-container-lowest text-xs border border-surface-container-high/60 focus:outline-none"
              />
              <input
                type="number"
                placeholder="Rate"
                value={unitRate}
                onChange={(e) => setUnitRate(Number(e.target.value))}
                className="sm:col-span-3 h-9 px-2 rounded bg-surface-container-lowest text-xs border border-surface-container-high/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddItem}
                className="sm:col-span-3 h-9 rounded bg-surface-container text-primary hover:bg-surface-container-high text-xs font-semibold flex items-center justify-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">add</span> Add Item
              </button>
            </div>
          </div>

          {/* Subtotal & Grand Total Summary */}
          <div className="p-3 bg-surface-container-low rounded-xl flex items-center justify-between">
            <div className="flex flex-col text-xs text-secondary">
              <span>Subtotal: {formatINR(totals.subtotal)}</span>
              <span>18% GST: {formatINR(totals.totalGst)}</span>
            </div>
            <div className="text-right">
              <span className="block font-label-sm text-secondary">Total Payable</span>
              <span className="font-headline-lg text-primary font-bold font-tabular-nums">
                {formatINR(totals.grandTotal)}
              </span>
            </div>
          </div>

          {/* Footer Submit */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-on-surface-variant font-label-md text-label-md hover:bg-surface-container transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-semibold hover:bg-primary-container shadow-md transition-all flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">verified</span>
              <span>Issue Smart Invoice</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
