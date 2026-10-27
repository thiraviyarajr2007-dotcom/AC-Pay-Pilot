import {
  StorefrontConfig,
  StorefrontTemplateId,
  TemplateDefinition,
  StoreProduct,
} from '../types/storefront';

export const TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
  {
    id: 'minimal',
    name: 'Minimal Clean',
    subtitle: 'Scandinavian Whitespace & Editorial Restraint',
    badge: 'Popular for Modern D2C',
    bestFor: 'Design studios, artisanal crafts, lifestyle goods, books & stationery',
    previewImage:
      'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&auto=format&fit=crop&q=80',
    description:
      'Monochrome discipline, generous breathing room, ultra-clean typography, and distraction-free purchase flow.',
    defaultTheme: {
      primaryColor: '#18181b', // Zinc 900
      accentColor: '#3b82f6', // Subtle Cobalt
      backgroundColor: '#fafafa', // Warm white
      textColor: '#09090b',
      surfaceColor: '#ffffff',
      fontPair: 'inter-sans',
      buttonStyle: 'rounded',
      cornerRadius: 'md',
      heroStyle: 'split',
    },
  },
  {
    id: 'boutique',
    name: 'Luxury Boutique',
    subtitle: 'Editorial Serif & Champagne Elegance',
    badge: 'High-Ticket & Jewellery',
    bestFor: 'Fine jewellery, luxury watches, haute couture, premium skincare',
    previewImage:
      'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=800&auto=format&fit=crop&q=80',
    description:
      'Opulent champagne gold tones, rich serif headlines, heritage badge framing, and bespoke certificate guarantees.',
    defaultTheme: {
      primaryColor: '#b45309', // Warm Amber/Gold
      accentColor: '#d97706', // Champagne Gold
      backgroundColor: '#fffbeb', // Warm cream
      textColor: '#1c1917',
      surfaceColor: '#ffffff',
      fontPair: 'playfair-sans',
      buttonStyle: 'sharp',
      cornerRadius: 'none',
      heroStyle: 'banner',
    },
  },
  {
    id: 'electronics',
    name: 'Cyber Electronics',
    subtitle: 'High-Spec Tech & Holographic AR',
    badge: 'Hardware & Audio',
    bestFor: 'Smart home, gaming gear, acoustics, high-precision engineering',
    previewImage:
      'https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=800&auto=format&fit=crop&q=80',
    description:
      'Deep technical grids, dynamic spec badges, live stock telemetries, and 3D spatial model inspection cards.',
    defaultTheme: {
      primaryColor: '#0ea5e9', // Cyber Cyan
      accentColor: '#6366f1', // Electric Indigo
      backgroundColor: '#090d16', // Deep Tech Navy
      textColor: '#f8fafc',
      surfaceColor: '#111827',
      fontPair: 'space-grotesk',
      buttonStyle: 'rounded',
      cornerRadius: 'sm',
      heroStyle: 'video',
    },
  },
  {
    id: 'grocery',
    name: 'Artisan Grocery',
    subtitle: 'Farm-to-Table Fresh & Organic Earth',
    badge: 'Food & Gourmet',
    bestFor: 'Organic groceries, specialty coffee, gourmet bakery, vegan pantry',
    previewImage:
      'https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&auto=format&fit=crop&q=80',
    description:
      'Warm sage & terracotta earth tones, 1-click quantity steppers on product cards, fresh delivery estimates, and harvest badges.',
    defaultTheme: {
      primaryColor: '#15803d', // Harvest Green
      accentColor: '#d97706', // Warm Ochre
      backgroundColor: '#fefce8', // Creamy light
      textColor: '#14532d',
      surfaceColor: '#ffffff',
      fontPair: 'dm-sans',
      buttonStyle: 'pill',
      cornerRadius: 'full',
      heroStyle: 'banner',
    },
  },
  {
    id: 'fashion',
    name: 'Atelier Fashion',
    subtitle: 'Runway Lookbook & Masonry Gallery',
    badge: 'Apparel & Footwear',
    bestFor: 'Clothing labels, streetwear, sneaker drops, seasonal collections',
    previewImage:
      'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&auto=format&fit=crop&q=80',
    description:
      'Full-height editorial photography, size/color variant chips, quick bag sliding drawer, and social lookbook integration.',
    defaultTheme: {
      primaryColor: '#000000',
      accentColor: '#e11d48', // Vibrant Rose
      backgroundColor: '#ffffff',
      textColor: '#0f172a',
      surfaceColor: '#f8fafc',
      fontPair: 'cinzel-lato',
      buttonStyle: 'sharp',
      cornerRadius: 'none',
      heroStyle: 'slider',
    },
  },
  {
    id: 'bold_dark',
    name: 'Neo Brutalist Dark',
    subtitle: 'Raw High-Impact Contrast & Neon Surge',
    badge: 'Creator & Streetwear',
    bestFor: 'Limited edition drops, tech accessories, creator merch, energy goods',
    previewImage:
      'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=800&auto=format&fit=crop&q=80',
    description:
      'High contrast borders, vibrant electric chartreuse accents, bold uppercase typography, and maximum purchase momentum.',
    defaultTheme: {
      primaryColor: '#a3e635', // Electric Lime / Chartreuse
      accentColor: '#38bdf8', // Neon Sky
      backgroundColor: '#0a0a0a', // Pitch Black
      textColor: '#ffffff',
      surfaceColor: '#171717',
      fontPair: 'space-grotesk',
      buttonStyle: 'sharp',
      cornerRadius: 'none',
      heroStyle: 'banner',
    },
  },
];

export function getDefaultStorefrontConfig(
  bizId: string,
  businessName: string,
  category: string,
  templateId: StorefrontTemplateId = 'electronics'
): StorefrontConfig {
  const template =
    TEMPLATE_DEFINITIONS.find((t) => t.id === templateId) || TEMPLATE_DEFINITIONS[0];

  return {
    bizId,
    templateId,
    theme: { ...template.defaultTheme },
    sectionsOrder: [
      'hero',
      'featured',
      'categories',
      'offers',
      'reviews',
      'about',
      'faq',
      'contact',
    ],
    announcementBar: {
      enabled: true,
      text: '⚡ PAYPAL ESCROW PROTECTED: 100% Buyer Guarantee on all orders + Free Express Shipping',
      link: '#',
      bgColor: template.defaultTheme.primaryColor,
      textColor: '#ffffff',
    },
    hero: {
      headline: `The New Standard in ${category}`,
      subheadline: `Engineered by ${businessName}. Autonomous fulfillment with verifiable PayPal escrow security on every transaction.`,
      ctaText: 'Explore Catalog',
      ctaLink: '#products',
      badgeText: 'Official Storefront',
      bgImageUrl:
        template.previewImage,
      secondaryImageUrl:
        'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&auto=format&fit=crop&q=80',
    },
    about: {
      title: `Crafted by ${businessName}`,
      story: `${businessName} was founded to eliminate friction in modern commerce. We blend obsessive engineering with transparent escrow guarantees.`,
      mission:
        'To deliver authentic, high-grade products protected by real-time automated escrow settlement.',
      foundedYear: '2024',
      imageUrl:
        'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&auto=format&fit=crop&q=80',
    },
    footer: {
      bio: `Official direct-to-consumer store for ${businessName}. Protected by AC PayPilot autonomous commerce infrastructure.`,
      quickLinks: [
        { label: 'Featured Products', href: '#products' },
        { label: 'Escrow Guarantee', href: '#faq' },
        { label: 'Order Tracking', href: '/track' },
        { label: 'Return Policy', href: '#about' },
      ],
      socialLinks: {
        instagram: 'https://instagram.com',
        twitter: 'https://x.com',
        facebook: 'https://facebook.com',
      },
      copyright: `© ${new Date().getFullYear()} ${businessName}. All rights reserved. Powered by AC PayPilot AI.`,
    },
    whatsapp: {
      enabled: true,
      phoneNumber: '+919876543210',
      defaultMessage: `Hi ${businessName}, I would like to inquire about your products.`,
      botEnabled: true,
      botMode: 'ai_recommender',
      welcomeMessage: `Welcome to ${businessName}! 🚀 I am your WhatsApp Commerce Bot. How may I assist you today?`,
      quickActionChips: [
        '🔍 Best Deals & Catalog',
        '📦 Track Escrow Order',
        '🛡️ Buyer Protection Policy',
        '💬 Chat with Specialist',
      ],
    },
    seo: {
      title: `${businessName} — Official Store & Escrow Protected Checkout`,
      description: `Shop genuine ${category} directly from ${businessName}. Enjoy instant dispatch and PayPal buyer escrow protection.`,
      keywords: `${businessName}, ${category}, online store, buy, escrow protected`,
      ogImage: template.previewImage,
    },
    customDomain: {
      domain: `${bizId.replace(/^biz-/, '')}.acpaypilot.app`,
      status: 'ssl_issued',
      cnameTarget: 'cname.acpaypilot.app',
      aRecordIp: '199.36.158.100',
    },
    isPublished: true,
    lastPublishedAt: new Date().toISOString(),
    version: 1,
  };
}

export const SEED_STORE_PRODUCTS: StoreProduct[] = [
  {
    id: 'prod-fan-bldc',
    bizId: 'biz-aerocool',
    sku: 'FAN-BLDC-892',
    name: 'AeroBreeze Stealth 1200mm Smart BLDC Ceiling Fan',
    description:
      '28W ultra-silent brushless DC motor with 235 CMM air delivery. Integrated IoT app control and 3D AR spatial fitting.',
    category: 'Smart Hardware',
    price: 8499,
    mrp: 12999,
    stock: 120,
    rating: 4.9,
    reviewCount: 142,
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAdZqURIDL_NaUXiAifTbLg4cem9jV1GV8iZOZph4aZvIM_kBIBsVSYaq0LFoeWQ1Xe11jOuDpYR0RHnVhSurjQprJuCqeXfR6luOW8JojolfW3AL3RlJG5cFe-YmAZaYz7-lll8h5sqcs83z5WRWhCSmB_-pIxVPGanujJtlcWqHaGPRDckKJmoCqqWoVmhA4SIWYCZ53ylY77gEHOrpObunEt2PyFUzIVJzYoOpMS9aQvgYTluWmbLg',
      'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=800&auto=format&fit=crop&q=80',
    ],
    isFeatured: true,
    tags: ['Best Seller', '3D AR Ready', 'Energy Saver'],
    specs: {
      Power: '28W at Speed 6',
      'Air Delivery': '235 CMM @ 380 RPM',
      Sweep: '1200 mm (48")',
      Noise: '28 dB Whisper Silent',
      Warranty: '3 Years Replacement',
    },
    modelUrl: '/api/models/ceiling-fan.glb',
  },
  {
    id: 'prod-yonex-racket',
    bizId: 'biz-aerocool',
    sku: 'SPO-YNX-99P',
    name: 'Yonex Astrox 99 Pro Carbon Badminton Racket',
    description:
      'Pro grade Rotational Generator System with Namd graphite core. Pre-strung with BG80 at 28 lbs tension.',
    category: 'Sports Gear',
    price: 14990,
    mrp: 19900,
    stock: 40,
    rating: 4.8,
    reviewCount: 88,
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDURq8df1AvNhd6BXPOnLSDepBVFAZQQdhN7XCJzqUwmcV79SqYGalleVqm5XyenVa4nFesHY7jCNLROrqBHlgtE92aPFjCmcNoiYuJEPzJjul5AYdnnHkeKQevXmwyO8xozEtp1qExjA6sfd8tRUMhTAaE5rLBnqslJx9r-5JgtL82V5kmTgx9bt5QmOiAjh1sa5vjPP7EB5WSaeKeMK9zuVgCH8RJFezfeBmyvYUJuYqroAVrKuYT6A',
    ],
    isFeatured: true,
    tags: ['Tournament Grade', '3D Model Available'],
    specs: {
      Weight: '4U (83g)',
      Balance: 'Head Heavy',
      Flex: 'Extra Stiff',
      String: 'Pre-strung BG80',
      Warranty: '1 Year Brand Cover',
    },
    modelUrl: '/api/models/badminton-racket.glb',
  },
  {
    id: 'prod-spatial-pods',
    bizId: 'biz-aerocool',
    sku: 'AUD-ANC-99',
    name: 'AcousticSphere ANC Spatial Earbuds',
    description:
      'Lossless LDAC wireless audio with 48dB hybrid active noise cancellation and personalized HRTF spatial tuning.',
    category: 'Spatial Audio',
    price: 11499,
    mrp: 14999,
    stock: 65,
    rating: 4.7,
    reviewCount: 64,
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuATX6652NttkNvGUKx5jflqNG9RH8CT1bcmBhwPs5ONeLhU9pt_yu_fLrBW741KftvyB8iGKx74rvwQHwuPCAi3l4R3tYkHwBDG9n3OPdy9Mlu8L_I0x4OPz9BwauAkb1vv9Y9m6inErwdhjPUN3ppwCGPbYGt503flhtRIVgYmpxZIuYY_1j9Rm3YHrFW7YLzOu7wmGH2HMVU6LtZPoH8W80bhQ8Ax7MbgTzEynmMscW556GyOm__wiw',
    ],
    isFeatured: true,
    tags: ['48dB ANC', 'Lossless Audio'],
    specs: {
      Driver: '11mm Liquid Crystal Polymer',
      Codec: 'LDAC, AAC, SBC',
      Battery: '38 Hours with Case',
      Rating: 'IPX5 Water Resistant',
    },
    modelUrl: null,
  },
];
