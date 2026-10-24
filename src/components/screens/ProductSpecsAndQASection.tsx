import React from 'react';
import {
  CollectionViewState,
  DataCollectionBoundary,
} from '../ui/HonestTrustComponents';

interface ProductQaResult {
  source: 'live' | 'fallback';
  answerStatus: 'answered_from_specs' | 'not_provided';
  answer: string;
  citedField: string;
}

interface ProductSpecsAndQASectionProps {
  product: any;
  resolvedModelUrl: string | null;
  qaQuestion: string;
  setQaQuestion: (q: string) => void;
  qaLoading: boolean;
  qaResult: ProductQaResult | null;
  onAskProductQa: (e?: React.FormEvent, overrideQuestion?: string) => Promise<void>;
  benchmarkState: CollectionViewState;
  setBenchmarkState: (state: CollectionViewState) => void;
}

export const ProductSpecsAndQASection: React.FC<ProductSpecsAndQASectionProps> = ({
  product,
  resolvedModelUrl,
  qaQuestion,
  setQaQuestion,
  qaLoading,
  qaResult,
  onAskProductQa,
  benchmarkState,
  setBenchmarkState,
}) => {
  return (
    <div className="space-y-8">
      {/* 6-Cell Technical Specifications Bento (Matches Image_9 / Image_10) */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-secondary">
          Product Specifications
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="p-3.5 bg-surface-container-low rounded-xl border border-surface-container-high">
            <span className="text-[10px] font-semibold text-secondary uppercase block">
              Dimensions
            </span>
            <span className="text-xs font-bold text-on-surface font-tabular-nums mt-0.5 block">
              {product.dimensions || 'Not available'}
            </span>
          </div>
          <div className="p-3.5 bg-surface-container-low rounded-xl border border-surface-container-high">
            <span className="text-[10px] font-semibold text-secondary uppercase block">
              Weight
            </span>
            <span className="text-xs font-bold text-on-surface font-tabular-nums mt-0.5 block">
              {product.weight || 'Not available'}
            </span>
          </div>
          <div className="p-3.5 bg-surface-container-low rounded-xl border border-surface-container-high">
            <span className="text-[10px] font-semibold text-secondary uppercase block">
              Warranty
            </span>
            <span className="text-xs font-bold text-on-surface mt-0.5 block">
              {product.warranty || 'Not available'}
            </span>
          </div>
          <div className="p-3.5 bg-surface-container-low rounded-xl border border-surface-container-high">
            <span className="text-[10px] font-semibold text-secondary uppercase block">
              Tax Code (HSN)
            </span>
            <span className="text-xs font-bold text-on-surface font-tabular-nums mt-0.5 block">
              {product.hsCode || '8414.51.10'}
            </span>
          </div>
          <div className="p-3.5 bg-surface-container-low rounded-xl border border-surface-container-high">
            <span className="text-[10px] font-semibold text-secondary uppercase block">
              GST Rate
            </span>
            <span className="text-xs font-bold text-on-surface font-tabular-nums mt-0.5 block">
              {product.gstRate || 18}% GST Included
            </span>
          </div>
          <div className="p-3.5 bg-surface-container-low rounded-xl border border-surface-container-high">
            <span className="text-[10px] font-semibold text-secondary uppercase block">
              3D &amp; AR View
            </span>
            <span className="text-xs font-bold text-emerald-700 mt-0.5 block">
              {resolvedModelUrl ? 'Available' : 'Photo Gallery Only'}
            </span>
          </div>
        </div>
      </div>

      {/* Customer Product Q&A Card (Matches Image_9 / Image_10 Buyer Q&A Section) */}
      <div className="bg-surface-container-lowest rounded-xl border border-surface-container-high p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-on-surface font-headline">
              Ask About This Product
            </h3>
            <p className="text-xs text-secondary">
              Answers come directly from the seller&apos;s listed product details. If a detail isn&apos;t listed, we&apos;ll let you know.
            </p>
          </div>
          {qaResult && (
            <span
              data-testid="product-qa-source-badge"
              className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-surface-container text-secondary"
            >
              {qaResult.source === 'live' ? 'Live' : 'Instant Answer'}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              void onAskProductQa(
                undefined,
                'What is the power consumption and blade sweep?'
              )
            }
            className="px-3 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-medium transition-colors cursor-pointer"
          >
            Power &amp; blade sweep?
          </button>
          <button
            type="button"
            onClick={() => void onAskProductQa(undefined, 'What is the warranty coverage?')}
            className="px-3 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-medium transition-colors cursor-pointer"
          >
            Warranty details?
          </button>
          <button
            type="button"
            onClick={() =>
              void onAskProductQa(
                undefined,
                'What is the IP waterproof rating and copper winding gauge?'
              )
            }
            data-testid="qa-ask-unknown-btn"
            className="px-3 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-secondary text-xs font-medium transition-colors cursor-pointer"
          >
            Waterproof rating?
          </button>
        </div>

        <form onSubmit={(e) => void onAskProductQa(e)} className="flex gap-2">
          <input
            type="text"
            value={qaQuestion}
            onChange={(e) => setQaQuestion(e.target.value)}
            placeholder="Ask a question about size, warranty, or power..."
            className="flex-1 px-3.5 py-2 rounded-xl border border-surface-container-high bg-surface-container-low text-xs text-on-surface focus:outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={qaLoading}
            data-testid="product-qa-submit-btn"
            className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-container disabled:opacity-50 text-on-primary text-xs font-semibold cursor-pointer"
          >
            {qaLoading ? 'Checking...' : 'Ask'}
          </button>
        </form>

        {qaResult && (
          <div
            data-testid="product-qa-answer-box"
            className={`p-3.5 rounded-xl border text-xs space-y-1 ${
              qaResult.answerStatus === 'answered_from_specs'
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                : 'bg-amber-50/80 border-amber-200 text-amber-950'
            }`}
          >
            <div className="flex items-center justify-between text-[11px] font-semibold">
              <span>
                {qaResult.answerStatus === 'answered_from_specs'
                  ? 'Listed Specification'
                  : 'Detail Not Provided by Seller'}
              </span>
              <span className="text-secondary">Detail: {qaResult.citedField}</span>
            </div>
            <p className="leading-relaxed">{qaResult.answer}</p>
          </div>
        )}
      </div>

      {/* Bottom Comparison Table (Matches Image_9 / Image_10) */}
      <div className="bg-surface-container-lowest rounded-xl border border-surface-container-high p-5">
        <div className="mb-4">
          <h3 className="text-base font-bold font-headline text-on-surface">
            Specification Summary
          </h3>
          <p className="text-xs text-secondary">
            Key product details provided by the seller for this listing.
          </p>
        </div>

        <DataCollectionBoundary
          title="Product Specifications"
          state={benchmarkState}
          onStateChange={setBenchmarkState}
          emptyMessage="No product specifications found."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-surface-container-high text-[11px] font-semibold uppercase tracking-wider text-secondary">
                  <th className="py-3 pr-4">Feature</th>
                  <th className="py-3 px-4 text-primary font-bold">{product.name}</th>
                  <th className="py-3 pl-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container text-xs">
                <tr>
                  <td className="py-3 pr-4 font-semibold text-on-surface">3D &amp; AR View</td>
                  <td className="py-3 px-4 font-semibold text-on-surface">
                    {resolvedModelUrl ? 'Interactive 3D & AR Ready' : "3D view isn't available for this product yet."}
                  </td>
                  <td className="py-3 pl-4 text-right text-emerald-700 font-semibold">
                    {resolvedModelUrl ? 'Ready' : 'Photos Only'}
                  </td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-semibold text-on-surface">Dimensions</td>
                  <td className="py-3 px-4 font-tabular-nums text-on-surface">
                    {product.dimensions || 'Not available'}
                  </td>
                  <td className="py-3 pl-4 text-right text-secondary">Seller Listed</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-semibold text-on-surface">Warranty</td>
                  <td className="py-3 px-4 text-on-surface">
                    {product.warranty || 'Not available'}
                  </td>
                  <td className="py-3 pl-4 text-right text-secondary">Seller Listed</td>
                </tr>
              </tbody>
            </table>
          </div>
        </DataCollectionBoundary>
      </div>
    </div>
  );
};
