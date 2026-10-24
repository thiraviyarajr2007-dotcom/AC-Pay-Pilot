import React from 'react';

interface GuidedDemoBarProps {
  isDemoTourActive?: boolean;
  demoStepIndex?: number;
  onSelectDemoStep?: (stepIdx: number) => void;
  onCloseDemoTour?: () => void;
}

export const DEMO_TOUR_STEPS = [
  {
    step: 1,
    role: 'seller' as const,
    route: '/seller/listing-studio',
    title: '1. Seller Uploads 3D Model & AI Drafts Listing',
    description:
      'Upload the AeroBreeze 1200mm ceiling fan 3D model, review the 3-column AI listing draft, and approve.',
  },
  {
    step: 2,
    role: 'customer' as const,
    route: '/customer/product/FAN-BLDC-892',
    title: '2. Customer Inspects 3D & AR View',
    description:
      'Rotate, zoom, and reset the 3D fan view, test AR placement, or ask a product question.',
  },
  {
    step: 3,
    role: 'customer' as const,
    route: '/customer/cart',
    title: '3. SmartCart Ranking & PayPal Checkout',
    description:
      'Review ranked cart items against your budget and complete PayPal checkout.',
  },
  {
    step: 4,
    role: 'seller' as const,
    route: '/seller/orders',
    title: '4. Seller Order & Escrow Release',
    description:
      'Review the AI release recommendation and confirm escrow transition with one click.',
  },
  {
    step: 5,
    role: 'finance' as const,
    route: '/finance/invoices',
    title: '5. Finance InvoiceIQ Review',
    description:
      'Verify invoice GST compliance, tax split, and payment status.',
  },
  {
    step: 6,
    role: 'business_head' as const,
    route: '/executive',
    title: '6. Executive Command Center',
    description:
      'Inspect store KPIs, revenue trends, and strategic insights.',
  },
];

export const ScreenDataSourceBanner: React.FC<GuidedDemoBarProps> = ({
  isDemoTourActive = false,
  demoStepIndex = 0,
  onSelectDemoStep,
  onCloseDemoTour,
}) => {
  if (!isDemoTourActive) {
    return null;
  }

  return (
    <div
      data-testid="guided-demo-tour-bar"
      className="mb-6 bg-surface-container-lowest text-on-surface rounded-xl p-4 border border-surface-container-high shadow-xs space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed text-[11px] font-semibold uppercase tracking-wider">
            Guided Walkthrough • Step {demoStepIndex + 1} of {DEMO_TOUR_STEPS.length}
          </span>
          <span className="text-sm font-bold text-on-surface">
            {DEMO_TOUR_STEPS[demoStepIndex]?.title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={demoStepIndex <= 0}
            onClick={() => onSelectDemoStep && onSelectDemoStep(demoStepIndex - 1)}
            className="px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high disabled:opacity-40 text-xs font-semibold cursor-pointer"
          >
            ← Prev
          </button>
          <button
            type="button"
            disabled={demoStepIndex >= DEMO_TOUR_STEPS.length - 1}
            onClick={() => onSelectDemoStep && onSelectDemoStep(demoStepIndex + 1)}
            data-testid="demo-next-step-btn"
            className="px-3 py-1 rounded-lg bg-primary hover:bg-primary-container disabled:opacity-40 text-on-primary text-xs font-semibold cursor-pointer"
          >
            Next Step →
          </button>
          <button
            type="button"
            onClick={onCloseDemoTour}
            className="px-2 py-1 rounded-lg text-secondary hover:text-on-surface text-xs font-medium cursor-pointer"
          >
            Exit
          </button>
        </div>
      </div>

      <p className="text-xs text-secondary">{DEMO_TOUR_STEPS[demoStepIndex]?.description}</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5 pt-1">
        {DEMO_TOUR_STEPS.map((st, idx) => (
          <button
            key={st.step}
            type="button"
            onClick={() => onSelectDemoStep && onSelectDemoStep(idx)}
            data-testid={`demo-step-btn-${st.step}`}
            className={`px-2.5 py-1.5 rounded-lg text-left text-[11px] font-semibold transition-all cursor-pointer border ${
              idx === demoStepIndex
                ? 'bg-primary text-on-primary border-primary'
                : 'bg-surface-container-low text-secondary border-transparent hover:text-on-surface'
            }`}
          >
            <div className="truncate">{st.title}</div>
          </button>
        ))}
      </div>
    </div>
  );
};
