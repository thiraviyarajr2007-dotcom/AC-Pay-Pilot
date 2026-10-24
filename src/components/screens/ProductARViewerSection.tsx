import React, { useState } from 'react';
import { ARPanelState } from './ProductDetailARScreen';
import { WebXRStudioViewer } from '../three/WebXRStudioViewer';

interface GalleryAngle {
  id: string;
  label: string;
  caption: string;
  img: string;
}

interface ProductARViewerSectionProps {
  product: any;
  resolvedModelUrl: string | null;
  arPanelState: ARPanelState;
  setArPanelState: (state: ARPanelState) => void;
  selectedGalleryIdx: number;
  setSelectedGalleryIdx: (idx: number) => void;
  galleryFallbackAngles: GalleryAngle[];
  cameraOrbit: string;
  fieldOfView: number;
  modelViewerRef: React.RefObject<any>;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onInitiateArClick: () => void;
  onConfirmAndLaunchAr: () => void;
  onOpenQRModal?: () => void;
  onOpenARModal?: () => void;
}

export const ProductARViewerSection: React.FC<ProductARViewerSectionProps> = ({
  product,
  resolvedModelUrl,
  arPanelState,
  setArPanelState,
  selectedGalleryIdx,
  setSelectedGalleryIdx,
  galleryFallbackAngles,
  cameraOrbit,
  fieldOfView,
  modelViewerRef,
  onRotateLeft,
  onRotateRight,
  onZoomIn,
  onZoomOut,
  onResetView,
  onInitiateArClick,
  onConfirmAndLaunchAr,
  onOpenQRModal,
  onOpenARModal,
}) => {
  const [engineMode, setEngineMode] = useState<'three_webxr' | 'model_viewer'>('three_webxr');

  return (
    <div className="space-y-6">
      {/* Main 3D & AR Canvas Card */}
      <div className="relative bg-surface-container-lowest rounded-xl overflow-hidden border border-surface-container-high min-h-[440px] sm:min-h-[520px] flex flex-col justify-between p-5 sm:p-6">
        {/* Top Overlay: Spatial 3D Metadata & Engine Selector */}
        <div className="flex flex-wrap items-center justify-between gap-3 z-20 pb-2 border-b border-surface-container-high/60">
          <div className="flex items-center gap-2 text-xs font-semibold text-on-surface">
            <span className="material-symbols-outlined text-primary text-[18px]">view_in_ar</span>
            <span className="tracking-tight">Interactive 3D / WebXR Stage</span>
            <span aria-hidden="true" className="text-outline-variant">·</span>
            <span className="text-[11px] font-mono text-secondary font-medium">
              {engineMode === 'three_webxr' ? 'Three.js WebXR PBR Engine' : 'Binary glTF 2.0'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Engine Switcher */}
            <div className="flex items-center bg-surface-container p-0.5 rounded-lg border border-surface-container-high text-[11px]">
              <button
                type="button"
                onClick={() => setEngineMode('three_webxr')}
                className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                  engineMode === 'three_webxr'
                    ? 'bg-primary text-on-primary shadow-sm'
                    : 'text-secondary hover:text-on-surface'
                }`}
              >
                🥽 WebXR VR Studio
              </button>
              <button
                type="button"
                onClick={() => setEngineMode('model_viewer')}
                className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                  engineMode === 'model_viewer'
                    ? 'bg-primary text-on-primary shadow-sm'
                    : 'text-secondary hover:text-on-surface'
                }`}
              >
                🌐 WebGL glTF
              </button>
            </div>

            <div
              className="flex flex-wrap items-center gap-1 bg-surface-container-low p-1 rounded-xl border border-surface-container-high"
              role="group"
              aria-label="3D and AR preview modes"
            >
              {(
                [
                  { id: 'ready', label: '3D View' },
                  { id: 'loading', label: 'Loading' },
                  { id: 'model_unavailable', label: 'Photos' },
                  { id: 'ar_unsupported', label: 'Phone QR' },
                  { id: 'camera_denied', label: 'Camera Off' },
                ] as { id: ARPanelState; label: string }[]
              ).map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setArPanelState(st.id)}
                  data-testid={`ar-state-btn-${st.id}`}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                    arPanelState === st.id
                      ? 'bg-primary text-on-primary'
                      : 'text-secondary hover:text-on-surface'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Center Interactive Stage */}
        <div className="relative flex-1 my-4 rounded-xl overflow-hidden bg-surface-container-low border border-surface-container-high flex items-center justify-center min-h-[360px] sm:min-h-[420px]">
          {/* Loading State */}
          {arPanelState === 'loading' && (
            <div
              data-testid="ar-panel-loading"
              className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center bg-surface-container-lowest/95"
            >
              <div className="w-12 h-12 rounded-xl bg-primary-fixed text-primary flex items-center justify-center mb-3">
                <span className="material-symbols-outlined animate-spin text-[24px]">
                  progress_activity
                </span>
              </div>
              <h3 className="text-base font-bold text-on-surface mb-1">Loading 3D view...</h3>
              <p className="text-xs text-secondary max-w-sm mb-4">
                Preparing interactive 3D product view for {product.name}.
              </p>
              <button
                type="button"
                onClick={() => setArPanelState('model_unavailable')}
                className="px-3.5 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs font-semibold text-on-surface transition-colors cursor-pointer"
              >
                View Product Photos Instead
              </button>
            </div>
          )}

          {/* 3D View Unavailable -> Clean Photo Gallery Fallback */}
          {(arPanelState === 'model_unavailable' || !resolvedModelUrl) &&
            arPanelState !== 'loading' &&
            arPanelState !== 'ar_unsupported' &&
            arPanelState !== 'camera_denied' && (
              <div
                data-testid="ar-panel-model-unavailable"
                className="inset-0 z-10 w-full h-full flex flex-col justify-between p-4 bg-surface-container-lowest"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-container-low border border-surface-container-high rounded-xl px-3.5 py-2">
                  <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                    <span className="material-symbols-outlined text-primary text-[18px]">
                      photo_library
                    </span>
                    <span>3D view isn&apos;t available for this product yet. Showing product photos.</span>
                  </div>
                  {resolvedModelUrl && (
                    <button
                      type="button"
                      onClick={() => setArPanelState('ready')}
                      className="text-xs font-semibold text-primary hover:underline cursor-pointer"
                    >
                      Back to 3D view
                    </button>
                  )}
                </div>

                <div className="relative flex-1 my-3 rounded-xl overflow-hidden bg-surface-container-low flex items-center justify-center p-4">
                  <img
                    src={galleryFallbackAngles[selectedGalleryIdx].img}
                    alt={galleryFallbackAngles[selectedGalleryIdx].label}
                    className="w-full h-full object-contain max-h-[240px]"
                  />
                  <div className="absolute bottom-3 left-3 right-3 bg-surface-container-lowest/95 px-3.5 py-2 rounded-xl border border-surface-container-high flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-on-surface">
                        {galleryFallbackAngles[selectedGalleryIdx].label}
                      </div>
                      <div className="text-[11px] text-secondary">
                        {galleryFallbackAngles[selectedGalleryIdx].caption}
                      </div>
                    </div>
                    <span className="text-[11px] font-tabular-nums font-semibold text-secondary bg-surface-container px-2.5 py-0.5 rounded-lg">
                      {selectedGalleryIdx + 1} / {galleryFallbackAngles.length}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {galleryFallbackAngles.map((angle, idx) => (
                    <button
                      key={angle.id}
                      type="button"
                      onClick={() => setSelectedGalleryIdx(idx)}
                      className={`p-2 rounded-xl border text-left transition-colors cursor-pointer ${
                        selectedGalleryIdx === idx
                          ? 'bg-primary-fixed/40 border-primary text-on-surface'
                          : 'bg-surface-container-low border-surface-container-high text-secondary hover:text-on-surface'
                      }`}
                    >
                      <div className="text-[11px] font-semibold truncate">{angle.label}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

          {/* AR Unsupported on Desktop -> Phone QR Handoff */}
          {arPanelState === 'ar_unsupported' && (
            <div
              data-testid="ar-panel-unsupported"
              className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center bg-surface-container-lowest"
            >
              <div className="w-12 h-12 rounded-xl bg-primary-fixed text-primary flex items-center justify-center mb-3">
                <span className="material-symbols-outlined text-[24px]">qr_code_scanner</span>
              </div>
              <h3 className="text-base font-bold text-on-surface mb-1">
                AR unsupported on this device
              </h3>
              <p className="text-xs text-secondary max-w-md leading-relaxed mb-4">
                Room placement works best on a mobile phone or tablet with a camera. Scan the QR
                code with your phone or return to the 3D view.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={onOpenQRModal}
                  className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">qr_code_2</span>
                  <span>Scan Phone QR Code</span>
                </button>
                <button
                  type="button"
                  onClick={() => setArPanelState('model_unavailable')}
                  className="px-3.5 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold cursor-pointer"
                >
                  View Photos
                </button>
                {resolvedModelUrl && (
                  <button
                    type="button"
                    onClick={() => setArPanelState('ready')}
                    className="px-3.5 py-2 rounded-xl text-secondary hover:text-on-surface text-xs font-semibold cursor-pointer"
                  >
                    Back to 3D View
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Camera Permission Denied */}
          {arPanelState === 'camera_denied' && (
            <div
              data-testid="ar-panel-camera-denied"
              className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center bg-surface-container-lowest"
            >
              <div className="w-12 h-12 rounded-xl bg-error-container text-error flex items-center justify-center mb-3">
                <span className="material-symbols-outlined text-[24px]">videocam_off</span>
              </div>
              <h3 className="text-base font-bold text-on-surface mb-1">
                Camera permission denied
              </h3>
              <p className="text-xs text-secondary max-w-md leading-relaxed mb-4">
                Room placement needs camera access to preview this item in your space. Allow camera
                access in your browser settings or continue using the 3D view.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={onConfirmAndLaunchAr}
                  className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-semibold cursor-pointer"
                >
                  Try Camera Again
                </button>
                <button
                  type="button"
                  onClick={() => setArPanelState('model_unavailable')}
                  className="px-3.5 py-2 rounded-xl bg-surface-container text-on-surface text-xs font-semibold cursor-pointer"
                >
                  View Photos
                </button>
                {resolvedModelUrl && (
                  <button
                    type="button"
                    onClick={() => setArPanelState('ready')}
                    className="px-3.5 py-2 rounded-xl text-secondary hover:text-on-surface text-xs font-semibold cursor-pointer"
                  >
                    Use 3D View
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Ready State: Three.js WebXR Studio or Google Model Viewer */}
          {arPanelState === 'ready' && resolvedModelUrl && (
            engineMode === 'three_webxr' ? (
              <div className="relative w-full h-[400px] sm:h-[460px]">
                <WebXRStudioViewer
                  productSkuOrName={product.sku || product.name}
                  productName={product.name}
                  price={product.price}
                />
              </div>
            ) : (
              <div className="relative w-full h-[340px] sm:h-[380px] flex items-center justify-center">
                {React.createElement('model-viewer', {
                  ref: modelViewerRef,
                  src: resolvedModelUrl,
                  alt: `3D view of ${product.name}`,
                  'camera-controls': true,
                  'auto-rotate': true,
                  ar: true,
                  'ar-modes': 'webxr scene-viewer quick-look',
                  'camera-orbit': cameraOrbit,
                  'field-of-view': `${fieldOfView}deg`,
                  'shadow-intensity': '1',
                  exposure: '1.1',
                  style: {
                    width: '100%',
                    height: '100%',
                    backgroundColor: 'transparent',
                  },
                  'data-testid': 'google-model-viewer',
                })}
              </div>
            )
          )}
        </div>

        {/* Bottom 3D Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 z-20">
          <div className="flex items-center gap-1.5 bg-surface-container-low p-1.5 rounded-xl border border-surface-container-high">
            <button
              type="button"
              onClick={onRotateLeft}
              className="px-3 py-1.5 rounded-lg bg-surface-container-lowest text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors cursor-pointer"
              title="Rotate Left"
            >
              ↺ Rotate Left
            </button>
            <button
              type="button"
              onClick={onRotateRight}
              className="px-3 py-1.5 rounded-lg bg-surface-container-lowest text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors cursor-pointer"
              title="Rotate Right"
            >
              ↻ Rotate Right
            </button>
            <button
              type="button"
              onClick={onZoomOut}
              className="w-8 h-8 rounded-lg bg-surface-container-lowest text-on-surface font-bold hover:bg-surface-container transition-colors cursor-pointer"
              aria-label="Zoom out"
            >
              -
            </button>
            <button
              type="button"
              onClick={onZoomIn}
              className="w-8 h-8 rounded-lg bg-surface-container-lowest text-on-surface font-bold hover:bg-surface-container transition-colors cursor-pointer"
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              onClick={onResetView}
              data-testid="model-viewer-reset-btn"
              className="px-3 py-1.5 rounded-lg text-secondary hover:text-on-surface text-xs font-semibold transition-colors cursor-pointer"
            >
              Reset View
            </button>
          </div>

          <div className="text-right">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-secondary block">
              True-to-Scale Dimensions
            </span>
            <span className="text-xs font-bold text-on-surface font-tabular-nums">
              {product.dimensions || '1200 × 1200 × 340 mm'}
            </span>
          </div>
        </div>
      </div>

      {/* AR Experience, WebXR VR Showroom & Gallery Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: WebXR VR Showroom */}
        <div className="bg-[#0f172a] text-white p-5 rounded-xl flex flex-col justify-between border border-sky-500/30">
          <div className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-sky-400">
              WebXR Virtual Reality
            </span>
            <h3 className="text-base font-bold font-headline text-white">VR Headset &amp; Stereo 3D</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Experience this product in WebXR stereoscopic VR. Supports Meta Quest, Apple Vision Pro, Cardboard, and exploded mechanical inspection.
            </p>
          </div>
          <div className="pt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenARModal && onOpenARModal()}
              data-testid="launch-vr-showroom-btn"
              className="px-3.5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-black text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">view_in_ar</span>
              <span>Launch VR Studio</span>
            </button>
            <button
              type="button"
              onClick={() => setEngineMode('three_webxr')}
              className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-all cursor-pointer"
            >
              Embed 3D
            </button>
          </div>
        </div>

        {/* Card 2: Augmented Reality (AR) */}
        <div className="bg-primary text-on-primary p-5 rounded-xl flex flex-col justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-primary-fixed">
              Augmented Reality
            </span>
            <h3 className="text-base font-bold font-headline">Try in Your Room (AR)</h3>
            <p className="text-xs text-on-primary-container leading-relaxed">
              Preview true-to-scale clearance in your room using your phone camera.
            </p>
          </div>
          <div className="pt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onInitiateArClick}
              data-testid="ar-check-device-btn"
              className="px-3.5 py-2 rounded-lg bg-surface-container-lowest text-primary text-xs font-bold hover:bg-primary-fixed transition-colors cursor-pointer"
            >
              Launch Room View
            </button>
            <button
              type="button"
              onClick={onOpenQRModal}
              className="px-3 py-2 rounded-lg bg-primary-container text-on-primary text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
            >
              Phone QR Code
            </button>
          </div>
        </div>

        {/* Card 3: Studio Photo Gallery */}
        <div className="bg-surface-container-low p-5 rounded-xl border border-surface-container-high flex flex-col justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-secondary">
              Gallery Angles
            </span>
            <h3 className="text-base font-bold font-headline text-on-surface">
              Studio Photo Gallery
            </h3>
            <p className="text-xs text-secondary leading-relaxed">
              Switch between 3D rotation and high-resolution studio reference angles.
            </p>
          </div>
          <div className="pt-3">
            <button
              type="button"
              onClick={() =>
                setArPanelState(arPanelState === 'model_unavailable' ? 'ready' : 'model_unavailable')
              }
              className="text-xs font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>
                {arPanelState === 'model_unavailable' ? 'Switch to 3D View' : 'Browse Studio Photos'}
              </span>
              <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
            </button>
          </div>
        </div>
      </div>

      {/* Curated Room Visualizations */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-secondary">
          Curated Room Previews
        </h4>
        <div className="grid grid-cols-3 gap-4">
          {galleryFallbackAngles.map((angle, idx) => (
            <button
              key={angle.id}
              type="button"
              onClick={() => {
                setSelectedGalleryIdx(idx);
                setArPanelState('model_unavailable');
              }}
              className="group relative aspect-video bg-surface-container rounded-xl overflow-hidden border border-surface-container-high text-left cursor-pointer"
            >
              <img
                src={angle.img}
                alt={angle.label}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
              <div className="absolute inset-0 bg-on-surface/30 flex items-end p-2.5">
                <span className="text-[10px] text-white font-semibold uppercase tracking-wider truncate">
                  {angle.label}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
