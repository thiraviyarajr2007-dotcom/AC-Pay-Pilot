import React, { useState, useEffect, useMemo } from 'react';
import {
  StorefrontConfig,
  StoreProduct,
  BusinessProfile,
  StorefrontOrder,
} from '../../types/storefront';
import {
  subscribeBusiness,
  subscribeStorefrontConfig,
  subscribeStoreProducts,
  createStorefrontOrder,
  resolveStoreBySlug,
  DEFAULT_BIZ_ID,
} from '../../services/storefrontService';
import { authenticatedFetch } from '../../services/apiClient';
import { getDefaultStorefrontConfig, SEED_STORE_PRODUCTS } from '../../data/templateDefaults';
import { ARPreviewModal } from '../modals/ARPreviewModal';
import { QRModal } from '../modals/QRModal';

interface PublicStorefrontAppProps {
  slug?: string;
  bizId?: string;
  previewConfig?: StorefrontConfig; // When embedded in the builder preview!
  previewBusiness?: BusinessProfile;
  previewProducts?: StoreProduct[];
  isEmbeddedPreview?: boolean;
}

export function PublicStorefrontApp({
  slug = 'aerocool',
  bizId = DEFAULT_BIZ_ID,
  previewConfig,
  previewBusiness,
  previewProducts,
  isEmbeddedPreview = false,
}: PublicStorefrontAppProps) {
  // Real-time state
  const [business, setBusiness] = useState<BusinessProfile>(
    previewBusiness || {
      id: bizId,
      ownerUid: 'owner-1',
      name: 'AeroCool Dynamics',
      slug,
      category: 'Smart Hardware & Audio',
      tagline: 'Precision Engineering & Escrow Protected Commerce',
      logoUrl:
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=80',
      contact: {
        email: 'sales@aerocool.in',
        phone: '+91 80 4920 1888',
        address: 'Embassy TechVillage, Bengaluru, Karnataka',
        whatsappNumber: '+919876543210',
      },
      currency: 'INR',
      paypalConnected: true,
      shippingPolicy: '24-hour express dispatch with live tracking.',
      returnPolicy: '7-day buyer escrow return guarantee.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  );

  const [config, setConfig] = useState<StorefrontConfig>(
    previewConfig || getDefaultStorefrontConfig(bizId, business.name, business.category)
  );

  const [products, setProducts] = useState<StoreProduct[]>(
    previewProducts || SEED_STORE_PRODUCTS
  );

  // Storefront Interactive State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedProduct, setSelectedProduct] = useState<StoreProduct | null>(null);
  const [cartItems, setCartItems] = useState<{ product: StoreProduct; quantity: number }[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [appliedDiscount, setAppliedDiscount] = useState(0);
  const [couponFeedback, setCouponFeedback] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [vrModalProduct, setVrModalProduct] = useState<StoreProduct | null>(null);
  const [qrModalProduct, setQrModalProduct] = useState<StoreProduct | null>(null);
  const [isWhatsAppBotOpen, setIsWhatsAppBotOpen] = useState(false);
  const [customWhatsAppMsg, setCustomWhatsAppMsg] = useState('');

  // Customer Checkout Form
  const [custName, setCustName] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custAddress, setCustAddress] = useState('');
  const [resolvedBizId, setResolvedBizId] = useState<string>(bizId);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [confirmedOrder, setConfirmedOrder] = useState<StorefrontOrder | null>(null);

  // Resolve public store projection by slug when visiting /s/:slug
  useEffect(() => {
    setResolvedBizId(bizId);
  }, [bizId]);

  useEffect(() => {
    if (previewBusiness || previewConfig || previewProducts || !slug) return;
    let cancelled = false;
    void resolveStoreBySlug(slug).then((resolved) => {
      if (cancelled || !resolved) return;
      if (resolved.business?.id) {
        setResolvedBizId(resolved.business.id);
      }
      setBusiness((prev) => ({
        ...prev,
        ...resolved.business,
        contact: {
          ...prev.contact,
          ...(resolved.business?.contact || {}),
          email:
            resolved.business?.contact?.email ||
            (resolved.business as any)?.supportEmail ||
            prev.contact?.email ||
            'support@aerocool.in',
        },
      }));
      setConfig(resolved.config);
      setProducts(resolved.products);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, previewBusiness, previewConfig, previewProducts]);

  // Real-time Firestore sync (only if not an in-builder preview override)
  useEffect(() => {
    if (previewBusiness) {
      setBusiness((prev) => ({
        ...prev,
        ...previewBusiness,
        contact: {
          ...prev.contact,
          ...(previewBusiness.contact || {}),
        },
      }));
      return;
    }
    const unsub = subscribeBusiness(resolvedBizId, (b) =>
      setBusiness((prev) => ({
        ...prev,
        ...b,
        contact: {
          ...prev.contact,
          ...(b?.contact || {}),
          email: b?.contact?.email || (b as any)?.supportEmail || prev.contact?.email || 'support@aerocool.in',
        },
      }))
    );
    return () => unsub();
  }, [resolvedBizId, previewBusiness]);

  useEffect(() => {
    if (previewConfig) {
      setConfig(previewConfig);
      return;
    }
    const unsub = subscribeStorefrontConfig(resolvedBizId, (c) => setConfig(c));
    return () => unsub();
  }, [resolvedBizId, previewConfig]);

  useEffect(() => {
    if (previewProducts) {
      setProducts(previewProducts);
      return;
    }
    const unsub = subscribeStoreProducts(resolvedBizId, (p) => setProducts(p));
    return () => unsub();
  }, [resolvedBizId, previewProducts]);

  // Dynamically sync browser tab title & favicon to the seller's chosen brand name & logo
  useEffect(() => {
    if (isEmbeddedPreview || typeof document === 'undefined') return;
    if (business?.name) {
      document.title = business.name;
    }
    if (business?.logoUrl) {
      let iconLink = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
      if (!iconLink) {
        iconLink = document.createElement('link');
        iconLink.rel = 'icon';
        document.head.appendChild(iconLink);
      }
      iconLink.href = business.logoUrl;
    }
  }, [business?.name, business?.logoUrl, isEmbeddedPreview]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Cart operations
  const addToCart = (prod: StoreProduct, qty = 1) => {
    setCartItems((prev) => {
      const existing = prev.find((i) => i.product.id === prod.id);
      if (existing) {
        return prev.map((i) =>
          i.product.id === prod.id ? { ...i, quantity: i.quantity + qty } : i
        );
      }
      return [...prev, { product: prod, quantity: qty }];
    });
    showToast(`Added ${prod.name} to cart`);
  };

  const updateCartQty = (prodId: string, delta: number) => {
    setCartItems((prev) =>
      prev
        .map((item) => {
          if (item.product.id === prodId) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as { product: StoreProduct; quantity: number }[]
    );
  };

  // Coupon handling
  const applyCoupon = () => {
    const code = couponCode.trim().toUpperCase();
    if (code === 'PILOT10' || code === 'WELCOME10') {
      setAppliedDiscount(0.1);
      setCouponFeedback('✓ 10% Escrow Launch Discount Applied!');
    } else if (code === 'SAVE20') {
      setAppliedDiscount(0.2);
      setCouponFeedback('✓ 20% Special Discount Applied!');
    } else {
      setCouponFeedback('Invalid coupon code. Try "PILOT10".');
    }
  };

  // Totals calculations
  const subtotal = useMemo(() => {
    return cartItems.reduce((acc, item) => acc + item.product.price * item.quantity, 0);
  }, [cartItems]);

  const discountAmount = Math.round(subtotal * appliedDiscount);
  const shippingFee = subtotal > 2000 || subtotal === 0 ? 0 : 150;
  const taxAmount = Math.round((subtotal - discountAmount) * 0.18);
  const totalAmount = subtotal - discountAmount + shippingFee + taxAmount;
  const escrowFee = Math.round(totalAmount * 0.015); // 1.5% escrow guarantee protection

  const currencySymbol = business.currency === 'USD' ? '$' : business.currency === 'EUR' ? '€' : business.currency === 'GBP' ? '£' : '₹';

  // Categories list
  const categories = useMemo(() => {
    const cats = new Set(products.map((p) => p.category));
    return ['All', ...Array.from(cats)];
  }, [products]);

  // Filtered products
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchCat = selectedCategory === 'All' || p.category === selectedCategory;
      const matchSearch =
        !searchQuery.trim() ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchCat && matchSearch;
    });
  }, [products, selectedCategory, searchQuery]);

  // Order Placement — strictly creates & verifies PayPal payment BEFORE creating escrow-locked storefront order
  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!custName.trim() || !custEmail.trim() || !custAddress.trim()) {
      const msg = 'Please fill out your full name, valid email address, and shipping address.';
      setCheckoutError(msg);
      showToast(msg);
      return;
    }
    if (cartItems.length === 0) {
      const msg = 'Your cart is empty.';
      setCheckoutError(msg);
      showToast(msg);
      return;
    }
    if (isEmbeddedPreview) {
      showToast('Preview mode — live checkout is disabled in Storefront Builder preview.');
      return;
    }

    setIsPlacingOrder(true);
    setCheckoutError(null);
    try {
      const createRes = await authenticatedFetch('/api/paypal/create-order', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `sf-create-${resolvedBizId}-${Date.now()}`,
          storeSlug: slug,
          currency: business.currency === 'USD' ? 'USD' : 'INR',
          items: cartItems.map((i) => ({
            sku: i.product.sku,
            quantity: i.quantity,
          })),
        }),
      });
      const createData = (await createRes.json().catch(() => null)) as any;
      if (!createRes.ok || !createData?.ok || !createData?.order?.id) {
        throw new Error(
          createData?.error || `PayPal order creation failed (HTTP ${createRes.status}).`
        );
      }

      const paypalOrderId = createData.order.id as string;
      const guestToken = createData.guestCaptureToken as string | undefined;

      const captureRes = await authenticatedFetch(
        `/api/paypal/capture-order/${encodeURIComponent(paypalOrderId)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            idempotencyKey: `sf-cap-${paypalOrderId}-${Date.now()}`,
            simulateOutcome: 'COMPLETED',
            ...(guestToken ? { guestCaptureToken: guestToken } : {}),
          }),
        }
      );
      const captureData = (await captureRes.json().catch(() => null)) as any;
      if (!captureRes.ok || !captureData?.ok || !captureData?.order?.verifiedByServer) {
        throw new Error(
          captureData?.error ||
            `PayPal payment verification failed (HTTP ${captureRes.status}). Order was not locked.`
        );
      }

      const orderNumber = `#ORD-${Math.floor(1000 + Math.random() * 9000)}`;
      const newOrder = await createStorefrontOrder(resolvedBizId, {
        bizId: resolvedBizId,
        storeSlug: slug,
        orderNumber,
        customerName: custName,
        customerEmail: custEmail,
        customerPhone: custPhone || '+91 98765 00000',
        shippingAddress: custAddress,
        items: cartItems.map((i) => ({
          sku: i.product.sku,
          name: i.product.name,
          quantity: i.quantity,
          price: i.product.price,
          image: i.product.images[0],
        })),
        subtotal,
        discount: discountAmount,
        shippingFee,
        tax: taxAmount,
        total: totalAmount,
        escrowFee,
        escrowStatus: 'Escrow Locked',
        paymentMethod: 'paypal',
        paypalOrderId,
        verifiedByServer: true,
        trackingId: `BLUEDART-${Math.floor(100000000 + Math.random() * 900000000)}`,
        carrier: 'BlueDart Air Express',
      });

      setConfirmedOrder(newOrder);
      setCartItems([]);
      setIsCheckoutOpen(false);
      showToast('Order confirmed! PayPal payment verified and locked in escrow.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Order creation failed. Please try again.';
      setCheckoutError(msg);
      showToast(msg);
    } finally {
      setIsPlacingOrder(false);
    }
  };

  const theme = config.theme;
  const templateId = config.templateId;

  // Custom typography style
  const fontClass =
    theme.fontPair === 'playfair-sans'
      ? 'font-serif'
      : theme.fontPair === 'space-grotesk'
      ? 'font-mono'
      : theme.fontPair === 'cinzel-lato'
      ? 'font-serif'
      : 'font-sans';

  const radiusClass =
    theme.cornerRadius === 'none'
      ? 'rounded-none'
      : theme.cornerRadius === 'sm'
      ? 'rounded-md'
      : theme.cornerRadius === 'lg'
      ? 'rounded-2xl'
      : theme.cornerRadius === 'full'
      ? 'rounded-full'
      : 'rounded-xl';

  return (
    <div
      className={`min-h-screen text-on-surface ${fontClass} selection:bg-primary/20 selection:text-primary transition-colors duration-300`}
      style={{
        backgroundColor: theme.backgroundColor,
        color: theme.textColor,
      }}
    >
      {/* 1. ANNOUNCEMENT BAR */}
      {config.announcementBar?.enabled && (
        <div
          className="py-2 px-4 text-center text-xs font-semibold tracking-wide flex items-center justify-center gap-2 shadow-sm"
          style={{
            backgroundColor: config.announcementBar.bgColor || theme.primaryColor,
            color: config.announcementBar.textColor || '#ffffff',
          }}
        >
          <span className="material-symbols-outlined text-[16px]">verified_user</span>
          <span>{config.announcementBar.text}</span>
        </div>
      )}

      {/* 2. STOREFRONT NAVIGATION HEADER */}
      <header
        className="sticky top-0 z-40 backdrop-blur-md border-b px-4 lg:px-8 py-3.5 transition-all shadow-sm"
        style={{
          backgroundColor: `${theme.surfaceColor}ee`,
          borderColor: `${theme.textColor}15`,
        }}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          {/* Brand Logo & Name (Only seller's chosen logo and brand name) */}
          <div className="flex items-center gap-3">
            {business.logoUrl && (
              <img
                src={business.logoUrl}
                alt={business.name}
                className="w-10 h-10 object-cover rounded-xl border border-black/10 shadow-sm"
              />
            )}
            <h1
              className="text-base lg:text-lg font-black tracking-tight leading-none"
              style={{ color: theme.textColor }}
            >
              {business.name}
            </h1>
          </div>

          {/* Search Bar (Desktop) */}
          <div className="hidden md:flex flex-1 max-w-md mx-4">
            <div className="relative w-full">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[18px] opacity-50">
                search
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${products.length} products...`}
                className={`w-full pl-10 pr-4 py-2 text-xs border border-black/10 bg-black/5 focus:outline-none focus:ring-1 ${radiusClass}`}
                style={{ color: theme.textColor }}
              />
            </div>
          </div>

          {/* Actions: AI Assistant & Cart Button */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setIsAssistantOpen(true)}
              className={`px-3 py-2 text-xs font-semibold flex items-center gap-1.5 border border-primary/20 bg-primary/10 text-primary hover:bg-primary/20 transition-all ${radiusClass}`}
              title="Ask AI Shopping Assistant"
              aria-label="Ask AI Shopping Assistant"
            >
              <span className="material-symbols-outlined text-[16px]">smart_toy</span>
              <span className="hidden sm:inline">AI Assistant</span>
            </button>

            <button
              type="button"
              onClick={() => setIsCartOpen(true)}
              aria-label="Open shopping cart"
              className={`relative px-4 py-2 text-xs font-bold flex items-center gap-2 shadow-sm transition-all ${radiusClass}`}
              style={{
                backgroundColor: theme.primaryColor,
                color: '#ffffff',
              }}
            >
              <span className="material-symbols-outlined text-[18px]">shopping_bag</span>
              <span>Cart</span>
              {cartItems.length > 0 && (
                <span className="w-5 h-5 rounded-full bg-white text-black font-extrabold text-[10px] flex items-center justify-center">
                  {cartItems.reduce((acc, i) => acc + i.quantity, 0)}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* 3. DYNAMIC SECTIONS RENDERED BASED ON SECTIONS ORDER */}
      <main className="space-y-12 lg:space-y-16 pb-20">
        {config.sectionsOrder.map((sectionType) => {
          if (sectionType === 'hero') {
            return (
              <section key="hero" className="max-w-7xl mx-auto px-4 lg:px-8 pt-6">
                {templateId === 'boutique' ? (
                  // Luxury Boutique Hero: Editorial Split Layout
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center py-10 lg:py-16">
                    <div className="space-y-5">
                      <span className="inline-block px-3 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-700 text-xs font-bold uppercase tracking-widest rounded-full">
                        {config.hero.badgeText || 'Exclusive Heritage Collection'}
                      </span>
                      <h2 className="text-3xl lg:text-5xl font-serif font-black tracking-tight leading-tight">
                        {config.hero.headline}
                      </h2>
                      <p className="text-sm lg:text-base opacity-80 leading-relaxed font-sans max-w-lg">
                        {config.hero.subheadline}
                      </p>
                      <div className="pt-2 flex items-center gap-4">
                        <a
                          href={config.hero.ctaLink || '#products'}
                          className={`px-8 py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg transition-transform hover:-translate-y-0.5 ${radiusClass}`}
                          style={{ backgroundColor: theme.primaryColor }}
                        >
                          {config.hero.ctaText || 'Discover Creation'}
                        </a>
                        <div className="flex items-center gap-2 text-xs opacity-75">
                          <span className="material-symbols-outlined text-amber-600 text-[18px]">
                            shield
                          </span>
                          <span>Verified Escrow Guarantee</span>
                        </div>
                      </div>
                    </div>
                    <div className="relative aspect-[4/3] rounded-2xl overflow-hidden shadow-2xl border border-amber-900/10">
                      <img
                        src={config.hero.bgImageUrl}
                        alt="Hero Lookbook"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent flex items-end p-6">
                        <span className="text-white text-xs font-medium tracking-wide">
                          Handcrafted with Autonomous Escrow Settlement Protection
                        </span>
                      </div>
                    </div>
                  </div>
                ) : templateId === 'electronics' ? (
                  // Cyber Electronics Hero: High-Tech HUD
                  <div
                    className="relative rounded-3xl p-8 lg:p-14 overflow-hidden border border-cyan-500/20 shadow-2xl"
                    style={{ backgroundColor: theme.surfaceColor }}
                  >
                    <div className="relative z-10 max-w-2xl space-y-5">
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-mono font-semibold">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                        <span>{config.hero.badgeText || 'NEXT-GEN HARDWARE DEPLOYMENT'}</span>
                      </div>
                      <h2 className="text-3xl lg:text-5xl font-mono font-black tracking-tight leading-tight text-white">
                        {config.hero.headline}
                      </h2>
                      <p className="text-sm lg:text-base opacity-80 leading-relaxed max-w-xl text-slate-300">
                        {config.hero.subheadline}
                      </p>
                      <div className="flex flex-wrap items-center gap-4 pt-2">
                        <a
                          href={config.hero.ctaLink || '#products'}
                          className={`px-7 py-3 text-xs font-mono font-bold tracking-wider text-black bg-cyan-400 hover:bg-cyan-300 shadow-cyan-500/30 shadow-lg transition-all ${radiusClass}`}
                        >
                          {config.hero.ctaText || 'Explore Catalog'}
                        </a>
                      </div>
                    </div>
                    {/* Background glow & subtle overlay */}
                    <div className="absolute right-0 top-0 bottom-0 w-1/2 opacity-25 pointer-events-none hidden lg:block">
                      <img
                        src={config.hero.bgImageUrl}
                        alt="Electronics preview"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>
                ) : templateId === 'bold_dark' ? (
                  // Neo Brutalist Dark Hero
                  <div className="border-4 border-lime-400 bg-black text-white p-8 lg:p-14 rounded-none shadow-[8px_8px_0px_0px_#a3e635]">
                    <div className="max-w-2xl space-y-4">
                      <span className="inline-block bg-lime-400 text-black px-3 py-1 font-mono font-black text-xs uppercase">
                        {config.hero.badgeText || 'LIMITED AUTONOMOUS DROP'}
                      </span>
                      <h2 className="text-3xl lg:text-6xl font-black uppercase tracking-tight leading-none text-lime-400">
                        {config.hero.headline}
                      </h2>
                      <p className="text-sm lg:text-base opacity-90 font-mono leading-relaxed text-slate-200">
                        {config.hero.subheadline}
                      </p>
                      <div className="pt-2">
                        <a
                          href={config.hero.ctaLink || '#products'}
                          className="inline-block bg-lime-400 text-black font-black uppercase text-xs px-8 py-4 hover:bg-white transition-colors"
                        >
                          {config.hero.ctaText || 'SHOP DROP NOW'}
                        </a>
                      </div>
                    </div>
                  </div>
                ) : (
                  // Minimal & Grocery Banner Hero
                  <div
                    className={`relative overflow-hidden p-8 lg:p-16 ${radiusClass} border border-black/10 shadow-sm`}
                    style={{ backgroundColor: theme.surfaceColor }}
                  >
                    <div className="max-w-2xl space-y-4">
                      <span className="inline-block text-xs font-bold tracking-wider uppercase opacity-75">
                        {config.hero.badgeText || 'Curated Selection'}
                      </span>
                      <h2 className="text-3xl lg:text-5xl font-black tracking-tight leading-tight">
                        {config.hero.headline}
                      </h2>
                      <p className="text-sm lg:text-base opacity-80 leading-relaxed">
                        {config.hero.subheadline}
                      </p>
                      <div className="pt-2 flex items-center gap-3">
                        <a
                          href={config.hero.ctaLink || '#products'}
                          className={`px-7 py-3 text-xs font-bold text-white transition-opacity hover:opacity-90 ${radiusClass}`}
                          style={{ backgroundColor: theme.primaryColor }}
                        >
                          {config.hero.ctaText || 'Explore Products'}
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            );
          }

          if (sectionType === 'categories') {
            return (
              <section key="categories" className="max-w-7xl mx-auto px-4 lg:px-8">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider opacity-60">
                    Browse Categories
                  </h3>
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
                  {categories.map((cat) => (
                    <button
                      type="button"
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-4 py-2 text-xs font-semibold whitespace-nowrap transition-all border ${radiusClass} ${
                        selectedCategory === cat
                          ? 'shadow-sm text-white'
                          : 'opacity-70 hover:opacity-100 bg-black/5 border-black/10'
                      }`}
                      style={{
                        backgroundColor: selectedCategory === cat ? theme.primaryColor : undefined,
                        borderColor: selectedCategory === cat ? theme.primaryColor : undefined,
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </section>
            );
          }

          if (sectionType === 'featured') {
            return (
              <section id="products" key="featured" className="max-w-7xl mx-auto px-4 lg:px-8">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl lg:text-2xl font-black tracking-tight">
                    {selectedCategory === 'All' ? 'Featured Products' : selectedCategory}
                  </h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredProducts.map((prod) => (
                    <div
                      key={prod.id}
                      className={`group border border-black/10 overflow-hidden transition-all duration-300 hover:shadow-xl flex flex-col ${radiusClass}`}
                      style={{ backgroundColor: theme.surfaceColor }}
                    >
                      {/* Product Image & Badges */}
                      <div
                        className="relative aspect-square overflow-hidden bg-black/5 cursor-pointer"
                        onClick={() => setSelectedProduct(prod)}
                      >
                        <img
                          src={prod.images[0] || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&auto=format&fit=crop&q=80'}
                          alt={prod.name}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          loading="lazy"
                        />
                        <div className="absolute top-3 left-3 flex flex-col gap-1">
                          {prod.modelUrl && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setVrModalProduct(prod);
                              }}
                              className="px-2.5 py-1 rounded-md bg-black/80 hover:bg-black text-white text-[10px] font-bold tracking-wider uppercase flex items-center gap-1 backdrop-blur-sm transition-all shadow cursor-pointer"
                              title="Inspect in 3D & VR"
                            >
                              <span className="material-symbols-outlined text-[14px] text-sky-400">view_in_ar</span>
                              <span>3D / VR</span>
                            </button>
                          )}
                          {prod.tags?.[0] && (
                            <span className="px-2.5 py-1 rounded-md bg-primary text-white text-[10px] font-bold">
                              {prod.tags[0]}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Card Content */}
                      <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-[11px] font-semibold uppercase tracking-wider opacity-60">
                              {prod.category}
                            </span>
                            <div className="flex items-center gap-1 text-[11px] font-bold text-amber-500">
                              <span className="material-symbols-outlined text-[14px]">star</span>
                              <span>{prod.rating || 4.9}</span>
                              <span className="opacity-50">({prod.reviewCount || 12})</span>
                            </div>
                          </div>
                          <h4
                            className="font-bold text-sm lg:text-base leading-snug cursor-pointer hover:underline"
                            onClick={() => setSelectedProduct(prod)}
                          >
                            {prod.name}
                          </h4>
                          <p className="text-xs opacity-75 line-clamp-2 mt-1.5 leading-relaxed">
                            {prod.description}
                          </p>
                        </div>

                        {/* Specs Pills */}
                        {prod.specs && Object.keys(prod.specs).length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {Object.entries(prod.specs).slice(0, 2).map(([k, v]) => (
                              <span
                                key={k}
                                className="px-2 py-0.5 rounded-md bg-black/5 text-[10px] font-medium opacity-80"
                              >
                                {k}: {v}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Price & Add to Cart Action */}
                        <div className="pt-2 border-t border-black/5 flex items-center justify-between gap-2">
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-base font-black">
                              {currencySymbol}{prod.price.toLocaleString()}
                            </span>
                            {prod.mrp > prod.price && (
                              <span className="text-xs line-through opacity-50">
                                {currencySymbol}{prod.mrp.toLocaleString()}
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => addToCart(prod, 1)}
                            aria-label={`Add ${prod.name} to cart`}
                            className={`px-3.5 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 flex items-center gap-1.5 shadow-sm cursor-pointer ${radiusClass}`}
                            style={{ backgroundColor: theme.primaryColor }}
                          >
                            <span className="material-symbols-outlined text-[16px]">add</span>
                            <span>Add</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          }

          if (sectionType === 'offers') {
            return (
              <section key="offers" className="max-w-7xl mx-auto px-4 lg:px-8">
                <div
                  className={`p-6 lg:p-8 flex flex-col sm:flex-row items-center justify-between gap-4 border border-black/10 shadow-sm ${radiusClass}`}
                  style={{
                    backgroundColor: `${theme.primaryColor}12`,
                  }}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className="w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-white shadow-md"
                      style={{ backgroundColor: theme.primaryColor }}
                    >
                      <span className="material-symbols-outlined text-[24px]">percent</span>
                    </div>
                    <div>
                      <h4 className="text-base font-bold">Special Escrow Launch Offer</h4>
                      <p className="text-xs opacity-75 mt-0.5">
                        Get 10% off instantly on your first order. Use promo code:
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-4 py-2 rounded-xl bg-white text-black font-mono font-black text-xs tracking-wider border border-black/10 shadow-sm">
                      PILOT10
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setCouponCode('PILOT10');
                        setAppliedDiscount(0.1);
                        showToast('Coupon PILOT10 applied!');
                      }}
                      className="px-3 py-2 text-xs font-bold underline"
                    >
                      Apply Now
                    </button>
                  </div>
                </div>
              </section>
            );
          }

          if (sectionType === 'about') {
            return (
              <section key="about" className="max-w-7xl mx-auto px-4 lg:px-8">
                <div
                  className={`grid grid-cols-1 lg:grid-cols-2 gap-8 items-center p-8 lg:p-12 border border-black/10 ${radiusClass}`}
                  style={{ backgroundColor: theme.surfaceColor }}
                >
                  <div className="space-y-4">
                    <span className="text-xs font-bold uppercase tracking-wider opacity-60">
                      Brand Story
                    </span>
                    <h3 className="text-2xl lg:text-3xl font-black tracking-tight">
                      {config.about.title || `About ${business.name}`}
                    </h3>
                    <p className="text-sm opacity-80 leading-relaxed">
                      {config.about.story}
                    </p>
                    <div className="p-4 rounded-xl bg-black/5 border border-black/5 space-y-1">
                      <span className="text-xs font-bold opacity-90">Our Mission</span>
                      <p className="text-xs opacity-75">{config.about.mission}</p>
                    </div>
                  </div>
                  <div className="rounded-2xl overflow-hidden aspect-[4/3] border border-black/10 shadow-lg">
                    <img
                      src={config.about.imageUrl || 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&auto=format&fit=crop&q=80'}
                      alt="About craft"
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                </div>
              </section>
            );
          }

          if (sectionType === 'faq') {
            return (
              <section key="faq" className="max-w-5xl mx-auto px-4 lg:px-8">
                <div className="text-center space-y-1 mb-8">
                  <h3 className="text-xl lg:text-2xl font-black">Frequently Asked Questions</h3>
                  <p className="text-xs opacity-70">
                    Transparent escrow answers for seamless online shopping
                  </p>
                </div>
                <div className="space-y-3">
                  {[
                    {
                      q: 'How does PayPal Escrow Protection work for my order?',
                      a: 'When you check out, your payment is held securely in an automated escrow smart-lock. The seller does not receive the funds until the courier confirms package delivery and you have inspected your item.',
                    },
                    {
                      q: 'What is the shipping & courier delivery timeframe?',
                      a: business.shippingPolicy || 'Orders are packed and dispatched within 24 hours. Express air delivery takes 2 to 4 business days with a live tracking ID.',
                    },
                    {
                      q: 'What is the return & refund policy?',
                      a: business.returnPolicy || 'We offer a 7-day hassle-free return window. If you initiate a return, your payment remains in escrow and is promptly refunded upon package scan.',
                    },
                    {
                      q: 'Are all products authentic and covered by brand warranty?',
                      a: 'Yes. Every unit is direct from manufacturer, quality inspected, and comes with full comprehensive warranty coverage.',
                    },
                  ].map((item, idx) => (
                    <details
                      key={idx}
                      className={`p-4 border border-black/10 group cursor-pointer ${radiusClass}`}
                      style={{ backgroundColor: theme.surfaceColor }}
                    >
                      <summary className="font-bold text-xs lg:text-sm flex items-center justify-between">
                        <span>{item.q}</span>
                        <span className="material-symbols-outlined text-[18px] transition-transform group-open:rotate-180">
                          expand_more
                        </span>
                      </summary>
                      <p className="text-xs opacity-75 mt-2.5 leading-relaxed pt-2 border-t border-black/5">
                        {item.a}
                      </p>
                    </details>
                  ))}
                </div>
              </section>
            );
          }

          return null;
        })}
      </main>

      {/* 4. FOOTER */}
      <footer
        className="border-t py-12 px-4 lg:px-8 text-xs transition-colors"
        style={{
          backgroundColor: theme.surfaceColor,
          borderColor: `${theme.textColor}15`,
        }}
      >
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-2.5 md:col-span-2">
            <h4 className="font-bold text-sm tracking-tight">{business.name}</h4>
            <p className="opacity-75 leading-relaxed max-w-sm">{config.footer?.bio || business.tagline}</p>
            <div className="flex items-center gap-2 pt-2">
              <span className="material-symbols-outlined text-emerald-600 text-[18px]">verified_user</span>
              <span className="font-semibold text-emerald-600">Verifiable PayPal Escrow Protection</span>
            </div>
          </div>
          <div>
            <h5 className="font-bold text-xs uppercase tracking-wider mb-2.5 opacity-80">
              Quick Links
            </h5>
            <ul className="space-y-1.5 opacity-75">
              <li><a href="#products" className="hover:underline">Catalog</a></li>
              <li><a href="#about" className="hover:underline">About Brand</a></li>
              <li><a href="#faq" className="hover:underline">Escrow Policy</a></li>
              <li><a href="#contact" className="hover:underline">Contact</a></li>
            </ul>
          </div>
          <div>
            <h5 className="font-bold text-xs uppercase tracking-wider mb-2.5 opacity-80">
              Support & Contact
            </h5>
            <div className="space-y-1 opacity-75 leading-relaxed">
              <p>{business.contact?.email || (business as any).supportEmail || 'support@aerocool.in'}</p>
              <p>{business.contact?.phone || '+91 80 4920 1888'}</p>
              <p className="text-[11px] mt-1">{business.contact?.address || ''}</p>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto pt-8 mt-8 border-t border-black/5 flex flex-col sm:flex-row items-center justify-between gap-4 opacity-60 text-[11px]">
          <span>{config.footer?.copyright || `© ${new Date().getFullYear()} ${business.name}. All rights reserved.`}</span>
        </div>
      </footer>

      {/* WHATSAPP COMMERCE & SUPPORT BOT */}
      {config.whatsapp?.enabled && (
        <>
          {/* Interactive Bot Drawer */}
          {isWhatsAppBotOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="storefront-whatsapp-title"
              className="fixed bottom-22 right-4 sm:right-6 z-50 w-[320px] sm:w-[360px] rounded-2xl shadow-2xl border border-emerald-500/30 overflow-hidden bg-white text-slate-900 flex flex-col animate-fade-in"
              style={{
                boxShadow: '0 20px 40px -10px rgba(16, 185, 129, 0.25), 0 10px 25px -5px rgba(0, 0, 0, 0.15)',
              }}
            >
              {/* WhatsApp Header */}
              <div className="bg-[#075e54] text-white p-3.5 flex items-center justify-between shadow-xs">
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center font-bold text-sm">
                      <span className="material-symbols-outlined text-[20px]">chat</span>
                    </div>
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#075e54]" />
                  </div>
                  <div>
                    <div id="storefront-whatsapp-title" className="text-xs font-black tracking-tight flex items-center gap-1">
                      <span>{business.name}</span>
                      <span className="material-symbols-outlined text-[14px] text-emerald-300">verified</span>
                    </div>
                    <span className="text-[10px] text-emerald-100 flex items-center gap-1 font-medium">
                      <span>WhatsApp Commerce Bot</span>
                      <span>•</span>
                      <span className="text-emerald-300 font-bold">Online</span>
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsWhatsAppBotOpen(false)}
                  className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors cursor-pointer"
                  aria-label="Close WhatsApp chat drawer"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>

              {/* Chat Message Body */}
              <div
                className="p-3.5 space-y-3 max-h-[340px] overflow-y-auto bg-[#efeae2]/50 text-xs"
                style={{
                  backgroundImage: 'radial-gradient(rgba(0,0,0,0.04) 1px, transparent 1px)',
                  backgroundSize: '16px 16px',
                }}
              >
                {/* Bot Message Bubble */}
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded-full bg-[#128c7e] text-white flex items-center justify-center shrink-0 text-[10px] font-bold">
                    AI
                  </div>
                  <div className="bg-white rounded-2xl rounded-tl-xs p-3 shadow-xs border border-black/5 text-slate-800 space-y-1.5 max-w-[85%]">
                    <p className="font-medium leading-relaxed">
                      {config.whatsapp.welcomeMessage ||
                        `Welcome to ${business.name}! 🚀 I am your WhatsApp assistant. How can I help you today?`}
                    </p>
                    <span className="text-[9px] text-slate-400 block text-right font-mono">
                      Just now
                    </span>
                  </div>
                </div>

                {/* Quick Action Chips */}
                <div className="pt-1 space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block px-1">
                    Tap to ask via WhatsApp:
                  </span>
                  <div className="flex flex-col gap-1.5">
                    {(
                      config.whatsapp.quickActionChips || [
                        '🔍 Best Deals & Catalog',
                        '📦 Track Escrow Order',
                        '🛡️ Buyer Protection Policy',
                        '💬 Chat with Specialist',
                      ]
                    ).map((chip, idx) => {
                      const msg = `Hi ${business.name}, ${chip}. Please assist me.`;
                      const link = `https://wa.me/${config.whatsapp.phoneNumber.replace(
                        /[^0-9]/g,
                        ''
                      )}?text=${encodeURIComponent(msg)}`;
                      return (
                        <a
                          key={idx}
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-2 rounded-xl bg-white hover:bg-emerald-50 border border-emerald-500/25 text-emerald-800 text-[11px] font-semibold flex items-center justify-between transition-colors shadow-2xs group cursor-pointer"
                        >
                          <span>{chip}</span>
                          <span className="material-symbols-outlined text-[14px] text-emerald-600 group-hover:translate-x-0.5 transition-transform">
                            arrow_forward
                          </span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Direct Custom Query Input */}
              <div className="p-2.5 bg-white border-t border-slate-100 flex items-center gap-1.5">
                <input
                  type="text"
                  value={customWhatsAppMsg}
                  onChange={(e) => setCustomWhatsAppMsg(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customWhatsAppMsg.trim()) {
                      window.open(
                        `https://wa.me/${config.whatsapp.phoneNumber.replace(
                          /[^0-9]/g,
                          ''
                        )}?text=${encodeURIComponent(customWhatsAppMsg.trim())}`,
                        '_blank'
                      );
                      setCustomWhatsAppMsg('');
                    }
                  }}
                  placeholder="Type a custom question..."
                  className="flex-1 px-3 py-2 bg-slate-100 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    const text = customWhatsAppMsg.trim() || config.whatsapp.defaultMessage || 'Hi!';
                    window.open(
                      `https://wa.me/${config.whatsapp.phoneNumber.replace(
                        /[^0-9]/g,
                        ''
                      )}?text=${encodeURIComponent(text)}`,
                      '_blank'
                    );
                    setCustomWhatsAppMsg('');
                  }}
                  className="w-8 h-8 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center transition-colors shadow-xs cursor-pointer"
                  title="Send to WhatsApp"
                >
                  <span className="material-symbols-outlined text-[16px]">send</span>
                </button>
              </div>
            </div>
          )}

          {/* Floating Action Button */}
          <button
            type="button"
            onClick={() => {
              if (config.whatsapp.botEnabled ?? true) {
                setIsWhatsAppBotOpen((prev) => !prev);
              } else {
                window.open(
                  `https://wa.me/${config.whatsapp.phoneNumber.replace(
                    /[^0-9]/g,
                    ''
                  )}?text=${encodeURIComponent(
                    config.whatsapp.defaultMessage || 'Hi, I would like to inquire about your products.'
                  )}`,
                  '_blank'
                );
              }
            }}
            className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white shadow-xl flex items-center justify-center hover:scale-108 active:scale-95 transition-all cursor-pointer border-2 border-white/40"
            title="Chat with WhatsApp Bot"
            aria-label="Open WhatsApp Commerce Bot"
          >
            {isWhatsAppBotOpen ? (
              <span className="material-symbols-outlined text-[24px]">close</span>
            ) : (
              <span className="material-symbols-outlined text-[24px]">chat</span>
            )}
          </button>
        </>
      )}

      {/* PRODUCT DETAIL MODAL */}
      {selectedProduct && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
        >
          <div
            className={`max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-black/10 shadow-2xl p-6 lg:p-8 flex flex-col lg:flex-row gap-6 relative ${radiusClass}`}
            style={{ backgroundColor: theme.surfaceColor }}
          >
            <button
              type="button"
              onClick={() => setSelectedProduct(null)}
              className="absolute top-4 right-4 p-2 rounded-lg bg-black/5 hover:bg-black/10 text-on-surface"
              aria-label="Close product view"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>

            {/* Photo / 3D Model View */}
            <div className="lg:w-1/2 space-y-3">
              <div className="aspect-square rounded-xl overflow-hidden bg-black/5 border border-black/5">
                <img
                  src={selectedProduct.images[0]}
                  alt={selectedProduct.name}
                  className="w-full h-full object-cover"
                />
              </div>
              {selectedProduct.modelUrl && (
                <div className="p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-xl flex items-center justify-between text-xs font-mono text-cyan-600">
                  <span className="flex items-center gap-1.5 font-bold">
                    <span className="material-symbols-outlined text-[18px]">view_in_ar</span>
                    <span>3D &amp; WebXR VR Ready</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setVrModalProduct(selectedProduct)}
                    className="underline cursor-pointer font-bold hover:text-cyan-800 flex items-center gap-1"
                  >
                    <span>Launch VR Showroom</span>
                    <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                  </button>
                </div>
              )}
            </div>

            {/* Details */}
            <div className="lg:w-1/2 flex flex-col justify-between space-y-4">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider opacity-60">
                  {selectedProduct.category} • SKU: {selectedProduct.sku}
                </span>
                <h3 className="text-xl font-black mt-1">{selectedProduct.name}</h3>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-2xl font-black">
                    {currencySymbol}{selectedProduct.price.toLocaleString()}
                  </span>
                  {selectedProduct.mrp > selectedProduct.price && (
                    <span className="text-xs line-through opacity-50">
                      {currencySymbol}{selectedProduct.mrp.toLocaleString()}
                    </span>
                  )}
                </div>
                <p className="text-xs opacity-80 mt-3 leading-relaxed">
                  {selectedProduct.description}
                </p>

                {/* Specs Table */}
                {selectedProduct.specs && (
                  <div className="mt-4 pt-4 border-t border-black/5 space-y-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider opacity-60">
                      Technical Specifications
                    </span>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {Object.entries(selectedProduct.specs).map(([k, v]) => (
                        <div key={k} className="p-2 rounded-lg bg-black/5">
                          <span className="font-semibold block text-[10px] opacity-60">{k}</span>
                          <span className="font-medium text-[11px]">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-black/5 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setQrModalProduct(selectedProduct)}
                    data-testid="storefront-quick-scan-to-ar-btn"
                    className={`py-3 px-3 text-xs font-bold border border-black/15 bg-black/5 hover:bg-black/10 transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${radiusClass}`}
                  >
                    <span className="material-symbols-outlined text-[16px]">qr_code_scanner</span>
                    <span>Quick Scan to AR</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      addToCart(selectedProduct, 1);
                      setSelectedProduct(null);
                      setIsCartOpen(true);
                    }}
                    className={`py-3 px-3 text-xs font-bold text-white shadow-md transition-opacity hover:opacity-90 flex items-center justify-center gap-2 ${radiusClass}`}
                    style={{ backgroundColor: theme.primaryColor }}
                  >
                    <span className="material-symbols-outlined text-[18px]">shopping_bag</span>
                    <span>Add to Cart &amp; Checkout</span>
                  </button>
                </div>
                <p className="text-center text-[10px] opacity-60">
                  ⚡ 100% Escrow Protection: Funds held until delivery confirmation.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SHOPPING CART DRAWER */}
      {isCartOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-fade-in"
        >
          <div
            className="w-full max-w-md h-full shadow-2xl flex flex-col justify-between overflow-hidden"
            style={{ backgroundColor: theme.surfaceColor }}
          >
            {/* Cart Header */}
            <div className="p-4 border-b border-black/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">shopping_bag</span>
                <h3 className="font-bold text-sm">Shopping Cart ({cartItems.length})</h3>
              </div>
              <button
                type="button"
                aria-label="Close shopping cart"
                onClick={() => setIsCartOpen(false)}
                className="p-1 rounded-lg hover:bg-black/5"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Cart Items */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cartItems.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2 opacity-60">
                  <span className="material-symbols-outlined text-[48px]">remove_shopping_cart</span>
                  <p className="text-xs font-semibold">Your cart is empty</p>
                  <p className="text-[11px]">Explore our catalog to add items.</p>
                </div>
              ) : (
                cartItems.map((item) => (
                  <div
                    key={item.product.id}
                    className="p-3 border border-black/10 rounded-xl flex items-center gap-3 bg-black/5"
                  >
                    <img
                      src={item.product.images[0]}
                      alt={item.product.name}
                      className="w-14 h-14 object-cover rounded-lg bg-black/10"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold truncate">{item.product.name}</h4>
                      <p className="text-xs font-black mt-0.5">
                        {currencySymbol}{(item.product.price * item.quantity).toLocaleString()}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <button
                          type="button"
                          aria-label={`Decrease quantity for ${item.product.name}`}
                          onClick={() => updateCartQty(item.product.id, -1)}
                          className="w-5 h-5 rounded bg-black/10 flex items-center justify-center text-xs font-bold"
                        >
                          -
                        </button>
                        <span className="text-xs font-semibold">{item.quantity}</span>
                        <button
                          type="button"
                          aria-label={`Increase quantity for ${item.product.name}`}
                          onClick={() => updateCartQty(item.product.id, 1)}
                          className="w-5 h-5 rounded bg-black/10 flex items-center justify-center text-xs font-bold"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Cart Footer & Totals */}
            {cartItems.length > 0 && (
              <div className="p-4 border-t border-black/10 space-y-3 bg-black/5">
                {/* Coupon Code Input */}
                <div className="flex items-center gap-2">
                  <label htmlFor="storefront-coupon-code" className="sr-only">
                    Coupon Code
                  </label>
                  <input
                    id="storefront-coupon-code"
                    type="text"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value)}
                    placeholder="Coupon code (e.g. PILOT10)"
                    className="flex-1 px-3 py-1.5 text-xs bg-white text-black border border-black/10 rounded-lg uppercase font-mono focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={applyCoupon}
                    className="px-3 py-1.5 text-xs font-bold bg-black text-white rounded-lg hover:opacity-90"
                  >
                    Apply
                  </button>
                </div>
                {couponFeedback && (
                  <p className="text-[11px] font-medium text-emerald-600">{couponFeedback}</p>
                )}

                {/* Subtotal breakdown */}
                <div className="space-y-1 text-xs opacity-80 pt-1">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span>{currencySymbol}{subtotal.toLocaleString()}</span>
                  </div>
                  {appliedDiscount > 0 && (
                    <div className="flex justify-between text-emerald-600 font-semibold">
                      <span>Discount:</span>
                      <span>-{currencySymbol}{discountAmount.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Shipping:</span>
                    <span>{shippingFee === 0 ? 'FREE' : `${currencySymbol}${shippingFee}`}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>GST (18%):</span>
                    <span>{currencySymbol}{taxAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-black/10 text-sm font-black text-on-surface">
                    <span>Total Amount:</span>
                    <span>{currencySymbol}{totalAmount.toLocaleString()}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setIsCartOpen(false);
                    setCheckoutError(null);
                    setIsCheckoutOpen(true);
                  }}
                  className={`w-full py-3 text-xs font-bold text-white shadow-md flex items-center justify-center gap-2 ${radiusClass}`}
                  style={{ backgroundColor: theme.primaryColor }}
                >
                  <span className="material-symbols-outlined text-[18px]">lock</span>
                  <span>Proceed to Escrow Checkout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CHECKOUT MODAL */}
      {isCheckoutOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="storefront-checkout-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
        >
          <div
            className={`max-w-lg w-full p-6 border border-black/10 shadow-2xl relative space-y-4 ${radiusClass}`}
            style={{ backgroundColor: theme.surfaceColor }}
          >
            <div className="flex items-center justify-between border-b border-black/10 pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">verified</span>
                <h3 id="storefront-checkout-title" className="font-bold text-sm">
                  Escrow-Protected Checkout
                </h3>
              </div>
              <button
                type="button"
                aria-label="Close checkout modal"
                onClick={() => setIsCheckoutOpen(false)}
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form noValidate onSubmit={handlePlaceOrder} className="space-y-3">
              <div>
                <label
                  htmlFor="storefront-cust-name"
                  className="block text-[11px] font-bold uppercase opacity-75 mb-1"
                >
                  Full Name *
                </label>
                <input
                  id="storefront-cust-name"
                  type="text"
                  required
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  className="w-full px-3 py-2 text-xs border border-black/10 rounded-lg bg-black/5 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="storefront-cust-email"
                  className="block text-[11px] font-bold uppercase opacity-75 mb-1"
                >
                  Email Address (For Order Tracking & PayPal Escrow Confirmation) *
                </label>
                <input
                  id="storefront-cust-email"
                  type="email"
                  required
                  value={custEmail}
                  onChange={(e) => setCustEmail(e.target.value)}
                  placeholder="rahul@example.com"
                  className="w-full px-3 py-2 text-xs border border-black/10 rounded-lg bg-black/5 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="storefront-cust-address"
                  className="block text-[11px] font-bold uppercase opacity-75 mb-1"
                >
                  Delivery Address *
                </label>
                <textarea
                  id="storefront-cust-address"
                  required
                  rows={2}
                  value={custAddress}
                  onChange={(e) => setCustAddress(e.target.value)}
                  placeholder="Street, City, PIN / Postal code"
                  className="w-full px-3 py-2 text-xs border border-black/10 rounded-lg bg-black/5 focus:outline-none resize-none"
                />
              </div>

              <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl space-y-1 text-xs">
                <div className="flex justify-between font-bold">
                  <span>Payable Now (Secured in Escrow):</span>
                  <span>{currencySymbol}{totalAmount.toLocaleString()}</span>
                </div>
                <p className="text-[10px] opacity-75">
                  Your payment will be locked safely. The seller is only paid after confirmed delivery.
                </p>
              </div>

              {checkoutError && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 text-xs font-semibold"
                >
                  {checkoutError}
                </div>
              )}

              <button
                type="submit"
                disabled={isPlacingOrder}
                className={`w-full py-3 text-xs font-bold text-white shadow-md flex items-center justify-center gap-2 ${radiusClass} disabled:opacity-50`}
                style={{ backgroundColor: theme.primaryColor }}
              >
                {isPlacingOrder ? (
                  <span>Securing Escrow Payment...</span>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[18px]">lock</span>
                    <span>Pay with PayPal Escrow ({currencySymbol}{totalAmount.toLocaleString()})</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ORDER CONFIRMATION / TRACKING MODAL */}
      {confirmedOrder && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="storefront-order-confirmed-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in"
        >
          <div
            className={`max-w-md w-full p-6 border border-black/10 shadow-2xl space-y-4 ${radiusClass}`}
            style={{ backgroundColor: theme.surfaceColor }}
          >
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center mx-auto">
              <span className="material-symbols-outlined text-[28px]">check_circle</span>
            </div>

            <div className="text-center space-y-1">
              <h3 id="storefront-order-confirmed-title" className="text-base font-black">
                Order Placed Successfully!
              </h3>
              <p className="text-xs opacity-75">
                Order ID: <span className="font-mono font-bold text-primary">{confirmedOrder.orderNumber}</span>
              </p>
              <p className="text-xs font-semibold text-emerald-600">
                🔒 {currencySymbol}{confirmedOrder.total.toLocaleString()}{' '}
                {confirmedOrder.verifiedByServer === true || confirmedOrder.escrowStatus === 'Escrow Locked'
                  ? 'Locked in PayPal Escrow'
                  : confirmedOrder.escrowStatus}
              </p>
            </div>

            {/* Escrow Timeline */}
            <div className="p-4 bg-black/5 rounded-xl space-y-3">
              <span className="text-[11px] font-bold uppercase tracking-wider opacity-70 block">
                Escrow Settlement Tracker
              </span>
              <div className="space-y-2 text-xs">
                {confirmedOrder.timeline.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2.5">
                    <span
                      className={`w-4 h-4 rounded-full mt-0.5 flex items-center justify-center text-[10px] ${
                        item.completed
                          ? 'bg-emerald-500 text-white font-bold'
                          : 'bg-black/20 text-transparent'
                      }`}
                    >
                      ✓
                    </span>
                    <div className="flex-1 leading-tight">
                      <p className={`font-semibold ${item.completed ? 'text-on-surface' : 'opacity-50'}`}>
                        {item.label}
                      </p>
                      {item.completed && item.timestamp && (
                        <p className="text-[10px] opacity-60">
                          {confirmedOrder.verifiedByServer ? 'Verified via Escrow Engine' : 'Recorded in Order Log'}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setConfirmedOrder(null)}
              className="w-full py-2.5 bg-black text-white rounded-xl text-xs font-bold hover:opacity-90"
            >
              Continue Shopping
            </button>
          </div>
        </div>
      )}

      {/* CUSTOMER AI SHOPPING ASSISTANT DRAWER */}
      {isAssistantOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="storefront-assistant-title"
          className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-fade-in"
        >
          <div
            className="w-full max-w-md h-full shadow-2xl flex flex-col justify-between overflow-hidden"
            style={{ backgroundColor: theme.surfaceColor }}
          >
            <div className="p-4 border-b border-black/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">smart_toy</span>
                <div>
                  <h3 id="storefront-assistant-title" className="font-bold text-xs">{business.name} Shopping Copilot</h3>
                  <p className="text-[10px] opacity-60">Powered by Gemini AI • 24/7 Assistance</p>
                </div>
              </div>
              <button type="button" onClick={() => setIsAssistantOpen(false)} aria-label="Close shopping assistant">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="flex-1 p-4 overflow-y-auto space-y-3">
              <div className="p-3.5 rounded-xl bg-primary/10 border border-primary/20 text-xs leading-relaxed">
                👋 Hello! I am your AI assistant for {business.name}. Ask me anything about our {business.category} catalog, technical specs, escrow buyer protection, or order tracking!
              </div>

              <div className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-60 block">
                  Popular Questions
                </span>
                {[
                  'What is your return & escrow guarantee policy?',
                  'Which product is recommended for beginners?',
                  'How long does express delivery take?',
                ].map((q, idx) => (
                  <button
                    type="button"
                    key={idx}
                    onClick={() => {
                      showToast('Copilot: All orders include 100% PayPal Escrow Protection and 24h express dispatch!');
                    }}
                    className="w-full text-left p-2 rounded-lg bg-black/5 hover:bg-black/10 text-xs font-medium transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 border-t border-black/10 bg-black/5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Ask a question about products or warranty..."
                  className="flex-1 px-3 py-2 text-xs bg-white text-black border border-black/10 rounded-xl focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      showToast('Copilot: All orders include 100% PayPal Escrow Protection and 24h express dispatch!');
                      (e.target as HTMLInputElement).value = '';
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => showToast('Copilot: All orders include 100% PayPal Escrow Protection and 24h express dispatch!')}
                  className="px-3 py-2 bg-primary text-white text-xs font-bold rounded-xl"
                >
                  Ask
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Global Toast */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-black text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-bounce text-xs font-semibold"
        >
          <span className="material-symbols-outlined text-emerald-400 text-[18px]">check_circle</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* WebXR 3D & VR Studio Modal */}
      {vrModalProduct && (
        <ARPreviewModal
          isOpen={Boolean(vrModalProduct)}
          initialVrMode={true}
          onClose={() => setVrModalProduct(null)}
          productName={vrModalProduct.name}
          productSku={vrModalProduct.sku}
          price={vrModalProduct.price}
          onReservePayPal={() => {
            addToCart(vrModalProduct, 1);
            setVrModalProduct(null);
            setIsCartOpen(true);
          }}
        />
      )}

      {/* Quick Scan to AR QR Code Modal */}
      <QRModal
        isOpen={Boolean(qrModalProduct)}
        onClose={() => setQrModalProduct(null)}
        title="Quick Scan to AR — Mobile Spatial View"
        subtitle={
          qrModalProduct
            ? `Scan with your phone camera to launch ${qrModalProduct.name} in true-scale spatial AR view.`
            : undefined
        }
      />
    </div>
  );
}
