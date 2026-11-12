import React, { useState, useCallback, useEffect } from 'react';
import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { RoleRouteGuard } from './components/RoleRouteGuard';
import { ScreenDataSourceBanner } from './components/ScreenDataSourceBanner';
import { useRole } from './context/RoleContext';
import type { OrderRecord } from './components/screens/OrdersScreen';
import type { SmartCartItem } from './components/screens/SmartCartScreen';
import { loadInitialSmartCart, persistSmartCart } from './data/cartDefaults';
import type { CheckoutIntent } from './components/modals/PayPalCheckoutModal';

const DashboardScreen = React.lazy(() =>
  import('./components/screens/DashboardScreen').then((m) => ({ default: m.DashboardScreen }))
);
const DiscoveryScreen = React.lazy(() =>
  import('./components/screens/DiscoveryScreen').then((m) => ({ default: m.DiscoveryScreen }))
);
const SmartCartScreen = React.lazy(() =>
  import('./components/screens/SmartCartScreen').then((m) => ({ default: m.SmartCartScreen }))
);
const InvoiceIQScreen = React.lazy(() =>
  import('./components/screens/InvoiceIQScreen').then((m) => ({ default: m.InvoiceIQScreen }))
);
const ListingGeneratorScreen = React.lazy(() =>
  import('./components/screens/ListingGeneratorScreen').then((m) => ({ default: m.ListingGeneratorScreen }))
);
const ProductDetailARScreen = React.lazy(() =>
  import('./components/screens/ProductDetailARScreen').then((m) => ({ default: m.ProductDetailARScreen }))
);
const ExecutiveScreen = React.lazy(() =>
  import('./components/screens/ExecutiveScreen').then((m) => ({ default: m.ExecutiveScreen }))
);
const TransactionsScreen = React.lazy(() =>
  import('./components/screens/TransactionsScreen').then((m) => ({ default: m.TransactionsScreen }))
);
const ReconciliationScreen = React.lazy(() =>
  import('./components/screens/ReconciliationScreen').then((m) => ({ default: m.ReconciliationScreen }))
);
const FinancialReportsScreen = React.lazy(() =>
  import('./components/screens/FinancialReportsScreen').then((m) => ({ default: m.FinancialReportsScreen }))
);
const SettingsScreen = React.lazy(() =>
  import('./components/screens/SettingsScreen').then((m) => ({ default: m.SettingsScreen }))
);
const OrdersScreen = React.lazy(() =>
  import('./components/screens/OrdersScreen').then((m) => ({ default: m.OrdersScreen }))
);
const AssistantScreen = React.lazy(() =>
  import('./components/screens/AssistantScreen').then((m) => ({ default: m.AssistantScreen }))
);
const CheckoutResultScreen = React.lazy(() =>
  import('./components/screens/CheckoutResultScreen').then((m) => ({ default: m.CheckoutResultScreen }))
);
const NotFoundScreen = React.lazy(() =>
  import('./components/screens/CheckoutResultScreen').then((m) => ({ default: m.NotFoundScreen }))
);
const HealthScreen = React.lazy(() =>
  import('./components/screens/HealthScreen').then((m) => ({ default: m.HealthScreen }))
);
const StorefrontBuilderScreen = React.lazy(() =>
  import('./components/screens/StorefrontBuilderScreen').then((m) => ({ default: m.StorefrontBuilderScreen }))
);
const CustomersScreen = React.lazy(() =>
  import('./components/screens/CustomersScreen').then((m) => ({ default: m.CustomersScreen }))
);
const SellerCommandCenterScreen = React.lazy(() =>
  import('./components/screens/SellerCommandCenterScreen').then((m) => ({ default: m.SellerCommandCenterScreen }))
);
const CreativeStudioScreen = React.lazy(() =>
  import('./components/screens/CreativeStudioScreen').then((m) => ({ default: m.CreativeStudioScreen }))
);
const LoginScreen = React.lazy(() =>
  import('./components/screens/LoginScreen').then((m) => ({ default: m.LoginScreen }))
);
const PublicStorefrontApp = React.lazy(() =>
  import('./components/storefront/PublicStorefrontApp').then((m) => ({
    default: m.PublicStorefrontApp,
  }))
);
const OnboardingWizard = React.lazy(() =>
  import('./components/onboarding/OnboardingWizard').then((m) => ({ default: m.OnboardingWizard }))
);
import {
  DEFAULT_BIZ_ID,
  emitOrderPlacedNotification,
  ensureDefaultStoreExists,
  subscribeStoreOrders,
} from './services/storefrontService';
import { StorefrontOrder } from './types/storefront';
const CopilotModal = React.lazy(() =>
  import('./components/modals/CopilotModal').then((m) => ({ default: m.CopilotModal }))
);
const FeeAuditModal = React.lazy(() =>
  import('./components/modals/FeeAuditModal').then((m) => ({ default: m.FeeAuditModal }))
);
const PayPalCheckoutModal = React.lazy(() =>
  import('./components/modals/PayPalCheckoutModal').then((m) => ({ default: m.PayPalCheckoutModal }))
);
const QRModal = React.lazy(() =>
  import('./components/modals/QRModal').then((m) => ({ default: m.QRModal }))
);
const ARPreviewModal = React.lazy(() =>
  import('./components/modals/ARPreviewModal').then((m) => ({ default: m.ARPreviewModal }))
);
const AuthModal = React.lazy(() =>
  import('./components/modals/AuthModal').then((m) => ({ default: m.AuthModal }))
);
const ProfileOnboardingModal = React.lazy(() =>
  import('./components/modals/ProfileOnboardingModal').then((m) => ({ default: m.ProfileOnboardingModal }))
);
import { ScreenId, UserRole } from './types';
import { CanonicalPaymentState } from './components/ui/HonestTrustComponents';
import {
  mockCatalogProducts,
  mockInvoices,
  mockOrders,
  mockTransactions,
} from './data/mockData';

export const CATALOG_BY_SKU: Record<string, any> = {
  'FAN-BLDC-892': {
    sku: '#FAN-BLDC-892',
    name: 'AeroBreeze Stealth 1200mm Smart BLDC Ceiling Fan',
    price: 8499,
    mrp: 12999,
    gstRate: 18,
    hsCode: '8414.51.10',
    category: 'Smart Ceiling Fans',
    stock: 120,
    modelUrl: '/api/models/ceiling-fan.glb',
    specs: ['28W @ Speed 6 (BLDC)', '235 CMM @ 380 RPM', '1200 mm (48") Sweep', '28 dB Whisper Silent'],
    dimensions: '1200 × 1200 × 340 mm',
    weight: '3.8 kg',
    warranty: '3 Years On-Site Replacement',
    aiMatchScore: 99,
    aiReason:
      '28W BLDC motor cuts energy draw by 65% vs 75W induction fans with 1200mm room air throw.',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAdZqURIDL_NaUXiAifTbLg4cem9jV1GV8iZOZph4aZvIM_kBIBsVSYaq0LFoeWQ1Xe11jOuDpYR0RHnVhSurjQprJuCqeXfR6luOW8JojolfW3AL3RlJG5cFe-YmAZaYz7-lll8h5sqcs83z5WRWhCSmB_-pIxVPGanujJtlcWqHaGPRDckKJmoCqqWoVmhA4SIWYCZ53ylY77gEHOrpObunEt2PyFUzIVJzYoOpMS9aQvgYTluWmbLg',
  },
  '#FAN-BLDC-892': {
    sku: '#FAN-BLDC-892',
    name: 'AeroBreeze Stealth 1200mm Smart BLDC Ceiling Fan',
    price: 8499,
    mrp: 12999,
    gstRate: 18,
    hsCode: '8414.51.10',
    category: 'Smart Ceiling Fans',
    stock: 120,
    modelUrl: '/api/models/ceiling-fan.glb',
    specs: ['28W @ Speed 6 (BLDC)', '235 CMM @ 380 RPM', '1200 mm (48") Sweep', '28 dB Whisper Silent'],
    dimensions: '1200 × 1200 × 340 mm',
    weight: '3.8 kg',
    warranty: '3 Years On-Site Replacement',
    aiMatchScore: 99,
    aiReason:
      '28W BLDC motor cuts energy draw by 65% vs 75W induction fans with 1200mm room air throw.',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAdZqURIDL_NaUXiAifTbLg4cem9jV1GV8iZOZph4aZvIM_kBIBsVSYaq0LFoeWQ1Xe11jOuDpYR0RHnVhSurjQprJuCqeXfR6luOW8JojolfW3AL3RlJG5cFe-YmAZaYz7-lll8h5sqcs83z5WRWhCSmB_-pIxVPGanujJtlcWqHaGPRDckKJmoCqqWoVmhA4SIWYCZ53ylY77gEHOrpObunEt2PyFUzIVJzYoOpMS9aQvgYTluWmbLg',
  },
  'SPO-YNX-99P': {
    sku: '#SPO-YNX-99P',
    name: 'Yonex Astrox 99 Pro Carbon Badminton Racket',
    price: 14990,
    mrp: 19900,
    gstRate: 18,
    hsCode: '9506.59.10',
    category: 'Badminton & Sports Gear',
    stock: 40,
    modelUrl: '/api/models/badminton-racket.glb',
    specs: ['Pre-Strung BG80', 'Full Carbon Cap', '4U (83g) • Head Heavy'],
    dimensions: '675 × 200 × 12 mm',
    weight: '0.083 kg (4U)',
    warranty: '1 Year Yonex Brand Protection',
    aiMatchScore: 96,
    aiReason:
      'Rotational Generator System distributes weight across grip, frame top, and T-joint.',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDURq8df1AvNhd6BXPOnLSDepBVFAZQQdhN7XCJzqUwmcV79SqYGalleVqm5XyenVa4nFesHY7jCNLROrqBHlgtE92aPFjCmcNoiYuJEPzJjul5AYdnnHkeKQevXmwyO8xozEtp1qExjA6sfd8tRUMhTAaE5rLBnqslJx9r-5JgtL82V5kmTgx9bt5QmOiAjh1sa5vjPP7EB5WSaeKeMK9zuVgCH8RJFezfeBmyvYUJuYqroAVrKuYT6A',
  },
  '#SPO-YNX-99P': {
    sku: '#SPO-YNX-99P',
    name: 'Yonex Astrox 99 Pro Carbon Badminton Racket',
    price: 14990,
    mrp: 19900,
    gstRate: 18,
    hsCode: '9506.59.10',
    category: 'Badminton & Sports Gear',
    stock: 40,
    modelUrl: '/api/models/badminton-racket.glb',
    specs: ['Pre-Strung BG80', 'Full Carbon Cap', '4U (83g) • Head Heavy'],
    dimensions: '675 × 200 × 12 mm',
    weight: '0.083 kg (4U)',
    warranty: '1 Year Yonex Brand Protection',
    aiMatchScore: 96,
    aiReason:
      'Rotational Generator System distributes weight across grip, frame top, and T-joint.',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDURq8df1AvNhd6BXPOnLSDepBVFAZQQdhN7XCJzqUwmcV79SqYGalleVqm5XyenVa4nFesHY7jCNLROrqBHlgtE92aPFjCmcNoiYuJEPzJjul5AYdnnHkeKQevXmwyO8xozEtp1qExjA6sfd8tRUMhTAaE5rLBnqslJx9r-5JgtL82V5kmTgx9bt5QmOiAjh1sa5vjPP7EB5WSaeKeMK9zuVgCH8RJFezfeBmyvYUJuYqroAVrKuYT6A',
  },
  'AUD-ANC-99': {
    sku: '#AUD-ANC-99',
    name: 'AcousticSphere ANC Wireless Earbuds',
    price: 11499,
    mrp: 14999,
    gstRate: 18,
    hsCode: '8518.30.00',
    category: 'Spatial Audio Nodes',
    stock: 45,
    modelUrl: null,
    specs: ['Lossless LDAC', 'Spatial Audio'],
    dimensions: '62 × 48 × 28 mm',
    weight: '0.048 kg',
    warranty: '1 Year Brand Warranty',
    aiMatchScore: 88,
    aiReason:
      'Studio-grade active noise cancellation with 36-hour battery life and spatial audio.',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuATX6652NttkNvGUKx5jflqNG9RH8CT1bcmBhwPs5ONeLhU9pt_yu_fLrBW741KftvyB8iGKx74rvwQHwuPCAi3l4R3tYkHwBDG9n3OPdy9Mlu8L_I0x4OPz9BwauAkb1vv9Y9m6inErwdhjPUN3ppwCGPbYGt503flhtRIVgYmpxZIuYY_1j9Rm3YHrFW7YLzOu7wmGH2HMVU6LtZPoH8W80bhQ8Ax7MbgTzEynmMscW556GyOm__wiw',
  },
  'AC-WRK-8990': {
    sku: 'AC-WRK-8990',
    name: 'ProArt Studio Workstation X1',
    price: 292000,
    mrp: 325000,
    gstRate: 18,
    hsCode: '8471.50.00',
    category: 'Workstations',
    stock: 4,
    modelUrl: '/api/models/workstation.glb',
    specs: ['64GB ECC DDR5', 'RTX 4090 24GB', '2TB Gen5 NVMe', 'Dual 10GbE LAN'],
    dimensions: '420 × 680 × 178 mm',
    weight: '14.8 kg',
    warranty: '3 Years On-Site Next-Business-Day',
    aiMatchScore: 99,
    aiReason:
      'Matches 4K Redshift & DaVinci Resolve rendering profiles with 0% PCIe lane bottleneck.',
    img: 'https://images.unsplash.com/photo-1591799264318-7e6ef8ddb7ea?w=800&auto=format&fit=crop&q=80',
  },
  'AC-MON-324K': {
    sku: 'AC-MON-324K',
    name: 'UltraSharp 32" 6K HDR Reference Display',
    price: 118000,
    mrp: 135000,
    gstRate: 18,
    hsCode: '8528.52.00',
    category: 'Displays',
    stock: 11,
    modelUrl: null,
    specs: ['6K IPS Black', '99% DCI-P3', 'Thunderbolt 4 140W Hub'],
    dimensions: '712 × 498 × 230 mm',
    weight: '8.6 kg',
    warranty: '3 Years Zero Bright Dot Exchange',
    aiMatchScore: 97,
    aiReason: 'Thunderbolt 4 single-cable dock pairs directly with Workstation X1.',
    img: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=800&auto=format&fit=crop&q=80',
  },
  'AC-NAS-10G8': {
    sku: 'AC-NAS-10G8',
    name: 'ProRack 8-Bay 10GbE Studio NAS',
    price: 164000,
    mrp: 182000,
    gstRate: 18,
    hsCode: '8471.70.20',
    category: 'Storage',
    stock: 6,
    modelUrl: null,
    specs: ['64TB Raw Enterprise RAID', 'Dual 10GbE SFP+', 'NVMe Read Cache'],
    dimensions: '340 × 290 × 240 mm',
    weight: '11.2 kg',
    warranty: '5 Years Enterprise Chassis Warranty',
    aiMatchScore: 93,
    aiReason: 'Sustains 1,950 MB/s multi-editor proxy ingest over 10GbE LAN.',
    img: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800&auto=format&fit=crop&q=80',
  },
  'AC-ERG-2100': {
    sku: 'AC-ERG-2100',
    name: 'ErgoMesh Task Chair Pro',
    price: 45000,
    mrp: 54000,
    gstRate: 18,
    hsCode: '9401.30.00',
    category: 'Ergonomics',
    stock: 19,
    modelUrl: null,
    specs: ['4D Titanium Armrests', 'Dynamic Lumbar', '12-Year Commercial Warranty'],
    dimensions: '670 × 670 × 1140 mm',
    weight: '16.4 kg',
    warranty: '12 Years 24/7 Shift Rated',
    aiMatchScore: 91,
    aiReason: 'BIFMA certified commercial seating with full 18% GST input tax credit.',
    img: 'https://images.unsplash.com/photo-1505843490538-5133c6c7d0e1?w=800&auto=format&fit=crop&q=80',
  },
};

const INITIAL_ORDER_RECORDS: OrderRecord[] = [
  {
    id: '#PP-9821',
    invoiceId: 'INV-2026-089',
    buyerName: 'Apex Studio Pvt Ltd',
    buyerGstin: '27AABCA8921K1Z4',
    productSku: '#FAN-BLDC-892',
    productName: 'AeroBreeze Stealth 1200mm Smart BLDC Ceiling Fan (×2)',
    qty: 2,
    amount: 16998,
    paymentState: 'Captured',
    date: '14 May 2026',
    trackingId: 'BLR-DLV-90812',
  },
  {
    id: '#PP-9820',
    invoiceId: 'INV-2026-088',
    buyerName: 'Kinetix VFX Bengaluru',
    buyerGstin: '29AABCK4412M1Z9',
    productSku: '#SPO-YNX-99P',
    productName: 'Yonex Astrox 99 Pro Carbon Badminton Racket',
    qty: 1,
    amount: 14990,
    paymentState: 'Authorized',
    date: '13 May 2026',
    trackingId: 'DELHIVERY-7741290',
  },
  {
    id: '#PP-9814',
    invoiceId: 'INV-2026-085',
    buyerName: 'Monolith Architecture LLP',
    buyerGstin: '07AABCM9910P1Z2',
    productSku: 'AC-NAS-10G8',
    productName: 'ProRack 8-Bay 10GbE Studio NAS',
    qty: 1,
    amount: 164000,
    paymentState: 'Pending',
    date: '11 May 2026',
    trackingId: 'AWAITING-DISPATCH',
  },
  {
    id: '#PP-9809',
    invoiceId: 'INV-2026-081',
    buyerName: 'Vertex Industrial Design',
    buyerGstin: '27AABCV3319L1Z1',
    productSku: 'AC-ERG-2100',
    productName: 'ErgoMesh Task Chair Pro',
    qty: 1,
    amount: 45000,
    paymentState: 'Refunded',
    date: '09 May 2026',
    trackingId: 'RETURNED-RMA-102',
  },
  {
    id: '#PP-9805',
    invoiceId: 'INV-2026-079',
    buyerName: 'Horizon CAD Labs',
    buyerGstin: '29AABCH5512D1Z8',
    productSku: 'AC-MON-324K',
    productName: 'UltraSharp 32" 6K HDR Reference Display',
    qty: 1,
    amount: 118000,
    paymentState: 'Failed',
    date: '07 May 2026',
    trackingId: 'AUTH-DECLINED',
  },
  {
    id: '#PP-9801',
    invoiceId: 'INV-2026-076',
    buyerName: 'Prism Sound Studios',
    buyerGstin: '27AABCP9910E1Z4',
    productSku: 'AC-ERG-2100',
    productName: 'ErgoMesh Task Chair Pro',
    qty: 1,
    amount: 45000,
    paymentState: 'Cancelled',
    date: '05 May 2026',
    trackingId: 'VOIDED-BY-BUYER',
  },
];

export const SCREEN_ID_TO_PATH: Record<ScreenId, string> = {
  'executive-insights': '/executive',
  'seller-dashboard': '/seller/dashboard',
  'seller-command-center': '/seller/command-center',
  'seller-website': '/seller/website',
  'seller-invoiceiq': '/seller/invoices',
  'seller-orders': '/seller/orders',
  'seller-products': '/seller/products',
  'seller-transactions': '/seller/transactions',
  'seller-reconciliation': '/finance/reconciliation',
  'seller-reports': '/seller/reports',
  'customer-discover': '/customer/discover',
  'customer-cart': '/customer/cart',
  'customer-3d-ar': '/customer/product/FAN-BLDC-892',
  'customer-orders': '/customer/orders',
  'customer-assistant': '/assistant',
  'platform-settings': '/settings',
};

const ProductRouteWrapper: React.FC<{
  customCatalog: Record<string, any>;
  onAddToCart: (product: any) => void;
  onBuyNow: (product: any) => void;
  onOpenQRModal: () => void;
  onOpenARModal: () => void;
  showToast: (msg: string) => void;
}> = ({ customCatalog, onAddToCart, onBuyNow, onOpenQRModal, onOpenARModal, showToast }) => {
  const { sku } = useParams<{ sku: string }>();
  const cleanSku = sku ? decodeURIComponent(sku).replace(/^#/, '') : 'FAN-BLDC-892';
  const product =
    (sku && customCatalog[sku]) ||
    customCatalog[cleanSku] ||
    customCatalog[`#${cleanSku}`] ||
    CATALOG_BY_SKU[cleanSku] ||
    CATALOG_BY_SKU[`#${cleanSku}`] ||
    null;

  return (
    <ProductDetailARScreen
      selectedProduct={product}
      notFoundSku={!product ? cleanSku : undefined}
      onAddToCart={onAddToCart}
      onBuyNow={onBuyNow}
      onOpenQRModal={onOpenQRModal}
      onOpenARModal={onOpenARModal}
      showToast={showToast}
    />
  );
};

const InvoiceRouteWrapper: React.FC<{
  basePath?: string;
  pathSuffix?: string;
  onOpenCopilot: (q?: string) => void;
  onOpenFeeAudit: () => void;
  showToast: (msg: string) => void;
  globalSearchQuery: string;
}> = ({
  basePath = '/seller/invoices',
  pathSuffix = '',
  onOpenCopilot,
  onOpenFeeAudit,
  showToast,
  globalSearchQuery,
}) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  return (
    <InvoiceIQScreen
      selectedInvoiceId={id}
      onSelectInvoiceId={(nextId) => navigate(`${basePath}/${nextId}${pathSuffix}`)}
      onOpenCopilot={onOpenCopilot}
      onOpenFeeAudit={onOpenFeeAudit}
      showToast={showToast}
      globalSearchQuery={globalSearchQuery}
    />
  );
};

const RoleHomeRedirect: React.FC = () => {
  const { profile } = useRole();
  return <Navigate to={profile.homeRoute} replace />;
};

const ROUTE_META: Array<{ match: (path: string) => boolean; title: string; description: string }> = [
  {
    match: (p) => p === '/login' || p === '/auth',
    title: 'Sign In — AC PayPilot',
    description: 'Sign in or explore Demo Mode for AC PayPilot Autonomous Commerce & Intelligent Escrow.',
  },
  {
    match: (p) => p.startsWith('/executive'),
    title: 'Executive Insights — AC PayPilot',
    description: 'Multi-store GMV telemetry, escrow hold health, and executive synthesis across PayPilot workspaces.',
  },
  {
    match: (p) => p.startsWith('/seller/command-center'),
    title: 'Seller Command Center — AC PayPilot',
    description: 'Interactive enterprise analytics, escrow pipeline controls, and settlement telemetry.',
  },
  {
    match: (p) => p.startsWith('/seller/products'),
    title: 'Listing Generator & 3D Studio — AC PayPilot',
    description: 'Create GST-compliant SKUs, upload .glb 3D assets, and generate truthful AI product listings.',
  },
  {
    match: (p) => p.startsWith('/seller/invoices') || p.startsWith('/finance/invoices') || p.includes('/invoice'),
    title: 'InvoiceIQ & GST Compliance — AC PayPilot',
    description: 'Automated GST invoice verification, HSN checks, and PayPal fee audit trails.',
  },
  {
    match: (p) => p.startsWith('/seller/dashboard'),
    title: 'Seller Dashboard — AC PayPilot',
    description: 'Live storefront GMV, escrow lifecycle monitoring, and order dispatch workspace.',
  },
  {
    match: (p) => p.startsWith('/finance'),
    title: 'Finance & Reconciliation — AC PayPilot',
    description: 'PayPal Sandbox settlement reconciliation, fee audits, and GST ledger controls.',
  },
  {
    match: (p) => p.startsWith('/customer/discover'),
    title: 'Discover 3D & Smart Hardware — AC PayPilot',
    description: 'Search energy-efficient hardware, filter by budget, and inspect products in 3D & AR.',
  },
  {
    match: (p) => p.startsWith('/customer/cart'),
    title: 'SmartCart & Budget Optimizer — AC PayPilot',
    description: 'Rank B2B cart priorities against your target budget and check out with PayPal Escrow.',
  },
  {
    match: (p) => p.startsWith('/customer/product/'),
    title: '3D & AR Product Inspector — AC PayPilot',
    description: 'Interactive glTF/WebXR product inspection, spec Q&A, and escrow-protected PayPal checkout.',
  },
  {
    match: (p) => p.startsWith('/customer/orders') || p.startsWith('/seller/orders'),
    title: 'Escrow Orders & Delivery — AC PayPilot',
    description: 'Track shipment milestones, inspect buyer delivery proofs, and manage escrow releases.',
  },
  {
    match: (p) => p.startsWith('/assistant'),
    title: 'Autonomous Copilot — AC PayPilot',
    description: 'Role-scoped conversational commerce assistant with verifiable store record citations.',
  },
];

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    role,
    setRole,
    dataSource,
    activeBizId,
    isAuthModalOpen,
    closeAuthModal,
    isProfileOnboardingPending,
    dismissProfileOnboarding,
  } = useRole();

  const [searchQuery, setSearchQuery] = useState('');
  const [customCatalog, setCustomCatalog] = useState<Record<string, any>>(CATALOG_BY_SKU);
  const [cartItems, setCartItems] = useState<SmartCartItem[]>(() =>
    loadInitialSmartCart(dataSource === 'live')
  );
  const [checkoutIntent, setCheckoutIntent] = useState<CheckoutIntent | null>(null);
  const [orders, setOrders] = useState<OrderRecord[]>(INITIAL_ORDER_RECORDS);
  const [liveStoreOrders, setLiveStoreOrders] = useState<StorefrontOrder[]>([]);
  const [copilotInitialQuery, setCopilotInitialQuery] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  useEffect(() => {
    persistSmartCart(cartItems);
  }, [cartItems]);

  useEffect(() => {
    const matched = ROUTE_META.find((r) => r.match(location.pathname));
    const title = matched?.title || 'AC PayPilot — Autonomous Commerce & Intelligent Escrow';
    const description =
      matched?.description ||
      'AI-native B2B commerce, 3D/AR spatial catalog, and PayPal escrow settlement workspace.';
    document.title = title;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute('content', description);
    }
  }, [location.pathname]);

  React.useEffect(() => {
    ensureDefaultStoreExists();
  }, []);

  React.useEffect(() => {
    const unsub = subscribeStoreOrders(activeBizId, (ords) => {
      setLiveStoreOrders(ords);
    });
    return () => unsub();
  }, [activeBizId]);

  const effectiveOrders = React.useMemo<OrderRecord[]>(() => {
    if (dataSource === 'live') {
      return liveStoreOrders.map((o) => {
        const firstItem = o.items?.[0] || { sku: 'ITEM-1', name: 'Storefront Product', quantity: 1 };
        const paymentState =
          o.escrowStatus === 'Delivered — Escrow Released'
            ? 'Captured'
            : o.escrowStatus === 'Disputed'
            ? 'Failed'
            : 'Authorized';

        return {
          id: o.orderNumber || o.id,
          invoiceId: `INV-${o.orderNumber || o.id}`,
          buyerName: o.customerName || 'Verified Buyer',
          buyerGstin: '29ABCDE1234F1Z5',
          productSku: firstItem.sku,
          productName: firstItem.name,
          qty: firstItem.quantity || 1,
          amount: o.total || 0,
          paymentState,
          date: o.createdAt ? new Date(o.createdAt).toISOString().split('T')[0] : '2026-10-27',
          trackingId: o.trackingId || `AWB-${o.orderNumber || o.id}`,
        };
      });
    }
    return orders;
  }, [dataSource, liveStoreOrders, orders]);

  // Determine if this is a customer visiting the public storefront
  const isPublicStorefront =
    location.pathname.startsWith('/s/') ||
    location.pathname.startsWith('/store/') ||
    (typeof window !== 'undefined' &&
      window.location.hostname.includes('.acpaypilot.app') &&
      !window.location.hostname.startsWith('www.'));

  if (isPublicStorefront) {
    const parts = location.pathname.split('/');
    let slug = 'aerocool';
    if (parts.length >= 3 && (parts[1] === 's' || parts[1] === 'store')) {
      slug = parts[2];
    } else if (typeof window !== 'undefined' && window.location.hostname.includes('.')) {
      const sub = window.location.hostname.split('.')[0];
      if (sub && sub !== 'www' && !sub.startsWith('ais-')) {
        slug = sub;
      }
    }
    return (
      <React.Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center bg-surface">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-on-surface-variant font-medium">Loading Storefront...</span>
            </div>
          </div>
        }
      >
        <PublicStorefrontApp slug={slug} />
      </React.Suspense>
    );
  }

  const activeModal = searchParams.get('modal');
  const highlightedOrderId = searchParams.get('highlight');

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  const openModalParam = useCallback(
    (modalName: 'copilot' | 'qr' | 'ar' | 'vr' | 'fee-audit' | 'checkout', extraQuery?: string) => {
      if (extraQuery) {
        setCopilotInitialQuery(extraQuery);
      }
      const next = new URLSearchParams(searchParams);
      next.set('modal', modalName);
      setSearchParams(next);
    },
    [searchParams, setSearchParams]
  );

  const closeModalParam = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('modal');
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  const handleNavigateScreen = useCallback(
    (screen: ScreenId) => {
      const target = SCREEN_ID_TO_PATH[screen] || '/executive';
      navigate(target);
    },
    [navigate]
  );

  const handleSelectPersona = useCallback(
    (persona: 'customer' | 'seller' | 'finance') => {
      const nextRole: UserRole = persona;
      setRole(nextRole);
      if (persona === 'customer') {
        navigate('/customer/discover');
        showToast('Switched to Customer Discovery & Spatial Catalog');
      } else if (persona === 'seller') {
        navigate('/seller/dashboard');
        showToast('Switched to Seller Operations Workspace');
      } else {
        navigate('/finance/ledger');
        showToast('Switched to Finance & Reconciliation Workspace');
      }
    },
    [navigate, setRole, showToast]
  );

  const handleAddToCart = useCallback(
    (product: any) => {
      const sku = product?.sku || '#FAN-BLDC-892';
      if (product?.sku) {
        setCustomCatalog((prev) => ({ ...prev, [product.sku]: product }));
      }
      setCartItems((prev) => {
        const cleanSku = String(sku).replace(/^#/, '');
        const existing = prev.find(
          (i) => i.sku === sku || i.sku.replace(/^#/, '') === cleanSku
        );
        if (existing) {
          return prev.map((i) =>
            i.sku === existing.sku ? { ...i, qty: i.qty + 1, selected: true } : i
          );
        }
        return [
          ...prev,
          {
            sku,
            name: product?.name || sku,
            category: product?.category || 'Hardware',
            hsCode: product?.hsCode || '8414.51.10',
            unitPrice: Number(product?.price) || 8499,
            qty: 1,
            selected: true,
            img:
              product?.img ||
              'https://images.unsplash.com/photo-1591799264318-7e6ef8ddb7ea?w=400&auto=format&fit=crop&q=80',
          },
        ];
      });
      showToast(`Added ${product?.name || 'item'} to SmartCart`);
      navigate('/customer/cart');
    },
    [navigate, showToast]
  );

  const handleSelectProduct = useCallback(
    (product: any) => {
      const sku = product?.sku || 'AC-WRK-8990';
      setCustomCatalog((prev) => ({ ...prev, [sku]: { ...prev[sku], ...product, sku } }));
      navigate(`/customer/product/${encodeURIComponent(sku)}`);
    },
    [navigate]
  );

  const handleBuyNow = useCallback(
    (product?: any) => {
      if (product?.sku) {
        setCustomCatalog((prev) => ({ ...prev, [product.sku]: product }));
        setCheckoutIntent({
          items: [
            {
              sku: product.sku,
              name: product.name,
              quantity: 1,
              unitPrice: Number(product.price) || undefined,
            },
          ],
          currency: 'USD',
          mode: 'buy_now',
        });
      } else {
        setCheckoutIntent(null);
      }
      openModalParam('checkout');
    },
    [openModalParam]
  );

  const handleCheckoutSuccess = useCallback(() => {
    const newOrderId = `#PP-${Math.floor(9822 + orders.length)}`;
    const newInvoiceId = `INV-2026-0${90 + orders.length}`;
    const firstIntentItem = checkoutIntent?.items?.[0];
    const newOrder: OrderRecord = {
      id: newOrderId,
      invoiceId: newInvoiceId,
      buyerName: 'Verified Customer',
      buyerGstin: '27AABCU9603R1ZM',
      productSku: firstIntentItem?.sku || 'FAN-BLDC-892',
      productName: firstIntentItem?.name || 'Smart Hardware Bundle',
      qty: firstIntentItem?.quantity || 1,
      amount: (firstIntentItem?.unitPrice || 8499) * (firstIntentItem?.quantity || 1),
      paymentState: 'Captured',
      date: 'Just now',
      trackingId: 'ESCROW-LOCKED-NEW',
    };
    setOrders((prev) => [newOrder, ...prev]);
    if (checkoutIntent?.mode === 'cart') {
      setCartItems((prev) => prev.filter((item) => !item.selected));
    }
    setCheckoutIntent(null);
    emitOrderPlacedNotification({
      id: newOrderId,
      bizId: DEFAULT_BIZ_ID,
      orderNumber: newOrderId,
      customerName: newOrder.buyerName,
      productSummary: newOrder.productName,
      totalInr: newOrder.amount,
      escrowStatus: 'Escrow Locked',
      createdAt: new Date().toISOString(),
    });
    const next = new URLSearchParams();
    next.set('highlight', newOrderId);
    navigate({
      pathname: '/customer/orders',
      search: `?${next.toString()}`,
    });
    showToast(`PayPal Escrow Authorized (${newOrderId}) — Redirected to Orders`);
  }, [checkoutIntent, navigate, orders.length, showToast]);

  const handleUpdateOrderState = useCallback(
    (orderId: string, nextState: CanonicalPaymentState) => {
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, paymentState: nextState } : o))
      );
      showToast(`Order ${orderId} updated to ${nextState}`);
    },
    [showToast]
  );

  return (
    <div className="min-h-screen flex flex-col bg-surface text-on-surface font-body selection:bg-primary-fixed selection:text-on-primary-fixed overflow-x-clip">
      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenCopilot={(q) => openModalParam('copilot', q)}
        onOpenOnboarding={() => setIsOnboardingOpen(true)}
        catalog={mockCatalogProducts}
        invoices={mockInvoices}
        transactions={mockTransactions}
        orders={mockOrders}
        activeCartCount={cartItems.reduce((sum, item) => sum + (item.selected ? item.qty : 0), 0)}
      />

      <div className="flex flex-1 min-h-0 items-start">
        <Sidebar onOpenCopilot={(q) => openModalParam('copilot', q)} />

        <main className="flex-1 min-w-0">
          <div className="p-3 sm:p-4 md:p-5 max-w-[1600px] mx-auto">
            <ScreenDataSourceBanner />
            <React.Suspense
              fallback={
                <div className="flex items-center justify-center py-24">
                  <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              }
            >
            <Routes>
            <Route path="/" element={<RoleHomeRedirect />} />
            <Route path="/login" element={<LoginScreen />} />
            <Route path="/auth" element={<LoginScreen />} />

            <Route
              path="/executive"
              element={
                <RoleRouteGuard allowedRoles={['business_head']}>
                  <ExecutiveScreen
                    onSelectPersona={handleSelectPersona}
                    onNavigate={handleNavigateScreen}
                  />
                </RoleRouteGuard>
              }
            />

            {/* Seller Routes */}
            <Route
              path="/seller/dashboard"
              element={
                <RoleRouteGuard allowedRoles={['seller', 'business_head']}>
                  <DashboardScreen
                    onOpenCopilot={(q) => openModalParam('copilot', q)}
                    onOpenFeeAudit={() => openModalParam('fee-audit')}
                    onNavigateInvoice={(invId) =>
                      navigate(invId ? `/seller/invoices/${invId}` : '/seller/invoices')
                    }
                    onNavigateWebsite={() => navigate('/seller/website')}
                    showToast={showToast}
                  />
                </RoleRouteGuard>
              }
            />

            {/* Seller Command Center (AG Studio Enterprise) */}
            <Route
              path="/seller/command-center"
              element={
                <RoleRouteGuard allowedRoles={['seller', 'business_head', 'finance']}>
                  <SellerCommandCenterScreen showToast={showToast} />
                </RoleRouteGuard>
              }
            />

            {/* My Website - Storefront Studio */}
            <Route
              path="/seller/website"
              element={
                <RoleRouteGuard allowedRoles={['seller', 'business_head']}>
                  <StorefrontBuilderScreen bizId={activeBizId} showToast={showToast} />
                </RoleRouteGuard>
              }
            />
            <Route path="/website" element={<Navigate to="/seller/website" replace />} />
            <Route path="/onboarding" element={<Navigate to="/seller/website" replace />} />

            <Route
              path="/seller/products"
              element={
                <RoleRouteGuard allowedRoles={['seller', 'business_head']}>
                  <ListingGeneratorScreen
                    onPreviewCustomer={(product) => handleSelectProduct(product)}
                    showToast={showToast}
                  />
                </RoleRouteGuard>
              }
            />

            <Route
              path="/seller/ai-studio"
              element={
                <RoleRouteGuard allowedRoles={['seller', 'business_head', 'finance']}>
                  <CreativeStudioScreen portalMode="seller" showToast={showToast} />
                </RoleRouteGuard>
              }
            />

            <Route
              path="/seller/orders"
              element={
                <RoleRouteGuard allowedRoles={['seller', 'business_head']}>
                  <OrdersScreen
                    mode="seller"
                    orders={effectiveOrders}
                    highlightedOrderId={highlightedOrderId}
                    onUpdateOrderState={handleUpdateOrderState}
                    onOpenInvoice={(invId) => navigate(`/seller/invoices/${invId}`)}
                    onOpenProduct={(sku) => navigate(`/customer/product/${sku}`)}
                    showToast={showToast}
                    globalSearchQuery={searchQuery}
                  />
                </RoleRouteGuard>
              }
            />

            <Route
              path="/seller/customers"
              element={
                <RoleRouteGuard allowedRoles={['seller', 'business_head']}>
                  <CustomersScreen showToast={showToast} />
                </RoleRouteGuard>
              }
            />

            <Route
              path="/seller/invoices"
              element={
                <RoleRouteGuard allowedRoles={['seller', 'finance', 'business_head']}>
                  <InvoiceIQScreen
                    onSelectInvoiceId={(id) => navigate(`/seller/invoices/${id}`)}
                    onOpenCopilot={(q) => openModalParam('copilot', q)}
                    onOpenFeeAudit={() => openModalParam('fee-audit')}
                    showToast={showToast}
                    globalSearchQuery={searchQuery}
                  />
                </RoleRouteGuard>
              }
            />

            <Route
              path="/seller/invoices/:id"
              element={
                <RoleRouteGuard allowedRoles={['seller', 'finance', 'business_head']}>
                  <InvoiceRouteWrapper
                    basePath="/seller/invoices"
                    onOpenCopilot={(q) => openModalParam('copilot', q)}
                    onOpenFeeAudit={() => openModalParam('fee-audit')}
                    showToast={showToast}
                    globalSearchQuery={searchQuery}
                  />
                </RoleRouteGuard>
              }
            />

            <Route
              path="/seller/transactions"
              element={
                <RoleRouteGuard allowedRoles={['seller', 'finance', 'business_head']}>
                  <TransactionsScreen
                    onOpenFeeAudit={() => openModalParam('fee-audit')}
                    onOpenInvoice={(invId) => navigate(`/seller/invoices/${invId}`)}
                    showToast={showToast}
                    globalSearchQuery={searchQuery}
                  />
                </RoleRouteGuard>
              }
            />

            <Route
              path="/seller/reports"
              element={
                <RoleRouteGuard allowedRoles={['seller', 'finance', 'business_head']}>
                  <FinancialReportsScreen showToast={showToast} />
                </RoleRouteGuard>
              }
            />

            {/* Finance Dedicated Workspace Routes */}
            <Route
              path="/finance/ledger"
              element={
                <RoleRouteGuard allowedRoles={['finance', 'business_head']}>
                  <TransactionsScreen
                    onOpenFeeAudit={() => openModalParam('fee-audit')}
                    onOpenInvoice={(invId) => navigate(`/finance/invoices/${invId}`)}
                    showToast={showToast}
                    globalSearchQuery={searchQuery}
                  />
                </RoleRouteGuard>
              }
            />

            <Route
              path="/finance/invoices"
              element={
                <RoleRouteGuard allowedRoles={['finance', 'seller', 'business_head']}>
                  <InvoiceIQScreen
                    onSelectInvoiceId={(id) => navigate(`/finance/invoices/${id}`)}
                    onOpenCopilot={(q) => openModalParam('copilot', q)}
                    onOpenFeeAudit={() => openModalParam('fee-audit')}
                    showToast={showToast}
                    globalSearchQuery={searchQuery}
                  />
                </RoleRouteGuard>
              }
            />

            <Route
              path="/finance/invoices/:id"
              element={
                <RoleRouteGuard allowedRoles={['finance', 'seller', 'business_head']}>
                  <InvoiceRouteWrapper
                    basePath="/finance/invoices"
                    onOpenCopilot={(q) => openModalParam('copilot', q)}
                    onOpenFeeAudit={() => openModalParam('fee-audit')}
                    showToast={showToast}
                    globalSearchQuery={searchQuery}
                  />
                </RoleRouteGuard>
              }
            />

            <Route
              path="/finance/reconciliation"
              element={
                <RoleRouteGuard allowedRoles={['finance', 'business_head']}>
                  <ReconciliationScreen
                    onOpenInvoice={(invId) => navigate(`/finance/invoices/${invId}`)}
                    onOpenFeeAudit={() => openModalParam('fee-audit')}
                    showToast={showToast}
                  />
                </RoleRouteGuard>
              }
            />

            <Route
              path="/finance/reports"
              element={
                <RoleRouteGuard allowedRoles={['finance', 'seller', 'business_head']}>
                  <FinancialReportsScreen showToast={showToast} />
                </RoleRouteGuard>
              }
            />

            {/* Customer Routes */}
            <Route
              path="/customer/discover"
              element={
                <RoleRouteGuard allowedRoles={['customer', 'business_head']}>
                  <DiscoveryScreen
                    onOpenCopilot={(q) => openModalParam('copilot', q)}
                    onAddToCart={handleAddToCart}
                    onOpenAR={(product) => handleSelectProduct(product)}
                    onSelectProduct={(product) => handleSelectProduct(product)}
                    showToast={showToast}
                    globalSearchQuery={searchQuery}
                  />
                </RoleRouteGuard>
              }
            />

            <Route
              path="/customer/cart"
              element={
                <RoleRouteGuard allowedRoles={['customer', 'business_head']}>
                  <SmartCartScreen
                    items={cartItems}
                    onUpdateItems={setCartItems}
                    onOpenCheckout={() => openModalParam('checkout')}
                    onStartCheckout={(active) => {
                      setCheckoutIntent({
                        items: active.map((i) => ({
                          sku: i.sku,
                          name: i.name,
                          quantity: i.qty,
                          unitPrice: i.unitPrice,
                        })),
                        currency: 'USD',
                        mode: 'cart',
                      });
                      openModalParam('checkout');
                    }}
                    onOpenCopilot={(query) => {
                      if (query) {
                        setCopilotInitialQuery(query);
                      }
                      openModalParam('copilot', query);
                    }}
                    onSelectProduct={(product) => handleSelectProduct(product)}
                    showToast={showToast}
                  />
                </RoleRouteGuard>
              }
            />

            <Route
              path="/customer/product/:sku"
              element={
                <RoleRouteGuard allowedRoles={['customer', 'seller', 'business_head']}>
                  <ProductRouteWrapper
                    customCatalog={customCatalog}
                    onAddToCart={handleAddToCart}
                    onBuyNow={handleBuyNow}
                    onOpenQRModal={() => openModalParam('qr')}
                    onOpenARModal={() => openModalParam('ar')}
                    showToast={showToast}
                  />
                </RoleRouteGuard>
              }
            />

            <Route
              path="/customer/ai-studio"
              element={
                <RoleRouteGuard allowedRoles={['customer', 'seller', 'business_head']}>
                  <CreativeStudioScreen portalMode="customer" showToast={showToast} />
                </RoleRouteGuard>
              }
            />

            <Route
              path="/customer/orders"
              element={
                <RoleRouteGuard allowedRoles={['customer', 'business_head']}>
                  <OrdersScreen
                    mode="customer"
                    orders={effectiveOrders}
                    highlightedOrderId={highlightedOrderId}
                    onUpdateOrderState={handleUpdateOrderState}
                    onOpenInvoice={(invId) => navigate(`/customer/orders/${invId}/invoice`)}
                    onOpenProduct={(sku) => navigate(`/customer/product/${sku}`)}
                    onOpenCheckout={() => openModalParam('checkout')}
                    showToast={showToast}
                    globalSearchQuery={searchQuery}
                  />
                </RoleRouteGuard>
              }
            />

            <Route
              path="/customer/orders/:id/invoice"
              element={
                <RoleRouteGuard allowedRoles={['customer', 'business_head']}>
                  <InvoiceRouteWrapper
                    basePath="/customer/orders"
                    pathSuffix="/invoice"
                    onOpenCopilot={(q) => openModalParam('copilot', q)}
                    onOpenFeeAudit={() => openModalParam('fee-audit')}
                    showToast={showToast}
                    globalSearchQuery={searchQuery}
                  />
                </RoleRouteGuard>
              }
            />

            {/* Full-Page Assistant Route */}
            <Route
              path="/assistant"
              element={
                <RoleRouteGuard allowedRoles={['customer', 'seller', 'finance', 'business_head']}>
                  <AssistantScreen
                    initialQuery={copilotInitialQuery}
                    onConsumeInitialQuery={() => setCopilotInitialQuery('')}
                    onNavigateProduct={(sku) => navigate(`/customer/product/${sku}`)}
                    onNavigateCart={() => navigate('/customer/cart')}
                    onNavigateInvoice={(invId) =>
                      navigate(
                        role === 'customer'
                          ? `/customer/orders/${invId}/invoice`
                          : `/seller/invoices/${invId}`
                      )
                    }
                    onOpenCheckout={() => openModalParam('checkout')}
                    showToast={showToast}
                  />
                </RoleRouteGuard>
              }
            />

            {/* Platform Settings Route */}
            <Route
              path="/settings"
              element={
                <RoleRouteGuard allowedRoles={['customer', 'seller', 'finance', 'business_head']}>
                  <SettingsScreen />
                </RoleRouteGuard>
              }
            />

            {/* Diagnostic & System Health Check Route */}
            <Route
              path="/health"
              element={
                <RoleRouteGuard allowedRoles={['seller', 'finance', 'business_head']}>
                  <HealthScreen />
                </RoleRouteGuard>
              }
            />

            {/* PayPal Return & Cancel Callback Routes */}
            <Route path="/checkout/success" element={<CheckoutResultScreen status="success" />} />
            <Route path="/checkout/cancel" element={<CheckoutResultScreen status="cancel" />} />

            {/* Standalone Authentication & Onboarding Routes */}
            <Route path="/login" element={<LoginScreen />} />
            <Route path="/auth" element={<LoginScreen />} />

            {/* 404 Catch-all Route */}
            <Route path="*" element={<NotFoundScreen />} />
          </Routes>
            </React.Suspense>
          </div>
        </main>
      </div>

      {/* URL-Synced Modals (?modal=copilot|fee-audit|checkout|qr|ar) */}
      <React.Suspense fallback={null}>
      <CopilotModal
        isOpen={activeModal === 'copilot'}
        onClose={closeModalParam}
        initialQuery={copilotInitialQuery}
        onConsumeInitialQuery={() => setCopilotInitialQuery('')}
      />

      <FeeAuditModal
        isOpen={activeModal === 'fee-audit'}
        onClose={closeModalParam}
        orderId="#PP-9821"
        customerName="Apex Studio Pvt Ltd"
        grossAmount={292000}
        feeAmount={5168}
        tierInfo="Enterprise B2B Escrow (1.5% + 18% GST)"
      />

      <PayPalCheckoutModal
        isOpen={activeModal === 'checkout'}
        onClose={() => {
          setCheckoutIntent(null);
          closeModalParam();
        }}
        onSuccess={handleCheckoutSuccess}
        checkoutIntent={checkoutIntent}
        onSimulateRedirectReturn={() =>
          navigate('/checkout/success?token=PP-TX-94821-SB&orderId=%23PP-9822')
        }
        onSimulateRedirectCancel={() => navigate('/checkout/cancel?reason=user_aborted')}
      />

      {(() => {
        const pathMatch = location.pathname.match(/\/customer\/product\/([^/]+)/);
        const routeSku = pathMatch ? decodeURIComponent(pathMatch[1]).replace(/^#/, '') : 'FAN-BLDC-892';
        const activeProd =
          customCatalog[routeSku] ||
          customCatalog[`#${routeSku}`] ||
          CATALOG_BY_SKU[routeSku] ||
          CATALOG_BY_SKU['FAN-BLDC-892'];

        return (
          <>
            <QRModal
              isOpen={activeModal === 'qr'}
              onClose={closeModalParam}
              title="Quick Scan to AR — Mobile Spatial View"
              subtitle={`Open your phone camera to place ${activeProd?.name || 'the 1200mm AeroBreeze ceiling fan'} (${activeProd?.dimensions || 'True Scale'}) in your room at true scale.`}
            />
            <ARPreviewModal
              isOpen={activeModal === 'ar' || activeModal === 'vr'}
              initialVrMode={activeModal === 'vr'}
              onClose={closeModalParam}
              productName={activeProd?.name || 'AeroBreeze Stealth 1200mm Smart BLDC Ceiling Fan'}
              productSku={activeProd?.sku || routeSku}
              price={activeProd?.price || 8499}
              onReservePayPal={() => {
                closeModalParam();
                handleAddToCart(activeProd);
              }}
            />
          </>
        );
      })()}

      {/* Onboarding Wizard Modal */}
      <OnboardingWizard
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        onComplete={(newBiz) => {
          setIsOnboardingOpen(false);
          showToast(`Storefront auto-generated for ${newBiz.name}!`);
          navigate('/seller/website');
        }}
      />

      {/* Universal Multi-Provider Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={closeAuthModal}
        showToast={showToast}
      />

      {/* Mandatory First-Time Profile Onboarding Modal */}
      <ProfileOnboardingModal
        isOpen={isProfileOnboardingPending}
        onClose={dismissProfileOnboarding}
        showToast={showToast}
      />

      </React.Suspense>

      {/* Global Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-inverse-surface text-inverse-on-surface px-5 py-3 rounded-xl shadow-xl flex items-center gap-3 transition-all duration-300"
        >
          <span className="material-symbols-outlined text-emerald-400 text-[20px]">
            check_circle
          </span>
          <span className="font-label-md text-sm font-medium">{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
