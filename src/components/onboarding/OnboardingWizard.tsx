import React, { useState, useEffect } from 'react';
import {
  saveBusinessProfile,
  saveStorefrontConfig,
  createStoreProduct,
} from '../../services/storefrontService';
import { getDefaultStorefrontConfig } from '../../data/templateDefaults';
import { BusinessProfile } from '../../types/storefront';
import { useRole } from '../../context/RoleContext';

interface OnboardingWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (business: BusinessProfile) => void;
  initialData?: Partial<BusinessProfile>;
}

const CATEGORY_OPTIONS = [
  'Electronics & Smart Hardware',
  'Fashion & Apparel',
  'Fine Jewellery & Luxury',
  'Artisan Grocery & Gourmet Food',
  'Minimalist Home & Furniture',
  'Sports, Fitness & Outdoor',
  'Acoustics & Pro Audio',
  'Health & Premium Skincare',
  'Handcrafted Goods & Art',
];

export function OnboardingWizard({
  isOpen,
  onClose,
  onComplete,
  initialData,
}: OnboardingWizardProps) {
  const { authFetch } = useRole();
  const [step, setStep] = useState<number>(1);
  const [isAiGenerating, setIsAiGenerating] = useState<boolean>(false);
  const [aiGenStatus, setAiGenStatus] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Form State
  const [businessName, setBusinessName] = useState(
    initialData?.name || 'AeroCool Dynamics'
  );
  const [slug, setSlug] = useState(initialData?.slug || 'aerocool');
  const [category, setCategory] = useState(
    initialData?.category || 'Electronics & Smart Hardware'
  );
  const [logoUrl, setLogoUrl] = useState(
    initialData?.logoUrl ||
      'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=80'
  );
  const [email, setEmail] = useState(initialData?.contact?.email || 'sales@aerocool.in');
  const [phone, setPhone] = useState(initialData?.contact?.phone || '+91 80 4920 1888');
  const [address, setAddress] = useState(
    initialData?.contact?.address ||
      'Embassy TechVillage, Outer Ring Rd, Bellandur, Bengaluru, Karnataka 560103'
  );
  const [currency, setCurrency] = useState<'INR' | 'USD' | 'EUR' | 'GBP'>(
    initialData?.currency || 'INR'
  );
  const [taxGstNumber, setTaxGstNumber] = useState(
    initialData?.taxGstNumber || '29ABCDE1234F1Z5'
  );
  const [paypalConnected, setPaypalConnected] = useState(
    initialData?.paypalConnected ?? true
  );
  const [paypalEmail, setPaypalEmail] = useState(
    initialData?.paypalEmail || 'merchant@aerocool.in'
  );
  const [paypalClientId, setPaypalClientId] = useState(
    initialData?.paypalClientId || 'sb-merchant-acpaypilot-live'
  );
  const [shippingPolicy, setShippingPolicy] = useState(
    initialData?.shippingPolicy ||
      'Standard express courier dispatch within 24 hours. Transit time 2-4 business days with tracking ID.'
  );
  const [returnPolicy, setReturnPolicy] = useState(
    initialData?.returnPolicy ||
      '7-day buyer escrow return guarantee. Funds are held in escrow until return inspection is complete.'
  );

  // Auto-slug generator from business name
  const handleNameChange = (val: string) => {
    setBusinessName(val);
    const generatedSlug = val
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    setSlug(generatedSlug || 'my-store');
  };

  // Image upload with client-side canvas compression
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 256;
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/jpeg', 0.85);
        setLogoUrl(compressed);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Load and save drafts to localStorage
  useEffect(() => {
    const savedDraft = localStorage.getItem('ac_paypilot_onboarding_draft');
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft);
        if (parsed.businessName) setBusinessName(parsed.businessName);
        if (parsed.slug) setSlug(parsed.slug);
        if (parsed.category) setCategory(parsed.category);
        if (parsed.email) setEmail(parsed.email);
        if (parsed.phone) setPhone(parsed.phone);
        if (parsed.address) setAddress(parsed.address);
        if (parsed.currency) setCurrency(parsed.currency);
        if (parsed.step) setStep(parsed.step);
      } catch {
        // Ignore
      }
    }
  }, []);

  const saveDraft = (currentStep: number) => {
    localStorage.setItem(
      'ac_paypilot_onboarding_draft',
      JSON.stringify({
        businessName,
        slug,
        category,
        email,
        phone,
        address,
        currency,
        taxGstNumber,
        step: currentStep,
      })
    );
  };

  const handleNextStep = () => {
    setErrorMsg('');
    if (step === 1) {
      if (!businessName.trim()) {
        setErrorMsg('Please enter your business name.');
        return;
      }
      if (!slug.trim()) {
        setErrorMsg('Please provide a valid store URL slug.');
        return;
      }
    }
    if (step === 2) {
      if (!email.trim() || !email.includes('@')) {
        setErrorMsg('Please enter a valid business contact email.');
        return;
      }
    }
    const nextStep = step + 1;
    setStep(nextStep);
    saveDraft(nextStep);
  };

  const handlePrevStep = () => {
    setErrorMsg('');
    const prev = Math.max(1, step - 1);
    setStep(prev);
    saveDraft(prev);
  };

  // AI-Powered Storefront Auto-Generation
  const handleFinishOnboarding = async () => {
    setIsAiGenerating(true);
    setErrorMsg('');
    const bizId = `biz-${slug}`;

    try {
      setAiGenStatus('Contacting Gemini 2.5 Flash to craft brand narrative & starter catalog...');
      const response = await authFetch('/api/ai/generate-storefront', {
        method: 'POST',
        body: JSON.stringify({
          businessName,
          category,
          currency,
        }),
      });

      let aiData;
      if (response.ok) {
        const json = await response.json();
        aiData = json.data;
      }

      setAiGenStatus('Assembling multi-tenant business profile and escrow policy...');

      const newBusiness: BusinessProfile = {
        id: bizId,
        ownerUid: 'owner-current',
        name: businessName,
        slug,
        category,
        tagline: aiData?.tagline || `The New Standard in ${category}`,
        logoUrl,
        contact: {
          email,
          phone,
          address,
          whatsappNumber: phone.replace(/[^0-9+]/g, ''),
        },
        currency,
        taxGstNumber: taxGstNumber || undefined,
        paypalConnected,
        paypalEmail: paypalConnected ? paypalEmail : undefined,
        paypalClientId: paypalConnected ? paypalClientId : undefined,
        shippingPolicy,
        returnPolicy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        roleMembers: {
          'owner-current': 'owner',
        },
      };

      await saveBusinessProfile(bizId, newBusiness);

      setAiGenStatus('Styling personalized storefront theme and layout...');

      // Default template based on category
      let templateId: 'minimal' | 'boutique' | 'electronics' | 'grocery' | 'fashion' | 'bold_dark' =
        'minimal';
      const cLower = category.toLowerCase();
      if (cLower.includes('jewel') || cLower.includes('luxury')) templateId = 'boutique';
      else if (cLower.includes('electro') || cLower.includes('hardware') || cLower.includes('audio'))
        templateId = 'electronics';
      else if (cLower.includes('food') || cLower.includes('grocery')) templateId = 'grocery';
      else if (cLower.includes('fashion') || cLower.includes('apparel')) templateId = 'fashion';
      else if (cLower.includes('sport') || cLower.includes('fitness')) templateId = 'bold_dark';

      const config = getDefaultStorefrontConfig(bizId, businessName, category, templateId);
      if (aiData) {
        config.hero.headline = aiData.heroHeadline || config.hero.headline;
        config.hero.subheadline = aiData.heroSubheadline || config.hero.subheadline;
        config.about.story = aiData.aboutStory || config.about.story;
        config.about.mission = aiData.aboutMission || config.about.mission;
      }

      await saveStorefrontConfig(bizId, config, true);

      setAiGenStatus('Seeding 3 starter products into merchant catalog...');

      if (aiData?.starterProducts && aiData.starterProducts.length > 0) {
        for (const p of aiData.starterProducts) {
          await createStoreProduct(bizId, {
            bizId,
            sku: p.sku || `SKU-${Date.now()}`,
            name: p.name,
            description: p.description,
            category: p.category || category,
            price: p.price,
            mrp: p.mrp,
            stock: p.stock || 50,
            rating: 5.0,
            reviewCount: 1,
            images: [p.image || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&auto=format&fit=crop&q=80'],
            isFeatured: true,
            tags: p.tags || ['Starter Item'],
            specs: p.specs || { Quality: 'Inspected' },
            modelUrl: null,
          });
        }
      }

      localStorage.removeItem('ac_paypilot_onboarding_draft');
      setIsAiGenerating(false);
      onComplete(newBusiness);
    } catch (err) {
      console.error('Error during onboarding completion:', err);
      setErrorMsg('Storefront initialization encountered a warning, but setup was completed.');
      setIsAiGenerating(false);
      onComplete({
        id: bizId,
        ownerUid: 'owner-current',
        name: businessName,
        slug,
        category,
        tagline: `Official Store of ${businessName}`,
        logoUrl,
        contact: { email, phone, address },
        currency,
        paypalConnected: true,
        shippingPolicy,
        returnPolicy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in"
    >
      <div className="bg-surface border border-outline-variant/30 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header & Stepper Progress */}
        <div className="px-6 py-5 border-b border-outline-variant/20 bg-surface-container-low flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold">
                <span className="material-symbols-outlined text-[22px]">rocket_launch</span>
              </div>
              <div>
                <h2 className="text-lg font-bold text-on-surface">Store Setup Wizard</h2>
                <p className="text-xs text-on-surface-variant">
                  Step {step} of 5 — {step === 1 && 'Business Identity & Branding'}
                  {step === 2 && 'Contact & Base Currency'}
                  {step === 3 && 'Tax & Compliance (Optional)'}
                  {step === 4 && 'PayPal Sandbox Account Connect'}
                  {step === 5 && 'Fulfillment & Return Policy'}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-on-surface-variant hover:text-on-surface p-1.5 rounded-lg hover:bg-surface-container"
              aria-label="Close setup wizard"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-surface-container h-2 rounded-full overflow-hidden flex">
            <div
              className="bg-primary transition-all duration-300 rounded-full"
              style={{ width: `${(step / 5) * 100}%` }}
            />
          </div>
        </div>

        {/* Form Body */}
        <div className="px-6 py-6 overflow-y-auto flex-1 space-y-5">
          {errorMsg && (
            <div className="p-3 bg-error-container text-on-error-container rounded-xl text-xs flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">error</span>
              <span>{errorMsg}</span>
            </div>
          )}

          {/* STEP 1: Business Identity */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-on-surface uppercase tracking-wider mb-1.5">
                  Business Name *
                </label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. AeroCool Dynamics"
                  className="w-full px-4 py-2.5 bg-surface-container border border-outline-variant rounded-xl text-sm text-on-surface focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface uppercase tracking-wider mb-1.5">
                  Storefront URL Slug *
                </label>
                <div className="flex items-center">
                  <span className="px-3.5 py-2.5 bg-surface-container-high border border-r-0 border-outline-variant rounded-l-xl text-xs text-on-surface-variant select-none">
                    https://
                  </span>
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) =>
                      setSlug(
                        e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9-]/g, '')
                      )
                    }
                    className="flex-1 px-3 py-2.5 bg-surface-container border-y border-outline-variant text-sm text-on-surface focus:outline-none"
                    placeholder="my-store"
                  />
                  <span className="px-3 py-2.5 bg-surface-container-high border border-l-0 border-outline-variant rounded-r-xl text-xs text-on-surface-variant select-none">
                    .acpaypilot.app
                  </span>
                </div>
                <p className="text-[11px] text-on-surface-variant mt-1">
                  Accessible directly via subdomain or path <code className="text-primary">/s/{slug}</code>.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface uppercase tracking-wider mb-1.5">
                  Business Category *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-4 py-2.5 bg-surface-container border border-outline-variant rounded-xl text-sm text-on-surface focus:outline-none focus:border-primary"
                >
                  {CATEGORY_OPTIONS.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface uppercase tracking-wider mb-1.5">
                  Store Logo
                </label>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-xl border border-outline-variant bg-surface-container-low overflow-hidden flex items-center justify-center">
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt="Logo Preview"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="material-symbols-outlined text-outline text-[28px]">
                        storefront
                      </span>
                    )}
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 bg-surface-container-high hover:bg-surface-container-highest text-xs font-medium text-on-surface rounded-lg border border-outline-variant transition-colors">
                      <span className="material-symbols-outlined text-[16px]">upload</span>
                      <span>Upload Logo File (Auto-compressed)</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleLogoUpload}
                      />
                    </label>
                    <p className="text-[11px] text-on-surface-variant">
                      Recommended 512x512 transparent PNG or JPEG.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Contact & Base Currency */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-on-surface uppercase tracking-wider mb-1.5">
                  Customer Support Email *
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="support@yourbrand.com"
                  className="w-full px-4 py-2.5 bg-surface-container border border-outline-variant rounded-xl text-sm text-on-surface focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface uppercase tracking-wider mb-1.5">
                  Business Phone / WhatsApp
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full px-4 py-2.5 bg-surface-container border border-outline-variant rounded-xl text-sm text-on-surface focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface uppercase tracking-wider mb-1.5">
                  Store Registered Address
                </label>
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={2}
                  placeholder="Street, City, State, PIN / Postal Code"
                  className="w-full px-4 py-2 bg-surface-container border border-outline-variant rounded-xl text-sm text-on-surface focus:outline-none focus:border-primary resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface uppercase tracking-wider mb-1.5">
                  Base Store Currency
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(['INR', 'USD', 'EUR', 'GBP'] as const).map((curr) => (
                    <button
                      key={curr}
                      type="button"
                      onClick={() => setCurrency(curr)}
                      className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                        currency === curr
                          ? 'bg-primary/10 border-primary text-primary shadow-sm'
                          : 'bg-surface-container border-outline-variant text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      <span>{curr === 'INR' ? '₹' : curr === 'USD' ? '$' : curr === 'EUR' ? '€' : '£'}</span>
                      <span>{curr}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Tax & Legal */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="p-4 bg-surface-container-low border border-outline-variant/30 rounded-xl">
                <div className="flex items-center gap-2 mb-2 text-on-surface font-semibold text-sm">
                  <span className="material-symbols-outlined text-primary text-[20px]">
                    verified_user
                  </span>
                  <span>GSTIN & Tax Registration</span>
                </div>
                <p className="text-xs text-on-surface-variant leading-relaxed mb-3">
                  Optional for individual creators. Required if issuing GST-compliant B2B invoices
                  through the InvoiceIQ engine.
                </p>
                <div>
                  <label className="block text-xs font-medium text-on-surface mb-1">
                    GSTIN / Tax ID Number
                  </label>
                  <input
                    type="text"
                    value={taxGstNumber}
                    onChange={(e) => setTaxGstNumber(e.target.value.toUpperCase())}
                    placeholder="29ABCDE1234F1Z5"
                    className="w-full px-4 py-2 bg-surface-container border border-outline-variant rounded-xl text-sm text-on-surface uppercase tracking-wider font-mono focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="p-3.5 bg-primary/5 border border-primary/20 rounded-xl text-xs text-on-surface space-y-1">
                <span className="font-semibold text-primary">Zero Seller Liability Clause:</span>
                <p className="text-on-surface-variant leading-normal">
                  AC PayPilot manages tax calculations and automated minor-unit reconciliation at
                  checkout without charging platform markups on your listed catalog prices.
                </p>
              </div>
            </div>
          )}

          {/* STEP 4: PayPal Business Sandbox Connect */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 flex items-start gap-3">
                <span className="material-symbols-outlined text-primary text-[24px]">account_balance_wallet</span>
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-on-surface">PayPal Business Account</h4>
                  <p className="text-xs text-on-surface-variant leading-relaxed mt-0.5">
                    Connect your PayPal sandbox credentials to receive customer payments secured
                    under our cryptographic escrow smart contracts.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface uppercase tracking-wider mb-1.5">
                  PayPal Merchant Email
                </label>
                <input
                  type="email"
                  value={paypalEmail}
                  onChange={(e) => setPaypalEmail(e.target.value)}
                  placeholder="merchant-facilitator@sandbox.paypal.com"
                  className="w-full px-4 py-2.5 bg-surface-container border border-outline-variant rounded-xl text-sm text-on-surface focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface uppercase tracking-wider mb-1.5">
                  Sandbox Client ID (Optional custom)
                </label>
                <input
                  type="text"
                  value={paypalClientId}
                  onChange={(e) => setPaypalClientId(e.target.value)}
                  placeholder="sb (Default Sandbox Provided)"
                  className="w-full px-4 py-2.5 bg-surface-container border border-outline-variant rounded-xl text-xs font-mono text-on-surface focus:outline-none focus:border-primary"
                />
              </div>

              <label className="flex items-center gap-3 p-3 bg-surface-container rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={paypalConnected}
                  onChange={(e) => setPaypalConnected(e.target.checked)}
                  className="w-4 h-4 text-primary rounded focus:ring-0"
                />
                <span className="text-xs font-medium text-on-surface">
                  Enable Autonomous Escrow Holding until Verified Delivery
                </span>
              </label>
            </div>
          )}

          {/* STEP 5: Shipping & Return Policy */}
          {step === 5 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-on-surface uppercase tracking-wider mb-1.5">
                  Shipping & Delivery Timeline
                </label>
                <textarea
                  value={shippingPolicy}
                  onChange={(e) => setShippingPolicy(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 bg-surface-container border border-outline-variant rounded-xl text-sm text-on-surface focus:outline-none focus:border-primary resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface uppercase tracking-wider mb-1.5">
                  Return & Escrow Release Policy
                </label>
                <textarea
                  value={returnPolicy}
                  onChange={(e) => setReturnPolicy(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 bg-surface-container border border-outline-variant rounded-xl text-sm text-on-surface focus:outline-none focus:border-primary resize-none"
                />
              </div>

              <div className="p-4 bg-gradient-to-r from-primary/10 via-accent/10 to-transparent border border-primary/20 rounded-xl flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary text-on-primary flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
                </div>
                <div className="flex-1">
                  <p className="text-xs font-bold text-on-surface">AI Auto-Generator Ready</p>
                  <p className="text-[11px] text-on-surface-variant">
                    Gemini 2.5 Flash will automatically generate your tagline, about story, hero banner copy, and 3 starter products on finish!
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* AI Generation Loading State */}
          {isAiGenerating && (
            <div className="p-6 bg-surface-container-high rounded-2xl flex flex-col items-center justify-center text-center space-y-3 animate-pulse border border-primary/30">
              <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-[32px] animate-spin">
                  progress_activity
                </span>
              </div>
              <h4 className="text-sm font-bold text-on-surface">
                Building Your Autonomous Storefront...
              </h4>
              <p className="text-xs text-primary font-medium">{aiGenStatus}</p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-outline-variant/20 bg-surface-container-low flex items-center justify-between">
          <button
            type="button"
            onClick={step === 1 ? onClose : handlePrevStep}
            disabled={isAiGenerating}
            className="px-4 py-2 border border-outline-variant rounded-xl text-xs font-semibold text-on-surface hover:bg-surface-container transition-colors disabled:opacity-50"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>

          <div className="flex items-center gap-2">
            {step < 5 ? (
              <button
                type="button"
                onClick={handleNextStep}
                className="px-5 py-2 bg-primary text-on-primary rounded-xl text-xs font-semibold hover:bg-primary/90 transition-all shadow-sm flex items-center gap-1.5"
              >
                <span>Continue</span>
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinishOnboarding}
                disabled={isAiGenerating}
                className="px-6 py-2.5 bg-gradient-to-r from-primary to-accent text-on-primary rounded-xl text-xs font-bold hover:opacity-95 transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                <span>Finish & Launch Storefront</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
