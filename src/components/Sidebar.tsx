import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useRole } from '../context/RoleContext';
import {
  DEFAULT_BIZ_ID,
  INITIAL_DEFAULT_BUSINESS,
  subscribeBusiness,
} from '../services/storefrontService';
import { BusinessProfile } from '../types/storefront';

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
  const { role, profile } = useRole();
  const [sellerBusiness, setSellerBusiness] = useState<BusinessProfile>(INITIAL_DEFAULT_BUSINESS);

  useEffect(() => {
    const unsub = subscribeBusiness(DEFAULT_BIZ_ID, (biz) => {
      if (biz) setSellerBusiness(biz);
    });
    return () => unsub();
  }, []);

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
      to: '/seller/command-center',
      icon: 'space_dashboard',
      label: 'Command Center',
      badge: 'AG Studio',
      badgeColor: 'bg-sky-500/15 text-sky-700',
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
      to: '/seller/ai-studio',
      icon: '3d_rotation',
      label: '3D & AI Media Studio',
      badge: 'New',
      badgeColor: 'bg-primary text-on-primary',
    },
    {
      to: '/seller/orders',
      icon: 'orders',
      label: 'Orders & Escrow',
    },
    {
      to: '/seller/customers',
      icon: 'group',
      label: 'Customer Base',
      badge: '6',
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
      label: 'Transactions & Payouts',
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
      to: '/customer/ai-studio',
      icon: '3d_rotation',
      label: '3D & AI Media Studio',
      badge: 'New',
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
    <aside className="hidden lg:flex flex-col w-64 shrink-0 bg-surface-container-lowest border-r border-surface-container-high/60 sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto p-4 justify-between select-none">
      <div className="flex flex-col gap-5">
        {/* Role-Distinct Workspace Identity & Brand Header */}
        <div
          data-testid="sidebar-role-card"
          className={`p-3.5 rounded-xl border flex flex-col gap-2 shadow-2xs ${profile.accentSoftClass}`}
        >
          {role === 'customer' ? (
            <div className="flex items-center gap-2.5">
              <img
                src={sellerBusiness.logoUrl}
                alt={sellerBusiness.name}
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-lg object-cover border border-surface-container-high bg-white shrink-0"
              />
              <span className="font-headline-sm text-sm font-extrabold leading-tight truncate">
                {sellerBusiness.name}
              </span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span
                  data-testid="role-accent-chip"
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${profile.accentChipClass}`}
                >
                  <span className="material-symbols-outlined text-[12px]">{profile.roleIcon}</span>
                  <span>{profile.label}</span>
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <img
                  src="/assets/acpaypilot-logo.svg"
                  alt="ACPayPilot"
                  referrerPolicy="no-referrer"
                  className="w-7 h-7 rounded-lg object-cover border border-surface-container-high shrink-0"
                />
                <span className="font-headline-sm text-sm font-extrabold leading-tight truncate">
                  AC<span className="text-primary">PayPilot</span>
                </span>
              </div>
            </>
          )}
        </div>

        {/* Public Storefront Direct Preview Card (Seller & Executive only) */}
        {role !== 'customer' && (
          <div className="p-3 rounded-xl bg-gradient-to-r from-emerald-500/10 via-surface-container to-surface-container border border-emerald-500/25 flex flex-col gap-2 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-800 uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Public Storefront</span>
              </span>
              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                Live
              </span>
            </div>
            <div className="flex items-center gap-2">
              <img
                src={sellerBusiness.logoUrl}
                alt={sellerBusiness.name}
                className="w-5 h-5 rounded object-cover bg-white border border-emerald-500/20 shrink-0"
              />
              <span className="text-xs font-bold text-on-surface truncate">
                {sellerBusiness.name}
              </span>
            </div>
            <a
              href={`/s/${sellerBusiness.slug || 'aerocool'}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-1.5 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-label-md text-xs font-semibold shadow-2xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">open_in_new</span>
              <span>View Live Store</span>
            </a>
          </div>
        )}

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
              Utilities
            </span>
          </div>
          {renderItem({
            to: '/assistant',
            icon: 'smart_toy',
            label: 'AI Assistant',
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

      {/* Bottom Quick Assistant Button */}
      <div className="mt-6 pt-3 border-t border-surface-container-high/60">
        <button
          type="button"
          onClick={() => onOpenCopilot()}
          className="w-full py-2 px-3 rounded-xl bg-surface-container-low hover:bg-primary hover:text-on-primary text-primary font-label-md text-xs font-semibold shadow-2xs transition-colors flex items-center justify-center gap-1.5 border border-primary/20 cursor-pointer"
        >
          <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
          <span>Ask Assistant</span>
        </button>
      </div>
    </aside>
  );
};
