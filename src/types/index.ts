export type UserRole = 'customer' | 'seller' | 'finance' | 'business_head';

// Alias kept for backward compatibility with existing props
export type PersonaMode = UserRole;

export type DataSource = 'demo' | 'live';

export type AppRoute =
  | '/'
  | '/seller/dashboard'
  | '/seller/website'
  | '/website'
  | '/seller/products'
  | '/seller/orders'
  | '/seller/invoices'
  | `/seller/invoices/${string}`
  | '/seller/transactions'
  | '/seller/reconciliation'
  | '/seller/reports'
  | '/finance/ledger'
  | '/finance/invoices'
  | `/finance/invoices/${string}`
  | '/finance/reconciliation'
  | '/finance/reports'
  | '/customer/discover'
  | '/customer/cart'
  | `/customer/product/${string}`
  | '/customer/orders'
  | '/assistant'
  | '/executive'
  | '/settings'
  | '/checkout/success'
  | '/checkout/cancel'
  | `/s/${string}`;

export type ScreenId =
  | 'seller-dashboard'
  | 'seller-website'
  | 'seller-products'
  | 'seller-orders'
  | 'seller-invoiceiq'
  | 'seller-transactions'
  | 'seller-reconciliation'
  | 'seller-reports'
  | 'customer-discover'
  | 'customer-cart'
  | 'customer-3d-ar'
  | 'customer-orders'
  | 'customer-assistant'
  | 'executive-insights'
  | 'platform-settings';

export interface InvoiceLineItem {
  id: string;
  sku: string;
  hsn: string;
  name: string;
  quantity: number;
  unitRate: number;
  gstRatePercent: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  clientName: string;
  clientGstin: string;
  clientAddress: string;
  clientContact: string;
  clientType: 'B2B Bangalore' | 'B2B Hyderabad' | 'Cross-border USD' | 'Settled via Escrow' | string;
  issueDate: string;
  dueDate: string;
  placeOfSupply: string;
  status: 'paid' | 'unpaid' | 'overdue' | 'draft';
  overdueDays?: number;
  dueInDays?: number;
  paidDate?: string;
  riskScore: number;
  riskTier: 'Low Risk' | 'Med Risk' | 'High Risk';
  txRef: string;
  autoChaseStatus: string;
  items: InvoiceLineItem[];
  paymentMode: string;
}

export interface PurchaseItem {
  id: string;
  rank: number;
  name: string;
  sku: string;
  category: string;
  specs: string;
  price: number;
  gstPercent: number;
  image: string;
  priorityScore: number;
  tag: string;
  tagColor: string;
  aiRationaleHeader: string;
  aiRationaleText: string;
  isDeferred: boolean;
  deferNote?: string;
}

export interface RecentTransaction {
  id: string;
  orderId: string;
  customerName: string;
  customerEmail: string;
  grossAmount: number;
  feeAmount: number;
  feeFormula: string;
  status: 'Completed' | 'Pending Clearing' | 'Refunded';
  timestamp: string;
  disputeNote?: string;
  tierInfo: string;
}

export interface CatalogProduct {
  id: string;
  name: string;
  sku: string;
  price: number;
  originalPrice: number;
  discountPercent: number;
  stock: number;
  category: string;
  rating: number;
  reviewCount: number;
  image: string;
  status: 'AR Ready' | 'Processing 3D' | 'Needs Photos' | 'Stock Alert';
  revenue30d: number;
  tags: string[];
  specs: {
    power?: string;
    airDelivery?: string;
    bladeSweep?: string;
    warranty?: string;
    noise?: string;
    soundSignature?: string;
  };
}

export interface ExecutiveCategoryYield {
  category: string;
  flagship: string;
  icon: string;
  gmvLakhs: number;
  gmvPercent: number;
  marginPercent: number;
  returnRatePercent: number;
  arMultiplier: string;
}

export interface OrderItem {
  sku: string;
  name: string;
  quantity: number;
  price: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  buyerName: string;
  buyerEmail: string;
  shippingAddress: string;
  orderDate: string;
  totalAmount: number;
  escrowFee: number;
  escrowStatus: 'Escrow Locked' | 'In Transit' | 'Delivered — Escrow Released' | 'Dispute Inquiry';
  txRef: string;
  trackingId: string;
  carrier: string;
  items: OrderItem[];
}
