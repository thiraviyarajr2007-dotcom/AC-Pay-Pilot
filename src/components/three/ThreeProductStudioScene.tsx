import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type StudioModelPreset = 'aerobreeze-fan' | 'escrow-workstation' | 'yonex-racket';
export type StudioLightingPreset = 'studio-warm' | 'cyber-dusk' | 'daylight-lab';

interface ThreeProductStudioSceneProps {
  initialPreset?: StudioModelPreset;
  portalMode?: 'customer' | 'seller';
  onSelectModelSku?: (sku: string) => void;
}

const MODEL_METADATA: Record<
  StudioModelPreset,
  { sku: string; title: string; partsCount: number; priceInr: string; subtitle: string }
> = {
  'aerobreeze-fan': {
    sku: 'FAN-BLDC-892',
    title: 'AeroBreeze 1200mm BLDC Rig',
    partsCount: 9,
    priceInr: '₹8,499',
    subtitle: 'Lathe stator housing + 3 beveled ExtrudeGeometry airfoil blades',
  },
  'escrow-workstation': {
    sku: 'AC-WRK-8990',
    title: 'ProArt Studio & Escrow Vault',
    partsCount: 8,
    priceInr: '₹4,21,500',
    subtitle: 'Beveled CNC chassis + TubeGeometry arm + Gold HSM module',
  },
  'yonex-racket': {
    sku: 'SPO-YNX-99P',
    title: 'Yonex Astrox 99 Pro Carbon',
    partsCount: 7,
    priceInr: '₹14,990',
    subtitle: 'Isometric Torus carbon frame + Lathe stone plinth + T-joint',
  },
};

function createProceduralBrushedTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 2) {
      const shade = 110 + ((y * 17) % 36);
      ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
      ctx.fillRect(0, y, 256, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(128, 128, 12, 128, 128, 120);
    grad.addColorStop(0, 'rgba(2, 6, 23, 0.65)');
    grad.addColorStop(0.55, 'rgba(2, 6, 23, 0.22)');
    grad.addColorStop(1, 'rgba(2, 6, 23, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
  }
  return new THREE.CanvasTexture(canvas);
}

/**
 * Builds a 9-part composite THREE.Group for the AeroBreeze BLDC Smart Fan & Pedestal Rig.
 * Pivoted at bottom-center (y = 0) so it sits flush on the ground plane.
 */
function buildAeroBreezeFanGroup(brushedTex: THREE.CanvasTexture): {
  group: THREE.Group;
  rotorGroup: THREE.Group;
} {
  const root = new THREE.Group();
  root.position.set(0, 0, 0);

  // Part 1: Primary Silhouette — Fluted Lathe Base Plinth (Roughness 0.7, Metalness 0.2)
  const lathePoints = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(1.15, 0),
    new THREE.Vector2(1.08, 0.14),
    new THREE.Vector2(0.75, 0.24),
    new THREE.Vector2(0.32, 0.34),
    new THREE.Vector2(0, 0.34),
  ];
  const baseGeo = new THREE.LatheGeometry(lathePoints, 40);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.72,
    metalness: 0.22,
    bumpMap: brushedTex,
    bumpScale: 0.015,
  });
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  root.add(baseMesh);

  // Part 2: Secondary Read — Brushed Titanium Riser Column (Roughness 0.28, Metalness 0.88)
  const columnGeo = new THREE.CylinderGeometry(0.14, 0.18, 1.85, 32);
  const columnMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.28,
    metalness: 0.88,
    roughnessMap: brushedTex,
  });
  const columnMesh = new THREE.Mesh(columnGeo, columnMat);
  columnMesh.position.set(0, 1.22, 0);
  columnMesh.castShadow = true;
  columnMesh.receiveShadow = true;
  root.add(columnMesh);

  // Part 3: Accent — Gold Escrow Telemetry Collar Ring (Roughness 0.18, Metalness 0.95)
  const collarGeo = new THREE.TorusGeometry(0.19, 0.032, 20, 48);
  const collarMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    roughness: 0.18,
    metalness: 0.95,
  });
  const collarMesh = new THREE.Mesh(collarGeo, collarMat);
  collarMesh.rotation.x = Math.PI / 2;
  collarMesh.position.set(0, 0.55, 0);
  collarMesh.castShadow = true;
  root.add(collarMesh);

  // Part 4: Primary Silhouette — Contoured BLDC Stator Motor Housing (Roughness 0.55, Metalness 0.45)
  const statorPoints = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.58, 0.02),
    new THREE.Vector2(0.68, 0.16),
    new THREE.Vector2(0.52, 0.34),
    new THREE.Vector2(0, 0.38),
  ];
  const statorGeo = new THREE.LatheGeometry(statorPoints, 40);
  const statorMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.55,
    metalness: 0.45,
  });
  const statorMesh = new THREE.Mesh(statorGeo, statorMat);
  statorMesh.position.set(0, 2.05, 0);
  statorMesh.castShadow = true;
  root.add(statorMesh);

  // Rotating Assembly (Parts 5–9)
  const rotorGroup = new THREE.Group();
  rotorGroup.position.set(0, 2.22, 0);
  root.add(rotorGroup);

  // Part 5: Secondary Read — Anodized Copper Induction Ring (Roughness 0.22, Metalness 0.92)
  const inductionGeo = new THREE.TorusGeometry(0.64, 0.035, 20, 48);
  const inductionMat = new THREE.MeshStandardMaterial({
    color: 0x0284c7,
    roughness: 0.22,
    metalness: 0.92,
  });
  const inductionRing = new THREE.Mesh(inductionGeo, inductionMat);
  inductionRing.rotation.x = Math.PI / 2;
  inductionRing.castShadow = true;
  rotorGroup.add(inductionRing);

  // Parts 6, 7, 8: 3x Aerodynamic Swept Airfoil Blades via ExtrudeGeometry with Bevels
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0.45, -0.11);
  bladeShape.quadraticCurveTo(1.35, -0.22, 2.05, -0.08);
  bladeShape.quadraticCurveTo(2.18, 0.02, 2.02, 0.14);
  bladeShape.quadraticCurveTo(1.25, 0.2, 0.45, 0.09);
  bladeShape.closePath();

  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
    steps: 2,
    depth: 0.035,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 3,
  });
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.32,
    metalness: 0.76,
    bumpMap: brushedTex,
    bumpScale: 0.008,
  });

  for (let i = 0; i < 3; i++) {
    const bladeHolder = new THREE.Group();
    bladeHolder.rotation.y = (i * Math.PI * 2) / 3;
    const bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
    bladeMesh.rotation.x = Math.PI / 2 + 0.16; // aerodynamic pitch angle
    bladeMesh.castShadow = true;
    bladeMesh.receiveShadow = true;
    bladeHolder.add(bladeMesh);
    rotorGroup.add(bladeHolder);
  }

  // Part 9: Accent Detail — Optical Sapphire LED Telemetry Dome
  const domeGeo = new THREE.SphereGeometry(0.24, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const domeMat = new THREE.MeshPhysicalMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 0.45,
    roughness: 0.12,
    metalness: 0.1,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
  });
  const domeMesh = new THREE.Mesh(domeGeo, domeMat);
  domeMesh.position.set(0, 0.18, 0);
  rotorGroup.add(domeMesh);

  return { group: root, rotorGroup };
}

/**
 * Builds an 8-part composite THREE.Group for the ProArt Autonomous Escrow Vault & Workstation Rig.
 * Pivoted at bottom-center (y = 0).
 */
function buildEscrowWorkstationGroup(brushedTex: THREE.CanvasTexture): {
  group: THREE.Group;
  rotorGroup: THREE.Group;
} {
  const root = new THREE.Group();
  root.position.set(0, 0, 0);

  // Part 1: Pedestal Plinth (Roughness 0.78, Metalness 0.18)
  const plinthGeo = new THREE.CylinderGeometry(1.3, 1.45, 0.22, 36);
  const plinthMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.78,
    metalness: 0.18,
  });
  const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
  plinthMesh.position.set(0, 0.11, 0);
  plinthMesh.castShadow = true;
  plinthMesh.receiveShadow = true;
  root.add(plinthMesh);

  // Rotating showcase platform
  const rotorGroup = new THREE.Group();
  rotorGroup.position.set(0, 0.22, 0);
  root.add(rotorGroup);

  // Part 2: Beveled CNC Aluminum Workstation Tower Chassis via ExtrudeGeometry (Roughness 0.26, Metalness 0.88)
  const towerShape = new THREE.Shape();
  towerShape.moveTo(-0.42, 0);
  towerShape.lineTo(0.42, 0);
  towerShape.lineTo(0.42, 1.55);
  towerShape.lineTo(-0.42, 1.55);
  towerShape.closePath();

  const towerGeo = new THREE.ExtrudeGeometry(towerShape, {
    steps: 1,
    depth: 0.95,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 4,
  });
  const towerMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.26,
    metalness: 0.88,
    bumpMap: brushedTex,
    bumpScale: 0.012,
  });
  const towerMesh = new THREE.Mesh(towerGeo, towerMat);
  towerMesh.position.set(-0.55, 0.04, -0.48);
  towerMesh.castShadow = true;
  towerMesh.receiveShadow = true;
  rotorGroup.add(towerMesh);

  // Part 3 & 4: Dual Anodized Thermal Intake Rings on Tower Front
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 0.35,
    roughness: 0.2,
    metalness: 0.85,
  });
  for (let i = 0; i < 2; i++) {
    const ringGeo = new THREE.TorusGeometry(0.22, 0.028, 16, 36);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(-0.55, 0.5 + i * 0.62, 0.52);
    rotorGroup.add(ring);
  }

  // Part 5: Articulated Monitor Support Arm via TubeGeometry (Roughness 0.52, Metalness 0.65)
  const armCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.35, 0.0, -0.25),
    new THREE.Vector3(0.35, 0.85, -0.35),
    new THREE.Vector3(0.35, 1.38, -0.05),
  ]);
  const armGeo = new THREE.TubeGeometry(armCurve, 32, 0.065, 16, false);
  const armMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.52,
    metalness: 0.65,
  });
  const armMesh = new THREE.Mesh(armGeo, armMat);
  armMesh.castShadow = true;
  rotorGroup.add(armMesh);

  // Part 6: Studio Ultrawide Display Bezel Frame (Roughness 0.6, Metalness 0.35)
  const displayGeo = new THREE.BoxGeometry(1.55, 0.88, 0.06);
  const displayMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.6,
    metalness: 0.35,
  });
  const displayMesh = new THREE.Mesh(displayGeo, displayMat);
  displayMesh.position.set(0.38, 1.42, 0.02);
  displayMesh.rotation.y = -0.18;
  displayMesh.castShadow = true;
  rotorGroup.add(displayMesh);

  // Part 7: Emissive Telemetry Screen Surface (Roughness 0.12, Metalness 0.05)
  const screenGeo = new THREE.PlaneGeometry(1.46, 0.78);
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x0ea5e9,
    emissive: 0x0369a1,
    emissiveIntensity: 0.55,
    roughness: 0.12,
    metalness: 0.05,
  });
  const screenMesh = new THREE.Mesh(screenGeo, screenMat);
  screenMesh.position.set(0.38, 1.42, 0.055);
  screenMesh.rotation.y = -0.18;
  rotorGroup.add(screenMesh);

  // Part 8: Gold-Plated Escrow Hardware Security Vault Dial (Roughness 0.18, Metalness 0.96)
  const dialGeo = new THREE.CylinderGeometry(0.22, 0.25, 0.14, 32);
  const dialMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    roughness: 0.18,
    metalness: 0.96,
  });
  const dialMesh = new THREE.Mesh(dialGeo, dialMat);
  dialMesh.position.set(0.42, 0.07, 0.45);
  dialMesh.castShadow = true;
  rotorGroup.add(dialMesh);

  return { group: root, rotorGroup };
}

/**
 * Builds a 7-part composite THREE.Group for the Yonex Astrox 99 Pro Carbon Racket & Display Stand.
 * Pivoted at bottom-center (y = 0).
 */
function buildYonexRacketGroup(brushedTex: THREE.CanvasTexture): {
  group: THREE.Group;
  rotorGroup: THREE.Group;
} {
  const root = new THREE.Group();
  root.position.set(0, 0, 0);

  // Part 1: Lathe Architectural Stone Display Stand (Roughness 0.8, Metalness 0.15)
  const standPoints = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.95, 0),
    new THREE.Vector2(0.85, 0.18),
    new THREE.Vector2(0.42, 0.35),
    new THREE.Vector2(0, 0.35),
  ];
  const standGeo = new THREE.LatheGeometry(standPoints, 36);
  const standMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.8,
    metalness: 0.15,
  });
  const standMesh = new THREE.Mesh(standGeo, standMat);
  standMesh.castShadow = true;
  standMesh.receiveShadow = true;
  root.add(standMesh);

  const rotorGroup = new THREE.Group();
  rotorGroup.position.set(0, 0.35, 0);
  root.add(rotorGroup);

  const racketRig = new THREE.Group();
  racketRig.rotation.z = 0.18;
  rotorGroup.add(racketRig);

  // Part 2: Anodized Emerald Butt Cap (Roughness 0.25, Metalness 0.85)
  const capGeo = new THREE.CylinderGeometry(0.085, 0.095, 0.08, 8);
  const capMat = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    roughness: 0.25,
    metalness: 0.85,
  });
  const capMesh = new THREE.Mesh(capGeo, capMat);
  capMesh.position.set(0, 0.04, 0);
  racketRig.add(capMesh);

  // Part 3: Octagonal Cushion Handle Grip (Roughness 0.85, Metalness 0.08)
  const gripGeo = new THREE.CylinderGeometry(0.075, 0.082, 0.62, 8);
  const gripMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.85,
    metalness: 0.08,
  });
  const gripMesh = new THREE.Mesh(gripGeo, gripMat);
  gripMesh.position.set(0, 0.38, 0);
  gripMesh.castShadow = true;
  racketRig.add(gripMesh);

  // Part 4: Cone Cap Taper (Roughness 0.35, Metalness 0.65)
  const coneGeo = new THREE.CylinderGeometry(0.032, 0.075, 0.18, 16);
  const coneMat = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    roughness: 0.35,
    metalness: 0.65,
  });
  const coneMesh = new THREE.Mesh(coneGeo, coneMat);
  coneMesh.position.set(0, 0.78, 0);
  racketRig.add(coneMesh);

  // Part 5: High-Modulus Graphite Shaft (Roughness 0.22, Metalness 0.9)
  const shaftGeo = new THREE.CylinderGeometry(0.026, 0.028, 0.95, 16);
  const shaftMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.22,
    metalness: 0.9,
    bumpMap: brushedTex,
    bumpScale: 0.01,
  });
  const shaftMesh = new THREE.Mesh(shaftGeo, shaftMat);
  shaftMesh.position.set(0, 1.32, 0);
  shaftMesh.castShadow = true;
  racketRig.add(shaftMesh);

  // Part 6: Throat T-Joint Struts via TubeGeometry (Roughness 0.48, Metalness 0.7)
  const throatCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.24, 1.88, 0),
    new THREE.Vector3(0, 1.75, 0),
    new THREE.Vector3(0.24, 1.88, 0),
  ]);
  const throatGeo = new THREE.TubeGeometry(throatCurve, 24, 0.028, 12, false);
  const throatMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    roughness: 0.48,
    metalness: 0.7,
  });
  const throatMesh = new THREE.Mesh(throatGeo, throatMat);
  throatMesh.castShadow = true;
  racketRig.add(throatMesh);

  // Part 7: Isometric Carbon Frame Loop (TorusGeometry scaled into oval)
  const frameGeo = new THREE.TorusGeometry(0.55, 0.034, 20, 64);
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    roughness: 0.24,
    metalness: 0.82,
  });
  const frameMesh = new THREE.Mesh(frameGeo, frameMat);
  frameMesh.scale.set(0.82, 1.12, 1.0);
  frameMesh.position.set(0, 2.38, 0);
  frameMesh.castShadow = true;
  racketRig.add(frameMesh);

  return { group: root, rotorGroup };
}

export const ThreeProductStudioScene: React.FC<ThreeProductStudioSceneProps> = ({
  initialPreset = 'aerobreeze-fan',
  portalMode = 'customer',
  onSelectModelSku,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  const [activePreset, setActivePreset] = useState<StudioModelPreset>(initialPreset);
  const [lightingPreset, setLightingPreset] = useState<StudioLightingPreset>('studio-warm');
  const [spinSpeed, setSpinSpeed] = useState<number>(1.2);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [webglUnavailable, setWebglUnavailable] = useState<boolean>(false);
  const [fallbackYaw, setFallbackYaw] = useState<number>(20);

  // Refs synced into the animation loop so React state changes don't remount the WebGL context
  const spinSpeedRef = useRef<number>(spinSpeed);
  spinSpeedRef.current = spinSpeed;

  const activePresetRef = useRef<StudioModelPreset>(activePreset);
  activePresetRef.current = activePreset;

  const lightingPresetRef = useRef<StudioLightingPreset>(lightingPreset);
  lightingPresetRef.current = lightingPreset;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Software WebGL detection (GPU renderer string, freeing probe immediately)
    const isSoftwareGl = (() => {
      try {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    const width = container.clientWidth || 960;
    const height = container.clientHeight || 540;

    const scene = new THREE.Scene();
    const bgHex = 0x0b1120;
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.FogExp2(bgHex, 0.045);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(3.8, 2.8, 4.6);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
      if (!renderer.getContext()) {
        renderer.dispose();
        throw new Error('WebGL context unavailable');
      }
    } catch (err) {
      console.warn('[ThreeProductStudioScene] WebGL unavailable, switching to interactive fallback:', err);
      setWebglUnavailable(true);
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 2. Studio PBR Environment Reflection via RoomEnvironment + PMREMGenerator
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    pmremGenerator.dispose();

    // 3. Studio PBR Lighting Rig (Warm Key DirectionalLight + Cool HemisphereLight Fill)
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.85);
    hemiLight.position.set(0, 12, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4e6, 2.2);
    keyLight.position.set(5.5, 7.5, 4.5);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 22;
    keyLight.shadow.camera.left = -4.5;
    keyLight.shadow.camera.right = 4.5;
    keyLight.shadow.camera.top = 4.5;
    keyLight.shadow.camera.bottom = -4.5;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.1);
    rimLight.position.set(-5.0, 4.0, -4.5);
    scene.add(rimLight);

    // 4. Studio Ground Plane + Radial Contact Shadow (Zero 404 procedural CanvasTextures)
    const brushedTex = createProceduralBrushedTexture();
    const shadowTex = createContactShadowTexture();

    const floorGeo = new THREE.CircleGeometry(14, 64);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.85,
      metalness: 0.12,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -0.002;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    const contactShadowGeo = new THREE.PlaneGeometry(3.6, 3.6);
    const contactShadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
    });
    const contactShadowMesh = new THREE.Mesh(contactShadowGeo, contactShadowMat);
    contactShadowMesh.rotation.x = -Math.PI / 2;
    contactShadowMesh.position.y = 0.002;
    scene.add(contactShadowMesh);

    // 5. InstancedMesh (>20 repeated studio calibration markers around the stage with ±15% scale & tint)
    const markerCount = 24;
    const markerGeo = new THREE.CylinderGeometry(0.035, 0.045, 0.16, 12);
    const markerMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.35,
      metalness: 0.75,
    });
    const markerInstances = new THREE.InstancedMesh(markerGeo, markerMat, markerCount);
    const scratchMatrix = new THREE.Matrix4();
    const scratchPos = new THREE.Vector3();
    const scratchQuat = new THREE.Quaternion();
    const scratchScale = new THREE.Vector3();
    const scratchColor = new THREE.Color();

    for (let i = 0; i < markerCount; i++) {
      const angle = (i / markerCount) * Math.PI * 2;
      const radius = 2.65;
      const scaleVar = 0.88 + ((i * 7) % 25) * 0.01; // ±15% variation
      scratchPos.set(Math.cos(angle) * radius, 0.08 * scaleVar, Math.sin(angle) * radius);
      scratchScale.set(scaleVar, scaleVar, scaleVar);
      scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
      markerInstances.setMatrixAt(i, scratchMatrix);

      scratchColor.setHSL(0.55 + (i % 5) * 0.025, 0.75, 0.48 + (i % 3) * 0.06);
      markerInstances.setColorAt(i, scratchColor);
    }
    markerInstances.instanceMatrix.needsUpdate = true;
    if (markerInstances.instanceColor) markerInstances.instanceColor.needsUpdate = true;
    scene.add(markerInstances);

    // 6. Build the 3 multi-part procedural THREE.Group subjects
    const fanModel = buildAeroBreezeFanGroup(brushedTex);
    const workstationModel = buildEscrowWorkstationGroup(brushedTex);
    const racketModel = buildYonexRacketGroup(brushedTex);

    scene.add(fanModel.group);
    scene.add(workstationModel.group);
    scene.add(racketModel.group);

    // 7. OrbitControls with exponential damping
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.35, 0);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 2.2;
    controls.maxDistance = 11.0;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    controls.update();

    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;

    const syncScenePresets = () => {
      const preset = activePresetRef.current;
      fanModel.group.visible = preset === 'aerobreeze-fan';
      workstationModel.group.visible = preset === 'escrow-workstation';
      racketModel.group.visible = preset === 'yonex-racket';

      const lightMode = lightingPresetRef.current;
      if (lightMode === 'studio-warm') {
        keyLight.color.setHex(0xfff4e6);
        keyLight.intensity = 2.2;
        rimLight.color.setHex(0x38bdf8);
        scene.background = new THREE.Color(0x0b1120);
        (scene.fog as THREE.FogExp2).color.setHex(0x0b1120);
      } else if (lightMode === 'cyber-dusk') {
        keyLight.color.setHex(0x38bdf8);
        keyLight.intensity = 2.5;
        rimLight.color.setHex(0xf43f5e);
        scene.background = new THREE.Color(0x090d16);
        (scene.fog as THREE.FogExp2).color.setHex(0x090d16);
      } else {
        keyLight.color.setHex(0xffffff);
        keyLight.intensity = 2.6;
        rimLight.color.setHex(0x93c5fd);
        scene.background = new THREE.Color(0x1e293b);
        (scene.fog as THREE.FogExp2).color.setHex(0x1e293b);
      }
    };

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;
      const dt = Math.min(clock.getDelta(), 0.1);
      const dampAlpha = 1 - Math.exp(-8 * dt);

      syncScenePresets();

      const speed = spinSpeedRef.current;
      fanModel.rotorGroup.rotation.y += dt * speed * 2.4;
      workstationModel.rotorGroup.rotation.y += dt * speed * 0.65;
      racketModel.rotorGroup.rotation.y += dt * speed * 0.85;

      if (controls.enableDamping) {
        controls.dampingFactor = Math.max(0.04, Math.min(0.18, dampAlpha));
      }
      controls.update();

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    const handleResize = () => {
      if (!container || disposed) return;
      const nextW = container.clientWidth || 960;
      const nextH = container.clientHeight || 540;
      camera.aspect = nextW / nextH;
      camera.updateProjectionMatrix();
      renderer.setSize(nextW, nextH);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      disposed = true;
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      controls.dispose();
      envTarget.dispose();
      brushedTex.dispose();
      shadowTex.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material?.dispose();
          }
        }
      });
      renderer.dispose();
    };
  }, []);

  const meta = MODEL_METADATA[activePreset];

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 w-screen h-screen bg-slate-950 overflow-hidden'
          : 'relative w-full h-[560px] rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden shadow-lg'
      }
      data-testid="threejs-product-studio"
    >
      {/* Stable WebGL Canvas Container outside React UI re-renders */}
      <div ref={mountRef} className="w-full h-full" />

      {webglUnavailable && (
        <div
          data-testid="threejs-webgl-fallback"
          onClick={() => setFallbackYaw((prev) => (prev + 45) % 360)}
          role="region"
          aria-label="Interactive 3D fallback preview"
          className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 cursor-pointer select-none"
        >
          <div
            className="w-44 h-44 rounded-3xl border border-sky-400/40 bg-gradient-to-tr from-sky-500/20 via-indigo-500/20 to-emerald-400/20 shadow-2xl flex flex-col items-center justify-center transition-transform duration-500"
            style={{
              transform: `perspective(900px) rotateX(-14deg) rotateY(${fallbackYaw}deg) scale(${spinSpeed > 0 ? 1.04 : 1})`,
              boxShadow:
                lightingPreset === 'cyber-dusk'
                  ? '0 20px 50px rgba(244, 63, 94, 0.25)'
                  : lightingPreset === 'daylight-lab'
                    ? '0 20px 50px rgba(147, 197, 253, 0.28)'
                    : '0 20px 50px rgba(56, 189, 248, 0.25)',
            }}
          >
            <span className="material-symbols-outlined text-[48px] text-sky-300">view_in_ar</span>
            <span className="mt-2 text-xs font-mono uppercase tracking-wider text-sky-200">
              {meta.partsCount}-Part Spatial Blueprint
            </span>
            <span className="mt-1 text-[11px] font-bold text-white px-2">{meta.title}</span>
          </div>
          <p className="mt-4 text-xs text-slate-300 max-w-md">
            Hardware WebGL context is unavailable in this environment — interactive spatial fallback active (click card to rotate {fallbackYaw}°).
          </p>
        </div>
      )}

      {/* Top-Left Minimal Model Readout */}
      <div className="absolute top-4 left-4 pointer-events-none select-none bg-slate-900/90 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-slate-100 max-w-xs">
        <div className="flex items-center gap-2 text-[11px] text-sky-400 font-semibold">
          <span>Three.js PBR Studio</span>
          <span aria-hidden="true">·</span>
          <span>{meta.partsCount}-Part Procedural Group</span>
        </div>
        <div className="text-sm font-bold tracking-tight mt-0.5">{meta.title}</div>
        <div className="text-[11px] text-slate-400 mt-0.5">{meta.subtitle}</div>
        <div className="text-xs font-mono font-bold text-emerald-400 mt-1 tabular-nums">
          #{meta.sku} · {meta.priceInr} ({portalMode === 'seller' ? 'Seller Twin' : 'Buyer Spatial View'})
        </div>
      </div>

      {/* Compact, Collapsible Floating Control Dock (<= 15% viewport footprint, solid rgba surface) */}
      <div
        className="absolute bottom-4 right-4 z-10 w-64 rounded-xl border border-slate-700/90 text-slate-100 p-3 shadow-xl"
        style={{ backgroundColor: 'rgba(15, 23, 42, 0.94)' }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold tracking-tight">3D Scene Controls</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setIsFullscreen((prev) => !prev);
                setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
              }}
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold cursor-pointer"
              title="Toggle 100vw x 100vh Fullscreen"
            >
              {isFullscreen ? 'Exit Full' : '100vh Full'}
            </button>
            <button
              type="button"
              onClick={() => setDockCollapsed((prev) => !prev)}
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold cursor-pointer"
            >
              {dockCollapsed ? 'Expand' : 'Hide'}
            </button>
          </div>
        </div>

        {!dockCollapsed && (
          <div className="mt-3 space-y-2.5 text-xs">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Procedural Multi-Part Subject
              </label>
              <div className="grid grid-cols-1 gap-1">
                {(
                  [
                    { id: 'aerobreeze-fan', label: 'AeroBreeze Fan (9 Parts)' },
                    { id: 'escrow-workstation', label: 'ProArt Escrow Rig (8 Parts)' },
                    { id: 'yonex-racket', label: 'Yonex Carbon Frame (7 Parts)' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActivePreset(item.id);
                      onSelectModelSku?.(MODEL_METADATA[item.id].sku);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                      activePreset === item.id
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-800/90 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                <span>Rotor / Turntable Speed</span>
                <span className="font-mono tabular-nums">{spinSpeed.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min={0}
                max={3}
                step={0.1}
                value={spinSpeed}
                onChange={(e) => setSpinSpeed(Number(e.target.value))}
                className="w-full accent-sky-500 cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Studio PBR Lighting</label>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { id: 'studio-warm', label: 'Warm Key' },
                    { id: 'cyber-dusk', label: 'Rim Neon' },
                    { id: 'daylight-lab', label: 'Daylight' },
                  ] as const
                ).map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setLightingPreset(l.id)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-semibold cursor-pointer ${
                      lightingPreset === l.id
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
