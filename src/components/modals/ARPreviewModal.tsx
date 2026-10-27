import React, { useState } from 'react';
import { formatINR } from '../../utils/finance';
import { WebXRStudioViewer } from '../three/WebXRStudioViewer';

interface ARPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  productName: string;
  price: number;
  productSku?: string;
  initialVrMode?: boolean;
  onReservePayPal?: () => void;
}

export const ARPreviewModal: React.FC<ARPreviewModalProps> = ({
  isOpen,
  onClose,
  productName,
  price,
  productSku = 'FAN-BLDC-892',
  initialVrMode = false,
  onReservePayPal,
}) => {
  const [activeTab, setActiveTab] = useState<'webxr' | 'spec_card'>('webxr');

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${productName} 3D and VR Studio View`}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 animate-fade-in"
    >
      <div className="bg-[#0c0e14] rounded-2xl shadow-2xl max-w-5xl w-full h-[90vh] max-h-[820px] flex flex-col overflow-hidden border border-white/10 relative">
        {/* Top Bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-black/40">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-sky-400 text-[24px]">view_in_ar</span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white tracking-tight">{productName}</h2>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-bold border border-sky-500/30">
                  WebXR Ready
                </span>
              </div>
              <p className="text-[11px] text-white/50">
                True-Scale WebXR Stereoscopic VR &amp; 3D Interactive Showroom
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center bg-white/5 p-1 rounded-xl border border-white/10 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('webxr')}
                className={`px-3 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                  activeTab === 'webxr' ? 'bg-sky-500 text-black' : 'text-white/70 hover:text-white'
                }`}
              >
                VR / 3D Canvas
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('spec_card')}
                className={`px-3 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                  activeTab === 'spec_card' ? 'bg-sky-500 text-black' : 'text-white/70 hover:text-white'
                }`}
              >
                Escrow &amp; Specs
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all cursor-pointer"
              title="Close modal"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 relative overflow-hidden">
          {activeTab === 'webxr' ? (
            <WebXRStudioViewer
              productSkuOrName={productSku || productName}
              productName={productName}
              price={price}
              initialVrMode={initialVrMode}
              onAddToCart={() => {
                onReservePayPal?.();
                onClose();
              }}
            />
          ) : (
            <div className="p-6 overflow-y-auto h-full text-white space-y-6 max-w-2xl mx-auto">
              <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
                <span className="text-[11px] font-mono text-sky-400 uppercase tracking-widest font-bold">
                  Spatial Specifications
                </span>
                <h3 className="text-lg font-bold">{productName}</h3>
                <p className="text-xs text-white/70 leading-relaxed">
                  Every 3D model in AC PayPilot is engineered with physical dimensions, PBR material
                  parameters (roughness, metalness, transmission), and multi-part subassemblies for
                  exploded-view inspection in both WebXR and 6DoF desktop modes.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <span className="text-white/40 block text-[10px] uppercase font-bold">Price</span>
                  <span className="text-base font-bold text-white font-mono">{formatINR(price)}</span>
                </div>
                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <span className="text-white/40 block text-[10px] uppercase font-bold">Escrow Protection</span>
                  <span className="text-base font-bold text-emerald-400">100% Secured</span>
                </div>
                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <span className="text-white/40 block text-[10px] uppercase font-bold">WebXR Target</span>
                  <span className="text-xs font-semibold text-white">Meta Quest / Vision Pro / Dual-Eye</span>
                </div>
                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <span className="text-white/40 block text-[10px] uppercase font-bold">Lighting Rig</span>
                  <span className="text-xs font-semibold text-white">Studio PBR + RoomEnvironment</span>
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('webxr')}
                  className="px-4 py-2 rounded-xl bg-white/10 text-white text-xs font-semibold hover:bg-white/20 transition-all cursor-pointer"
                >
                  Return to 3D / VR View
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onReservePayPal?.();
                    onClose();
                  }}
                  className="px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-black text-xs font-bold transition-all cursor-pointer"
                >
                  Add to Cart &amp; Checkout
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer info bar */}
        <div className="px-5 py-2.5 bg-black/60 border-t border-white/10 flex items-center justify-between text-[11px] text-white/50">
          <div className="flex items-center gap-3">
            <span>🥽 VR Controllers: Trigger to explode</span>
            <span className="hidden sm:inline">•</span>
            <span className="hidden sm:inline">⌨️ Press &apos;H&apos; to toggle control dock</span>
          </div>
          <div className="flex items-center gap-1.5 text-sky-400 font-medium">
            <span className="material-symbols-outlined text-[14px]">lock</span>
            <span>PayPal Escrow Verification Enabled</span>
          </div>
        </div>
      </div>
    </div>
  );
};
