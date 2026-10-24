import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useRole } from '../context/RoleContext';

interface SidebarProps {
  onOpenCopilot: (initialPrompt?: string) => void;
}

interface NavItemConfig {
  to: string;
  matchPrefixes?: string[];
  icon: string;
  label: string;
  badge?: string;
  badgeColor?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({ onOpenCopilot }) => {
  const location = useLocation();
  const { role, profile, dataSource } = useRole();

  const isActive = (item: NavItemConfig) => {
    const path = location.pathname;
    if (item.to === '/executive' && (path === '/' || path === '/executive')) {
      return true;
    }
    if (path === item.to) return true;
    if (item.matchPrefixes) {
      return item.matchPrefixes.some((prefix) => path.startsWith(prefix));
    }
    return false;
  };

  const sellerItems: NavItemConfig[] = [
    {
      to: '/seller/dashboard',
      icon: 'analytics',
      label: 'Seller Dashboard',
    },
    {
      to: '/seller/website',
      icon: 'web',
      label: 'My Website',
      badge: 'Live',
      badgeColor: 'bg-emerald-500/10 text-emerald-700',
    },
    {
      to: '/seller/products',
      icon: 'inventory_2',
      label: 'Product Catalog & AI',
      badge: 'AI',
    },
    {
      to: '/seller/orders',
      icon: 'orders',
      label: 'Orders & Escrow',
    },
    {
      to: '/seller/invoices',
      matchPrefixes: ['/seller/invoices'],
      icon: 'receipt_long',
      label: 'InvoiceIQ AI',
      badge: '1 Overdue',
      badgeColor: 'bg-error-container text-on-error-container',
    },
    {
      to: '/seller/transactions',
      icon: 'account_balance_wallet',
      label: 'Transactions & Fees',
    },
    {
      to: '/seller/reports',
      icon: 'assessment',
      label: 'Financial Reports',
    },
  ];

  // Dedicated Finance sidebar group: Ledger, Invoices, Reconciliation, Reports
  const financeItems: NavItemConfig[] = [
    {
      to: '/finance/ledger',
      matchPrefixes: ['/finance/ledger', '/seller/transactions'],
      icon: 'account_balance_wallet',
      label: 'Ledger',
    },
    {
      to: '/finance/invoices',
      matchPrefixes: ['/finance/invoices', '/seller/invoices'],
      icon: 'receipt_long',
      label: 'Invoices',
      badge: 'GST',
    },
    {
      to: '/finance/reconciliation',
      matchPrefixes: ['/finance/reconciliation', '/seller/reconciliation'],
      icon: 'fact_check',
      label: 'Reconciliation',
      badge: '3-Way',
    },
    {
      to: '/finance/reports',
      matchPrefixes: ['/finance/reports', '/seller/reports'],
      icon: 'assessment',
      label: 'Reports',
    },
  ];

  const customerItems: NavItemConfig[] = [
    {
      to: '/customer/discover',
      icon: 'travel_explore',
      label: 'Discover & Search',
    },
    {
      to: '/customer/cart',
      icon: 'shopping_cart_checkout',
      label: 'SmartCart',
      badge: '4',
    },
    {
      to: '/customer/product/FAN-BLDC-892',
      matchPrefixes: ['/customer/product/'],
      icon: 'view_in_ar',
      label: '3D & WebXR VR View',
      badge: 'VR',
      badgeColor: 'bg-primary text-on-primary',
    },
    {
      to: '/customer/orders',
      icon: 'local_shipping',
      label: 'My Orders',
    },
  ];

  const executiveItems: NavItemConfig[] = [
    {
      to: '/executive',
      icon: 'monitoring',
      label: 'Executive Insights',
    },
  ];

  const renderItem = (item: NavItemConfig, readOnlyBadge = false) => {
    const active = isActive(item);
    return (
      <NavLink
        key={item.to}
        to={item.to}
        aria-current={active ? 'page' : undefined}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl font-label-md text-xs transition-all group ${
          active
            ? 'bg-primary text-on-primary font-bold shadow-sm'
            : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
        }`}
      >
        <div className="flex items-center gap-2.5 truncate">
          <span
            className={`material-symbols-outlined text-[18px] ${
              active ? 'text-on-primary' : 'text-outline group-hover:text-primary'
            }`}
          >
            {item.icon}
          </span>
          <span className="truncate">{item.label}</span>
        </div>
        {readOnlyBadge ? (
          <span
            className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
              active
                ? 'bg-on-primary/20 text-on-primary'
                : 'bg-surface-container-high text-secondary'
            }`}
          >
            Read-Only
          </span>
        ) : (
          item.badge && (
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                active
                  ? 'bg-on-primary/20 text-on-primary'
                  : item.badgeColor || 'bg-primary-fixed text-on-primary-fixed'
              }`}
            >
              {item.badge}
            </span>
          )
        )}
      </NavLink>
    );
  };

  return (
    <aside className="hidden lg:flex flex-col w-64 shrink-0 bg-surface-container-lowest border-r border-surface-container-high/60 min-h-[calc(100vh-4rem)] p-4 justify-between select-none">
      <div className="flex flex-col gap-5">
        {/* Role-Distinct Workspace Identity & Accent Chip */}
        <div
          data-testid="sidebar-role-card"
          className={`p-3.5 rounded-xl border flex flex-col gap-2 shadow-2xs ${profile.accentSoftClass}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span
              data-testid="role-accent-chip"
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${profile.accentChipClass}`}
            >
              <span className="material-symbols-outlined text-[12px]">{profile.roleIcon}</span>
              <span>{profile.label} Role</span>
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                dataSource === 'demo'
                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                  : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
              }`}
            >
              {dataSource === 'demo' ? 'Demo' : 'Live'}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="font-headline-sm text-xs font-extrabold leading-tight">
              AC <span className="text-primary">PayPilot</span> • {profile.workspaceName}
            </span>
            <span className="font-label-sm text-[11px] opacity-80 mt-0.5">
              {profile.userName} • {profile.userTitle}
            </span>
          </div>
        </div>

        {/* Role-Specific Primary Navigation */}
        {role === 'seller' && (
          <div className="flex flex-col gap-1" data-testid="sidebar-seller-group">
            <div className="px-3 pb-1.5 flex items-center justify-between">
              <span className="font-label-sm text-[10px] uppercase tracking-widest font-bold text-primary">
                Seller Workspace
              </span>
            </div>
            {sellerItems.map((item) => renderItem(item))}
          </div>
        )}

        {role === 'finance' && (
          <div className="flex flex-col gap-1" data-testid="sidebar-finance-group">
            <div className="px-3 pb-1.5 flex items-center justify-between">
              <span className="font-label-sm text-[10px] uppercase tracking-widest font-bold text-purple-800">
                Finance Workspace
              </span>
            </div>
            {financeItems.map((item) => renderItem(item))}
          </div>
        )}

        {role === 'customer' && (
          <div className="flex flex-col gap-1" data-testid="sidebar-customer-group">
            <div className="px-3 pb-1.5 flex items-center justify-between">
              <span className="font-label-sm text-[10px] uppercase tracking-widest font-bold text-teal-800">
                Customer Experience
              </span>
            </div>
            {customerItems.map((item) => renderItem(item))}
          </div>
        )}

        {role === 'business_head' && (
          <>
            <div className="flex flex-col gap-1" data-testid="sidebar-executive-group">
              <div className="px-3 pb-1.5 flex items-center justify-between">
                <span className="font-label-sm text-[10px] uppercase tracking-widest font-bold text-slate-900">
                  Business Head Command
                </span>
              </div>
              {executiveItems.map((item) => renderItem(item))}
            </div>


            <div className="flex flex-col gap-1">
              <div className="px-3 pb-1 flex items-center justify-between">
                <span className="font-label-sm text-[10px] uppercase tracking-widest font-bold text-outline">
                  Finance (Read-Only)
                </span>
              </div>
              {financeItems.map((item) => renderItem(item, true))}
            </div>

            <div className="flex flex-col gap-1">
              <div className="px-3 pb-1 flex items-center justify-between">
                <span className="font-label-sm text-[10px] uppercase tracking-widest font-bold text-outline">
                  Seller (Read-Only)
                </span>
              </div>
              {sellerItems.slice(0, 3).map((item) => renderItem(item, true))}
            </div>

            <div className="flex flex-col gap-1">
              <div className="px-3 pb-1 flex items-center justify-between">
                <span className="font-label-sm text-[10px] uppercase tracking-widest font-bold text-outline">
                  Customer (Read-Only)
                </span>
              </div>
              {customerItems.map((item) => renderItem(item, true))}
            </div>
          </>
        )}

        {/* Shared Tools */}
        <div className="flex flex-col gap-1">
          <div className="px-3 pb-1.5 flex items-center justify-between">
            <span className="font-label-sm text-[10px] uppercase tracking-widest font-bold text-outline">
              Workspace Utilities
            </span>
          </div>
          {renderItem({
            to: '/assistant',
            icon: 'smart_toy',
            label: 'AI Assistant',
            badge: dataSource === 'demo' ? 'Demo' : 'Live AI',
          })}
          {role !== 'customer' &&
            renderItem({
              to: '/settings',
              icon: 'settings',
              label: 'Settings',
            })}
          {role !== 'customer' &&
            renderItem({
              to: '/health',
              icon: 'health_and_safety',
              label: 'System Check',
              badge: 'Live',
              badgeColor: 'bg-emerald-100 text-emerald-800',
            })}
        </div>
      </div>

      {/* Bottom Data Source & Copilot Card */}
      <div className="mt-6 p-3.5 rounded-xl bg-gradient-to-br from-surface-container-low to-surface-container border border-surface-container-high/80 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="font-label-sm text-[10px] uppercase tracking-wider text-primary font-bold">
            AC PayPilot Copilot
          </span>
          <span className="flex items-center gap-1 text-[10px] text-amber-800 font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            {dataSource === 'demo' ? 'Demo Mode' : 'Live AI'}
          </span>
        </div>
        <p className="font-body-sm text-[11px] text-on-surface-variant leading-relaxed">
          {dataSource === 'demo'
            ? 'AI suggests, you decide. Every suggestion includes source + "Why this?" + Edit/Approve.'
            : 'Live data mode selected with explicit user approval before changes.'}
        </p>
        <button
          type="button"
          onClick={() => onOpenCopilot()}
          className="w-full py-1.5 px-2.5 rounded-lg bg-surface-container-lowest hover:bg-primary hover:text-on-primary text-primary font-label-md text-xs font-semibold shadow-2xs transition-colors flex items-center justify-center gap-1.5 border border-primary/20 cursor-pointer"
        >
          <span className="material-symbols-outlined text-[15px]">chat_spark</span>
          <span>Ask AC PayPilot Copilot</span>
        </button>
      </div>
    </aside>
  );
};
