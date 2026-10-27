import React, { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_PROFILES, useRole } from '../context/RoleContext';
import {
  CatalogProduct,
  Invoice,
  Order,
  RecentTransaction,
  UserRole,
} from '../types';
import {
  filterCatalogProducts,
  filterInvoices,
  filterOrders,
  filterTransactions,
  formatINR,
  normalizeSkuForUrl,
} from '../utils/finance';
import {
  subscribeBusiness,
  DEFAULT_BIZ_ID,
  INITIAL_DEFAULT_BUSINESS,
} from '../services/storefrontService';
import { BusinessProfile } from '../types/storefront';

interface HeaderProps {
  searchQuery: string;
  onSearchChange: (val: string) => void;
  onOpenCopilot: (initialPrompt?: string) => void;
  onOpenOnboarding?: () => void;
  catalog: CatalogProduct[];
  invoices: Invoice[];
  transactions: RecentTransaction[];
  orders: Order[];
  activeCartCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  searchQuery,
  onSearchChange,
  onOpenCopilot,
  onOpenOnboarding,
  catalog,
  invoices,
  transactions,
  orders,
  activeCartCount = 3,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    role,
    profile,
    setRole,
    dataSource,
    setDataSource,
    activeBizId,
    startDemoTour,
    isDemoTourActive,
    firebaseUser,
    signInWithGoogle,
    openAuthModal,
    signOutUser,
  } = useRole();

  const [showNotifications, setShowNotifications] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sellerBusiness, setSellerBusiness] = useState<BusinessProfile>(INITIAL_DEFAULT_BUSINESS);

  useEffect(() => {
    const unsub = subscribeBusiness(activeBizId, (biz) => {
      setSellerBusiness(biz);
    });
    return () => unsub();
  }, [activeBizId]);

  const isCustomerSite = role === 'customer' || location.pathname.startsWith('/customer');

  const ACPAYPILOT_LOGO_URL = '/assets/acpaypilot-logo.svg';

  useEffect(() => {
    if (typeof document === 'undefined') return;
    let iconLink = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
    if (!iconLink) {
      iconLink = document.createElement('link');
      iconLink.rel = 'icon';
      document.head.appendChild(iconLink);
    }
    if (isCustomerSite && sellerBusiness?.name) {
      document.title = sellerBusiness.name;
      if (sellerBusiness.logoUrl) {
        iconLink.href = sellerBusiness.logoUrl;
      }
    } else {
      document.title = `ACPayPilot — ${profile.workspaceName}`;
      iconLink.href = ACPAYPILOT_LOGO_URL;
    }
  }, [isCustomerSite, sellerBusiness?.name, sellerBusiness?.logoUrl, profile.workspaceName]);

  const q = searchQuery.trim();
  const matchedProducts = q ? filterCatalogProducts(catalog, q).slice(0, 3) : [];
  const matchedInvoices = q ? filterInvoices(invoices, q).slice(0, 3) : [];
  const matchedTransactions = q ? filterTransactions(transactions, q).slice(0, 3) : [];
  const matchedOrders = q ? filterOrders(orders, q).slice(0, 2) : [];

  const totalMatches =
    matchedProducts.length +
    matchedInvoices.length +
    matchedTransactions.length +
    matchedOrders.length;

  const handleSelectResult = (route: string) => {
    setShowSearchDropdown(false);
    setShowSearchModal(false);
    setMobileMenuOpen(false);
    navigate(route);
  };

  const rolesOrder: UserRole[] = ['customer', 'seller', 'finance', 'business_head'];

  // Primary navigation links per role for mobile 375px usability
  const roleQuickLinks =
    role === 'customer'
      ? [
          { to: '/customer/discover', label: 'Discover', icon: 'travel_explore' },
          { to: '/customer/cart', label: `Cart (${activeCartCount})`, icon: 'shopping_cart_checkout' },
          { to: '/customer/product/FAN-BLDC-892', label: '3D / VR', icon: 'view_in_ar' },
          { to: '/customer/orders', label: 'Orders', icon: 'local_shipping' },
        ]
      : role === 'seller'
      ? [
          { to: '/seller/dashboard', label: 'Dashboard', icon: 'analytics' },
          { to: '/seller/products', label: 'Products', icon: 'inventory_2' },
          { to: '/seller/orders', label: 'Orders', icon: 'orders' },
          { to: '/seller/invoices', label: 'Invoices', icon: 'receipt_long' },
        ]
      : role === 'finance'
      ? [
          { to: '/finance/ledger', label: 'Ledger', icon: 'account_balance_wallet' },
          { to: '/finance/invoices', label: 'Invoices', icon: 'receipt_long' },
          { to: '/finance/reconciliation', label: 'Reconcile', icon: 'fact_check' },
          { to: '/finance/reports', label: 'Reports', icon: 'assessment' },
        ]
      : [
          { to: '/executive', label: 'Executive', icon: 'monitoring' },
          { to: '/customer/discover', label: 'Discover', icon: 'travel_explore' },
          { to: '/customer/cart', label: 'SmartCart', icon: 'shopping_cart_checkout' },
          { to: '/finance/ledger', label: 'Ledger', icon: 'account_balance_wallet' },
        ];

  return (
    <header className="sticky top-0 z-40 w-full bg-surface-container-lowest/95 backdrop-blur-xl border-b border-surface-container-high/60 shadow-2xs flex flex-col">
      {/* Main Top Row */}
      <div className="h-16 w-full px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2">
        {/* Left: Mobile Drawer Button + Brand Logo + Global Search */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Toggle workspace navigation menu"
            data-testid="mobile-menu-toggle"
            className="lg:hidden w-9 h-9 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface flex items-center justify-center shrink-0 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">
              {mobileMenuOpen ? 'close' : 'menu'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => navigate(profile.homeRoute)}
            className="flex items-center gap-2.5 text-left group cursor-pointer shrink-0"
          >
            {isCustomerSite ? (
              <>
                {sellerBusiness.logoUrl ? (
                  <img
                    src={sellerBusiness.logoUrl}
                    alt={sellerBusiness.name}
                    className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl object-cover border border-surface-container-high shadow-sm group-hover:scale-105 transition-transform"
                  />
                ) : (
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-primary to-primary-container flex items-center justify-center text-on-primary shadow-sm">
                    <span className="material-symbols-outlined text-[18px] sm:text-[20px]">
                      storefront
                    </span>
                  </div>
                )}
                <span className="font-headline-sm font-extrabold tracking-tight text-on-surface text-sm sm:text-base leading-none">
                  {sellerBusiness.name}
                </span>
              </>
            ) : (
              <>
                <img
                  src={ACPAYPILOT_LOGO_URL}
                  alt="ACPayPilot"
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl object-cover border border-surface-container-high shadow-sm group-hover:scale-105 transition-transform"
                />
                <div className="flex flex-col">
                  <span className="font-headline-sm font-extrabold tracking-tight text-on-surface text-sm sm:text-base leading-none">
                    AC<span className="text-primary">PayPilot</span>
                  </span>
                  <span className="hidden sm:inline font-label-sm text-[10px] text-secondary uppercase tracking-widest mt-0.5">
                    {profile.workspaceName}
                  </span>
                </div>
              </>
            )}
          </button>

          {/* Quick Search Button for < 2xl screens */}
          <button
            type="button"
            onClick={() => setShowSearchModal(true)}
            title="Search workspace (SKUs, invoices, orders)"
            className="2xl:hidden w-8 h-8 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface-variant flex items-center justify-center shrink-0 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">search</span>
          </button>

          {/* Global Search Bar with Cross-Screen Results Dropdown for 2xl screens */}
          <div className="hidden 2xl:flex items-center relative w-56 shrink-0">
            <span className="material-symbols-outlined text-outline text-[18px] absolute left-3 pointer-events-none">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onFocus={() => setShowSearchDropdown(true)}
              onBlur={() => setTimeout(() => setShowSearchDropdown(false), 180)}
              onChange={(e) => {
                onSearchChange(e.target.value);
                setShowSearchDropdown(true);
              }}
              placeholder="Search SKUs, invoices, orders..."
              aria-label="Global workspace search"
              className="w-full h-9 pl-9 pr-8 rounded-lg bg-surface-container-low text-on-surface placeholder:text-outline font-body-sm text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest transition-all border border-surface-container-high/50"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Clear search"
                className="absolute right-2 text-outline hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[15px]">close</span>
              </button>
            )}

            {/* Cross-Screen Search Results Dropdown */}
            {showSearchDropdown && q.length > 0 && (
              <div className="absolute left-0 top-11 w-96 bg-surface-container-lowest rounded-2xl shadow-2xl border border-surface-container-high/80 p-3 z-50 flex flex-col gap-2.5 max-h-[75vh] overflow-y-auto">
                <div className="flex items-center justify-between px-1 pb-1 border-b border-surface-container-low">
                  <span className="font-label-sm text-[11px] uppercase tracking-wider text-secondary font-bold">
                    Cross-Workspace Search ({totalMatches} matches)
                  </span>
                  <span className="text-[11px] text-primary font-mono">"{q}"</span>
                </div>

                {totalMatches === 0 && (
                  <div className="py-4 text-center text-xs text-secondary">
                    No products, invoices, orders, or transactions match "{q}".
                  </div>
                )}

                {matchedProducts.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="font-label-sm text-[10px] uppercase text-outline px-1 font-bold">
                      Catalog Products ({matchedProducts.length})
                    </span>
                    {matchedProducts.map((prod) => (
                      <button
                        key={prod.id}
                        type="button"
                        onMouseDown={() =>
                          handleSelectResult(`/customer/product/${normalizeSkuForUrl(prod.sku)}`)
                        }
                        className="p-2 rounded-lg hover:bg-surface-container-low flex items-center justify-between text-left transition-colors"
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="text-xs font-bold text-on-surface truncate">
                            {prod.name}
                          </span>
                          <span className="text-[11px] text-secondary font-mono">{prod.sku}</span>
                        </div>
                        <span className="text-xs font-bold text-primary font-tabular-nums shrink-0">
                          {formatINR(prod.price)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {matchedInvoices.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="font-label-sm text-[10px] uppercase text-outline px-1 font-bold">
                      Invoices ({matchedInvoices.length})
                    </span>
                    {matchedInvoices.map((inv) => (
                      <button
                        key={inv.id}
                        type="button"
                        onMouseDown={() => handleSelectResult(`/seller/invoices/${inv.id}`)}
                        className="p-2 rounded-lg hover:bg-surface-container-low flex items-center justify-between text-left transition-colors"
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="text-xs font-bold text-on-surface">
                            {inv.invoiceNumber} • {inv.clientName}
                          </span>
                          <span className="text-[11px] text-secondary">
                            Status: {inv.status.toUpperCase()}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-primary">Inspect →</span>
                      </button>
                    ))}
                  </div>
                )}

                {matchedTransactions.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="font-label-sm text-[10px] uppercase text-outline px-1 font-bold">
                      Ledger Transactions ({matchedTransactions.length})
                    </span>
                    {matchedTransactions.map((tx) => (
                      <button
                        key={tx.id}
                        type="button"
                        onMouseDown={() => handleSelectResult('/finance/ledger')}
                        className="p-2 rounded-lg hover:bg-surface-container-low flex items-center justify-between text-left transition-colors"
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="text-xs font-bold text-on-surface">
                            {tx.orderId} • {tx.customerName}
                          </span>
                          <span className="text-[11px] text-secondary">{tx.status}</span>
                        </div>
                        <span className="text-xs font-bold text-on-surface font-tabular-nums">
                          {formatINR(tx.grossAmount, true)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {matchedOrders.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="font-label-sm text-[10px] uppercase text-outline px-1 font-bold">
                      Escrow Orders ({matchedOrders.length})
                    </span>
                    {matchedOrders.map((ord) => (
                      <button
                        key={ord.id}
                        type="button"
                        onMouseDown={() => handleSelectResult('/seller/orders')}
                        className="p-2 rounded-lg hover:bg-surface-container-low flex items-center justify-between text-left transition-colors"
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="text-xs font-bold text-on-surface">
                            {ord.orderNumber} • {ord.buyerName}
                          </span>
                          <span className="text-[11px] text-secondary">{ord.escrowStatus}</span>
                        </div>
                        <span className="text-xs font-bold text-primary font-tabular-nums">
                          {formatINR(ord.totalAmount)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Center: Live / Demo Account Switcher & Persona Bar */}
        <div className="hidden lg:flex items-center gap-2 shrink-0">
          {/* Mode Switcher Pill */}
          <div className="flex items-center bg-surface-container-low p-1 rounded-xl border border-surface-container-high/60 text-xs shrink-0">
            <button
              type="button"
              onClick={() => {
                if (!firebaseUser) {
                  navigate('/login?mode=signin&role=seller');
                } else {
                  setDataSource('live');
                }
              }}
              title={firebaseUser ? 'Switch to your live isolated store' : 'Sign in to access your live store'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                dataSource === 'live'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Live Account</span>
            </button>
            <button
              type="button"
              onClick={() => setDataSource('demo')}
              title="Switch to Demo Sandbox to preview all features and UI"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                dataSource === 'demo'
                  ? 'bg-primary text-on-primary shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">sports_esports</span>
              <span>Demo Sandbox</span>
            </button>
          </div>

          {/* If in Demo mode: show persona switcher */}
          {dataSource === 'demo' && (
            <div className="flex items-center gap-1 bg-surface-container-low/70 p-1 rounded-xl border border-surface-container-high/40 shrink-0">
              <span className="text-[10px] uppercase font-bold text-on-surface-variant px-1.5 hidden 2xl:inline">
                Persona:
              </span>
              {/* Full persona pills on 2xl+ */}
              <div className="hidden 2xl:flex items-center gap-1">
                {rolesOrder.map((rKey) => {
                  const rInfo = ROLE_PROFILES[rKey];
                  const active = role === rKey;
                  return (
                    <button
                      key={rKey}
                      type="button"
                      onClick={() => setRole(rKey, true)}
                      data-testid={`role-switch-${rKey}`}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                        active
                          ? `${rInfo.accentChipClass} font-bold shadow-2xs`
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[13px]">{rInfo.roleIcon}</span>
                      <span>{rInfo.shortLabel}</span>
                    </button>
                  );
                })}
              </div>
              {/* Compact persona pills on lg to 2xl */}
              <div className="flex 2xl:hidden items-center gap-1">
                {rolesOrder.map((rKey) => {
                  const rInfo = ROLE_PROFILES[rKey];
                  const active = role === rKey;
                  return (
                    <button
                      key={rKey}
                      type="button"
                      onClick={() => setRole(rKey, true)}
                      title={rInfo.label}
                      className={`flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                        active
                          ? `${rInfo.accentChipClass} font-bold shadow-2xs`
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[13px]">{rInfo.roleIcon}</span>
                      <span className="hidden xl:inline text-[10px]">{rInfo.shortLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* User Sign In / Profile Action */}
          {firebaseUser ? (
            <div className="flex items-center gap-1.5 bg-surface-container-low px-2 py-1 rounded-xl border border-surface-container-high/60 shrink-0">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="text-[11px] font-bold text-on-surface max-w-[80px] sm:max-w-[120px] truncate">
                {firebaseUser.displayName || firebaseUser.email?.split('@')[0]}
              </span>
              <button
                type="button"
                onClick={() => signOutUser()}
                title="Sign out of your live account"
                className="px-2 py-0.5 rounded-md bg-surface hover:bg-surface-container text-on-surface-variant border border-outline-variant/40 text-[10px] font-semibold transition-colors cursor-pointer shrink-0"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/login')}
              title="Go to dedicated Sign In / Registration page"
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-label-md text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all shrink-0 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">login</span>
              <span className="hidden sm:inline">Sign In</span>
            </button>
          )}

          {/* AI Copilot Trigger */}
          <button
            type="button"
            onClick={() => onOpenCopilot()}
            title="Ask AI Copilot"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-gradient-to-r from-primary to-tertiary text-on-primary font-label-md text-xs font-semibold shadow-sm hover:opacity-95 transition-all active:scale-95 cursor-pointer shrink-0"
          >
            <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
            <span className="hidden xl:inline">AI Copilot</span>
          </button>

          {/* Store Setup Wizard Trigger */}
          {onOpenOnboarding && (
            <button
              type="button"
              onClick={onOpenOnboarding}
              title="Launch Store Setup & AI Onboarding Wizard"
              className="hidden 2xl:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-primary/20 bg-primary/10 text-primary font-label-md text-xs font-bold hover:bg-primary/20 transition-all cursor-pointer shrink-0"
            >
              <span className="material-symbols-outlined text-[16px]">rocket_launch</span>
              <span>Setup Store</span>
            </button>
          )}

          {/* Public Storefront Direct Link */}
          <a
            href={`/s/${sellerBusiness?.slug || 'aerocool'}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open customer storefront in new window"
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/20 font-label-md text-xs font-bold transition-all shadow-2xs shrink-0"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span className="material-symbols-outlined text-[15px] text-emerald-700">storefront</span>
            <span className="hidden md:inline">Storefront</span>
            <span className="material-symbols-outlined text-[13px] hidden sm:inline">open_in_new</span>
          </a>

          {/* Notifications Popover Trigger */}
          <div className="relative hidden sm:block shrink-0">
            <button
              type="button"
              onClick={() => setShowNotifications((prev) => !prev)}
              aria-label="Open notifications"
              className="relative w-9 h-9 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface-variant flex items-center justify-center transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">notifications</span>
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-error ring-2 ring-surface-container-lowest"></span>
            </button>

            {showNotifications && (
              <div className="absolute right-0 top-11 w-80 bg-surface-container-lowest rounded-2xl shadow-xl border border-surface-container-high/80 p-3 z-50 flex flex-col gap-2">
                <div className="flex items-center justify-between px-1 pb-1 border-b border-surface-container-low">
                  <span className="font-headline-sm text-xs font-bold text-on-surface">
                    Notifications
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowNotifications(false)}
                    className="text-xs text-primary font-semibold hover:underline"
                  >
                    Close
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowNotifications(false);
                    navigate('/seller/invoices/INV-2026-089');
                  }}
                  className="p-2.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-left flex flex-col gap-0.5 transition-colors cursor-pointer"
                >
                  <span className="text-xs font-bold text-error">Overdue Invoice #INV-2026-089</span>
                  <span className="text-[11px] text-secondary">
                    Apex Studio Pvt Ltd • Demo reminder ready in InvoiceIQ
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNotifications(false);
                    navigate('/finance/ledger');
                  }}
                  className="p-2.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-left flex flex-col gap-0.5 transition-colors cursor-pointer"
                >
                  <span className="text-xs font-bold text-primary">Micropayments Tier Simulation</span>
                  <span className="text-[11px] text-secondary">
                    Demo response — inspect fee schedule in Finance Ledger
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNotifications(false);
                    navigate('/health');
                  }}
                  className="p-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-left flex items-center justify-between border border-emerald-200 transition-colors cursor-pointer"
                >
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-emerald-900">System Health Check</span>
                    <span className="text-[10px] text-emerald-700">Firestore, PayPal, Gemini Diagnostics</span>
                  </div>
                  <span className="material-symbols-outlined text-[16px] text-emerald-700">health_and_safety</span>
                </button>
                <NavLink
                  to="/assistant"
                  onClick={() => setShowNotifications(false)}
                  className="p-2 rounded-lg text-center text-xs font-bold text-primary hover:bg-surface-container-low transition-colors"
                >
                  Open Full AI Assistant →
                </NavLink>
              </div>
            )}
          </div>

          {/* Active Persona Profile Pill */}
          <div
            onClick={() => navigate(role === 'customer' ? '/customer/orders' : '/settings')}
            className="flex items-center gap-2 pl-1.5 sm:pl-2 border-l border-surface-container-high cursor-pointer group"
            title={`Signed in as ${profile.userName} (${profile.label})`}
          >
            <div
              className={`w-8 h-8 rounded-full font-bold text-xs flex items-center justify-center shadow-2xs transition-colors ${profile.accentChipClass}`}
            >
              {profile.avatarInitials}
            </div>
            <div className="hidden xl:flex flex-col text-left">
              <span
                data-testid="active-persona-name"
                className="font-label-md text-xs font-semibold text-on-surface leading-none group-hover:text-primary transition-colors"
              >
                {profile.userName}
              </span>
              <span className="font-label-sm text-[10px] text-outline mt-0.5">
                {profile.label}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Standalone Workspace Search Modal (for mobile, tablet, and laptop screens) */}
      {showSearchModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-16 p-4">
          <div className="w-full max-w-xl bg-surface-container-lowest rounded-2xl shadow-2xl border border-surface-container-high/80 p-4 flex flex-col gap-3 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center gap-2 pb-2 border-b border-surface-container-low">
              <span className="material-symbols-outlined text-primary text-[22px]">search</span>
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search SKUs, invoices, orders, transactions..."
                className="w-full bg-transparent text-sm text-on-surface placeholder:text-outline focus:outline-none font-body-md"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  className="text-outline hover:text-on-surface p-1"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowSearchModal(false)}
                className="px-2.5 py-1 rounded-lg bg-surface-container-low hover:bg-surface-container text-xs font-semibold text-on-surface-variant transition-colors"
              >
                Done
              </button>
            </div>

            {/* Results in Modal */}
            {q.length > 0 ? (
              <div className="flex flex-col gap-3">
                <span className="font-label-sm text-[11px] uppercase tracking-wider text-secondary font-bold">
                  Matches ({totalMatches}) for "{q}"
                </span>
                {totalMatches === 0 && (
                  <div className="py-6 text-center text-xs text-secondary">
                    No products, invoices, orders, or transactions match "{q}".
                  </div>
                )}
                {matchedProducts.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="font-label-sm text-[10px] uppercase text-outline px-1 font-bold">
                      Catalog Products ({matchedProducts.length})
                    </span>
                    {matchedProducts.map((prod) => (
                      <button
                        key={prod.id}
                        type="button"
                        onClick={() =>
                          handleSelectResult(`/customer/product/${normalizeSkuForUrl(prod.sku)}`)
                        }
                        className="p-2.5 rounded-xl hover:bg-surface-container-low flex items-center justify-between text-left transition-colors cursor-pointer"
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="text-xs font-bold text-on-surface truncate">
                            {prod.name}
                          </span>
                          <span className="text-[11px] text-secondary font-mono">{prod.sku}</span>
                        </div>
                        <span className="text-xs font-bold text-primary font-tabular-nums shrink-0">
                          {formatINR(prod.price)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {matchedInvoices.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="font-label-sm text-[10px] uppercase text-outline px-1 font-bold">
                      Invoices ({matchedInvoices.length})
                    </span>
                    {matchedInvoices.map((inv) => (
                      <button
                        key={inv.id}
                        type="button"
                        onClick={() => handleSelectResult(`/seller/invoices/${inv.id}`)}
                        className="p-2.5 rounded-xl hover:bg-surface-container-low flex items-center justify-between text-left transition-colors cursor-pointer"
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="text-xs font-bold text-on-surface">
                            {inv.invoiceNumber} • {inv.clientName}
                          </span>
                          <span className="text-[11px] text-secondary">
                            Status: {inv.status.toUpperCase()}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-primary">Inspect →</span>
                      </button>
                    ))}
                  </div>
                )}
                {matchedTransactions.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="font-label-sm text-[10px] uppercase text-outline px-1 font-bold">
                      Transactions ({matchedTransactions.length})
                    </span>
                    {matchedTransactions.map((tx) => (
                      <button
                        key={tx.id}
                        type="button"
                        onClick={() => handleSelectResult('/finance/ledger')}
                        className="p-2.5 rounded-xl hover:bg-surface-container-low flex items-center justify-between text-left transition-colors cursor-pointer"
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="text-xs font-bold text-on-surface">
                            {tx.orderId} • {tx.customerName}
                          </span>
                          <span className="text-[11px] text-secondary">{tx.status}</span>
                        </div>
                        <span className="text-xs font-bold text-on-surface font-tabular-nums">
                          {formatINR(tx.grossAmount, true)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {matchedOrders.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="font-label-sm text-[10px] uppercase text-outline px-1 font-bold">
                      Escrow Orders ({matchedOrders.length})
                    </span>
                    {matchedOrders.map((ord) => (
                      <button
                        key={ord.id}
                        type="button"
                        onClick={() => handleSelectResult('/seller/orders')}
                        className="p-2.5 rounded-xl hover:bg-surface-container-low flex items-center justify-between text-left transition-colors cursor-pointer"
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="text-xs font-bold text-on-surface">
                            {ord.orderNumber} • {ord.buyerName}
                          </span>
                          <span className="text-[11px] text-secondary">{ord.escrowStatus}</span>
                        </div>
                        <span className="text-xs font-bold text-primary font-tabular-nums">
                          {formatINR(ord.totalAmount)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-secondary flex flex-col items-center gap-1">
                <span className="material-symbols-outlined text-[28px] text-outline">search</span>
                <span>Type to search catalog SKUs, invoices, or escrow orders...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile 375px Role Switcher & Primary Flow Strip (Discover → Cart → Pay) */}
      <div className="lg:hidden w-full bg-surface-container-low/90 border-t border-surface-container-high/60 px-3 py-1.5 flex flex-col gap-1.5">
        {/* Row 1: Compact Mobile Role Switcher */}
        <div className="flex items-center justify-between gap-1 overflow-x-auto no-scrollbar">
          <span className="font-label-sm text-[10px] uppercase text-secondary font-bold shrink-0">
            Role:
          </span>
          <div className="flex items-center gap-1">
            {rolesOrder.map((rKey) => {
              const rInfo = ROLE_PROFILES[rKey];
              const active = role === rKey;
              return (
                <button
                  key={rKey}
                  type="button"
                  onClick={() => setRole(rKey, true)}
                  data-testid={`mobile-role-switch-${rKey}`}
                  className={`px-2 py-1 rounded-md font-label-sm text-[11px] whitespace-nowrap transition-all cursor-pointer ${
                    active
                      ? `${rInfo.accentChipClass} font-bold shadow-2xs`
                      : 'bg-surface-container-lowest text-on-surface-variant'
                  }`}
                >
                  {rInfo.shortLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 2: Primary Flow Links (Discover → Cart → 3D/AR → Orders) */}
        <div className="grid grid-cols-4 gap-1">
          {roleQuickLinks.map((lnk) => {
            const isActive = location.pathname.startsWith(lnk.to.split('?')[0]);
            return (
              <NavLink
                key={lnk.to}
                to={lnk.to}
                onClick={() => setMobileMenuOpen(false)}
                className={`py-1.5 px-1.5 rounded-lg flex items-center justify-center gap-1 text-[11px] font-label-sm transition-colors truncate ${
                  isActive
                    ? 'bg-primary text-on-primary font-bold shadow-2xs'
                    : 'bg-surface-container-lowest text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-[14px] shrink-0">{lnk.icon}</span>
                <span className="truncate">{lnk.label}</span>
              </NavLink>
            );
          })}
        </div>
      </div>

      {/* Expandable Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          data-testid="mobile-nav-drawer"
          className="lg:hidden bg-surface-container-lowest border-t border-surface-container-high p-4 shadow-xl flex flex-col gap-3 max-h-[70vh] overflow-y-auto"
        >
          {/* Mobile Search Input */}
          <div className="flex items-center relative w-full">
            <span className="material-symbols-outlined text-outline text-[18px] absolute left-3 pointer-events-none">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search products, invoices, orders..."
              className="w-full h-9 pl-9 pr-3 rounded-lg bg-surface-container-low text-on-surface text-xs border border-surface-container-high"
            />
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-xl bg-surface-container-low">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase font-bold text-secondary">
                Active Persona ({profile.label})
              </span>
              <span className="text-xs font-bold text-on-surface">{profile.userName}</span>
            </div>
            <span
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${profile.accentChipClass}`}
            >
              {profile.accentChipLabel}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <NavLink
              to="/customer/discover"
              onClick={() => setMobileMenuOpen(false)}
              className="p-2.5 rounded-lg bg-surface-container-low hover:bg-surface-container font-semibold text-on-surface flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">
                travel_explore
              </span>
              <span>Discover</span>
            </NavLink>
            <NavLink
              to="/customer/cart"
              onClick={() => setMobileMenuOpen(false)}
              className="p-2.5 rounded-lg bg-surface-container-low hover:bg-surface-container font-semibold text-on-surface flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">
                shopping_cart_checkout
              </span>
              <span>SmartCart ({activeCartCount})</span>
            </NavLink>
            <NavLink
              to="/customer/product/FAN-BLDC-892"
              onClick={() => setMobileMenuOpen(false)}
              className="p-2.5 rounded-lg bg-surface-container-low hover:bg-surface-container font-semibold text-on-surface flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">view_in_ar</span>
              <span>3D / AR View</span>
            </NavLink>
            <NavLink
              to="/customer/orders"
              onClick={() => setMobileMenuOpen(false)}
              className="p-2.5 rounded-lg bg-surface-container-low hover:bg-surface-container font-semibold text-on-surface flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">
                local_shipping
              </span>
              <span>My Orders</span>
            </NavLink>
            <NavLink
              to="/seller/dashboard"
              onClick={() => setMobileMenuOpen(false)}
              className="p-2.5 rounded-lg bg-surface-container-low hover:bg-surface-container font-semibold text-on-surface flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">analytics</span>
              <span>Seller Home</span>
            </NavLink>
            <NavLink
              to="/finance/ledger"
              onClick={() => setMobileMenuOpen(false)}
              className="p-2.5 rounded-lg bg-surface-container-low hover:bg-surface-container font-semibold text-on-surface flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">
                account_balance_wallet
              </span>
              <span>Finance Ledger</span>
            </NavLink>
            <NavLink
              to="/executive"
              onClick={() => setMobileMenuOpen(false)}
              className="p-2.5 rounded-lg bg-surface-container-low hover:bg-surface-container font-semibold text-on-surface flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">monitoring</span>
              <span>Executive</span>
            </NavLink>
            <NavLink
              to="/assistant"
              onClick={() => setMobileMenuOpen(false)}
              className="p-2.5 rounded-lg bg-surface-container-low hover:bg-surface-container font-semibold text-on-surface flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">smart_toy</span>
              <span>AI Assistant</span>
            </NavLink>
          </div>
        </div>
      )}
    </header>
  );
};
