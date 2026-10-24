import React, { useState, useCallback } from 'react';
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
import { DashboardScreen } from './components/screens/DashboardScreen';
import { DiscoveryScreen } from './components/screens/DiscoveryScreen';
import { SmartCartScreen } from './components/screens/SmartCartScreen';
import { InvoiceIQScreen } from './components/screens/InvoiceIQScreen';
import { ListingGeneratorScreen } from './components/screens/ListingGeneratorScreen';
import { ProductDetailARScreen } from './components/screens/ProductDetailARScreen';
import { ExecutiveScreen } from './components/screens/ExecutiveScreen';
import { TransactionsScreen } from './components/screens/TransactionsScreen';
import { ReconciliationScreen } from './components/screens/ReconciliationScreen';
import { FinancialReportsScreen } from './components/screens/FinancialReportsScreen';
import { SettingsScreen } from './components/screens/SettingsScreen';
import { OrdersScreen, OrderRecord } from './components/screens/OrdersScreen';
import { AssistantScreen } from './components/screens/AssistantScreen';
import { CheckoutResultScreen, NotFoundScreen } from './components/screens/CheckoutResultScreen';
import { HealthScreen } from './components/screens/HealthScreen';
import { StorefrontBuilderScreen } from './components/screens/StorefrontBuilderScreen';
import { PublicStorefrontApp } from './components/storefront/PublicStorefrontApp';
import { OnboardingWizard } from './components/onboarding/OnboardingWizard';
import { ensureDefaultStoreExists } from './services/storefrontService';
import { CopilotModal } from './components/modals/CopilotModal';
import { FeeAuditModal } from './components/modals/FeeAuditModal';
import { PayPalCheckoutModal } from './components/modals/PayPalCheckoutModal';
import { QRModal } from './components/modals/QRModal';
import { ARPreviewModal } from './components/modals/ARPreviewModal';
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
      'Main 3D/AR demo SKU: 28W BLDC motor cuts energy draw by 65% vs 75W induction fans with 1200mm room air throw.',
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
      'Main 3D/AR demo SKU: 28W BLDC motor cuts energy draw by 65% vs 75W induction fans with 1200mm room air throw.',
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
      'Secondary 3D/AR demo SKU: Rotational Generator System distributes weight across grip, frame top, and T-joint.',
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
      'Secondary 3D/AR demo SKU: Rotational Generator System distributes weight across grip, frame top, and T-joint.',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDURq8df1AvNhd6BXPOnLSDepBVFAZQQdhN7XCJzqUwmcV79SqYGalleVqm5XyenVa4nFesHY7jCNLROrqBHlgtE92aPFjCmcNoiYuJEPzJjul5AYdnnHkeKQevXmwyO8xozEtp1qExjA6sfd8tRUMhTAaE5rLBnqslJx9r-5JgtL82V5kmTgx9bt5QmOiAjh1sa5vjPP7EB5WSaeKeMK9zuVgCH8RJFezfeBmyvYUJuYqroAVrKuYT6A',
  },
  'AUD-ANC-99': {
    sku: '#AUD-ANC-99',
    name: 'AcousticSphere ANC Pods (No .glb Model Demo)',
    price: 11499,
    mrp: 14999,
    gstRate: 18,
    hsCode: '8518.30.00',
    category: 'Spatial Audio Nodes',
    stock: 45,
    modelUrl: null,
    specs: ['Lossless LDAC', 'Spatial Audio'],
    dimensions: 'Not provided',
    weight: 'Not provided',
    warranty: 'Not provided',
    aiMatchScore: 88,
    aiReason:
      'No .glb file uploaded for this SKU — demonstrates honest "3D model unavailable" + 2D image gallery fallback.',
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
    CATALOG_BY_SKU['FAN-BLDC-892'];

  return (
    <ProductDetailARScreen
      selectedProduct={product}
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
  onOpenCopilot: (q?: string) => void;
  onOpenFeeAudit: () => void;
  showToast: (msg: string) => void;
  globalSearchQuery: string;
}> = ({
  basePath = '/seller/invoices',
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
      onSelectInvoiceId={(nextId) => navigate(`${basePath}/${nextId}`)}
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

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { setRole } = useRole();

  const [searchQuery, setSearchQuery] = useState('');
  const [customCatalog, setCustomCatalog] = useState<Record<string, any>>(CATALOG_BY_SKU);
  const [orders, setOrders] = useState<OrderRecord[]>(INITIAL_ORDER_RECORDS);
  const [copilotInitialQuery, setCopilotInitialQuery] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  React.useEffect(() => {
    ensureDefaultStoreExists();
  }, []);

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
    return <PublicStorefrontApp slug={slug} />;
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
      if (product?.sku) {
        setCustomCatalog((prev) => ({ ...prev, [product.sku]: product }));
      }
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
      }
      openModalParam('checkout');
    },
    [openModalParam]
  );

  const handleCheckoutSuccess = useCallback(() => {
    const newOrderId = `#PP-${Math.floor(9822 + orders.length)}`;
    const newInvoiceId = `INV-2026-0${90 + orders.length}`;
    const newOrder: OrderRecord = {
      id: newOrderId,
      invoiceId: newInvoiceId,
      buyerName: 'Priya Patel (Apex Cloud Labs)',
      buyerGstin: '27AABCU9603R1ZM',
      productSku: 'AC-WRK-8990',
      productName: 'ProArt Studio Workstation X1 + Display Bundle',
      qty: 1,
      amount: 421500,
      paymentState: 'Authorized',
      date: 'Just now',
      trackingId: 'ESCROW-LOCKED-NEW',
    };
    setOrders((prev) => [newOrder, ...prev]);
    const next = new URLSearchParams();
    next.set('highlight', newOrderId);
    navigate({
      pathname: '/customer/orders',
      search: `?${next.toString()}`,
    });
    showToast(`PayPal Escrow Authorized (${newOrderId}) — Redirected to Orders`);
  }, [navigate, orders.length, showToast]);

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
    <div className="min-h-screen bg-surface text-on-surface font-body selection:bg-primary-fixed selection:text-on-primary-fixed">
      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenCopilot={(q) => openModalParam('copilot', q)}
        onOpenOnboarding={() => setIsOnboardingOpen(true)}
        catalog={mockCatalogProducts}
        invoices={mockInvoices}
        transactions={mockTransactions}
        orders={mockOrders}
      />

      <Sidebar onOpenCopilot={(q) => openModalParam('copilot', q)} />

      <main className="md:pl-64 pt-28 md:pt-16 min-h-screen">
        <div className="p-4 sm:p-6 md:p-8 max-w-[1600px] mx-auto">
          <ScreenDataSourceBanner />
          <Routes>
            <Route path="/" element={<RoleHomeRedirect />} />

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

            {/* My Website - Storefront Studio */}
            <Route
              path="/seller/website"
              element={
                <RoleRouteGuard allowedRoles={['seller', 'business_head']}>
                  <StorefrontBuilderScreen showToast={showToast} />
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
              path="/seller/orders"
              element={
                <RoleRouteGuard allowedRoles={['seller', 'business_head']}>
                  <OrdersScreen
                    mode="seller"
                    orders={orders}
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
                    onOpenCheckout={() => openModalParam('checkout')}
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
              path="/customer/orders"
              element={
                <RoleRouteGuard allowedRoles={['customer', 'business_head']}>
                  <OrdersScreen
                    mode="customer"
                    orders={orders}
                    highlightedOrderId={highlightedOrderId}
                    onUpdateOrderState={handleUpdateOrderState}
                    onOpenInvoice={(invId) => navigate(`/seller/invoices/${invId}`)}
                    onOpenProduct={(sku) => navigate(`/customer/product/${sku}`)}
                    onOpenCheckout={() => openModalParam('checkout')}
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
                    onNavigateInvoice={(invId) => navigate(`/seller/invoices/${invId}`)}
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

            {/* 404 Catch-all Route */}
            <Route path="*" element={<NotFoundScreen />} />
          </Routes>
        </div>
      </main>

      {/* URL-Synced Modals (?modal=copilot|fee-audit|checkout|qr|ar) */}
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
        onClose={closeModalParam}
        onSuccess={handleCheckoutSuccess}
        onSimulateRedirectReturn={() =>
          navigate('/checkout/success?token=PP-TX-94821-SB&orderId=%23PP-9822')
        }
        onSimulateRedirectCancel={() => navigate('/checkout/cancel?reason=user_aborted')}
      />

      <QRModal isOpen={activeModal === 'qr'} onClose={closeModalParam} />

      {(() => {
        const pathMatch = location.pathname.match(/\/customer\/product\/([^/]+)/);
        const routeSku = pathMatch ? decodeURIComponent(pathMatch[1]).replace(/^#/, '') : 'FAN-BLDC-892';
        const activeProd =
          customCatalog[routeSku] ||
          customCatalog[`#${routeSku}`] ||
          CATALOG_BY_SKU[routeSku] ||
          CATALOG_BY_SKU['FAN-BLDC-892'];

        return (
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

      {/* Global Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-inverse-surface text-inverse-on-surface px-5 py-3 rounded-xl shadow-xl flex items-center gap-3 animate-bounce"
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
