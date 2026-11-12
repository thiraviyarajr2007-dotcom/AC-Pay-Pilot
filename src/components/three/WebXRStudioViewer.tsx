import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createProduct3DModel, ProceduralProductResult } from './proceduralModels';

interface WebXRStudioViewerProps {
  productSkuOrName: string;
  productName: string;
  price?: number;
  initialVrMode?: boolean;
  onClose?: () => void;
  onAddToCart?: () => void;
}

export type ViewPreset = 'perspective' | 'front' | 'top' | 'detail' | 'iso';
export type ColorwayFinish = 'obsidian' | 'titanium' | 'rosegold' | 'alpine';
export type DisplayMode = 'standard_3d' | 'stereo_vr' | 'webxr_active';

// Procedural Web Audio Click Synthesizer (Zero 404s)
function playHapticTone(freq = 640, duration = 0.04) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {
    // AudioContext blocked or unsupported, silently continue
  }
}

export const WebXRStudioViewer: React.FC<WebXRStudioViewerProps> = ({
  productSkuOrName,
  productName,
  price,
  initialVrMode = false,
  onClose,
  onAddToCart,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isSoftwareGl, setIsSoftwareGl] = useState(false);
  const [hasWebXRSupport, setHasWebXRSupport] = useState<boolean | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(initialVrMode ? 'stereo_vr' : 'standard_3d');
  const [explodeProgress, setExplodeProgress] = useState(0);
  const [selectedFinish, setSelectedFinish] = useState<ColorwayFinish>('obsidian');
  const [currentPreset, setCurrentPreset] = useState<ViewPreset>('perspective');
  const [isControlsCollapsed, setIsControlsCollapsed] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [vrStatusMessage, setVrStatusMessage] = useState<string | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const [fallbackView, setFallbackView] = useState({ rx: -10, ry: 22, scale: 1 });

  // Mutable Three.js refs to avoid re-renders tearing down the WebGL canvas
  const threeRefs = useRef<{
    renderer: THREE.WebGLRenderer | null;
    scene: THREE.Scene | null;
    camera: THREE.PerspectiveCamera | null;
    stereoCamera: THREE.StereoCamera | null;
    controls: OrbitControls | null;
    productModel: ProceduralProductResult | null;
    xrSession: any | null;
    targetExplode: number;
    currentExplode: number;
    targetCamPos: THREE.Vector3;
    targetLookAt: THREE.Vector3;
    isTransitioningCam: boolean;
    activeDisplayMode: DisplayMode;
    autoRotate: boolean;
  }>({
    renderer: null,
    scene: null,
    camera: null,
    stereoCamera: null,
    controls: null,
    productModel: null,
    xrSession: null,
    targetExplode: 0,
    currentExplode: 0,
    targetCamPos: new THREE.Vector3(2.4, 1.8, 3.2),
    targetLookAt: new THREE.Vector3(0, 0.8, 0),
    isTransitioningCam: false,
    activeDisplayMode: initialVrMode ? 'stereo_vr' : 'standard_3d',
    autoRotate: true,
  });

  // Check WebXR hardware support
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'xr' in navigator && (navigator as any).xr) {
      (navigator as any).xr
        .isSessionSupported('immersive-vr')
        .then((supported: boolean) => setHasWebXRSupport(supported))
        .catch(() => setHasWebXRSupport(false));
    } else {
      setHasWebXRSupport(false);
    }
  }, []);

  // Update mutable state
  useEffect(() => {
    threeRefs.current.targetExplode = explodeProgress;
  }, [explodeProgress]);

  useEffect(() => {
    threeRefs.current.activeDisplayMode = displayMode;
  }, [displayMode]);

  useEffect(() => {
    threeRefs.current.autoRotate = autoRotate;
    if (threeRefs.current.controls) {
      threeRefs.current.controls.autoRotate = autoRotate;
    }
  }, [autoRotate]);

  // Keyboard shortcut 'H' to toggle dock
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'h' || e.key === 'H') {
        setIsControlsCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // External 3D Viewer bar controls listener (Rotate Left/Right, Zoom +/-, Reset)
  useEffect(() => {
    const handle3DControl = (e: Event) => {
      const ce = e as CustomEvent<{ action: string; delta?: number; factor?: number }>;
      if (!ce.detail) return;
      const { action } = ce.detail;
      if (action === 'rotate_left' || action === 'rotate_right') {
        setFallbackView((prev) => ({
          ...prev,
          ry: prev.ry + (action === 'rotate_left' ? -22.5 : 22.5),
        }));
      } else if (action === 'zoom_in') {
        setFallbackView((prev) => ({ ...prev, scale: Math.min(1.6, Number((prev.scale * 1.15).toFixed(2))) }));
      } else if (action === 'zoom_out') {
        setFallbackView((prev) => ({ ...prev, scale: Math.max(0.65, Number((prev.scale * 0.85).toFixed(2))) }));
      } else if (action === 'reset_view') {
        setFallbackView({ rx: -10, ry: 22, scale: 1 });
      }
      const { camera, controls } = threeRefs.current;
      if (!camera || !controls) return;

      if (action === 'rotate_left' || action === 'rotate_right') {
        const angle = action === 'rotate_left' ? -Math.PI / 8 : Math.PI / 8; // 22.5 deg steps
        const offset = camera.position.clone().sub(controls.target);
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        camera.position.copy(controls.target).add(offset);
        camera.lookAt(controls.target);
        controls.update();
      } else if (action === 'zoom_in') {
        const offset = camera.position.clone().sub(controls.target);
        const newLen = offset.length() * 0.82;
        if (newLen >= controls.minDistance) {
          offset.multiplyScalar(0.82);
          camera.position.copy(controls.target).add(offset);
          controls.update();
        }
      } else if (action === 'zoom_out') {
        const offset = camera.position.clone().sub(controls.target);
        const newLen = offset.length() * 1.22;
        if (newLen <= controls.maxDistance) {
          offset.multiplyScalar(1.22);
          camera.position.copy(controls.target).add(offset);
          controls.update();
        }
      } else if (action === 'reset_view') {
        camera.position.set(2.4, 1.8, 3.2);
        controls.target.set(0, 0.8, 0);
        controls.update();
      }
    };

    window.addEventListener('ac-3d-control', handle3DControl);
    return () => window.removeEventListener('ac-3d-control', handle3DControl);
  }, []);

  // Initialize Three.js WebXR Scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Detect software WebGL
    const softGl = (() => {
      try {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return false;
      }
    })();
    setIsSoftwareGl(softGl);

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // 2. Renderer setup with WebXR enabled (graceful fallback if headless WebGL is unavailable)
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !softGl,
        powerPreference: 'high-performance',
        alpha: true,
      });
      if (!renderer.getContext()) {
        renderer.dispose();
        throw new Error('WebGL context unavailable');
      }
    } catch (err) {
      console.warn('[WebXRStudioViewer] WebGL unavailable, switching to interactive fallback:', err);
      setWebglUnavailable(true);
      return;
    }
    renderer.setSize(width, height);
    renderer.setPixelRatio(softGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = !softGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Enable WebXR on renderer!
    renderer.xr.enabled = true;

    container.appendChild(renderer.domElement);
    threeRefs.current.renderer = renderer;

    // 3. Scene & Horizon Fog
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0e14);
    scene.fog = new THREE.FogExp2(0x0c0e14, 0.08);
    threeRefs.current.scene = scene;

    // 4. Cameras (Perspective + Stereo for Cardboard VR)
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 50);
    camera.position.set(2.4, 1.8, 3.2);
    threeRefs.current.camera = camera;

    const stereoCamera = new THREE.StereoCamera();
    stereoCamera.aspect = (width / 2) / height;
    stereoCamera.eyeSep = 0.064; // Standard 64mm IPD (interpupillary distance)
    threeRefs.current.stereoCamera = stereoCamera;

    // 5. Studio Environment Map (RoomEnvironment)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // 6. 3-Point Studio Lighting Rig
    // Warm Key Light
    const keyLight = new THREE.DirectionalLight(0xfff5e6, 1.8);
    keyLight.position.set(3.5, 4.5, 3.0);
    keyLight.castShadow = !softGl;
    if (keyLight.castShadow) {
      keyLight.shadow.mapSize.width = 1024;
      keyLight.shadow.mapSize.height = 1024;
      keyLight.shadow.camera.near = 0.5;
      keyLight.shadow.camera.far = 15;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    // Cool Sky / Warm Ground Fill
    const hemiLight = new THREE.HemisphereLight(0xdce8ff, 0x181e29, 0.7);
    hemiLight.position.set(0, 10, 0);
    scene.add(hemiLight);

    // Cool Rim / Edge Light
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.9);
    rimLight.position.set(-3.5, 2.5, -2.5);
    scene.add(rimLight);

    // 7. Ground Contact Shadow & Studio Grid
    const groundGroup = new THREE.Group();
    groundGroup.name = 'Studio_Ground';

    // Soft Radial Contact Shadow
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 256;
    shadowCanvas.height = 256;
    const sctx = shadowCanvas.getContext('2d')!;
    const grad = sctx.createRadialGradient(128, 128, 10, 128, 128, 120);
    grad.addColorStop(0, 'rgba(0,0,0,0.7)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 256, 256);

    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const shadowPlaneGeo = new THREE.PlaneGeometry(3.6, 3.6);
    const shadowPlaneMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.8,
    });
    const shadowMesh = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = 0.005;
    groundGroup.add(shadowMesh);

    // Subtle Circular Grid Rings
    const ringGeo = new THREE.RingGeometry(0.8, 0.808, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });
    const ring1 = new THREE.Mesh(ringGeo, ringMat);
    ring1.position.y = 0.008;

    const ring2Geo = new THREE.RingGeometry(1.6, 1.61, 64);
    ring2Geo.rotateX(-Math.PI / 2);
    const ring2 = new THREE.Mesh(ring2Geo, ringMat);
    ring2.position.y = 0.008;

    groundGroup.add(ring1, ring2);
    scene.add(groundGroup);

    // 8. Load Procedural Multi-Part 3D Model
    const productModel = createProduct3DModel(productSkuOrName);
    scene.add(productModel.group);
    threeRefs.current.productModel = productModel;

    // 9. OrbitControls setup
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0.8, 0);
    controls.maxPolarAngle = Math.PI / 2 + 0.05; // Don't flip under the floor
    controls.minDistance = 0.8;
    controls.maxDistance = 8.0;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.0;
    controls.addEventListener('start', () => {
      threeRefs.current.isTransitioningCam = false;
    });
    threeRefs.current.controls = controls;

    // 10. WebXR Controllers & Ray setup
    const controller0 = renderer.xr.getController(0);
    const controller1 = renderer.xr.getController(1);

    const makeControllerRay = () => {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -2.5),
      ]);
      const material = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.7,
      });
      return new THREE.Line(geometry, material);
    };

    controller0.add(makeControllerRay());
    controller1.add(makeControllerRay());

    // Controller interaction: Trigger toggle explode in VR
    const onSelect = () => {
      setExplodeProgress((prev) => (prev > 0.4 ? 0 : 0.85));
      playHapticTone(720, 0.05);
    };
    controller0.addEventListener('select', onSelect);
    controller1.addEventListener('select', onSelect);

    scene.add(controller0);
    scene.add(controller1);

    // 11. Resize Handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      stereoCamera.aspect = (w / 2) / h;
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // 12. Main Animation Loop (WebXR Compliant via renderer.setAnimationLoop)
    const clock = new THREE.Clock();

    const animateLoop = () => {
      const dt = clock.getDelta();

      // Smoothly damp exploded view positions
      const { targetExplode, currentExplode, productModel, activeDisplayMode } = threeRefs.current;
      const nextExplode = THREE.MathUtils.damp(currentExplode, targetExplode, 8, dt);
      threeRefs.current.currentExplode = nextExplode;

      if (productModel) {
        for (const part of productModel.explodedParts) {
          part.mesh.position.lerpVectors(
            part.originalPosition,
            part.originalPosition.clone().add(part.explodedOffset),
            nextExplode
          );
        }
      }

      // Smooth camera transition when presets are clicked
      if (threeRefs.current.isTransitioningCam) {
        camera.position.x = THREE.MathUtils.damp(camera.position.x, threeRefs.current.targetCamPos.x, 6, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, threeRefs.current.targetCamPos.y, 6, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, threeRefs.current.targetCamPos.z, 6, dt);

        controls.target.x = THREE.MathUtils.damp(controls.target.x, threeRefs.current.targetLookAt.x, 6, dt);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, threeRefs.current.targetLookAt.y, 6, dt);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, threeRefs.current.targetLookAt.z, 6, dt);

        if (camera.position.distanceTo(threeRefs.current.targetCamPos) < 0.02) {
          threeRefs.current.isTransitioningCam = false;
        }
      }

      controls.update();

      // Render depending on display mode
      if (renderer.xr.isPresenting) {
        // Native WebXR Headset handles stereo automatically
        renderer.render(scene, camera);
      } else if (activeDisplayMode === 'stereo_vr') {
        // Dual-Eye VR Simulation (Cardboard Mode)
        const size = renderer.getSize(new THREE.Vector2());
        const halfWidth = Math.floor(size.x / 2);
        renderer.setScissorTest(true);

        stereoCamera.update(camera);

        // Left Eye Viewport
        renderer.setScissor(0, 0, halfWidth, size.y);
        renderer.setViewport(0, 0, halfWidth, size.y);
        renderer.render(scene, stereoCamera.cameraL);

        // Right Eye Viewport
        renderer.setScissor(halfWidth, 0, halfWidth, size.y);
        renderer.setViewport(halfWidth, 0, halfWidth, size.y);
        renderer.render(scene, stereoCamera.cameraR);

        renderer.setScissorTest(false);
      } else {
        // Standard 3D Orbit Viewport
        const size = renderer.getSize(new THREE.Vector2());
        renderer.setViewport(0, 0, size.x, size.y);
        renderer.render(scene, camera);
      }
    };

    renderer.setAnimationLoop(animateLoop);

    // Cleanup on unmount
    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.setAnimationLoop(null);
      renderer.dispose();
      controller0.removeEventListener('select', onSelect);
      controller1.removeEventListener('select', onSelect);
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [productSkuOrName]);

  // View Preset Transition Handler
  const handleApplyPreset = (preset: ViewPreset) => {
    setCurrentPreset(preset);
    playHapticTone(520, 0.03);
    const { targetCamPos, targetLookAt } = threeRefs.current;
    threeRefs.current.isTransitioningCam = true;

    switch (preset) {
      case 'front':
        setFallbackView((prev) => ({ ...prev, rx: 0, ry: 0 }));
        targetCamPos.set(0, 0.8, 3.4);
        targetLookAt.set(0, 0.8, 0);
        break;
      case 'perspective':
        setFallbackView((prev) => ({ ...prev, rx: -10, ry: 22 }));
        targetCamPos.set(2.4, 1.8, 3.2);
        targetLookAt.set(0, 0.8, 0);
        break;
      case 'top':
        setFallbackView((prev) => ({ ...prev, rx: -65, ry: 0 }));
        targetCamPos.set(0, 4.2, 0.01);
        targetLookAt.set(0, 0.8, 0);
        break;
      case 'detail':
        setFallbackView((prev) => ({ ...prev, rx: -6, ry: 12, scale: 1.25 }));
        targetCamPos.set(0.9, 0.95, 1.2);
        targetLookAt.set(0, 0.85, 0);
        break;
      case 'iso':
        setFallbackView((prev) => ({ ...prev, rx: -22, ry: -35 }));
        targetCamPos.set(-2.6, 2.2, 2.6);
        targetLookAt.set(0, 0.8, 0);
        break;
    }
  };

  // Colorway Finish Handler
  const handleChangeFinish = (finish: ColorwayFinish) => {
    setSelectedFinish(finish);
    playHapticTone(680, 0.03);
    if (threeRefs.current.productModel) {
      threeRefs.current.productModel.setColorway(finish);
    }
  };

  // WebXR Headset Session Launcher
  const handleLaunchWebXRSession = async () => {
    const renderer = threeRefs.current.renderer;
    if (!renderer) {
      setVrStatusMessage('WebGL 3D context unavailable; interactive spatial preview fallback is active.');
      setTimeout(() => setVrStatusMessage(null), 4000);
      return;
    }

    if (threeRefs.current.xrSession) {
      // End session if currently presenting
      await threeRefs.current.xrSession.end();
      threeRefs.current.xrSession = null;
      setDisplayMode('standard_3d');
      setVrStatusMessage(null);
      return;
    }

    if (typeof navigator !== 'undefined' && 'xr' in navigator && (navigator as any).xr) {
      try {
        setVrStatusMessage('Requesting WebXR immersive-vr session...');
        const session = await (navigator as any).xr.requestSession('immersive-vr', {
          optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
        });

        threeRefs.current.xrSession = session;
        await renderer.xr.setSession(session);
        setDisplayMode('webxr_active');
        setVrStatusMessage('VR Session Active in Headset');

        session.addEventListener('end', () => {
          threeRefs.current.xrSession = null;
          setDisplayMode('standard_3d');
          setVrStatusMessage('VR Session Ended');
          setTimeout(() => setVrStatusMessage(null), 3000);
        });
      } catch (err: any) {
        console.warn('WebXR session failed, falling back to Dual-Eye VR Stereo mode:', err);
        setVrStatusMessage('Physical headset not detected. Activated Dual-Eye VR Mode!');
        setDisplayMode('stereo_vr');
        setTimeout(() => setVrStatusMessage(null), 4000);
      }
    } else {
      setVrStatusMessage('WebXR hardware not found. Activated Dual-Eye VR Stereo simulation!');
      setDisplayMode('stereo_vr');
      setTimeout(() => setVrStatusMessage(null), 4000);
    }
  };

  return (
    <div className="relative w-full h-full min-h-[540px] sm:min-h-[640px] bg-[#0c0e14] overflow-hidden select-none flex flex-col justify-between font-sans text-white">
      {/* 3D WebGL Canvas Mount Container */}
      <div
        ref={containerRef}
        data-testid="threejs-webxr-canvas-container"
        className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing z-0"
      />

      {webglUnavailable && (
        <div
          data-testid="webxr-webgl-fallback"
          onClick={() => setFallbackView((prev) => ({ ...prev, ry: (prev.ry + 30) % 360 }))}
          role="region"
          aria-label="Interactive WebXR spatial fallback preview"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-[#0c0e14] via-[#131a29] to-[#0c0e14] cursor-pointer select-none"
        >
          <div
            className="w-48 h-48 rounded-3xl border border-sky-400/40 shadow-2xl flex flex-col items-center justify-center transition-transform duration-500"
            style={{
              background:
                selectedFinish === 'rosegold'
                  ? 'linear-gradient(135deg, rgba(157, 23, 77, 0.35), rgba(15, 23, 42, 0.9))'
                  : selectedFinish === 'titanium'
                    ? 'linear-gradient(135deg, rgba(113, 113, 122, 0.35), rgba(15, 23, 42, 0.9))'
                    : selectedFinish === 'alpine'
                      ? 'linear-gradient(135deg, rgba(248, 250, 252, 0.25), rgba(15, 23, 42, 0.9))'
                      : 'linear-gradient(135deg, rgba(56, 189, 248, 0.22), rgba(15, 23, 42, 0.92))',
              transform: `perspective(900px) rotateX(${fallbackView.rx}deg) rotateY(${fallbackView.ry}deg) scale(${fallbackView.scale}) translateZ(${Math.round(explodeProgress * 28)}px)`,
            }}
          >
            <span className="material-symbols-outlined text-[48px] text-sky-300">deployed_code</span>
            <span className="mt-2 text-[11px] font-mono uppercase tracking-widest text-sky-300">
              {currentPreset} • {selectedFinish}
            </span>
            <span className="mt-1 text-xs font-bold text-white px-3 truncate max-w-full">{productName}</span>
          </div>
          <p className="mt-4 text-xs text-slate-300 max-w-md">
            WebGL hardware/software context unavailable — interactive spatial preview active ({Math.round(explodeProgress * 100)}% explode • click stage to orbit).
          </p>
        </div>
      )}

      {/* Center Reticle Divider Line when in Dual-Eye Stereo VR Mode */}
      {displayMode === 'stereo_vr' && (
        <div className="absolute inset-0 pointer-events-none z-10 flex">
          <div className="w-1/2 h-full border-r border-white/20 relative flex items-center justify-center">
            {/* Left Eye Reticle */}
            <div className="w-3 h-3 rounded-full border border-sky-400/60 bg-sky-400/20" />
            <span className="absolute top-4 left-4 text-[10px] font-mono tracking-widest text-sky-400/80 uppercase">
              Left Eye
            </span>
          </div>
          <div className="w-1/2 h-full relative flex items-center justify-center">
            {/* Right Eye Reticle */}
            <div className="w-3 h-3 rounded-full border border-sky-400/60 bg-sky-400/20" />
            <span className="absolute top-4 right-4 text-[10px] font-mono tracking-widest text-sky-400/80 uppercase">
              Right Eye
            </span>
          </div>
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-black/75 px-4 py-1.5 rounded-full border border-white/10 text-xs text-white/90">
            📱 Insert into VR Cardboard or mobile headset • Drag to rotate
          </div>
        </div>
      )}

      {/* Top Header HUD (Top-Left Minimal Spec Badge + Close/Cart) */}
      <div className="relative z-20 p-4 sm:p-6 flex items-start justify-between pointer-events-none">
        <div className="pointer-events-auto space-y-1 bg-black/60 px-4 py-2.5 rounded-xl border border-white/10 shadow-lg">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-sky-400 text-[18px]">view_in_ar</span>
            <span className="text-xs font-bold tracking-tight uppercase text-white">
              WebXR 3D &amp; VR Studio
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
              {displayMode === 'stereo_vr' ? 'Stereo VR' : displayMode === 'webxr_active' ? 'WebXR Headset' : '6DoF 3D'}
            </span>
          </div>
          <h2 className="text-sm font-semibold text-white/90">{productName}</h2>
          {price && (
            <p className="text-xs font-mono font-bold text-emerald-400">
              ₹{price.toLocaleString()} • 100% Escrow Protected
            </p>
          )}
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          {onAddToCart && (
            <button
              type="button"
              onClick={onAddToCart}
              className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-black text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">shopping_cart</span>
              <span>Add to Cart</span>
            </button>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-black/60 hover:bg-black/90 border border-white/10 text-white/80 hover:text-white flex items-center justify-center transition-all cursor-pointer"
              title="Close 3D/VR Viewer"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          )}
        </div>
      </div>

      {/* Feedback Toast for VR Mode Changes */}
      {vrStatusMessage && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 bg-black/80 text-sky-300 text-xs px-4 py-2 rounded-full border border-sky-500/40 shadow-xl pointer-events-none">
          {vrStatusMessage}
        </div>
      )}

      {/* Collapsible Bottom Control Dock (Strictly pinned at bottom <= 15% footprint) */}
      <div className="relative z-20 flex flex-col items-center pb-4 px-4 pointer-events-none">
        {/* Toggle Collapse Pill */}
        <button
          type="button"
          onClick={() => setIsControlsCollapsed((prev) => !prev)}
          className="pointer-events-auto mb-2 px-3 py-1 rounded-full bg-black/70 hover:bg-black text-[11px] font-semibold text-white/80 border border-white/10 shadow-md flex items-center gap-1 transition-all cursor-pointer"
        >
          <span className="material-symbols-outlined text-[15px]">
            {isControlsCollapsed ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
          </span>
          <span>{isControlsCollapsed ? 'Show Controls (H)' : 'Hide Controls (H)'}</span>
        </button>

        {/* Floating Glassmorphic Dock */}
        <div
          className={`pointer-events-auto w-full max-w-4xl bg-black/85 border border-white/10 rounded-2xl p-3 sm:p-4 shadow-2xl transition-all duration-300 flex flex-col gap-3 ${
            isControlsCollapsed ? 'opacity-0 translate-y-12 pointer-events-none' : 'opacity-100 translate-y-0'
          }`}
        >
          {/* Row 1: VR Experience Modes & Exploded View Slider */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
            {/* VR Mode Buttons */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/50 mr-1 hidden sm:inline">
                Mode:
              </span>

              <button
                type="button"
                onClick={() => setDisplayMode('standard_3d')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  displayMode === 'standard_3d'
                    ? 'bg-sky-500 text-black font-bold shadow'
                    : 'bg-white/5 hover:bg-white/10 text-white/80'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">rotate_90_degrees_ccw</span>
                <span>3D Orbit</span>
              </button>

              <button
                type="button"
                onClick={() => setDisplayMode(displayMode === 'stereo_vr' ? 'standard_3d' : 'stereo_vr')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  displayMode === 'stereo_vr'
                    ? 'bg-purple-500 text-white font-bold shadow'
                    : 'bg-white/5 hover:bg-white/10 text-white/80'
                }`}
                title="Google Cardboard / Mobile VR stereoscopic split view"
              >
                <span className="material-symbols-outlined text-[16px]">vrpano</span>
                <span>Dual-Eye VR</span>
              </button>

              <button
                type="button"
                onClick={handleLaunchWebXRSession}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  displayMode === 'webxr_active'
                    ? 'bg-emerald-500 text-black'
                    : 'bg-gradient-to-r from-sky-500 to-indigo-500 text-white hover:opacity-95 shadow-md'
                }`}
                title="Launch WebXR session for Meta Quest, Apple Vision Pro, or SteamVR"
              >
                <span className="material-symbols-outlined text-[16px]">view_in_ar</span>
                <span>{hasWebXRSupport ? 'Enter VR Headset' : 'WebXR VR'}</span>
              </button>
            </div>

            {/* Exploded View Slider */}
            <div className="flex items-center gap-2 flex-1 max-w-xs">
              <span className="material-symbols-outlined text-white/50 text-[18px]">workspaces</span>
              <span className="text-[11px] font-semibold text-white/70 whitespace-nowrap">Explode:</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={explodeProgress}
                onChange={(e) => {
                  setExplodeProgress(parseFloat(e.target.value));
                  if (autoRotate) setAutoRotate(false);
                }}
                className="w-full accent-sky-400 h-1.5 bg-white/20 rounded-lg cursor-pointer"
              />
              <span className="text-[11px] font-mono text-sky-400 w-8 text-right">
                {Math.round(explodeProgress * 100)}%
              </span>
            </div>
          </div>

          {/* Row 2: Camera View Presets, Finish Swatches & Rotation Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            {/* View Presets */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/50 mr-1 hidden sm:inline">
                Camera:
              </span>
              {[
                { id: 'perspective', label: 'Perspective' },
                { id: 'front', label: 'Front' },
                { id: 'top', label: 'Top' },
                { id: 'detail', label: 'Detail' },
                { id: 'iso', label: 'Isometric' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleApplyPreset(p.id as ViewPreset)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                    currentPreset === p.id
                      ? 'bg-white/20 text-white font-semibold'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Finish Swatches */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/50 mr-1 hidden sm:inline">
                Finish:
              </span>
              {[
                { id: 'obsidian', label: 'Obsidian Matte', color: '#181a1f' },
                { id: 'titanium', label: 'Titanium Silver', color: '#71717a' },
                { id: 'rosegold', label: 'Rose Gold', color: '#9d174d' },
                { id: 'alpine', label: 'Alpine White', color: '#f8fafc' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => handleChangeFinish(f.id as ColorwayFinish)}
                  title={f.label}
                  className={`w-6 h-6 rounded-full border-2 transition-all cursor-pointer ${
                    selectedFinish === f.id
                      ? 'border-sky-400 scale-110 shadow-sm'
                      : 'border-white/20 hover:scale-105 opacity-70'
                  }`}
                  style={{ backgroundColor: f.color }}
                />
              ))}

              <div className="h-4 w-px bg-white/20 mx-1" />

              {/* Auto-Rotate Toggle */}
              <button
                type="button"
                onClick={() => {
                  setAutoRotate((prev) => !prev);
                  playHapticTone(580, 0.03);
                }}
                className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                  autoRotate
                    ? 'bg-sky-500/20 text-sky-400 border-sky-500/40'
                    : 'bg-white/5 text-white/60 border-white/10 hover:text-white'
                }`}
                title={autoRotate ? 'Pause Rotation' : 'Enable Auto-Rotation'}
              >
                <span className="material-symbols-outlined text-[16px]">sync</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
