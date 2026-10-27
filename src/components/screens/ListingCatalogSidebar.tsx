import React from 'react';
import { formatINR } from '../../utils/finance';
import {
  CollectionViewState,
  DataCollectionBoundary,
  MoneyBreakdownCard,
} from '../ui/HonestTrustComponents';

export interface PublishedListingItem {
  sku: string;
  name: string;
  hsCode: string;
  price: number;
  stock: number;
  modelUrl: string | null;
  cadStatus: string;
}

interface ListingCatalogSidebarProps {
  sku: string;
  draftHsn: string;
  grossPrice: number;
  taxableSubtotal: number;
  gstAmount: number;
  gatewayFee: number;
  netPayout: number;
  feesVerified: boolean;
  onVerifyFees: () => void;
  publishedListings: PublishedListingItem[];
  catalogListState: CollectionViewState;
  setCatalogListState: (state: CollectionViewState) => void;
  onPreviewCustomer?: (product?: any) => void;
}

export const ListingCatalogSidebar: React.FC<ListingCatalogSidebarProps> = ({
  sku,
  draftHsn,
  grossPrice,
  taxableSubtotal,
  gstAmount,
  gatewayFee,
  netPayout,
  feesVerified,
  onVerifyFees,
  publishedListings,
  catalogListState,
  setCatalogListState,
  onPreviewCustomer,
}) => {
  return (
    <div className="space-y-6">
      {/* Catalog & 3D Inventory List (Matches Image_11 / Image_12 Right Column) */}
      <div className="bg-surface-container-lowest rounded-xl border border-surface-container-high p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold font-headline text-on-surface">
              Store Catalog ({publishedListings.length})
            </h2>
            <p className="text-xs text-secondary">
              Products published with 3D &amp; AR views or photo galleries.
            </p>
          </div>
        </div>

        <DataCollectionBoundary
          title="Store Catalog"
          state={catalogListState}
          onStateChange={setCatalogListState}
          emptyMessage="No products published yet."
        >
          <div className="space-y-3">
            {publishedListings.map((item) => (
              <div
                key={item.sku}
                className="p-3.5 rounded-xl bg-surface-container-low border border-surface-container-high flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold text-on-surface leading-snug">{item.name}</h4>
                    <span className="text-[11px] font-tabular-nums text-secondary">
                      SKU: {item.sku} • Stock: {item.stock}
                    </span>
                  </div>
                  <span className="text-xs font-bold font-tabular-nums text-on-surface shrink-0">
                    {formatINR(item.price)}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      item.modelUrl
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-surface-container text-secondary'
                    }`}
                  >
                    {item.modelUrl ? '3D & AR Ready' : 'Photo Gallery'}
                  </span>
                  <button
                    type="button"
                    onClick={() => onPreviewCustomer?.(item)}
                    className="text-xs font-semibold text-primary hover:underline cursor-pointer"
                  >
                    Open 3D &amp; AR View →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </DataCollectionBoundary>
      </div>

      {/* 3D & AR Buyer Impact Card (Matches Image_11 / Image_12) */}
      <div className="bg-surface-container-low rounded-xl border border-surface-container-high p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-primary block">
              Shopper Engagement
            </span>
            <h3 className="text-sm font-bold font-headline text-on-surface">
              3D &amp; AR Buyer Impact
            </h3>
          </div>
          <span className="text-lg font-bold font-headline text-emerald-700 font-tabular-nums">
            +41%
          </span>
        </div>
        <p className="text-xs text-secondary leading-relaxed">
          Products with interactive 3D &amp; AR views help shoppers check room fit before ordering,
          reducing size-related returns.
        </p>
      </div>

      {/* Unit Economics Card */}
      <MoneyBreakdownCard
        title={`Unit Payout Summary (${sku})`}
        currency="INR"
        subtotal={taxableSubtotal}
        taxLabel={`GST (18% • HSN ${draftHsn})`}
        taxAmount={gstAmount}
        feeLabel="PayPal Fee"
        feeAmount={gatewayFee}
        isFeesVerified={feesVerified}
        payoutLabel="Estimated Seller Payout"
        payoutAmount={netPayout}
        total={grossPrice}
        onVerifyFees={onVerifyFees}
      />
    </div>
  );
};
