import React, { useState, useMemo } from 'react';
import { formatINR } from '../../utils/finance';
import { downloadTextFile } from '../../utils/export';

export interface CustomerRecord {
  id: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  totalOrders: number;
  totalSpent: number;
  lastOrderDate: string;
  status: 'VIP' | 'Repeat' | 'New';
  escrowTrustScore: number;
}

const INITIAL_CUSTOMERS: CustomerRecord[] = [
  {
    id: 'CUST-001',
    name: 'Priya Patel',
    email: 'priya.patel@apexcloud.io',
    phone: '+91 98450 12890',
    city: 'Bengaluru',
    state: 'Karnataka',
    totalOrders: 6,
    totalSpent: 421500,
    lastOrderDate: '14 May 2026',
    status: 'VIP',
    escrowTrustScore: 99,
  },
  {
    id: 'CUST-002',
    name: 'Rahul Sharma',
    email: 'rahul.sharma@kinetix.design',
    phone: '+91 98201 44192',
    city: 'Mumbai',
    state: 'Maharashtra',
    totalOrders: 3,
    totalSpent: 78990,
    lastOrderDate: '13 May 2026',
    status: 'Repeat',
    escrowTrustScore: 98,
  },
  {
    id: 'CUST-003',
    name: 'Ananya Deshmukh',
    email: 'ananya@monolitharch.com',
    phone: '+91 98110 55219',
    city: 'New Delhi',
    state: 'Delhi',
    totalOrders: 4,
    totalSpent: 164000,
    lastOrderDate: '11 May 2026',
    status: 'VIP',
    escrowTrustScore: 100,
  },
  {
    id: 'CUST-004',
    name: 'Karthik Ramanathan',
    email: 'karthik.r@soundwave.in',
    phone: '+91 94440 88201',
    city: 'Chennai',
    state: 'Tamil Nadu',
    totalOrders: 2,
    totalSpent: 45000,
    lastOrderDate: '09 May 2026',
    status: 'Repeat',
    escrowTrustScore: 96,
  },
  {
    id: 'CUST-005',
    name: 'Deepika Sen',
    email: 'deepika.sen@artisanstudios.org',
    phone: '+91 98300 77124',
    city: 'Kolkata',
    state: 'West Bengal',
    totalOrders: 1,
    totalSpent: 14990,
    lastOrderDate: '07 May 2026',
    status: 'New',
    escrowTrustScore: 94,
  },
  {
    id: 'CUST-006',
    name: 'Vikramaditya Rao',
    email: 'vikram.rao@techpilot.in',
    phone: '+91 98800 33491',
    city: 'Hyderabad',
    state: 'Telangana',
    totalOrders: 5,
    totalSpent: 292000,
    lastOrderDate: '04 May 2026',
    status: 'VIP',
    escrowTrustScore: 100,
  },
];

interface CustomersScreenProps {
  showToast?: (msg: string) => void;
}

export function CustomersScreen({ showToast = console.log }: CustomersScreenProps) {
  const [customers] = useState<CustomerRecord[]>(INITIAL_CUSTOMERS);
  const [searchQuery, setSearchQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | 'VIP' | 'Repeat' | 'New'>('all');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord | null>(null);

  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      const matchSearch =
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.phone.includes(searchQuery) ||
        c.city.toLowerCase().includes(searchQuery.toLowerCase());

      const matchTier = tierFilter === 'all' || c.status === tierFilter;
      return matchSearch && matchTier;
    });
  }, [customers, searchQuery, tierFilter]);

  const totalSpentAll = useMemo(() => {
    return customers.reduce((sum, c) => sum + c.totalSpent, 0);
  }, [customers]);

  const avgOrderValue = useMemo(() => {
    const totalOrders = customers.reduce((sum, c) => sum + c.totalOrders, 0);
    return totalOrders > 0 ? Math.round(totalSpentAll / totalOrders) : 0;
  }, [customers, totalSpentAll]);

  const exportCSV = () => {
    const headers = ['Customer ID', 'Name', 'Email', 'Phone', 'City', 'State', 'Orders', 'Total Spend', 'Last Order', 'Status', 'Escrow Trust'];
    const rows = filteredCustomers.map((c) => [
      c.id,
      c.name,
      c.email,
      c.phone,
      c.city,
      c.state,
      c.totalOrders,
      c.totalSpent,
      c.lastOrderDate,
      c.status,
      `${c.escrowTrustScore}%`,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    downloadTextFile('ac-paypilot-customers.csv', csv);
    showToast('Exported customer records CSV.');
  };

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-surface-container-lowest border border-surface-container-high shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[24px]">group</span>
            <h1 className="text-xl sm:text-2xl font-bold font-headline text-on-surface">
              Customer Directory &amp; Buyer Intelligence
            </h1>
          </div>
          <p className="text-xs text-secondary leading-relaxed">
            Manage your verified storefront buyers, track lifetime purchase volume, and escrow delivery ratings.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCSV}
            className="px-4 py-2.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-semibold flex items-center gap-1.5 border border-surface-container-high transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-surface-container-high space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
            Total Verified Customers
          </span>
          <p className="text-2xl font-bold font-headline text-on-surface font-tabular-nums">
            {customers.length}
          </p>
          <span className="text-[11px] text-emerald-600 font-medium">100% Mobile &amp; Email Verified</span>
        </div>

        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-surface-container-high space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
            Cumulative Customer Spend
          </span>
          <p className="text-2xl font-bold font-headline text-on-surface font-tabular-nums">
            {formatINR(totalSpentAll)}
          </p>
          <span className="text-[11px] text-primary font-medium">PayPal Escrow Protected</span>
        </div>

        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-surface-container-high space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
            Average Order Value (AOV)
          </span>
          <p className="text-2xl font-bold font-headline text-on-surface font-tabular-nums">
            {formatINR(avgOrderValue)}
          </p>
          <span className="text-[11px] text-secondary">Across 21 orders</span>
        </div>

        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-surface-container-high space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
            Average Buyer Trust Score
          </span>
          <p className="text-2xl font-bold font-headline text-emerald-700 font-tabular-nums">
            97.8%
          </p>
          <span className="text-[11px] text-emerald-600 font-medium">Zero Escrow Chargebacks</span>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 rounded-xl bg-surface-container-lowest border border-surface-container-high">
        <div className="relative flex-1 max-w-md">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-secondary text-[18px]">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by customer name, email, phone, city..."
            className="w-full pl-9 pr-4 py-2 bg-surface-container-low text-xs rounded-xl border border-surface-container-high focus:outline-none focus:border-primary text-on-surface placeholder:text-secondary"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {(['all', 'VIP', 'Repeat', 'New'] as const).map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => setTierFilter(tier)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                tierFilter === tier
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-low text-secondary hover:text-on-surface'
              }`}
            >
              {tier === 'all' ? 'All Customers' : `${tier} Buyers`}
            </button>
          ))}
        </div>
      </div>

      {/* Customer Table */}
      <div className="rounded-2xl bg-surface-container-lowest border border-surface-container-high overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-surface-container-high text-secondary bg-surface-container-low/50">
                <th className="py-3 px-4 font-semibold">Customer</th>
                <th className="py-3 px-4 font-semibold">Contact &amp; Location</th>
                <th className="py-3 px-4 font-semibold text-center">Orders</th>
                <th className="py-3 px-4 font-semibold text-right">Total Spend</th>
                <th className="py-3 px-4 font-semibold">Tier</th>
                <th className="py-3 px-4 font-semibold">Escrow Trust</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-secondary">
                    No customers match your search criteria.
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((cust) => (
                  <tr key={cust.id} className="hover:bg-surface-container-low transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0">
                          {cust.name
                            .split(' ')
                            .map((p) => p[0])
                            .join('')}
                        </div>
                        <div>
                          <p className="font-semibold text-on-surface">{cust.name}</p>
                          <p className="text-[10px] text-secondary font-mono">{cust.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <p className="text-on-surface">{cust.email}</p>
                      <p className="text-[11px] text-secondary">
                        {cust.phone} • {cust.city}, {cust.state}
                      </p>
                    </td>
                    <td className="py-3.5 px-4 text-center font-bold font-tabular-nums text-on-surface">
                      {cust.totalOrders}
                    </td>
                    <td className="py-3.5 px-4 text-right font-bold font-tabular-nums text-on-surface">
                      {formatINR(cust.totalSpent)}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          cust.status === 'VIP'
                            ? 'bg-purple-100 text-purple-900 border border-purple-200'
                            : cust.status === 'Repeat'
                            ? 'bg-blue-100 text-blue-900 border border-blue-200'
                            : 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                        }`}
                      >
                        {cust.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5">
                        <div className="w-16 h-1.5 rounded-full bg-surface-container-high overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full"
                            style={{ width: `${cust.escrowTrustScore}%` }}
                          />
                        </div>
                        <span className="text-[11px] font-mono font-semibold text-emerald-600">
                          {cust.escrowTrustScore}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedCustomer(cust)}
                        className="px-2.5 py-1 rounded-lg bg-surface-container-low hover:bg-surface-container text-primary font-semibold text-[11px] cursor-pointer"
                      >
                        View Profile
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Customer Detail Drawer Modal */}
      {selectedCustomer && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
        >
          <div className="bg-surface-container-lowest max-w-lg w-full rounded-2xl border border-surface-container-high shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-surface-container-high">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-primary/10 text-primary font-bold text-sm flex items-center justify-center">
                  {selectedCustomer.name
                    .split(' ')
                    .map((p) => p[0])
                    .join('')}
                </div>
                <div>
                  <h3 className="font-bold text-sm text-on-surface">{selectedCustomer.name}</h3>
                  <p className="text-[11px] text-secondary">{selectedCustomer.id} • {selectedCustomer.status} Tier</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="w-8 h-8 rounded-lg bg-surface-container-low text-secondary hover:text-on-surface flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-surface-container-low">
                  <span className="text-secondary block text-[10px] uppercase font-bold">Email</span>
                  <span className="font-semibold text-on-surface">{selectedCustomer.email}</span>
                </div>
                <div className="p-3 rounded-xl bg-surface-container-low">
                  <span className="text-secondary block text-[10px] uppercase font-bold">Phone</span>
                  <span className="font-semibold text-on-surface">{selectedCustomer.phone}</span>
                </div>
                <div className="p-3 rounded-xl bg-surface-container-low">
                  <span className="text-secondary block text-[10px] uppercase font-bold">Location</span>
                  <span className="font-semibold text-on-surface">{selectedCustomer.city}, {selectedCustomer.state}</span>
                </div>
                <div className="p-3 rounded-xl bg-surface-container-low">
                  <span className="text-secondary block text-[10px] uppercase font-bold">Escrow Safety</span>
                  <span className="font-semibold text-emerald-600">{selectedCustomer.escrowTrustScore}% (Zero disputes)</span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-primary/5 border border-primary/20 space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-secondary font-medium">Lifetime Spend</span>
                  <span className="text-base font-bold font-tabular-nums text-on-surface">{formatINR(selectedCustomer.totalSpent)}</span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-secondary">Completed Orders</span>
                  <span className="font-semibold text-on-surface">{selectedCustomer.totalOrders}</span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-secondary">Latest Purchase</span>
                  <span className="font-semibold text-on-surface">{selectedCustomer.lastOrderDate}</span>
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  showToast(`Prepared email notification to ${selectedCustomer.email}`);
                  setSelectedCustomer(null);
                }}
                className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-semibold"
              >
                Send Customer Note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
