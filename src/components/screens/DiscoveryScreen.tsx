import React, { useState } from 'react';
import { formatINR } from '../../utils/finance';
import {
  AISuggestionCard,
  DataCollectionBoundary,
  CollectionViewState,
} from '../ui/HonestTrustComponents';
import { useRole } from '../../context/RoleContext';

interface DiscoveryScreenProps {
  onSelectProduct: (product: any) => void;
  onAddToCart?: (product: any) => void;
  onOpenAR?: (product: any) => void;
  onOpenCopilot?: (query?: string) => void;
  showToast?: (msg: string) => void;
  globalSearchQuery?: string;
}

const DISCOVERY_CATALOG = [
  {
    sku: '#FAN-BLDC-892',
    name: 'AeroBreeze Stealth 1200mm Smart BLDC Ceiling Fan',
    category: 'Smart Ceiling Fans',
    price: 8499,
    mrp: 12999,
    gstRate: 18,
    hsCode: '8414.51.10',
    stock: 120,
    modelUrl: '/api/models/ceiling-fan.glb',
    specs: ['28W @ Speed 6 (BLDC)', '235 CMM @ 380 RPM', '1200 mm (48") Sweep', '28 dB Whisper Silent'],
    dimensions: '1200 × 1200 × 340 mm',
    weight: '3.8 kg',
    warranty: '3 Years On-Site Replacement',
    aiMatchScore: 99,
    badge: '3D & AR Ready',
    aiReason:
      '28W Brushless DC motor cuts energy draw by 65% compared with standard 75W ceiling fans while delivering 235 CMM room airflow.',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAdZqURIDL_NaUXiAifTbLg4cem9jV1GV8iZOZph4aZvIM_kBIBsVSYaq0LFoeWQ1Xe11jOuDpYR0RHnVhSurjQprJuCqeXfR6luOW8JojolfW3AL3RlJG5cFe-YmAZaYz7-lll8h5sqcs83z5WRWhCSmB_-pIxVPGanujJtlcWqHaGPRDckKJmoCqqWoVmhA4SIWYCZ53ylY77gEHOrpObunEt2PyFUzIVJzYoOpMS9aQvgYTluWmbLg',
  },
  {
    sku: '#SPO-YNX-99P',
    name: 'Yonex Astrox 99 Pro Carbon Badminton Racket',
    category: 'Sports & Fitness',
    price: 14990,
    mrp: 19900,
    gstRate: 18,
    hsCode: '9506.59.10',
    stock: 40,
    modelUrl: '/api/models/badminton-racket.glb',
    specs: ['Pre-Strung BG80', 'Full Carbon Cap', '4U (83g) • Head Heavy'],
    dimensions: '675 × 200 × 12 mm',
    weight: '0.083 kg (4U)',
    warranty: '1 Year Yonex Brand Protection',
    aiMatchScore: 96,
    badge: '3D & AR Ready',
    aiReason:
      'High-modulus graphite frame with balanced weight distribution for fast recovery between shots.',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDURq8df1AvNhd6BXPOnLSDepBVFAZQQdhN7XCJzqUwmcV79SqYGalleVqm5XyenVa4nFesHY7jCNLROrqBHlgtE92aPFjCmcNoiYuJEPzJjul5AYdnnHkeKQevXmwyO8xozEtp1qExjA6sfd8tRUMhTAaE5rLBnqslJx9r-5JgtL82V5kmTgx9bt5QmOiAjh1sa5vjPP7EB5WSaeKeMK9zuVgCH8RJFezfeBmyvYUJuYqroAVrKuYT6A',
  },
  {
    sku: '#AUD-ANC-99',
    name: 'AcousticSphere ANC Wireless Earbuds',
    category: 'Audio & Accessories',
    price: 11499,
    mrp: 14999,
    gstRate: 18,
    hsCode: '8518.30.00',
    stock: 45,
    modelUrl: null,
    specs: ['Lossless LDAC', 'Active Noise Cancellation'],
    dimensions: 'Not provided',
    weight: 'Not provided',
    warranty: 'Not provided',
    aiMatchScore: 88,
    badge: 'Best Value',
    aiReason:
      'Studio-grade noise cancellation with 36-hour battery life and USB-C fast charging.',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuATX6652NttkNvGUKx5jflqNG9RH8CT1bcmBhwPs5ONeLhU9pt_yu_fLrBW741KftvyB8iGKx74rvwQHwuPCAi3l4R3tYkHwBDG9n3OPdy9Mlu8L_I0x4OPz9BwauAkb1vv9Y9m6inErwdhjPUN3ppwCGPbYGt503flhtRIVgYmpxZIuYY_1j9Rm3YHrFW7YLzOu7wmGH2HMVU6LtZPoH8W80bhQ8Ax7MbgTzEynmMscW556GyOm__wiw',
  },
  {
    sku: 'AC-WRK-8990',
    name: 'ProArt Studio Workstation X1',
    category: 'Workstations',
    price: 292000,
    mrp: 325000,
    gstRate: 18,
    hsCode: '8471.50.00',
    stock: 4,
    modelUrl: '/api/models/workstation.glb',
    specs: ['64GB ECC DDR5', 'RTX 4090 24GB', '2TB Gen5 NVMe', 'Dual 10GbE LAN'],
    dimensions: '420 × 680 × 178 mm',
    weight: '14.8 kg',
    warranty: '3 Years On-Site Next-Business-Day',
    aiMatchScore: 99,
    badge: '3D & AR Ready',
    aiReason:
      'Built for 3D rendering, CAD workflows, and studio editing with whisper-quiet cooling.',
    img: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%231e293b"/><stop offset="100%" stop-color="%230f172a"/></linearGradient><linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%233b82f6"/><stop offset="100%" stop-color="%231d4ed8"/></linearGradient></defs><rect width="800" height="600" fill="%23090d16"/><rect x="260" y="100" width="280" height="400" rx="16" fill="url(%23g)" stroke="%23334155" stroke-width="4"/><rect x="290" y="130" width="220" height="340" rx="8" fill="%23020617" stroke="%231e293b" stroke-width="2"/><line x1="290" y1="210" x2="510" y2="210" stroke="%231e293b" stroke-width="2"/><circle cx="400" cy="170" r="14" fill="url(%23accent)"/><rect x="310" y="240" width="180" height="12" rx="3" fill="%23334155"/><rect x="310" y="265" width="180" height="12" rx="3" fill="%231e293b"/><rect x="310" y="290" width="180" height="12" rx="3" fill="%231e293b"/><rect x="320" y="340" width="160" height="80" rx="6" fill="%230f172a" stroke="%2338bdf8" stroke-width="1.5" stroke-dasharray="4 2"/><text x="400" y="540" fill="%2394a3b8" font-family="sans-serif" font-size="16" font-weight="600" text-anchor="middle">PROART WORKSTATION X1</text></svg>',
  },
];


export const DiscoveryScreen: React.FC<DiscoveryScreenProps> = ({
  onSelectProduct,
  onAddToCart,
  showToast,
  globalSearchQuery = '',
}) => {
  const { dataSource } = useRole();

  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [only3DReady, setOnly3DReady] = useState<boolean>(false);
  const [maxPriceFilter, setMaxPriceFilter] = useState<number>(350000);
  const [localQuery, setLocalQuery] = useState<string>(
    'Silent BLDC ceiling fan under ₹10,000 with 3D room view'
  );
  const [appliedSearch, setAppliedSearch] = useState<string>('');
  const [gridState, setGridState] = useState<CollectionViewState>('ready');
  const [approvedSearchFilter, setApprovedSearchFilter] = useState<string | null>(null);

  const effectiveQuery = globalSearchQuery.trim() || appliedSearch.trim() || '';

  const applyNaturalSearch = (queryText?: string) => {
    const next = (queryText ?? localQuery).trim();
    setAppliedSearch(next);
    if (next) {
      showToast?.(`Updated product matches for: "${next}"`);
    } else {
      showToast?.('Cleared search filter — showing all matching catalog items.');
    }
  };

  const filteredProducts = DISCOVERY_CATALOG.filter((p) => {
    if (categoryFilter !== 'ALL' && p.category !== categoryFilter) return false;
    if (only3DReady && !p.modelUrl) return false;
    if (p.price > maxPriceFilter) return false;
    if (effectiveQuery) {
      const q = effectiveQuery.toLowerCase();
      const underMatch = q.match(/(?:under|below|max|<=?)\s*(?:₹|rs\.?|inr)?\s*([\d,]+)/i);
      if (underMatch) {
        const cap = Number(underMatch[1].replace(/,/g, ''));
        if (Number.isFinite(cap) && cap > 0 && p.price > cap) return false;
      }

      const searchable = [
        p.name,
        p.sku,
        p.category,
        p.badge,
        p.aiReason,
        ...(Array.isArray(p.specs) ? p.specs : []),
      ]
        .join(' ')
        .toLowerCase();

      if (searchable.includes(q)) return true;

      const stopWords = new Set([
        'the',
        'and',
        'for',
        'with',
        'under',
        'below',
        'above',
        'over',
        'max',
        'min',
        'view',
        'room',
        'find',
        'show',
        'that',
        'this',
        'from',
        'into',
        'inr',
      ]);
      const tokens = q
        .replace(/[₹,()]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 2 && !stopWords.has(t) && !/^\d+$/.test(t));

      if (tokens.length === 0) return true;
      return tokens.some((tok) => searchable.includes(tok));
    }
    return true;
  });

  const categories = ['ALL', ...Array.from(new Set(DISCOVERY_CATALOG.map((p) => p.category)))];

  return (
    <div className="space-y-6 pb-12">
      {/* Natural Language Shopping Search Header (Matches Image_7 / Image_8) */}
      <div className="bg-surface-container-lowest p-5 sm:p-6 rounded-xl border border-surface-container-high space-y-4">
        <div className="max-w-3xl space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-primary block">
            Smart Shopping &amp; 3D Product Discovery
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold font-headline text-on-surface tracking-tight">
            Find the Right Product for Your Space &amp; Budget
          </h1>
        </div>

        {/* Search Input Capsule */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            applyNaturalSearch();
          }}
          className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 bg-surface-container-low p-2 rounded-xl border border-surface-container-high"
        >
          <div className="flex items-center gap-2.5 flex-1 px-2">
            <span className="material-symbols-outlined text-primary text-[20px]">
              auto_awesome
            </span>
            <label htmlFor="discovery-nl-search" className="sr-only">
              Search products by name, room need, or budget
            </label>
            <input
              id="discovery-nl-search"
              type="text"
              value={localQuery}
              onChange={(e) => setLocalQuery(e.target.value)}
              placeholder="Describe what you need, your room size, or budget..."
              className="w-full bg-transparent text-xs sm:text-sm text-on-surface focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {appliedSearch && (
              <button
                type="button"
                onClick={() => {
                  setLocalQuery('');
                  applyNaturalSearch('');
                }}
                className="px-3 py-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold cursor-pointer"
              >
                Clear
              </button>
            )}
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs font-semibold shrink-0 cursor-pointer"
            >
              Find Matches
            </button>
          </div>
        </form>

        {/* Parsed Intent Chips */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[11px] font-semibold text-secondary">Matched Preferences:</span>
          <span className="px-2.5 py-1 rounded-full bg-primary-fixed text-on-primary-fixed text-[11px] font-semibold">
            3D &amp; AR Room Preview
          </span>
          <span className="px-2.5 py-1 rounded-full bg-surface-container text-on-surface-variant text-[11px] font-semibold">
            Energy Efficient (BLDC)
          </span>
          <span className="px-2.5 py-1 rounded-full bg-surface-container text-on-surface-variant text-[11px] font-semibold">
            GST Invoice Included
          </span>
          {approvedSearchFilter && (
            <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-semibold">
              Saved Filter Applied ✓
            </span>
          )}
        </div>
      </div>

      {/* Category Navigation Strip (Matches Image_7 / Image_8) */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategoryFilter(cat)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              categoryFilter === cat
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container-lowest text-secondary border border-surface-container-high hover:text-on-surface'
            }`}
          >
            {cat === 'ALL' ? 'All Categories' : cat}
          </button>
        ))}
      </div>

      {/* Main 12-Col Layout: Left 3 Cols Precision Filters + Right 9 Cols Product Grid (Matches Image_7 / Image_8) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 3 Cols: Precision Filters Sidebar */}
        <div className="lg:col-span-3 space-y-5">
          <div className="bg-surface-container-lowest rounded-xl border border-surface-container-high p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-on-surface">
                Filters
              </h2>
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter('ALL');
                  setOnly3DReady(false);
                  setMaxPriceFilter(350000);
                }}
                className="text-[11px] font-semibold text-primary hover:underline cursor-pointer"
              >
                Reset
              </button>
            </div>

            <div className="space-y-2">
              <label className="flex items-center justify-between text-xs font-semibold text-on-surface cursor-pointer">
                <span>3D &amp; AR View Available</span>
                <input
                  type="checkbox"
                  checked={only3DReady}
                  onChange={(e) => setOnly3DReady(e.target.checked)}
                  className="w-4 h-4 accent-primary rounded cursor-pointer"
                />
              </label>
              <p className="text-[11px] text-secondary">
                Show only products you can rotate in 3D and place in your room.
              </p>
            </div>

            <div className="space-y-2 pt-3 border-t border-surface-container-high">
              <div className="flex items-center justify-between text-xs">
                <label
                  htmlFor="discovery-max-price"
                  className="font-semibold text-on-surface"
                >
                  Max Price
                </label>
                <span className="font-bold font-tabular-nums text-primary">
                  {formatINR(maxPriceFilter)}
                </span>
              </div>
              <input
                id="discovery-max-price"
                type="range"
                min={10000}
                max={350000}
                step={5000}
                value={maxPriceFilter}
                onChange={(e) => setMaxPriceFilter(Number(e.target.value))}
                className="w-full accent-primary cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-secondary font-tabular-nums">
                <span>₹10,000</span>
                <span>₹3,50,000</span>
              </div>
            </div>
          </div>

          <AISuggestionCard
            title="Shopping Tip"
            source={dataSource}
            suggestionText="Compare the AeroBreeze 1200mm BLDC Fan (₹8,499) in 3D & AR view to check ceiling clearance before checkout."
            whyThis="Matched your preference for low-noise appliances with interactive 3D room preview."
            approveLabel="Apply Recommendation"
            onApprove={(edited) => {
              setApprovedSearchFilter(edited);
              showToast?.('Applied recommended filter.');
            }}
          />
        </div>

        {/* Right 9 Cols: 2-Column Hero Product Grid + Spec Comparison Table */}
        <div className="lg:col-span-9 space-y-6">
          <DataCollectionBoundary
            title="Product Catalog"
            state={
              filteredProducts.length === 0 && gridState === 'ready' ? 'empty' : gridState
            }
            onStateChange={setGridState}
            emptyMessage="No products match your current filters."
          >
            <div
              data-testid="discovery-product-grid"
              className="grid grid-cols-1 md:grid-cols-2 gap-6"
            >
              {filteredProducts.map((product) => (
                <div
                  key={product.sku}
                  className="bg-surface-container-lowest rounded-xl border border-surface-container-high overflow-hidden flex flex-col justify-between transition-all hover:border-primary/40"
                >
                  {/* Hero Product Image + Single Badge (Style Rule #4) */}
                  <div>
                    <button
                      type="button"
                      onClick={() => onSelectProduct(product)}
                      aria-label={`Inspect ${product.name}`}
                      className="relative w-full h-56 bg-surface-container-low overflow-hidden cursor-pointer group block text-left"
                    >
                      <img
                        src={product.img}
                        alt={product.name}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          const target = e.currentTarget;
                          target.style.display = 'none';
                          const parent = target.parentElement;
                          if (parent) {
                            parent.classList.add('bg-slate-900', 'flex', 'items-center', 'justify-center');
                          }
                        }}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <span
                        className={`absolute top-3 left-3 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                          product.modelUrl
                            ? 'bg-primary text-on-primary shadow-xs'
                            : 'bg-surface-container-lowest/95 text-on-surface border border-surface-container-high'
                        }`}
                      >
                        {product.badge}
                      </span>
                    </button>


                    {/* Product Name & Price */}
                    <div className="p-5 space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
                        {product.category}
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelectProduct(product)}
                        className="text-left block w-full cursor-pointer"
                      >
                        <h3 className="text-base font-bold font-headline text-on-surface hover:text-primary leading-snug">
                          {product.name}
                        </h3>
                      </button>
                      <div className="flex items-baseline gap-2.5 pt-1">
                        <span className="text-2xl font-bold font-headline text-on-surface font-tabular-nums">
                          {formatINR(product.price)}
                        </span>
                        {product.mrp > product.price && (
                          <span className="text-xs text-secondary line-through font-tabular-nums">
                            {formatINR(product.mrp)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Card Footer: 1 Primary Action + 1 Secondary Ghost Action */}
                  <div className="px-5 pb-5 pt-2 flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => onSelectProduct(product)}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">view_in_ar</span>
                      <span>{product.modelUrl ? '3D & AR view' : 'View Details'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onAddToCart && onAddToCart(product)}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        add_shopping_cart
                      </span>
                      <span>Add to Cart</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </DataCollectionBoundary>

          {/* Bottom Spec Comparison Table (Matches Image_7 / Image_8) */}
          <div className="bg-surface-container-lowest rounded-xl border border-surface-container-high p-5 space-y-3">
            <div>
              <h3 className="text-sm font-bold font-headline text-on-surface">
                Quick Product Comparison
              </h3>
              <p className="text-xs text-secondary">
                Compare dimensions, warranty, and 3D &amp; AR availability side by side.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table
                data-testid="discovery-spec-matrix"
                className="w-full text-left border-collapse text-xs"
              >
                <thead>
                  <tr className="border-b border-surface-container-high text-[10px] font-semibold uppercase tracking-wider text-secondary">
                    <th className="py-2.5 pr-3">Product</th>
                    <th className="py-2.5 px-3">3D &amp; AR View</th>
                    <th className="py-2.5 px-3">Dimensions</th>
                    <th className="py-2.5 px-3">Warranty</th>
                    <th className="py-2.5 pl-3 text-right">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {filteredProducts.map((p) => (
                    <tr key={p.sku} className="hover:bg-surface-container-low/60">
                      <td className="py-3 pr-3 font-semibold text-on-surface">{p.name}</td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            p.modelUrl
                              ? 'bg-emerald-50 text-emerald-800'
                              : 'bg-surface-container text-secondary'
                          }`}
                        >
                          {p.modelUrl ? 'Available' : 'Photos Only'}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-tabular-nums text-secondary">
                        {p.dimensions}
                      </td>
                      <td className="py-3 px-3 text-secondary">{p.warranty}</td>
                      <td className="py-3 pl-3 text-right font-tabular-nums font-bold text-on-surface">
                        {formatINR(p.price)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
