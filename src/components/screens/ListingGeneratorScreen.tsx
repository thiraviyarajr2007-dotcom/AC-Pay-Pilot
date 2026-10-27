import React, { useState } from 'react';
import { formatINR } from '../../utils/finance';
import {
  MoneyBreakdownCard,
  DataCollectionBoundary,
  CollectionViewState,
} from '../ui/HonestTrustComponents';
import { useRole } from '../../context/RoleContext';
import {
  saveProductToFirestore,
  deleteProductFromFirestore,
} from '../../services/firestoreService';

interface ListingGeneratorScreenProps {
  onPreviewCustomer?: (product?: any) => void;
  showToast?: (msg: string) => void;
}

interface GeneratedListingResponse {
  source: 'live' | 'fallback';
  providedBySeller: Array<{ label: string; value: string }>;
  generated: {
    title: string;
    description: string;
    hsnCode: string;
    tags: string[];
    faqs: Array<{ question: string; answer: string }>;
  };
  missingInformation: string[];
  whyThis: string;
}

interface AssetUploadRecord {
  sku: string;
  fileName: string;
  format: 'glb' | 'gltf' | 'usdz';
  sizeBytes: number;
  status: 'Processing' | 'Ready' | 'Failed';
  modelUrl: string | null;
  validationMessage: string;
}

interface PublishedListingItem {
  sku: string;
  name: string;
  hsCode: string;
  price: number;
  stock: number;
  modelUrl: string | null;
  cadStatus: string;
  specs?: string[];
  category?: string;
  image?: string;
}

export const ListingGeneratorScreen: React.FC<ListingGeneratorScreenProps> = ({
  onPreviewCustomer,
  showToast,
}) => {
  const { feesVerified, setFeesVerified, getActorHeaders } = useRole();

  // Seller input form (Defaults to Demo Ceiling Fan #FAN-BLDC-892 for the 3-minute guided demo)
  const [sku, setSku] = useState('#FAN-BLDC-892');
  const [productName, setProductName] = useState(
    'AeroBreeze Stealth 1200mm Smart BLDC Ceiling Fan'
  );
  const [category, setCategory] = useState('Home Appliances > Smart Ceiling Fans');
  const [grossPrice, setGrossPrice] = useState(8499);
  const [specPower, setSpecPower] = useState('28W @ Speed 6 (BLDC)');
  const [specSweep, setSpecSweep] = useState('1200 mm (48")');
  const [specAirflow, setSpecAirflow] = useState('235 CMM @ 380 RPM');
  const [specWarranty, setSpecWarranty] = useState(''); // left blank initially to demonstrate "Missing information" column!
  const [specCertifications, setSpecCertifications] = useState(''); // left blank initially so AI flags missing BEE/ISI certification instead of inventing it!

  // 2D Image Upload State (seller-provided product photos)
  const [uploadedImages, setUploadedImages] = useState<string[]>([
    'https://lh3.googleusercontent.com/aida-public/AB6AXuAdZqURIDL_NaUXiAifTbLg4cem9jV1GV8iZOZph4aZvIM_kBIBsVSYaq0LFoeWQ1Xe11jOuDpYR0RHnVhSurjQprJuCqeXfR6luOW8JojolfW3AL3RlJG5cFe-YmAZaYz7-lll8h5sqcs83z5WRWhCSmB_-pIxVPGanujJtlcWqHaGPRDckKJmoCqqWoVmhA4SIWYCZ53ylY77gEHOrpObunEt2PyFUzIVJzYoOpMS9aQvgYTluWmbLg',
  ]);

  // 3D Asset (.glb / .gltf / .usdz) Upload State
  const [assetStatus, setAssetStatus] = useState<AssetUploadRecord>({
    sku: '#FAN-BLDC-892',
    fileName: 'aerobreeze-1200mm-bldc-fan.glb',
    format: 'glb',
    sizeBytes: 148240,
    status: 'Ready',
    modelUrl: '/api/models/ceiling-fan.glb',
    validationMessage:
      'Validated binary glTF 2.0 mesh (3 blades + BLDC motor housing, 1:1 1200mm scale).',
  });

  // 3-Column AI Draft State (POST /api/listing/generate)
  const [aiLoading, setAiLoading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [deletingSku, setDeletingSku] = useState<string | null>(null);

  const [aiResult, setAiResult] = useState<GeneratedListingResponse | null>({
    source: 'fallback',
    providedBySeller: [
      { label: 'SKU Code', value: '#FAN-BLDC-892' },
      { label: 'Product Name', value: 'AeroBreeze Stealth 1200mm Smart BLDC Ceiling Fan' },
      { label: 'Category', value: 'Home Appliances > Smart Ceiling Fans' },
      { label: 'Unit Price (INR)', value: '₹8,499' },
      { label: 'Seller Images Provided', value: '1 image(s) attached' },
      { label: 'power', value: '28W @ Speed 6 (BLDC)' },
      { label: 'bladeSweep', value: '1200 mm (48")' },
      { label: 'airDelivery', value: '235 CMM @ 380 RPM' },
    ],
    generated: {
      title: 'AeroBreeze Stealth 1200mm Smart BLDC Ceiling Fan (#FAN-BLDC-892)',
      description:
        'AeroBreeze Stealth 1200mm Smart BLDC Ceiling Fan in Home Appliances > Smart Ceiling Fans, listed at ₹8,499. Verified seller specifications: power: 28W @ Speed 6 (BLDC) • bladeSweep: 1200 mm (48") • airDelivery: 235 CMM @ 380 RPM. Unprovided certifications, warranty terms, or safety claims are omitted until seller verification.',
      hsnCode: '8414.51.10',
      tags: ['BLDC Ceiling Fan', '1200mm Sweep', '3D/AR Spatial Ready'],
      faqs: [
        {
          question: 'What specifications were provided by the seller?',
          answer:
            'power: 28W @ Speed 6 (BLDC) • bladeSweep: 1200 mm (48") • airDelivery: 235 CMM @ 380 RPM',
        },
        {
          question: 'Are statutory certifications or warranty terms included?',
          answer:
            'Warranty duration and statutory certifications (BEE Star Rating / ISI mark) were not provided by the seller and are not claimed.',
        },
      ],
    },
    missingInformation: [
      'Warranty duration & service terms — not provided by seller (do not assume)',
      'Statutory certifications (BEE Star Rating / BIS / ISI mark) — not provided by seller',
      'Safety / thermal protection ratings — not provided by seller',
      'Net unit weight (kg/g) — not provided by seller',
    ],
    whyThis:
      'Generated strictly from seller-supplied fields without inventing dimensions, certifications, warranty, or safety claims. Seller must edit and approve before publishing.',
  });

  // Editable draft fields (Seller edits before approving)
  const [draftTitle, setDraftTitle] = useState(
    'AeroBreeze Stealth 1200mm Smart BLDC Ceiling Fan (#FAN-BLDC-892)'
  );
  const [draftHsn, setDraftHsn] = useState('8414.51.10');
  const [draftDescription, setDraftDescription] = useState(
    'AeroBreeze Stealth 1200mm Smart BLDC Ceiling Fan in Home Appliances > Smart Ceiling Fans, listed at ₹8,499. Verified seller specifications: power: 28W @ Speed 6 (BLDC) • bladeSweep: 1200 mm (48") • airDelivery: 235 CMM @ 380 RPM.'
  );
  const [draftTags, setDraftTags] = useState(
    'BLDC Ceiling Fan, 1200mm Sweep, 3D/AR Spatial Ready'
  );
  const [sellerApproved, setSellerApproved] = useState(false);
  const [catalogListState, setCatalogListState] = useState<CollectionViewState>('ready');

  const [publishedListings, setPublishedListings] = useState<PublishedListingItem[]>([
    {
      sku: '#FAN-BLDC-892',
      name: 'AeroBreeze Stealth 1200mm Smart BLDC Ceiling Fan',
      hsCode: '8414.51.10',
      price: 8499,
      stock: 120,
      modelUrl: '/api/models/ceiling-fan.glb',
      cadStatus: 'Ready (.glb)',
      category: 'Home Appliances > Smart Ceiling Fans',
      specs: ['28W @ Speed 6 (BLDC)', '1200 mm (48")', '235 CMM @ 380 RPM'],
    },
    {
      sku: '#SPO-YNX-99P',
      name: 'Yonex Astrox 99 Pro Carbon Badminton Racket',
      hsCode: '9506.59.10',
      price: 14990,
      stock: 40,
      modelUrl: '/api/models/badminton-racket.glb',
      cadStatus: 'Ready (.glb)',
      category: 'Badminton & Sports Gear',
      specs: ['Pre-Strung BG80', 'Full Carbon Cap', '4U (83g) • Head Heavy'],
    },
    {
      sku: '#AUD-ANC-99',
      name: 'AcousticSphere ANC Pods',
      hsCode: '8518.30.00',
      price: 11499,
      stock: 45,
      modelUrl: null,
      cadStatus: 'No .glb (2D Fallback)',
      category: 'Spatial Audio Nodes',
      specs: ['Lossless LDAC', 'Spatial Audio'],
    },
  ]);

  // Handle 2D Image Upload
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setUploadedImages((prev) => [reader.result as string, ...prev]);
        showToast?.(`Added product photo: ${file.name}`);
      }
    };
    reader.readAsDataURL(file);
  };

  // Handle Seller 3D file upload (.glb / .gltf / .usdz validation)
  const handleUpload3DAsset = async (fileName: string, sizeBytes: number) => {
    setAssetStatus({
      sku,
      fileName,
      format: 'glb',
      sizeBytes,
      status: 'Processing',
      modelUrl: null,
      validationMessage: `Validating ${fileName} (${(sizeBytes / 1024).toFixed(1)} KB)...`,
    });

    try {
      const res = await fetch(`/api/products/${encodeURIComponent(sku)}/asset`, {
        method: 'POST',
        headers: getActorHeaders(),
        body: JSON.stringify({ fileName, sizeBytes }),
      });
      const data = await res.json();
      if (data.asset) {
        setAssetStatus(data.asset);
        showToast?.(`3D Asset ${data.asset.status}: ${data.asset.validationMessage}`);
      }
    } catch {
      setAssetStatus({
        sku,
        fileName,
        format: 'glb',
        sizeBytes,
        status: 'Failed',
        modelUrl: null,
        validationMessage: 'Network error validating 3D asset on server.',
      });
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void handleUpload3DAsset(file.name, file.size);
  };

  // Call POST /api/listing/generate
  const handleGenerateAiDraft = async () => {
    if (!productName.trim() || !sku.trim()) {
      showToast?.('Please specify at least SKU code and Product Name.');
      return;
    }

    setAiLoading(true);
    setSellerApproved(false);

    const providedSpecs: Record<string, string> = {};
    if (specPower.trim()) providedSpecs.power = specPower.trim();
    if (specSweep.trim()) providedSpecs.bladeSweep = specSweep.trim();
    if (specAirflow.trim()) providedSpecs.airDelivery = specAirflow.trim();
    if (specWarranty.trim()) providedSpecs.warranty = specWarranty.trim();
    if (specCertifications.trim()) providedSpecs.certifications = specCertifications.trim();

    try {
      const res = await fetch('/api/listing/generate', {
        method: 'POST',
        headers: getActorHeaders(),
        body: JSON.stringify({
          sku,
          productName,
          category,
          priceInr: grossPrice,
          imageUrls: uploadedImages.slice(0, 3),
          providedSpecs,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setAiResult(data);
        setDraftTitle(data.generated.title);
        setDraftHsn(data.generated.hsnCode);
        setDraftDescription(data.generated.description);
        setDraftTags((data.generated.tags || []).join(', '));
        showToast?.(
          `AI Listing Draft ready (Source: ${data.source}). Review the 3 columns and approve before publishing.`
        );
      } else {
        showToast?.(`Draft generation failed: ${data.error || 'Unknown error'}`);
      }
    } catch {
      showToast?.('Failed to generate AI listing draft.');
    } finally {
      setAiLoading(false);
    }
  };

  // Real Approve & Publish handler (writes to Firestore + backend REST API)
  const handleApproveAndPublish = async () => {
    setIsPublishing(true);
    const cleanSku = sku.trim();
    const entry: PublishedListingItem = {
      sku: cleanSku,
      name: draftTitle,
      hsCode: draftHsn,
      price: grossPrice,
      stock: 120,
      modelUrl: assetStatus.status === 'Ready' ? assetStatus.modelUrl : null,
      cadStatus:
        assetStatus.status === 'Ready'
          ? `Ready (.${assetStatus.format})`
          : `${assetStatus.status}`,
      category,
      specs: [specPower, specSweep, specAirflow].filter(Boolean),
      image: uploadedImages[0],
    };

    try {
      // 1. Post to Server API
      await fetch('/api/products', {
        method: 'POST',
        headers: getActorHeaders(),
        body: JSON.stringify({
          sku: cleanSku,
          name: draftTitle,
          category,
          priceMinor: grossPrice * 100,
          currency: 'INR',
          hsnCode: draftHsn,
          modelUrl: assetStatus.status === 'Ready' ? assetStatus.modelUrl : null,
          specs: [specPower, specSweep, specAirflow].filter(Boolean),
          stock: 120,
        }),
      });

      // 2. Persist to Firestore
      await saveProductToFirestore({
        id: cleanSku.replace(/^#/, ''),
        sku: cleanSku,
        name: draftTitle,
        category,
        priceMinor: grossPrice * 100,
        currency: 'INR',
        sellerId: 'seller-demo-1',
        stock: 120,
        status: 'active',
        hsnCode: draftHsn,
        modelUrl: assetStatus.status === 'Ready' ? assetStatus.modelUrl : null,
        specs: [specPower, specSweep, specAirflow].filter(Boolean),
        createdAt: new Date().toISOString(),
      });

      setPublishedListings((prev) => {
        const exists = prev.some((p) => p.sku === cleanSku);
        if (exists) {
          return prev.map((p) => (p.sku === cleanSku ? entry : p));
        }
        return [entry, ...prev];
      });

      setSellerApproved(true);
      showToast?.(`Seller approved & published SKU ${cleanSku} to live catalog & Firestore.`);
    } catch {
      showToast?.('Error syncing product to database.');
    } finally {
      setIsPublishing(false);
    }
  };

  // Populate form with existing product for editing
  const handleEditProduct = (item: PublishedListingItem) => {
    setSku(item.sku);
    setProductName(item.name);
    setGrossPrice(item.price);
    if (item.category) setCategory(item.category);
    if (item.hsCode) setDraftHsn(item.hsCode);
    setDraftTitle(item.name);
    setSellerApproved(false);
    window.scrollTo({ top: 380, behavior: 'smooth' });
    showToast?.(`Editing SKU ${item.sku}. Update details below and generate revised draft.`);
  };

  // Real Delete handler
  const handleDeleteProduct = async (targetSku: string) => {
    if (!window.confirm(`Are you sure you want to delete SKU ${targetSku} from the catalog?`)) {
      return;
    }
    setDeletingSku(targetSku);
    try {
      await fetch(`/api/products/${encodeURIComponent(targetSku)}`, {
        method: 'DELETE',
        headers: getActorHeaders(),
      });
      await deleteProductFromFirestore(targetSku.replace(/^#/, ''));
      setPublishedListings((prev) => prev.filter((p) => p.sku !== targetSku));
      showToast?.(`Deleted SKU ${targetSku} from catalog.`);
    } catch {
      showToast?.(`Failed to delete SKU ${targetSku}.`);
    } finally {
      setDeletingSku(null);
    }
  };

  const taxableSubtotal = Math.round(grossPrice / 1.18);
  const gstAmount = grossPrice - taxableSubtotal;
  const gatewayFee = Math.round(grossPrice * 0.0349 + 12);
  const netPayout = grossPrice - gatewayFee;

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-mono uppercase tracking-wider text-blue-700 font-bold">
            Seller Workspace • 3D Spatial Asset Upload &amp; Honest AI Listing Studio
          </span>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mt-0.5">
            Product Listing Generator &amp; .GLB/.USDZ Spatial Twin Upload
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Displays three transparent columns: <strong>Provided by seller</strong>,{' '}
            <strong>Generated</strong>, and <strong>Missing information</strong>. Never invents
            dimensions, certifications, warranty, or safety claims.
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            onPreviewCustomer?.({
              sku,
              name: draftTitle,
              price: grossPrice,
              hsCode: draftHsn,
              gstRate: 18,
              modelUrl: assetStatus.status === 'Ready' ? assetStatus.modelUrl : null,
              specs: [specPower, specSweep, specAirflow].filter(Boolean),
            })
          }
          data-testid="seller-preview-customer-3d-btn"
          className="px-4 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold flex items-center gap-2 shrink-0 cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">view_in_ar</span>
          <span>Open Customer 3D / AR View ({sku})</span>
        </button>
      </div>

      {/* Section 1: Seller 3D Model Upload (.glb / .gltf / .usdz) with Type & Size Validation */}
      <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Step 1: Seller 3D Spatial Model Upload (.glb / .gltf / .usdz • Max 25 MB)
            </h2>
            <p className="text-xs text-slate-500">
              Linked to SKU <strong className="font-mono text-slate-800">{sku}</strong>. Validates
              file extension and byte size on the server.
            </p>
          </div>
          <span
            data-testid="seller-3d-asset-status"
            className={`px-3 py-1 rounded-full text-xs font-mono font-bold border ${
              assetStatus.status === 'Ready'
                ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                : assetStatus.status === 'Processing'
                ? 'bg-blue-50 text-blue-900 border-blue-300'
                : 'bg-red-50 text-red-900 border-red-300'
            }`}
          >
            3D Status: {assetStatus.status}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center bg-slate-50 p-4 rounded-xl border border-slate-200/80">
          <div className="md:col-span-7 space-y-1 text-xs">
            <div className="font-bold text-slate-900 font-mono">
              File: {assetStatus.fileName} ({(assetStatus.sizeBytes / 1024).toFixed(1)} KB)
            </div>
            <div className="text-slate-600">{assetStatus.validationMessage}</div>
            {assetStatus.modelUrl && (
              <div className="text-[11px] font-mono text-blue-700">
                Served endpoint: {assetStatus.modelUrl}
              </div>
            )}
          </div>

          <div className="md:col-span-5 flex flex-wrap items-center justify-end gap-2">
            <label className="px-3 py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 text-xs font-bold cursor-pointer">
              Choose .glb/.gltf/.usdz File
              <input
                type="file"
                accept=".glb,.gltf,.usdz"
                onChange={handleFileInputChange}
                className="hidden"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleUpload3DAsset('aerobreeze-1200mm-bldc-fan.glb', 148240)}
              data-testid="upload-fan-glb-btn"
              className="px-3 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer"
            >
              Upload Fan .glb (Valid)
            </button>
            <button
              type="button"
              onClick={() => void handleUpload3DAsset('invalid-photo-spoof.png', 42000)}
              data-testid="upload-invalid-3d-btn"
              className="px-3 py-2 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 text-xs font-bold cursor-pointer"
            >
              Test Invalid (.png → Failed)
            </button>
          </div>
        </div>
      </div>

      {/* Section 2: Seller Known Details Input + 2D Photos + Trigger POST /api/listing/generate */}
      <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Step 2: Seller-Provided Product Details &amp; Photos
            </h2>
            <p className="text-xs text-slate-500">
              Leave Warranty or Certifications blank to verify that Gemini places them in{' '}
              <strong>&ldquo;Missing information&rdquo;</strong> rather than inventing claims.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleGenerateAiDraft()}
            disabled={aiLoading}
            data-testid="generate-listing-ai-btn"
            className="px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 cursor-pointer shadow-sm"
          >
            <span className="material-symbols-outlined text-[16px]">
              {aiLoading ? 'sync' : 'auto_awesome'}
            </span>
            <span>{aiLoading ? 'Drafting with Gemini AI...' : 'Draft Listing with AI'}</span>
          </button>
        </div>

        {/* 2D Product Photos Strip */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Seller 2D Images ({uploadedImages.length}):
          </span>
          <div className="flex items-center gap-2 overflow-x-auto">
            {uploadedImages.map((imgUrl, i) => (
              <img
                key={i}
                src={imgUrl}
                alt="Product preview thumbnail"
                className="w-12 h-12 rounded-lg object-cover border border-slate-300 shadow-2xs"
              />
            ))}
            <label className="w-12 h-12 rounded-lg border-2 border-dashed border-slate-300 hover:border-blue-500 flex flex-col items-center justify-center text-slate-400 hover:text-blue-600 bg-white cursor-pointer transition-colors">
              <span className="material-symbols-outlined text-[20px]">add_photo_alternate</span>
              <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
            </label>
          </div>
          <span className="text-[11px] text-slate-500">
            Attach high-res photo for 2D fallback gallery when 3D is unavailable.
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block font-semibold text-slate-600 mb-1">SKU *</label>
            <input
              type="text"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1">Product Name *</label>
            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1">Category</label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1">Unit Price (INR) *</label>
            <input
              type="number"
              value={grossPrice}
              onChange={(e) => setGrossPrice(Math.max(100, Number(e.target.value) || 0))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1">Power Rating</label>
            <input
              type="text"
              value={specPower}
              onChange={(e) => setSpecPower(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1">Blade Sweep / Size</label>
            <input
              type="text"
              value={specSweep}
              onChange={(e) => setSpecSweep(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1">
              Warranty (Optional — Blank = Missing)
            </label>
            <input
              type="text"
              value={specWarranty}
              onChange={(e) => setSpecWarranty(e.target.value)}
              placeholder="Not provided yet..."
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1">
              Certifications (Optional — Blank = Missing)
            </label>
            <input
              type="text"
              value={specCertifications}
              onChange={(e) => setSpecCertifications(e.target.value)}
              placeholder="Not provided yet..."
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
            />
          </div>
        </div>
      </div>

      {/* Section 3: REQUIRED 3-COLUMN HONEST AI LISTING REVIEW */}
      {aiResult && (
        <div
          data-testid="listing-three-columns"
          className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-slate-900">
                Step 3: Three-Column AI Listing Verification &amp; Seller Approval
              </span>
              <span
                data-testid="listing-ai-source-badge"
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase border ${
                  aiResult.source === 'live'
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                    : 'bg-amber-50 text-amber-900 border-amber-300'
                }`}
              >
                Source: {aiResult.source}
              </span>
            </div>
            <span className="text-xs text-slate-500">Why this? {aiResult.whyThis}</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* COLUMN 1: Provided by seller */}
            <div
              data-testid="col-provided-by-seller"
              className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  1. Provided by seller
                </h3>
                <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-mono text-[10px] font-bold">
                  {aiResult.providedBySeller.length} Facts
                </span>
              </div>
              <div className="space-y-2 text-xs">
                {aiResult.providedBySeller.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between gap-2 py-1.5 border-b border-slate-200/70 last:border-0"
                  >
                    <span className="text-slate-500 font-medium">{item.label}</span>
                    <span className="font-mono font-bold text-slate-900 text-right">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* COLUMN 2: Generated (Seller Edits Before Approving) */}
            <div
              data-testid="col-generated"
              className="rounded-xl bg-blue-50/40 border border-blue-200 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-blue-900">
                  2. Generated (Editable Draft)
                </h3>
                <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 font-mono text-[10px] font-bold">
                  Edit Before Publish
                </span>
              </div>

              <div className="space-y-2.5 text-xs">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Draft Title
                  </label>
                  <input
                    type="text"
                    value={draftTitle}
                    onChange={(e) => {
                      setDraftTitle(e.target.value);
                      setSellerApproved(false);
                    }}
                    className="w-full px-2.5 py-1.5 rounded border border-blue-300 bg-white text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Draft HSN Code
                  </label>
                  <input
                    type="text"
                    value={draftHsn}
                    onChange={(e) => {
                      setDraftHsn(e.target.value);
                      setSellerApproved(false);
                    }}
                    className="w-full px-2.5 py-1.5 rounded border border-blue-300 bg-white font-mono text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Draft Description
                  </label>
                  <textarea
                    rows={3}
                    value={draftDescription}
                    onChange={(e) => {
                      setDraftDescription(e.target.value);
                      setSellerApproved(false);
                    }}
                    className="w-full px-2.5 py-1.5 rounded border border-blue-300 bg-white text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Draft Tags (Comma-separated)
                  </label>
                  <input
                    type="text"
                    value={draftTags}
                    onChange={(e) => {
                      setDraftTags(e.target.value);
                      setSellerApproved(false);
                    }}
                    className="w-full px-2.5 py-1.5 rounded border border-blue-300 bg-white text-slate-900"
                  />
                </div>
                {aiResult.generated.faqs.length > 0 && (
                  <div className="pt-1 space-y-1.5">
                    <div className="text-[11px] font-bold text-slate-700">Draft FAQs:</div>
                    {aiResult.generated.faqs.map((f, i) => (
                      <div
                        key={i}
                        className="p-2 rounded bg-white border border-blue-200 text-[11px]"
                      >
                        <div className="font-bold text-slate-800">Q: {f.question}</div>
                        <div className="text-slate-600 mt-0.5">A: {f.answer}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* COLUMN 3: Missing information (Never invented!) */}
            <div
              data-testid="col-missing-information"
              className="rounded-xl bg-amber-50/60 border border-amber-200 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-amber-950">
                  3. Missing information
                </h3>
                <span className="px-2 py-0.5 rounded bg-amber-200/80 text-amber-950 font-mono text-[10px] font-bold">
                  {aiResult.missingInformation.length} Unprovided
                </span>
              </div>
              <p className="text-[11px] text-amber-900">
                AI is strictly blocked from inventing dimensions, certifications, warranty, or
                safety claims. Supply these above if applicable:
              </p>
              <ul className="space-y-2 text-xs text-amber-950">
                {aiResult.missingInformation.map((missing, idx) => (
                  <li
                    key={idx}
                    className="p-2.5 rounded-lg bg-white border border-amber-200/80 flex items-start gap-2"
                  >
                    <span className="material-symbols-outlined text-amber-600 text-[15px] shrink-0 mt-0.5">
                      warning
                    </span>
                    <span>{missing}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs font-medium text-slate-600">
              {sellerApproved
                ? `Approved & published ${sku} to catalog.`
                : 'Seller must review, edit if needed, and click Approve & Publish Listing.'}
            </span>
            <button
              type="button"
              onClick={() => void handleApproveAndPublish()}
              disabled={isPublishing}
              data-testid="seller-approve-publish-btn"
              className={`px-5 py-2.5 rounded-xl text-xs font-bold text-white transition-colors cursor-pointer flex items-center gap-2 ${
                sellerApproved ? 'bg-emerald-600' : 'bg-slate-900 hover:bg-slate-800'
              }`}
            >
              {isPublishing && (
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
              )}
              <span>
                {sellerApproved ? 'Approved & Published ✓' : isPublishing ? 'Publishing...' : 'Approve & Publish Listing'}
              </span>
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Published Merchant SKUs ({publishedListings.length})
            </h2>
            <span className="text-xs text-slate-400 font-mono">Sync: Server &amp; Firestore</span>
          </div>

          <DataCollectionBoundary
            title="Merchant Published SKUs"
            state={catalogListState}
            onStateChange={setCatalogListState}
            emptyMessage="No merchant SKUs published yet."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] font-mono uppercase text-slate-400">
                    <th className="py-2.5 pr-3">SKU</th>
                    <th className="py-2.5 px-3">Title</th>
                    <th className="py-2.5 px-3">3D Asset</th>
                    <th className="py-2.5 px-3 text-right">Gross (INR)</th>
                    <th className="py-2.5 pl-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60">
                  {publishedListings.map((item) => (
                    <tr key={item.sku} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 pr-3 font-mono font-bold text-slate-900">{item.sku}</td>
                      <td className="py-3 px-3 font-semibold text-slate-800">{item.name}</td>
                      <td className="py-3 px-3 font-mono text-[11px] text-emerald-700">
                        {item.cadStatus}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                        {formatINR(item.price)}
                      </td>
                      <td className="py-3 pl-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onPreviewCustomer?.(item)}
                            className="text-blue-600 hover:underline font-bold cursor-pointer"
                          >
                            3D
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditProduct(item)}
                            className="text-slate-600 hover:text-slate-900 font-bold cursor-pointer"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={deletingSku === item.sku}
                            onClick={() => void handleDeleteProduct(item.sku)}
                            className="text-rose-600 hover:text-rose-800 disabled:opacity-40 font-bold cursor-pointer"
                          >
                            {deletingSku === item.sku ? '...' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DataCollectionBoundary>
        </div>

        <div className="lg:col-span-5">
          <MoneyBreakdownCard
            title={`Unit Economics Breakdown (${sku})`}
            currency="INR"
            subtotal={taxableSubtotal}
            taxLabel={`Integrated GST (18% HSN ${draftHsn})`}
            taxAmount={gstAmount}
            feeLabel="PayPal Provider Fee (3.49% + ₹12)"
            feeAmount={gatewayFee}
            isFeesVerified={feesVerified}
            payoutLabel="Net Merchant Payout per Unit"
            payoutAmount={netPayout}
            total={grossPrice}
            onVerifyFees={() => {
              setFeesVerified(true);
              showToast?.('Provider fee schedule verified.');
            }}
          />
        </div>
      </div>
    </div>
  );
};
