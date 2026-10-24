import React from 'react';

interface QRModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
}

export const QRModal: React.FC<QRModalProps> = ({
  isOpen,
  onClose,
  title = 'Scan to Open 3D & AR View on Phone',
  subtitle = 'Open your phone camera to place the 1200mm AeroBreeze ceiling fan in your room at true scale.',
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-on-surface/50 flex items-center justify-center p-4">
      <div className="relative w-full max-w-sm rounded-xl bg-surface-container-lowest p-6 shadow-xl border border-surface-container-high flex flex-col items-center gap-4 text-center">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-secondary hover:text-on-surface p-1 rounded-lg transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>

        <div className="w-12 h-12 rounded-xl bg-primary-fixed flex items-center justify-center text-primary">
          <span className="material-symbols-outlined text-[26px]">view_in_ar</span>
        </div>

        <div>
          <h3 className="text-base font-headline text-on-surface font-bold">{title}</h3>
          <p className="text-xs text-secondary mt-1">{subtitle}</p>
        </div>

        <div className="p-4 rounded-xl bg-surface-container-low border border-surface-container-high">
          <svg className="w-44 h-44 text-on-surface" fill="currentColor" viewBox="0 0 100 100">
            <rect fill="none" height="25" rx="3" stroke="currentColor" strokeWidth="4" width="25" x="5" y="5" />
            <rect height="11" rx="1" width="11" x="12" y="12" />
            <rect fill="none" height="25" rx="3" stroke="currentColor" strokeWidth="4" width="25" x="70" y="5" />
            <rect height="11" rx="1" width="11" x="77" y="12" />
            <rect fill="none" height="25" rx="3" stroke="currentColor" strokeWidth="4" width="25" x="5" y="70" />
            <rect height="11" rx="1" width="11" x="12" y="77" />
            <rect height="8" rx="1" width="8" x="36" y="8" />
            <rect height="8" rx="1" width="8" x="48" y="12" />
            <rect height="18" rx="1" width="6" x="38" y="24" />
            <rect height="6" rx="1" width="12" x="52" y="28" />
            <rect height="6" rx="1" width="18" x="8" y="38" />
            <rect height="6" rx="1" width="22" x="70" y="38" />
            <rect fill="none" height="20" rx="3" stroke="currentColor" strokeWidth="3" width="20" x="40" y="44" />
            <circle cx="50" cy="54" fill="currentColor" r="4" />
            <rect height="6" rx="1" width="12" x="36" y="72" />
            <rect height="12" rx="1" width="8" x="54" y="68" />
            <rect height="12" rx="1" width="12" x="70" y="72" />
            <rect height="12" rx="1" width="6" x="86" y="80" />
          </svg>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-surface-container text-on-surface text-xs hover:bg-surface-container-high transition-colors font-semibold cursor-pointer"
        >
          Close
        </button>
      </div>
    </div>
  );
};
