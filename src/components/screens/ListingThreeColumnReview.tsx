import React from 'react';

export interface GeneratedListingResponse {
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

interface ListingThreeColumnReviewProps {
  sku: string;
  aiResult: GeneratedListingResponse;
  draftTitle: string;
  setDraftTitle: (val: string) => void;
  draftHsn: string;
  setDraftHsn: (val: string) => void;
  draftDescription: string;
  setDraftDescription: (val: string) => void;
  draftTags: string;
  setDraftTags: (val: string) => void;
  sellerApproved: boolean;
  setSellerApproved: (val: boolean) => void;
  onApproveAndPublish: () => void;
}

export const ListingThreeColumnReview: React.FC<ListingThreeColumnReviewProps> = ({
  sku,
  aiResult,
  draftTitle,
  setDraftTitle,
  draftHsn,
  setDraftHsn,
  draftDescription,
  setDraftDescription,
  draftTags,
  setDraftTags,
  sellerApproved,
  setSellerApproved,
  onApproveAndPublish,
}) => {
  return (
    <div
      data-testid="listing-three-columns"
      className="bg-surface-container-lowest rounded-xl border border-surface-container-high p-5 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-surface-container-high">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold font-headline text-on-surface">
            Step 3: Review &amp; Approve Listing Draft
          </span>
          <span
            data-testid="listing-ai-source-badge"
            className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase border ${
              aiResult.source === 'live'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-surface-container text-secondary border-surface-container-high'
            }`}
          >
            {aiResult.source === 'live' ? 'Live' : 'Draft'}
          </span>
        </div>
        <span className="text-xs text-secondary">{aiResult.whyThis}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* COLUMN 1: Provided by seller */}
        <div
          data-testid="col-provided-by-seller"
          className="rounded-xl bg-surface-container-low border border-surface-container-high p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface">
              Provided by seller
            </h3>
            <span className="px-2 py-0.5 rounded bg-surface-container-lowest text-secondary font-tabular-nums text-[10px] font-semibold">
              {aiResult.providedBySeller.length} items
            </span>
          </div>
          <div className="space-y-2 text-xs">
            {aiResult.providedBySeller.map((item, idx) => (
              <div
                key={idx}
                className="flex items-start justify-between gap-2 py-1.5 border-b border-surface-container-high/60 last:border-0"
              >
                <span className="text-secondary font-medium">{item.label}</span>
                <span className="font-semibold text-on-surface text-right">{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* COLUMN 2: Generated (Editable Draft) */}
        <div
          data-testid="col-generated"
          className="rounded-xl bg-primary-fixed/25 border border-primary-fixed-dim p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-on-primary-fixed">
              Generated
            </h3>
            <span className="px-2 py-0.5 rounded bg-surface-container-lowest text-primary text-[10px] font-semibold">
              Editable
            </span>
          </div>

          <div className="space-y-2.5 text-xs">
            <div>
              <label className="block text-[11px] font-semibold text-on-surface mb-1">
                Listing Title
              </label>
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => {
                  setDraftTitle(e.target.value);
                  setSellerApproved(false);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg border border-surface-container-high bg-surface-container-lowest text-on-surface"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-on-surface mb-1">
                Tax Code (HSN)
              </label>
              <input
                type="text"
                value={draftHsn}
                onChange={(e) => {
                  setDraftHsn(e.target.value);
                  setSellerApproved(false);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg border border-surface-container-high bg-surface-container-lowest font-tabular-nums text-on-surface"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-on-surface mb-1">
                Product Description
              </label>
              <textarea
                rows={3}
                value={draftDescription}
                onChange={(e) => {
                  setDraftDescription(e.target.value);
                  setSellerApproved(false);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg border border-surface-container-high bg-surface-container-lowest text-on-surface"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-on-surface mb-1">
                Search Tags
              </label>
              <input
                type="text"
                value={draftTags}
                onChange={(e) => {
                  setDraftTags(e.target.value);
                  setSellerApproved(false);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg border border-surface-container-high bg-surface-container-lowest text-on-surface"
              />
            </div>
            {aiResult.generated.faqs.length > 0 && (
              <div className="pt-1 space-y-1.5">
                <div className="text-[11px] font-semibold text-on-surface">Shopper FAQs:</div>
                {aiResult.generated.faqs.map((f, i) => (
                  <div
                    key={i}
                    className="p-2 rounded-lg bg-surface-container-lowest border border-surface-container-high text-[11px]"
                  >
                    <div className="font-semibold text-on-surface">Q: {f.question}</div>
                    <div className="text-secondary mt-0.5">A: {f.answer}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* COLUMN 3: Missing information */}
        <div
          data-testid="col-missing-information"
          className="rounded-xl bg-amber-50/70 border border-amber-200 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-950">
              Missing information
            </h3>
            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-tabular-nums text-[10px] font-semibold">
              {aiResult.missingInformation.length} Needed
            </span>
          </div>
          <p className="text-[11px] text-amber-900">
            Unprovided details are never guessed. Add these above if they apply to your product:
          </p>
          <ul className="space-y-2 text-xs text-amber-950">
            {aiResult.missingInformation.map((missing, idx) => (
              <li
                key={idx}
                className="p-2.5 rounded-lg bg-surface-container-lowest border border-amber-200 flex items-start gap-2"
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

      <div className="pt-3 border-t border-surface-container-high flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-medium text-secondary">
          {sellerApproved
            ? `Published ${sku} to your store catalog.`
            : 'Review and edit the draft above before publishing to your store.'}
        </span>
        <button
          type="button"
          onClick={onApproveAndPublish}
          data-testid="seller-approve-publish-btn"
          className={`px-5 py-2.5 rounded-xl text-xs font-semibold text-on-primary transition-colors cursor-pointer ${
            sellerApproved ? 'bg-emerald-600' : 'bg-primary hover:bg-primary-container'
          }`}
        >
          {sellerApproved ? 'Approved & Published ✓' : 'Approve & Publish Listing'}
        </button>
      </div>
    </div>
  );
};
