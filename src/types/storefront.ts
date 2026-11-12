export type StorefrontTemplateId =
  | 'minimal'
  | 'boutique'
  | 'electronics'
  | 'grocery'
  | 'fashion'
  | 'bold_dark';

export type FontPairId =
  | 'inter-sans'
  | 'playfair-sans'
  | 'space-grotesk'
  | 'dm-sans'
  | 'cinzel-lato'
  | 'plus-jakarta';

export type ButtonStyle = 'rounded' | 'sharp' | 'pill';
export type CornerRadius = 'none' | 'sm' | 'md' | 'lg' | 'full';
export type HeroStyle = 'banner' | 'video' | 'slider' | 'split';

export type SectionType =
  | 'hero'
  | 'featured'
  | 'categories'
  | 'offers'
  | 'reviews'
  | 'about'
  | 'faq'
  | 'contact';

export interface BusinessContact {
  email: string;
  phone: string;
  address: string;
  whatsappNumber?: string;
}

export interface BusinessProfile {
  id: string; // bizId
  ownerUid: string;
  name: string;
  slug: string;
  category: string;
  tagline: string;
  logoUrl: string;
  contact: BusinessContact;
  currency: 'INR' | 'USD' | 'EUR' | 'GBP';
  taxGstNumber?: string;
  paypalConnected: boolean;
  paypalEmail?: string;
  paypalClientId?: string;
  shippingPolicy: string;
  returnPolicy: string;
  createdAt: string;
  updatedAt: string;
  roleMembers?: Record<string, 'owner' | 'staff'>;
}

export interface StorefrontTheme {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  surfaceColor: string;
  fontPair: FontPairId;
  buttonStyle: ButtonStyle;
  cornerRadius: CornerRadius;
  heroStyle: HeroStyle;
}

export interface AnnouncementBarConfig {
  enabled: boolean;
  text: string;
  link?: string;
  bgColor: string;
  textColor: string;
}

export interface HeroConfig {
  headline: string;
  subheadline: string;
  ctaText: string;
  ctaLink: string;
  badgeText: string;
  bgImageUrl: string;
  secondaryImageUrl?: string;
}

export interface AboutSectionConfig {
  title: string;
  story: string;
  mission: string;
  foundedYear: string;
  imageUrl: string;
}

export interface FooterConfig {
  bio: string;
  quickLinks: { label: string; href: string }[];
  socialLinks: {
    instagram?: string;
    twitter?: string;
    facebook?: string;
    linkedin?: string;
  };
  copyright: string;
}

export interface WhatsAppConfig {
  enabled: boolean;
  phoneNumber: string;
  defaultMessage: string;
  botEnabled?: boolean;
  botMode?: 'ai_recommender' | 'escrow_tracking' | 'support_b2b';
  welcomeMessage?: string;
  quickActionChips?: string[];
}

export interface SeoConfig {
  title: string;
  description: string;
  keywords: string;
  ogImage: string;
}

export interface CustomDomainConfig {
  domain: string;
  status: 'pending' | 'verified' | 'ssl_issued';
  cnameTarget: string;
  aRecordIp: string;
  verifiedAt?: string;
}

export interface StorefrontConfig {
  bizId: string;
  templateId: StorefrontTemplateId;
  theme: StorefrontTheme;
  sectionsOrder: SectionType[];
  announcementBar: AnnouncementBarConfig;
  hero: HeroConfig;
  about: AboutSectionConfig;
  footer: FooterConfig;
  whatsapp: WhatsAppConfig;
  seo: SeoConfig;
  customDomain?: CustomDomainConfig;
  isPublished: boolean;
  lastPublishedAt?: string;
  version: number;
}

export interface StoreProduct {
  id: string;
  bizId: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  price: number;
  mrp: number;
  priceUsd?: number;
  mrpUsd?: number;
  stock: number;
  rating: number;
  reviewCount: number;
  images: string[];
  isFeatured: boolean;
  tags: string[];
  specs: Record<string, string>;
  modelUrl?: string | null;
  status?: string;
  createdAt?: string;
}

export interface StoreOrderItem {
  sku: string;
  name: string;
  quantity: number;
  price: number;
  image?: string;
}

export interface StorefrontOrderTimeline {
  step: string;
  label: string;
  timestamp: string;
  completed: boolean;
  current?: boolean;
}

export interface StorefrontOrder {
  id: string;
  bizId: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: string;
  items: StoreOrderItem[];
  subtotal: number;
  discount: number;
  shippingFee: number;
  tax: number;
  total: number;
  escrowFee: number;
  escrowStatus:
    | 'Escrow Locked'
    | 'In Transit'
    | 'Delivered — Escrow Released'
    | 'Disputed';
  paymentMethod: 'paypal' | 'escrow';
  paypalOrderId?: string;
  storeSlug?: string;
  verifiedByServer?: boolean;
  trackingId: string;
  carrier: string;
  timeline: StorefrontOrderTimeline[];
  createdAt: string;
}

export interface DomainCheckResult {
  domain: string;
  isAvailable: boolean;
  pricePerYearUsd: number;
  pricePerYearInr: number;
  currency: string;
  provider: 'hostinger';
  tld: string;
  suggestedAlternatives?: {
    domain: string;
    pricePerYearUsd: number;
    pricePerYearInr: number;
    tld: string;
  }[];
}

export interface DnsRecords {
  cname: {
    type: 'CNAME';
    host: string;
    value: string;
    ttl: number;
  };
  aRecord: {
    type: 'A';
    host: string;
    value: string;
    ttl: number;
  };
}

export interface DnsVerificationResult {
  domain: string;
  cnameVerified: boolean;
  aRecordVerified: boolean;
  sslIssued: boolean;
  status: 'pending' | 'verified' | 'ssl_issued';
  message: string;
}

export interface TemplateDefinition {
  id: StorefrontTemplateId;
  name: string;
  subtitle: string;
  badge: string;
  bestFor: string;
  previewImage: string;
  description: string;
  defaultTheme: StorefrontTheme;
}
