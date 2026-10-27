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
  const [activeTab, setActiveTab] = useState<'directory' | 'demographics' | 'advisor'>('directory');
  const [isGeneratingAdvisor, setIsGeneratingAdvisor] = useState(false);
  const [advisorRefreshedAt, setAdvisorRefreshedAt] = useState<string>('Just now');
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

      {/* Primary Section Switcher Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-surface-container-high/80 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('directory')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'directory'
              ? 'bg-primary text-on-primary shadow-xs'
              : 'bg-surface-container-low text-secondary hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-[17px]">groups</span>
          <span>Verified Buyers Directory ({customers.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('demographics')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'demographics'
              ? 'bg-primary text-on-primary shadow-xs'
              : 'bg-surface-container-low text-secondary hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-[17px]">query_stats</span>
          <span>Storefront Visitor Demographics</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('advisor')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'advisor'
              ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-xs'
              : 'bg-surface-container-low text-secondary hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-[17px]">psychology</span>
          <span>Gemini AI Growth Advisor</span>
        </button>
      </div>

      {/* TAB 1: VERIFIED BUYERS DIRECTORY */}
      {activeTab === 'directory' && (
        <div className="space-y-6">
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
    </div>
  )}

      {/* TAB 2: PRIVACY-PRESERVING VISITOR DEMOGRAPHICS */}
      {activeTab === 'demographics' && (
        <div className="space-y-6">
          {/* Zero-PII Strict Cybersecurity Banner */}
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-start gap-3">
            <span className="material-symbols-outlined text-emerald-600 text-[22px] shrink-0 mt-0.5">
              shield_lock
            </span>
            <div className="space-y-0.5">
              <h4 className="text-xs font-bold text-emerald-900 dark:text-emerald-300">
                Privacy-Preserving Visitor Intelligence Guarantee
              </h4>
              <p className="text-[11px] text-emerald-800/80 dark:text-emerald-400/90 leading-relaxed">
                All visitor demographic metrics (Age, Gender, Dwell Time) are strictly aggregated in an anonymized cohort model. Under strict cybersecurity and privacy guidelines, raw customer mobile numbers, private emails, and authentication credentials are NEVER exposed in statistical telemetry dashboards. Order delivery shipping details remain safely isolated in the Orders Fulfillment section.
              </p>
            </div>
          </div>

          {/* Demographic Breakdown Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Age Group Distribution */}
            <div className="p-6 rounded-2xl bg-surface-container-lowest border border-surface-container-high shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[20px]">cake</span>
                  <h3 className="text-sm font-bold text-on-surface">Age Bracket Breakdown</h3>
                </div>
                <span className="text-[11px] font-mono text-secondary">Cohort Size: 1,420 Visitors</span>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-semibold text-on-surface">18 – 24 Years (Gen-Z &amp; Early Tech Adopters)</span>
                    <span className="font-bold text-primary">28% (398 visitors)</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-surface-container-low overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: '28%' }} />
                  </div>
                  <span className="text-[10px] text-secondary">High AR 3D Fan interaction rate (52%); prefers 1-click PayPal checkout</span>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-semibold text-on-surface">25 – 34 Years (Core Urban Homeowners)</span>
                    <span className="font-bold text-primary">48% (682 visitors)</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-surface-container-low overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: '48%' }} />
                  </div>
                  <span className="text-[10px] text-secondary">Highest conversion volume (68% of sales); 3.8x higher BLDC fan order frequency</span>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-semibold text-on-surface">35 – 44 Years (Architects &amp; Commercial Buyers)</span>
                    <span className="font-bold text-primary">16% (227 visitors)</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-surface-container-low overflow-hidden">
                    <div className="h-full bg-purple-500 rounded-full" style={{ width: '16%' }} />
                  </div>
                  <span className="text-[10px] text-secondary">Highest basket value (₹18,400 AOV); frequently requests B2B Tax Invoices</span>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-semibold text-on-surface">45+ Years (Premium Comfort Seekers)</span>
                    <span className="font-bold text-primary">8% (113 visitors)</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-surface-container-low overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: '8%' }} />
                  </div>
                  <span className="text-[10px] text-secondary">Longest dwell time (5m 12s); values 3-year warranty and escrow protection</span>
                </div>
              </div>
            </div>

            {/* Gender Distribution & Privacy Isolation */}
            <div className="p-6 rounded-2xl bg-surface-container-lowest border border-surface-container-high shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[20px]">wc</span>
                  <h3 className="text-sm font-bold text-on-surface">Gender Demographics</h3>
                </div>
                <span className="text-[10px] bg-surface-container-low px-2 py-0.5 rounded-full text-secondary font-mono">
                  Self-Reported &amp; Anonymized
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 pt-2">
                <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-center space-y-1">
                  <span className="material-symbols-outlined text-blue-600 text-[26px]">man</span>
                  <p className="text-xl font-bold text-on-surface">48%</p>
                  <span className="text-[11px] font-semibold text-blue-700 block">Male</span>
                  <span className="text-[10px] text-secondary block">682 Buyers</span>
                </div>

                <div className="p-4 rounded-xl bg-pink-500/10 border border-pink-500/20 text-center space-y-1">
                  <span className="material-symbols-outlined text-pink-600 text-[26px]">woman</span>
                  <p className="text-xl font-bold text-on-surface">46%</p>
                  <span className="text-[11px] font-semibold text-pink-700 block">Female</span>
                  <span className="text-[10px] text-secondary block">653 Buyers</span>
                </div>

                <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20 text-center space-y-1">
                  <span className="material-symbols-outlined text-purple-600 text-[26px]">diversity_3</span>
                  <p className="text-xl font-bold text-on-surface">6%</p>
                  <span className="text-[11px] font-semibold text-purple-700 block">Non-Binary</span>
                  <span className="text-[10px] text-secondary block">85 Buyers</span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-surface-container-low text-xs space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-secondary font-medium">Top Purchasing Region</span>
                  <span className="font-bold text-on-surface">Bengaluru (34%) &amp; Mumbai (24%)</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-secondary font-medium">Average Catalog Dwell Time</span>
                  <span className="font-bold text-emerald-600 font-mono">3m 42s per session</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-secondary font-medium">AR Spatial View Rate</span>
                  <span className="font-bold text-primary font-mono">41.2% of mobile shoppers</span>
                </div>
              </div>
            </div>
          </div>

          {/* Product View Share & Conversion vs Bounce Telemetry */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-5 rounded-2xl bg-surface-container-lowest border border-surface-container-high space-y-3 md:col-span-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">visibility</span>
                <h3 className="text-sm font-bold text-on-surface">Most Looked-At Storefront Catalog Products</h3>
              </div>
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-surface-container-low flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-lg bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">1</span>
                    <div>
                      <div className="font-bold text-xs text-on-surface">AeroBreeze Stealth 1200mm Smart BLDC Ceiling Fan</div>
                      <div className="text-[11px] text-secondary">SKU: #FAN-BLDC-892 • Avg Dwell: 4m 12s</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-primary block">64% Traffic Share</span>
                    <span className="text-[10px] text-emerald-600">31.4% Escrow Conversion</span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-surface-container-low flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-lg bg-secondary/20 text-secondary text-xs font-bold flex items-center justify-center">2</span>
                    <div>
                      <div className="font-bold text-xs text-on-surface">Yonex Astrox 99 Pro Carbon Badminton Racket</div>
                      <div className="text-[11px] text-secondary">SKU: #SPO-YNX-99P • Avg Dwell: 2m 45s</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-on-surface block">22% Traffic Share</span>
                    <span className="text-[10px] text-emerald-600">26.2% Escrow Conversion</span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-surface-container-low flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-lg bg-secondary/20 text-secondary text-xs font-bold flex items-center justify-center">3</span>
                    <div>
                      <div className="font-bold text-xs text-on-surface">AcousticSphere ANC Wireless Earbuds</div>
                      <div className="text-[11px] text-secondary">SKU: #AUD-ANC-99 • Avg Dwell: 1m 50s</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-on-surface block">14% Traffic Share</span>
                    <span className="text-[10px] text-emerald-600">19.8% Escrow Conversion</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Conversion vs Bounce Funnel */}
            <div className="p-5 rounded-2xl bg-surface-container-lowest border border-surface-container-high space-y-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">filter_alt</span>
                <h3 className="text-sm font-bold text-on-surface">Conversion vs Bounce</h3>
              </div>
              <div className="space-y-3 pt-1">
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <span className="text-[11px] uppercase tracking-wider text-emerald-700 font-bold block">
                    Purchase Conversion Rate
                  </span>
                  <p className="text-2xl font-bold font-headline text-emerald-700 mt-1">28.4%</p>
                  <span className="text-[10px] text-emerald-800/80 mt-0.5 block">
                    Escrow buyer protection &amp; 3D model previews doubled conversion vs industry avg.
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <span className="text-[11px] uppercase tracking-wider text-amber-800 font-bold block">
                    Browse / Drop-Off Rate
                  </span>
                  <p className="text-2xl font-bold font-headline text-amber-800 mt-1">71.6%</p>
                  <span className="text-[10px] text-amber-900/80 mt-0.5 block">
                    High intent shoppers who left before paying. Prime targets for WhatsApp Bot recovery!
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: GEMINI AI GROWTH ADVISOR */}
      {activeTab === 'advisor' && (
        <div className="space-y-6">
          {/* AI Advisor Hero Banner */}
          <div className="p-6 rounded-2xl bg-gradient-to-r from-purple-900/80 via-indigo-900/80 to-blue-900/80 text-white border border-purple-500/30 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-purple-300 text-[26px]">psychology</span>
                <h3 className="text-lg font-bold font-headline">
                  Gemini AI Autonomous Business Growth Advisor
                </h3>
              </div>
              <p className="text-xs text-purple-200 leading-relaxed max-w-2xl">
                Analyzing real-time visitor telemetry, demographic patterns, and catalog dwell times to deliver automated revenue optimization recommendations for your storefront.
              </p>
            </div>

            <button
              type="button"
              disabled={isGeneratingAdvisor}
              onClick={() => {
                setIsGeneratingAdvisor(true);
                setTimeout(() => {
                  setIsGeneratingAdvisor(false);
                  setAdvisorRefreshedAt('Just now');
                  showToast('Gemini AI refreshed store telemetry recommendations!');
                }, 1200);
              }}
              className="px-4 py-2.5 rounded-xl bg-white text-indigo-900 font-bold text-xs flex items-center gap-2 hover:bg-purple-50 transition-all shrink-0 cursor-pointer shadow-md disabled:opacity-50"
            >
              <span className={`material-symbols-outlined text-[18px] ${isGeneratingAdvisor ? 'animate-spin' : ''}`}>
                auto_awesome
              </span>
              <span>{isGeneratingAdvisor ? 'Analyzing Store Telemetry...' : 'Refresh AI Ideas'}</span>
            </button>
          </div>

          <div className="flex items-center justify-between text-xs text-secondary px-1">
            <span>AI Model: <strong className="text-on-surface">Gemini 1.5 Pro Commerce Tuning</strong></span>
            <span>Last Analyzed: <strong className="text-on-surface">{advisorRefreshedAt}</strong></span>
          </div>

          {/* Actionable Strategy Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Strategy 1 */}
            <div className="p-5 rounded-2xl bg-surface-container-lowest border border-surface-container-high shadow-sm space-y-3 hover:border-purple-500/50 transition-all">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center font-bold text-xs">
                    01
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-on-surface">
                      Capture 18–24 Demographic with ₹250 Welcome Escrow Perk
                    </h4>
                    <span className="text-[10px] text-emerald-600 font-medium">Estimated Revenue Lift: +18.4%</span>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700">
                  High Impact
                </span>
              </div>
              <p className="text-xs text-secondary leading-relaxed">
                Telemetry shows 28% of your visitors are ages 18–24 who spend &gt;3 minutes rotating the 3D ceiling fan model but drop off at payment checkout. Providing an instant ₹250 first-order escrow credit eliminates hesitation and increases first-time checkout completion by ~18%.
              </p>
              <div className="pt-2 border-t border-surface-container-high/60 flex items-center justify-between">
                <span className="text-[11px] font-mono text-secondary">Target: 398 Young Shoppers</span>
                <button
                  type="button"
                  onClick={() => showToast('Configured ₹250 Welcome Escrow perk in Storefront!')}
                  className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-semibold hover:opacity-90 cursor-pointer"
                >
                  Activate Perk
                </button>
              </div>
            </div>

            {/* Strategy 2 */}
            <div className="p-5 rounded-2xl bg-surface-container-lowest border border-surface-container-high shadow-sm space-y-3 hover:border-emerald-500/50 transition-all">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold text-xs">
                    02
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-on-surface">
                      Automate WhatsApp Instant Cart Recovery Bot
                    </h4>
                    <span className="text-[10px] text-emerald-600 font-medium">Recovered Cart Target: ₹1,48,000</span>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                  Automation
                </span>
              </div>
              <p className="text-xs text-secondary leading-relaxed">
                71.6% of sessions explore products but do not complete order escrow lock. By enabling your newly integrated WhatsApp Bot to trigger an automated message after 30 minutes with a direct 1-click PayPal reservation link, storefronts see up to 34% drop-off recovery.
              </p>
              <div className="pt-2 border-t border-surface-container-high/60 flex items-center justify-between">
                <span className="text-[11px] font-mono text-secondary">Feature: WhatsApp Bot Commerce</span>
                <button
                  type="button"
                  onClick={() => showToast('WhatsApp Cart Recovery Bot sequence enabled!')}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 cursor-pointer"
                >
                  Enable WhatsApp Bot
                </button>
              </div>
            </div>

            {/* Strategy 3 */}
            <div className="p-5 rounded-2xl bg-surface-container-lowest border border-surface-container-high shadow-sm space-y-3 hover:border-blue-500/50 transition-all">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center font-bold text-xs">
                    03
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-on-surface">
                      Bundle 3-Unit Commercial BLDC Pack for 35–44 Age Bracket
                    </h4>
                    <span className="text-[10px] text-emerald-600 font-medium">Estimated AOV Growth: +42%</span>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
                  B2B Expansion
                </span>
              </div>
              <p className="text-xs text-secondary leading-relaxed">
                Visitors aged 35–44 frequently examine technical specifications and tax invoices (INV-2026-089) for office spaces and villas. Creating a 3-unit bundle with milestone escrow release (50% dispatch, 50% installation) will attract high-ticket architect buyers.
              </p>
              <div className="pt-2 border-t border-surface-container-high/60 flex items-center justify-between">
                <span className="text-[11px] font-mono text-secondary">Target: Commercial &amp; Architects</span>
                <button
                  type="button"
                  onClick={() => showToast('Drafted 3-Unit Commercial BLDC Pack in Catalog!')}
                  className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-semibold hover:opacity-90 cursor-pointer"
                >
                  Create Bundle
                </button>
              </div>
            </div>

            {/* Strategy 4 */}
            <div className="p-5 rounded-2xl bg-surface-container-lowest border border-surface-container-high shadow-sm space-y-3 hover:border-indigo-500/50 transition-all">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center font-bold text-xs">
                    04
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-on-surface">
                      VIP Reorder Triggers for Loyal Buyers (45+ Day Cycle)
                    </h4>
                    <span className="text-[10px] text-emerald-600 font-medium">Repeat Rate: +25%</span>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">
                  Retention
                </span>
              </div>
              <p className="text-xs text-secondary leading-relaxed">
                Your repeat customers (Priya Patel, Rahul Sharma, Vikramaditya Rao) demonstrate 99.4% escrow reliability. Automated 45-day maintenance checks and complementary accessory offers will generate predictable monthly recurring merchandise volume (MRV).
              </p>
              <div className="pt-2 border-t border-surface-container-high/60 flex items-center justify-between">
                <span className="text-[11px] font-mono text-secondary">Cohort: 21 Repeat Escrow Buyers</span>
                <button
                  type="button"
                  onClick={() => showToast('Scheduled automated VIP Reorder trigger!')}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 cursor-pointer"
                >
                  Schedule Trigger
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
