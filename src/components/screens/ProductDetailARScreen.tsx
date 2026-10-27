import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatINR } from '../../utils/finance';
import {
  AISuggestionCard,
  MoneyBreakdownCard,
  CollectionViewState,
} from '../ui/HonestTrustComponents';
import { useRole } from '../../context/RoleContext';
import { ProductARViewerSection } from './ProductARViewerSection';
import { ProductSpecsAndQASection } from './ProductSpecsAndQASection';
import { QRModal } from '../modals/QRModal';

interface ProductDetailARScreenProps {
  selectedProduct?: any;
  onAddToCart?: (product: any) => void;
  onBuyNow?: (product: any) => void;
  onOpenQRModal?: () => void;
  onOpenARModal?: () => void;
  showToast?: (msg: string) => void;
}

export type ARPanelState =
  | 'ready'
  | 'loading'
  | 'model_unavailable'
  | 'ar_unsupported'
  | 'camera_denied';

const DEMO_3D_PRODUCTS: Record<string, any> = {
  'FAN-BLDC-892': {
    sku: '#FAN-BLDC-892',
    name: 'AeroBreeze Stealth 1200mm Smart BLDC Ceiling Fan',
    price: 8499,
    mrp: 12999,
    gstRate: 18,
    hsCode: '8414.51.10',
    category: 'Home Appliances > Smart Ceiling Fans',
    stock: 120,
    modelUrl: '/api/models/ceiling-fan.glb',
    specs: [
      '28W @ Speed 6 (BLDC)',
      '235 CMM @ 380 RPM',
      '1200 mm (48") Sweep',
      '28 dB Whisper Silent',
    ],
    dimensions: '1200 × 1200 × 340 mm',
    weight: '3.8 kg',
    warranty: '3 Years On-Site Replacement',
    aiMatchScore: 99,
    aiReason:
      '28W Brushless DC motor reduces power draw by 65% compared with standard 75W fans while delivering 235 CMM airflow across a 1200mm sweep.',
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
      'Isometric High-Modulus Graphite frame with Rotational Generator System counterweight balance.',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDURq8df1AvNhd6BXPOnLSDepBVFAZQQdhN7XCJzqUwmcV79SqYGalleVqm5XyenVa4nFesHY7jCNLROrqBHlgtE92aPFjCmcNoiYuJEPzJjul5AYdnnHkeKQevXmwyO8xozEtp1qExjA6sfd8tRUMhTAaE5rLBnqslJx9r-5JgtL82V5kmTgx9bt5QmOiAjh1sa5vjPP7EB5WSaeKeMK9zuVgCH8RJFezfeBmyvYUJuYqroAVrKuYT6A',
  },
  'AUD-ANC-99': {
    sku: '#AUD-ANC-99',
    name: 'AcousticSphere ANC Pods',
    price: 11499,
    mrp: 14999,
    gstRate: 18,
    hsCode: '8518.30.00',
    category: 'Wireless Audio',
    stock: 45,
    modelUrl: null,
    specs: ['Lossless LDAC', 'Spatial Audio'],
    dimensions: 'Not provided',
    weight: 'Not provided',
    warranty: 'Not provided',
    aiMatchScore: 88,
    aiReason:
      "3D view isn't available for this product yet — automatically shows the product photo gallery.",
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuATX6652NttkNvGUKx5jflqNG9RH8CT1bcmBhwPs5ONeLhU9pt_yu_fLrBW741KftvyB8iGKx74rvwQHwuPCAi3l4R3tYkHwBDG9n3OPdy9Mlu8L_I0x4OPz9BwauAkb1vv9Y9m6inErwdhjPUN3ppwCGPbYGt503flhtRIVgYmpxZIuYY_1j9Rm3YHrFW7YLzOu7wmGH2HMVU6LtZPoH8W80bhQ8Ax7MbgTzEynmMscW556GyOm__wiw',
  },
};

export const ProductDetailARScreen: React.FC<ProductDetailARScreenProps> = ({
  selectedProduct,
  onAddToCart,
  onBuyNow,
  onOpenQRModal,
  onOpenARModal,
  showToast,
}) => {
  const navigate = useNavigate();
  const { dataSource, feesVerified, setFeesVerified, getActorHeaders } = useRole();

  const product = selectedProduct || DEMO_3D_PRODUCTS['FAN-BLDC-892'];
  const cleanSku = String(product.sku || '#FAN-BLDC-892')
    .replace(/^#/, '')
    .toUpperCase();

  const resolvedModelUrl: string | null =
    product.modelUrl !== undefined
      ? product.modelUrl
      : cleanSku.includes('FAN')
      ? '/api/models/ceiling-fan.glb'
      : cleanSku.includes('SPO') || cleanSku.includes('RKT')
      ? '/api/models/badminton-racket.glb'
      : cleanSku.includes('WRK')
      ? '/api/models/workstation.glb'
      : null;

  const [arPanelState, setArPanelState] = useState<ARPanelState>(() =>
    resolvedModelUrl ? 'ready' : 'model_unavailable'
  );
  const [selectedGalleryIdx, setSelectedGalleryIdx] = useState(0);
  const [cameraOrbit, setCameraOrbit] = useState<string>('0deg 75deg 105%');
  const [fieldOfView, setFieldOfView] = useState<number>(30);
  const [showArConsentPrompt, setShowArConsentPrompt] = useState<boolean>(false);
  const [benchmarkState, setBenchmarkState] = useState<CollectionViewState>('ready');

  const [qaQuestion, setQaQuestion] = useState<string>(
    'What is the power consumption and blade sweep?'
  );
  const [qaLoading, setQaLoading] = useState<boolean>(false);
  const [qaResult, setQaResult] = useState<{
    source: 'live' | 'fallback';
    answerStatus: 'answered_from_specs' | 'not_provided';
    answer: string;
    citedField: string;
  } | null>(null);

  const [approvedConfigNote, setApprovedConfigNote] = useState<string | null>(null);
  const [aiSuggestionApproved, setAiSuggestionApproved] = useState(false);
  const [isLocalQRModalOpen, setIsLocalQRModalOpen] = useState(false);

  const handleQuickScanToAR = () => {
    if (onOpenQRModal) {
      onOpenQRModal();
    } else {
      setIsLocalQRModalOpen(true);
    }
  };

  const modelViewerRef = useRef<any>(null);

  const galleryFallbackAngles = [
    {
      id: 'primary',
      label: 'Primary Studio View',
      caption: `${product.name} (${product.sku})`,
      img:
        product.img ||
        'https://images.unsplash.com/photo-1591799264318-7e6ef8ddb7ea?w=800&auto=format&fit=crop&q=80',
    },
    {
      id: 'detail',
      label: 'Close-Up Finish & Detail',
      caption: `Dimensions: ${product.dimensions || 'Not available'}`,
      img: 'https://images.unsplash.com/photo-1587202372775-e229f172b9d7?w=800&auto=format&fit=crop&q=80',
    },
    {
      id: 'scale',
      label: 'Room Scale Preview',
      caption: `Warranty: ${product.warranty || 'Not available'}`,
      img: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&auto=format&fit=crop&q=80',
    },
  ];

  useEffect(() => {
    setCameraOrbit('0deg 75deg 105%');
    setFieldOfView(30);
    setShowArConsentPrompt(false);
    setQaResult(null);
    if (!resolvedModelUrl) {
      setArPanelState('model_unavailable');
    } else {
      setArPanelState('ready');
    }
  }, [product.sku, resolvedModelUrl]);

  useEffect(() => {
    const el = modelViewerRef.current;
    if (!el || !resolvedModelUrl || arPanelState !== 'ready') return;

    const onError = () => {
      setArPanelState('model_unavailable');
      showToast?.("3D view isn't available for this product yet.");
    };

    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('error', onError);
    };
  }, [resolvedModelUrl, arPanelState, product.sku, showToast]);

  const handleRotateLeft = () => {
    setCameraOrbit('-45deg 70deg 105%');
    if (modelViewerRef.current) {
      modelViewerRef.current.cameraOrbit = '-45deg 70deg 105%';
    }
  };

  const handleRotateRight = () => {
    setCameraOrbit('45deg 70deg 105%');
    if (modelViewerRef.current) {
      modelViewerRef.current.cameraOrbit = '45deg 70deg 105%';
    }
  };

  const handleZoomIn = () => {
    const next = Math.max(18, fieldOfView - 5);
    setFieldOfView(next);
    if (modelViewerRef.current) {
      modelViewerRef.current.fieldOfView = `${next}deg`;
    }
  };

  const handleZoomOut = () => {
    const next = Math.min(45, fieldOfView + 5);
    setFieldOfView(next);
    if (modelViewerRef.current) {
      modelViewerRef.current.fieldOfView = `${next}deg`;
    }
  };

  const handleResetView = () => {
    setCameraOrbit('0deg 75deg 105%');
    setFieldOfView(30);
    if (modelViewerRef.current) {
      modelViewerRef.current.cameraOrbit = '0deg 75deg 105%';
      modelViewerRef.current.fieldOfView = '30deg';
    }
    showToast?.('3D view reset to default angle.');
  };

  const handleInitiateArClick = () => {
    if (!resolvedModelUrl) {
      setArPanelState('model_unavailable');
      showToast?.("3D view isn't available for this product yet.");
      return;
    }
    setShowArConsentPrompt(true);
  };

  const handleConfirmAndLaunchAr = async () => {
    setShowArConsentPrompt(false);

    if (!resolvedModelUrl) {
      setArPanelState('model_unavailable');
      return;
    }

    const mv = modelViewerRef.current;
    if (mv && mv.canActivateAR) {
      try {
        mv.activateAR();
        return;
      } catch {
        // Fall through
      }
    }

    const nav = navigator as any;
    let xrSupported = false;
    if (nav.xr && typeof nav.xr.isSessionSupported === 'function') {
      try {
        xrSupported = await nav.xr.isSessionSupported('immersive-ar');
      } catch {
        xrSupported = false;
      }
    }

    if (!xrSupported) {
      setArPanelState('ar_unsupported');
      showToast?.('AR room preview requires a mobile phone or tablet with AR camera support.');
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setArPanelState('ar_unsupported');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
      setArPanelState('ready');
      showToast?.('Camera ready — starting AR room preview.');
    } catch {
      setArPanelState('camera_denied');
      showToast?.('Camera permission denied.');
    }
  };

  const handleAskProductQa = async (e?: React.FormEvent, overrideQuestion?: string) => {
    if (e) e.preventDefault();
    const q = (overrideQuestion ?? qaQuestion).trim();
    if (!q) return;
    if (overrideQuestion) setQaQuestion(overrideQuestion);

    setQaLoading(true);
    try {
      const res = await fetch('/api/product/qa', {
        method: 'POST',
        headers: getActorHeaders(),
        body: JSON.stringify({
          sku: product.sku,
          question: q,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setQaResult({
          source: data.source,
          answerStatus: data.answerStatus,
          answer: data.answer,
          citedField: data.citedField,
        });
      }
    } catch {
      showToast?.('Unable to check product details right now.');
    } finally {
      setQaLoading(false);
    }
  };

  const baseTaxable = Math.round(product.price / (1 + (product.gstRate || 18) / 100));
  const gstAmount = product.price - baseTaxable;
  const gatewayFee = Math.round(product.price * 0.0349 + 12);
  const payIn4Installment = Math.round(product.price / 4);

  return (
    <div className="space-y-6 pb-12">
      {/* Top Breadcrumb & Demo Product Switcher (Matches Image_9 / Image_10) */}
      <div className="bg-surface-container-lowest p-4 sm:p-5 rounded-xl border border-surface-container-high flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
          <button
            type="button"
            onClick={() => navigate('/customer/discover')}
            className="hover:text-primary font-medium cursor-pointer"
          >
            Catalog
          </button>
          <span className="material-symbols-outlined text-[14px]">chevron_right</span>
          <span>{product.category || 'Smart Appliances'}</span>
          <span className="material-symbols-outlined text-[14px]">chevron_right</span>
          <span className="text-on-surface font-semibold">{product.name}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-secondary mr-1">Switch Product:</span>
          <button
            type="button"
            onClick={() => navigate('/customer/product/FAN-BLDC-892')}
            data-testid="select-demo-fan"
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              cleanSku === 'FAN-BLDC-892'
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
            }`}
          >
            Ceiling Fan (3D &amp; AR)
          </button>
          <button
            type="button"
            onClick={() => navigate('/customer/product/SPO-YNX-99P')}
            data-testid="select-demo-racket"
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              cleanSku === 'SPO-YNX-99P'
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
            }`}
          >
            Badminton Racket (3D &amp; AR)
          </button>
          <button
            type="button"
            onClick={() => navigate('/customer/product/AUD-ANC-99')}
            data-testid="select-demo-noglb"
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              cleanSku === 'AUD-ANC-99'
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container-low text-secondary hover:bg-surface-container'
            }`}
          >
            ANC Pods (Photos Only)
          </button>
        </div>
      </div>

      {/* Camera Permission Explanation Dialog */}
      {showArConsentPrompt && (
        <div
          data-testid="ar-camera-consent-dialog"
          className="bg-inverse-surface text-inverse-on-surface rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-inverse-primary">
              Camera Access Needed for AR Preview
            </span>
            <h3 className="text-sm font-bold">Preview {product.name} in your room</h3>
            <p className="text-xs opacity-90 max-w-2xl leading-relaxed">
              Room placement uses your camera to show this item at true scale ({product.dimensions || '1200mm'}). Camera video stays on your device and is never uploaded.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowArConsentPrompt(false)}
              className="px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmAndLaunchAr}
              data-testid="ar-confirm-launch-btn"
              className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-container text-on-primary text-xs font-semibold cursor-pointer"
            >
              Continue to AR View
            </button>
          </div>
        </div>
      )}

      {/* 12-Column Split Layout (Matches Image_9 / Image_10: 7 Cols Left 3D/AR + 5 Cols Right Details) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 space-y-8">
          <ProductARViewerSection
            product={product}
            resolvedModelUrl={resolvedModelUrl}
            arPanelState={arPanelState}
            setArPanelState={setArPanelState}
            selectedGalleryIdx={selectedGalleryIdx}
            setSelectedGalleryIdx={setSelectedGalleryIdx}
            galleryFallbackAngles={galleryFallbackAngles}
            cameraOrbit={cameraOrbit}
            fieldOfView={fieldOfView}
            modelViewerRef={modelViewerRef}
            onRotateLeft={handleRotateLeft}
            onRotateRight={handleRotateRight}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onResetView={handleResetView}
            onInitiateArClick={handleInitiateArClick}
            onConfirmAndLaunchAr={handleConfirmAndLaunchAr}
            onOpenQRModal={onOpenQRModal}
            onOpenARModal={onOpenARModal}
          />

          <ProductSpecsAndQASection
            product={product}
            resolvedModelUrl={resolvedModelUrl}
            qaQuestion={qaQuestion}
            setQaQuestion={setQaQuestion}
            qaLoading={qaLoading}
            qaResult={qaResult}
            onAskProductQa={handleAskProductQa}
            benchmarkState={benchmarkState}
            setBenchmarkState={setBenchmarkState}
          />
        </div>

        {/* Right 5 Columns: Product Details, Pricing, PayPal Checkout & AI Match */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-surface-container-lowest rounded-xl border border-surface-container-high p-6 space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 text-[11px] font-semibold">
                  In Stock ({product.stock || 40} Ready to Ship)
                </span>
                <span className="text-xs font-tabular-nums text-secondary">
                  SKU: {product.sku}
                </span>
              </div>
              <h1 className="text-2xl font-bold font-headline text-on-surface tracking-tight">
                {product.name}
              </h1>
            </div>

            {/* Price & PayPal Pay in 4 Box (Matches Image_9 / Image_10) */}
            <div className="p-5 bg-surface-container-low rounded-xl border border-surface-container-high space-y-4">
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-bold font-headline text-on-surface font-tabular-nums">
                  {formatINR(product.price)}
                </span>
                {product.mrp && product.mrp > product.price && (
                  <>
                    <span className="text-sm text-secondary line-through font-tabular-nums">
                      {formatINR(product.mrp)}
                    </span>
                    <span className="bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2 py-0.5 rounded">
                      Save {formatINR(product.mrp - product.price)}
                    </span>
                  </>
                )}
              </div>

              <div className="p-3 bg-surface-container-lowest rounded-xl border border-surface-container-high flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <i className="fa-brands fa-paypal text-primary text-lg"></i>
                  <div className="text-xs">
                    <p className="font-semibold text-on-surface">
                      Pay in 4 interest-free payments of{' '}
                      <span className="font-tabular-nums text-primary">
                        {formatINR(payIn4Installment)}
                      </span>
                    </p>
                    <p className="text-[11px] text-secondary">
                      Buyer protection included with PayPal checkout
                    </p>
                  </div>
                </div>
              </div>

              {approvedConfigNote && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
                  <span className="font-bold">Saved Note:</span> {approvedConfigNote}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => onAddToCart && onAddToCart(product)}
                  data-testid="product-detail-add-cart-btn"
                  className="py-3 px-4 rounded-xl bg-surface-container-lowest border border-outline-variant hover:bg-surface-container text-on-surface font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">add_shopping_cart</span>
                  <span>Add to SmartCart</span>
                </button>
                <button
                  type="button"
                  onClick={() => onBuyNow && onBuyNow(product)}
                  className="py-3 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <i className="fa-brands fa-paypal"></i>
                  <span>PayPal Checkout</span>
                </button>
              </div>

              {/* Quick Scan to AR Button for Mobile Spatial View */}
              <div className="pt-2 border-t border-surface-container-high/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                  <span className="material-symbols-outlined text-primary text-[18px]">
                    view_in_ar
                  </span>
                  <span>
                    Want to inspect <strong className="text-on-surface">{product.name}</strong> in your room on mobile?
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleQuickScanToAR}
                  data-testid="quick-scan-to-ar-btn"
                  className="px-3.5 py-2 rounded-xl bg-primary/10 hover:bg-primary/20 border border-primary/25 text-primary font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shrink-0 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">qr_code_scanner</span>
                  <span>Quick Scan to AR</span>
                </button>
              </div>
            </div>

            {/* Price & Tax Breakdown */}
            <MoneyBreakdownCard
              title="Price & GST Summary"
              currency="INR"
              subtotal={baseTaxable}
              taxLabel={`GST (${product.gstRate || 18}% • HSN ${product.hsCode || '8414.51.10'})`}
              taxAmount={gstAmount}
              feeLabel="PayPal Fee"
              feeAmount={gatewayFee}
              isFeesVerified={feesVerified}
              total={product.price}
              compact
              onVerifyFees={() => {
                setFeesVerified(true);
                showToast?.('PayPal fee loaded.');
              }}
            />
          </div>

          {/* Predictive Match Card */}
          <AISuggestionCard
            title="Smart Fit & Energy Summary"
            source={dataSource}
            suggestionText={
              product.aiReason ||
              'Check the 3D & AR view to confirm room clearance before adding to your cart.'
            }
            whyThis="Based on listed dimensions, power rating, and GST invoice eligibility."
            approved={aiSuggestionApproved}
            approveLabel="Save Note to Order"
            onApprove={(finalText) => {
              setApprovedConfigNote(finalText);
              setAiSuggestionApproved(true);
              showToast?.('Note saved to your order.');
            }}
          />
        </div>
      </div>

      {/* Fallback Local QR Modal if onOpenQRModal prop is not supplied */}
      <QRModal
        isOpen={isLocalQRModalOpen}
        onClose={() => setIsLocalQRModalOpen(false)}
        title="Quick Scan to AR — Mobile Spatial View"
        subtitle={`Scan with your phone camera to place ${product.name} (${product.dimensions || 'True Scale'}) directly into your room.`}
      />
    </div>
  );
};
