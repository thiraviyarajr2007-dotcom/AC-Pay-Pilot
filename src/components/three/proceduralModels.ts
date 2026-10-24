import * as THREE from 'three';

export interface ExplodedPart {
  mesh: THREE.Object3D;
  originalPosition: THREE.Vector3;
  explodedOffset: THREE.Vector3;
}

export interface ProceduralProductResult {
  group: THREE.Group;
  explodedParts: ExplodedPart[];
  setColorway: (finish: 'obsidian' | 'titanium' | 'rosegold' | 'alpine') => void;
}

/**
 * Creates a procedural radial texture for dial/mesh details without external assets.
 */
function createRadialGridTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#181b22';
  ctx.fillRect(0, 0, 512, 512);

  // Concentric radial lines
  ctx.strokeStyle = '#2d3748';
  ctx.lineWidth = 2;
  for (let r = 20; r < 240; r += 24) {
    ctx.beginPath();
    ctx.arc(256, 256, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Radial spoke accents
  for (let i = 0; i < 24; i++) {
    const angle = (i * Math.PI * 2) / 24;
    ctx.beginPath();
    ctx.moveTo(256 + Math.cos(angle) * 30, 256 + Math.sin(angle) * 30);
    ctx.lineTo(256 + Math.cos(angle) * 230, 256 + Math.sin(angle) * 230);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Procedural AeroBreeze BLDC Smart Ceiling Fan (6 distinct parts).
 */
export function createCeilingFanModel(): ProceduralProductResult {
  const group = new THREE.Group();
  group.name = 'CeilingFan_Root';
  const explodedParts: ExplodedPart[] = [];

  // Finish materials
  const motorMat = new THREE.MeshStandardMaterial({
    color: 0x1f242d,
    roughness: 0.28,
    metalness: 0.85,
  });

  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0x2a303c,
    roughness: 0.45,
    metalness: 0.15,
  });

  const chromeAccentMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.1,
    metalness: 0.95,
  });

  const haloRingMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 0.8,
    roughness: 0.2,
  });

  // 1. Ceiling Canopy Mount
  const canopyGeo = new THREE.ConeGeometry(0.35, 0.25, 32, 1, true);
  canopyGeo.rotateX(Math.PI);
  const canopy = new THREE.Mesh(canopyGeo, motorMat);
  canopy.position.set(0, 1.8, 0);
  canopy.castShadow = true;
  group.add(canopy);
  explodedParts.push({
    mesh: canopy,
    originalPosition: canopy.position.clone(),
    explodedOffset: new THREE.Vector3(0, 0.6, 0),
  });

  // 2. Downrod Pipe
  const rodGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.9, 24);
  const rod = new THREE.Mesh(rodGeo, chromeAccentMat);
  rod.position.set(0, 1.35, 0);
  rod.castShadow = true;
  group.add(rod);
  explodedParts.push({
    mesh: rod,
    originalPosition: rod.position.clone(),
    explodedOffset: new THREE.Vector3(0, 0.35, 0),
  });

  // 3. BLDC Motor Housing (Core)
  const motorCore = new THREE.Group();
  motorCore.position.set(0, 0.8, 0);

  const mainHousingGeo = new THREE.CylinderGeometry(0.42, 0.46, 0.28, 48);
  const mainHousing = new THREE.Mesh(mainHousingGeo, motorMat);
  mainHousing.castShadow = true;
  motorCore.add(mainHousing);

  const statorTrimGeo = new THREE.TorusGeometry(0.44, 0.025, 16, 48);
  statorTrimGeo.rotateX(Math.PI / 2);
  const statorTrim = new THREE.Mesh(statorTrimGeo, chromeAccentMat);
  motorCore.add(statorTrim);

  group.add(motorCore);
  explodedParts.push({
    mesh: motorCore,
    originalPosition: motorCore.position.clone(),
    explodedOffset: new THREE.Vector3(0, 0, 0),
  });

  // 4. Aerodynamic Halo Light Ring & Lower Cowl
  const lowerCowl = new THREE.Group();
  lowerCowl.position.set(0, 0.62, 0);

  const haloGeo = new THREE.TorusGeometry(0.36, 0.03, 16, 48);
  haloGeo.rotateX(Math.PI / 2);
  const haloMesh = new THREE.Mesh(haloGeo, haloRingMat);
  lowerCowl.add(haloMesh);

  const capGeo = new THREE.SphereGeometry(0.32, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.45);
  capGeo.rotateX(Math.PI);
  const capMesh = new THREE.Mesh(capGeo, chromeAccentMat);
  capMesh.position.set(0, -0.02, 0);
  lowerCowl.add(capMesh);

  group.add(lowerCowl);
  explodedParts.push({
    mesh: lowerCowl,
    originalPosition: lowerCowl.position.clone(),
    explodedOffset: new THREE.Vector3(0, -0.45, 0),
  });

  // 5. Tri-Blade Aerodynamic Rotor Assembly
  const bladesGroup = new THREE.Group();
  bladesGroup.name = 'RotorBlades';
  bladesGroup.position.set(0, 0.78, 0);

  const bladeCount = 3;
  for (let i = 0; i < bladeCount; i++) {
    const angle = (i * Math.PI * 2) / bladeCount;
    const bladeArm = new THREE.Group();
    bladeArm.rotation.y = angle;

    // Aerodynamic blade shape
    const shape = new THREE.Shape();
    shape.moveTo(0.35, -0.06);
    shape.lineTo(1.85, -0.16);
    shape.quadraticCurveTo(2.1, 0, 1.85, 0.16);
    shape.lineTo(0.35, 0.08);
    shape.closePath();

    const extrudeSettings = {
      depth: 0.018,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 0.008,
      bevelThickness: 0.008,
    };
    const bladeGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    bladeGeo.rotateX(Math.PI / 2);
    bladeGeo.rotateZ(0.12); // Pitch angle for airflow

    const bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
    bladeMesh.castShadow = true;
    bladeArm.add(bladeMesh);

    // Chrome blade shank bracket
    const shankGeo = new THREE.BoxGeometry(0.18, 0.035, 0.07);
    const shankMesh = new THREE.Mesh(shankGeo, chromeAccentMat);
    shankMesh.position.set(0.38, 0.01, 0);
    bladeArm.add(shankMesh);

    bladesGroup.add(bladeArm);
  }

  group.add(bladesGroup);
  explodedParts.push({
    mesh: bladesGroup,
    originalPosition: bladesGroup.position.clone(),
    explodedOffset: new THREE.Vector3(0, -0.2, 0),
  });

  const setColorway = (finish: 'obsidian' | 'titanium' | 'rosegold' | 'alpine') => {
    switch (finish) {
      case 'obsidian':
        motorMat.color.setHex(0x181a1f);
        motorMat.roughness = 0.28;
        motorMat.metalness = 0.88;
        bladeMat.color.setHex(0x22262d);
        chromeAccentMat.color.setHex(0xc0c6cf);
        haloRingMat.color.setHex(0x38bdf8);
        haloRingMat.emissive.setHex(0x0284c7);
        break;
      case 'titanium':
        motorMat.color.setHex(0x6b7280);
        motorMat.roughness = 0.22;
        motorMat.metalness = 0.92;
        bladeMat.color.setHex(0x4b5563);
        chromeAccentMat.color.setHex(0xe5e7eb);
        haloRingMat.color.setHex(0x93c5fd);
        haloRingMat.emissive.setHex(0x3b82f6);
        break;
      case 'rosegold':
        motorMat.color.setHex(0x7c3a27);
        motorMat.roughness = 0.25;
        motorMat.metalness = 0.9;
        bladeMat.color.setHex(0x3d2723);
        chromeAccentMat.color.setHex(0xfbcfe8);
        haloRingMat.color.setHex(0xf472b6);
        haloRingMat.emissive.setHex(0xdb2777);
        break;
      case 'alpine':
        motorMat.color.setHex(0xf8fafc);
        motorMat.roughness = 0.35;
        motorMat.metalness = 0.25;
        bladeMat.color.setHex(0xf1f5f9);
        chromeAccentMat.color.setHex(0x38bdf8);
        haloRingMat.color.setHex(0x38bdf8);
        haloRingMat.emissive.setHex(0x0ea5e9);
        break;
    }
  };

  return { group, explodedParts, setColorway };
}

/**
 * Procedural ProArt Studio Workstation X1 (Multi-part chassis, internals, GPU & glass panel).
 */
export function createWorkstationModel(): ProceduralProductResult {
  const group = new THREE.Group();
  group.name = 'Workstation_Root';
  const explodedParts: ExplodedPart[] = [];

  const chassisMat = new THREE.MeshStandardMaterial({
    color: 0x1e242d,
    roughness: 0.32,
    metalness: 0.82,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x94a3b8,
    transmission: 0.9,
    roughness: 0.05,
    metalness: 0.1,
    ior: 1.52,
    thickness: 0.05,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });

  const pcbMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.6,
    metalness: 0.3,
  });

  const copperMat = new THREE.MeshStandardMaterial({
    color: 0xb45309,
    roughness: 0.2,
    metalness: 0.9,
  });

  const rgbGlowMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 1.2,
    roughness: 0.2,
  });

  // 1. Main Unibody Aluminum Frame
  const frameGeo = new THREE.BoxGeometry(0.8, 1.4, 1.6);
  const frame = new THREE.Mesh(frameGeo, chassisMat);
  frame.position.set(0, 0.7, 0);
  frame.castShadow = true;
  group.add(frame);
  explodedParts.push({
    mesh: frame,
    originalPosition: frame.position.clone(),
    explodedOffset: new THREE.Vector3(0, 0, 0),
  });

  // 2. Perforated Front Intake Grill
  const grillGeo = new THREE.BoxGeometry(0.78, 1.34, 0.06);
  const grillTex = createRadialGridTexture();
  const grillMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    map: grillTex,
    roughness: 0.5,
    metalness: 0.7,
  });
  const grill = new THREE.Mesh(grillGeo, grillMat);
  grill.position.set(0, 0.7, 0.82);
  group.add(grill);
  explodedParts.push({
    mesh: grill,
    originalPosition: grill.position.clone(),
    explodedOffset: new THREE.Vector3(0, 0, 0.6),
  });

  // 3. Motherboard & Heatsink Tower (Internals)
  const internals = new THREE.Group();
  internals.position.set(-0.15, 0.7, 0);

  const moboGeo = new THREE.BoxGeometry(0.04, 1.1, 1.1);
  const mobo = new THREE.Mesh(moboGeo, pcbMat);
  internals.add(mobo);

  // CPU Cooler Tower with Heat Pipes
  const coolerGeo = new THREE.BoxGeometry(0.24, 0.35, 0.35);
  const cooler = new THREE.Mesh(coolerGeo, chassisMat);
  cooler.position.set(0.14, 0.2, 0.1);
  internals.add(cooler);

  // Copper Heat Pipes
  for (let p = -0.1; p <= 0.1; p += 0.08) {
    const pipeGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.42, 16);
    pipeGeo.rotateZ(Math.PI / 2);
    const pipe = new THREE.Mesh(pipeGeo, copperMat);
    pipe.position.set(0.12, 0.38, 0.1 + p);
    internals.add(pipe);
  }

  // High-End Dual-Fan GPU Block
  const gpuGeo = new THREE.BoxGeometry(0.3, 0.16, 0.8);
  const gpu = new THREE.Mesh(gpuGeo, chassisMat);
  gpu.position.set(0.16, -0.22, 0);
  internals.add(gpu);

  // Illuminated GPU Edge
  const ledStripeGeo = new THREE.BoxGeometry(0.02, 0.02, 0.76);
  const ledStripe = new THREE.Mesh(ledStripeGeo, rgbGlowMat);
  ledStripe.position.set(0.315, -0.22, 0);
  internals.add(ledStripe);

  group.add(internals);
  explodedParts.push({
    mesh: internals,
    originalPosition: internals.position.clone(),
    explodedOffset: new THREE.Vector3(-0.35, 0, 0),
  });

  // 4. Tempered Glass Side Panel
  const glassPanelGeo = new THREE.BoxGeometry(0.03, 1.34, 1.54);
  const glassPanel = new THREE.Mesh(glassPanelGeo, glassMat);
  glassPanel.position.set(0.42, 0.7, 0);
  group.add(glassPanel);
  explodedParts.push({
    mesh: glassPanel,
    originalPosition: glassPanel.position.clone(),
    explodedOffset: new THREE.Vector3(0.65, 0, 0),
  });

  // 5. Anti-Vibration Pedestal Rails
  const feetGroup = new THREE.Group();
  feetGroup.position.set(0, 0.03, 0);
  const foot1Geo = new THREE.BoxGeometry(0.72, 0.06, 0.18);
  const foot1 = new THREE.Mesh(foot1Geo, chassisMat);
  foot1.position.set(0, 0, 0.6);
  const foot2 = foot1.clone();
  foot2.position.set(0, 0, -0.6);
  feetGroup.add(foot1, foot2);
  group.add(feetGroup);
  explodedParts.push({
    mesh: feetGroup,
    originalPosition: feetGroup.position.clone(),
    explodedOffset: new THREE.Vector3(0, -0.3, 0),
  });

  const setColorway = (finish: 'obsidian' | 'titanium' | 'rosegold' | 'alpine') => {
    switch (finish) {
      case 'obsidian':
        chassisMat.color.setHex(0x181a1f);
        rgbGlowMat.color.setHex(0x38bdf8);
        rgbGlowMat.emissive.setHex(0x0284c7);
        break;
      case 'titanium':
        chassisMat.color.setHex(0x52525b);
        rgbGlowMat.color.setHex(0xa855f7);
        rgbGlowMat.emissive.setHex(0x7e22ce);
        break;
      case 'rosegold':
        chassisMat.color.setHex(0x831843);
        rgbGlowMat.color.setHex(0xf472b6);
        rgbGlowMat.emissive.setHex(0xdb2777);
        break;
      case 'alpine':
        chassisMat.color.setHex(0xe2e8f0);
        rgbGlowMat.color.setHex(0x10b981);
        rgbGlowMat.emissive.setHex(0x059669);
        break;
    }
  };

  return { group, explodedParts, setColorway };
}

/**
 * Procedural Yonex Astrox 99 Pro Badminton Racket (Head, strings, shaft, t-joint, grip).
 */
export function createRacketModel(): ProceduralProductResult {
  const group = new THREE.Group();
  group.name = 'Racket_Root';
  const explodedParts: ExplodedPart[] = [];

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    roughness: 0.22,
    metalness: 0.75,
  });

  const stringMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.5,
    metalness: 0.1,
  });

  const shaftMat = new THREE.MeshStandardMaterial({
    color: 0x18181b,
    roughness: 0.2,
    metalness: 0.85,
  });

  const gripMat = new THREE.MeshStandardMaterial({
    color: 0x27272a,
    roughness: 0.85,
    metalness: 0.05,
  });

  const goldCapMat = new THREE.MeshStandardMaterial({
    color: 0xeab308,
    roughness: 0.15,
    metalness: 0.95,
  });

  // 1. Isometric Frame Head
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.45, 0);

  const curve = new THREE.EllipseCurve(0, 0, 0.45, 0.6, 0, 2 * Math.PI, false, 0);
  const points = curve.getPoints(64).map((p) => new THREE.Vector3(p.x, p.y, 0));
  const tubeGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), 64, 0.022, 12, true);
  const headMesh = new THREE.Mesh(tubeGeo, frameMat);
  headMesh.castShadow = true;
  headGroup.add(headMesh);

  // String Grid (pre-strung BG80)
  const stringGroup = new THREE.Group();
  for (let x = -0.36; x <= 0.36; x += 0.05) {
    const yLimit = Math.sqrt(Math.max(0, 1 - (x / 0.45) ** 2)) * 0.54;
    const vLineGeo = new THREE.CylinderGeometry(0.002, 0.002, yLimit * 2, 6);
    const vLine = new THREE.Mesh(vLineGeo, stringMat);
    vLine.position.set(x, 0, 0);
    stringGroup.add(vLine);
  }
  for (let y = -0.48; y <= 0.48; y += 0.05) {
    const xLimit = Math.sqrt(Math.max(0, 1 - (y / 0.6) ** 2)) * 0.42;
    const hLineGeo = new THREE.CylinderGeometry(0.002, 0.002, xLimit * 2, 6);
    hLineGeo.rotateZ(Math.PI / 2);
    const hLine = new THREE.Mesh(hLineGeo, stringMat);
    hLine.position.set(0, y, 0);
    stringGroup.add(hLine);
  }
  headGroup.add(stringGroup);
  group.add(headGroup);
  explodedParts.push({
    mesh: headGroup,
    originalPosition: headGroup.position.clone(),
    explodedOffset: new THREE.Vector3(0, 0.5, 0),
  });

  // 2. Built-in T-Joint Stabilizer
  const tJointGeo = new THREE.CylinderGeometry(0.032, 0.026, 0.12, 16);
  const tJoint = new THREE.Mesh(tJointGeo, goldCapMat);
  tJoint.position.set(0, 0.82, 0);
  group.add(tJoint);
  explodedParts.push({
    mesh: tJoint,
    originalPosition: tJoint.position.clone(),
    explodedOffset: new THREE.Vector3(0, 0.25, 0),
  });

  // 3. High-Modulus Carbon Shaft
  const shaftGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.68, 16);
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);
  shaft.position.set(0, 0.44, 0);
  shaft.castShadow = true;
  group.add(shaft);
  explodedParts.push({
    mesh: shaft,
    originalPosition: shaft.position.clone(),
    explodedOffset: new THREE.Vector3(0, 0.05, 0),
  });

  // 4. Wrapped Grip Handle & Gold Cap
  const gripGroup = new THREE.Group();
  gripGroup.position.set(0, -0.16, 0);

  const gripGeo = new THREE.CylinderGeometry(0.038, 0.042, 0.48, 8);
  const grip = new THREE.Mesh(gripGeo, gripMat);
  gripGroup.add(grip);

  const capGeo = new THREE.CylinderGeometry(0.044, 0.046, 0.06, 8);
  const cap = new THREE.Mesh(capGeo, goldCapMat);
  cap.position.set(0, -0.26, 0);
  gripGroup.add(cap);

  group.add(gripGroup);
  explodedParts.push({
    mesh: gripGroup,
    originalPosition: gripGroup.position.clone(),
    explodedOffset: new THREE.Vector3(0, -0.35, 0),
  });

  const setColorway = (finish: 'obsidian' | 'titanium' | 'rosegold' | 'alpine') => {
    switch (finish) {
      case 'obsidian':
        frameMat.color.setHex(0xdc2626); // Solar Orange / Cherry Red
        goldCapMat.color.setHex(0xeab308);
        break;
      case 'titanium':
        frameMat.color.setHex(0x0284c7); // Cyan Sapphire
        goldCapMat.color.setHex(0xe2e8f0);
        break;
      case 'rosegold':
        frameMat.color.setHex(0xdb2777); // Metallic Magenta
        goldCapMat.color.setHex(0xfbcfe8);
        break;
      case 'alpine':
        frameMat.color.setHex(0x10b981); // Emerald Volt
        goldCapMat.color.setHex(0xfef08a);
        break;
    }
  };

  return { group, explodedParts, setColorway };
}

/**
 * Procedural AcousticSphere ANC Pods (Charging capsule + left/right earbuds).
 */
export function createAudioPodsModel(): ProceduralProductResult {
  const group = new THREE.Group();
  group.name = 'AudioPods_Root';
  const explodedParts: ExplodedPart[] = [];

  const caseMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.18,
    metalness: 0.45,
  });

  const earbudMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.25,
    metalness: 0.65,
  });

  const tipMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.8,
    metalness: 0.05,
  });

  const ledMat = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    emissive: 0x059669,
    emissiveIntensity: 1.5,
  });

  // 1. Lower Case Shell
  const caseBottomGeo = new THREE.CylinderGeometry(0.5, 0.42, 0.45, 32);
  const caseBottom = new THREE.Mesh(caseBottomGeo, caseMat);
  caseBottom.position.set(0, 0.24, 0);
  caseBottom.castShadow = true;
  group.add(caseBottom);
  explodedParts.push({
    mesh: caseBottom,
    originalPosition: caseBottom.position.clone(),
    explodedOffset: new THREE.Vector3(0, -0.3, 0),
  });

  // Battery Status LED Dot
  const ledDotGeo = new THREE.SphereGeometry(0.015, 12, 12);
  const ledDot = new THREE.Mesh(ledDotGeo, ledMat);
  ledDot.position.set(0, 0.26, 0.505);
  group.add(ledDot);

  // 2. Magnetic Case Lid
  const lidGeo = new THREE.SphereGeometry(0.51, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.45);
  const lid = new THREE.Mesh(lidGeo, caseMat);
  lid.position.set(0, 0.46, 0);
  group.add(lid);
  explodedParts.push({
    mesh: lid,
    originalPosition: lid.position.clone(),
    explodedOffset: new THREE.Vector3(0, 0.55, 0),
  });

  // 3. Left Earbud
  const leftBud = new THREE.Group();
  leftBud.position.set(-0.2, 0.72, 0);

  const budHeadGeo = new THREE.SphereGeometry(0.12, 24, 24);
  const budHead = new THREE.Mesh(budHeadGeo, earbudMat);
  leftBud.add(budHead);

  const stemGeo = new THREE.CylinderGeometry(0.03, 0.025, 0.28, 16);
  const stem = new THREE.Mesh(stemGeo, earbudMat);
  stem.position.set(0.04, -0.16, 0.04);
  stem.rotation.z = -0.2;
  leftBud.add(stem);

  const tipGeo = new THREE.SphereGeometry(0.07, 16, 16);
  const tip = new THREE.Mesh(tipGeo, tipMat);
  tip.position.set(-0.08, 0.02, -0.04);
  leftBud.add(tip);

  group.add(leftBud);
  explodedParts.push({
    mesh: leftBud,
    originalPosition: leftBud.position.clone(),
    explodedOffset: new THREE.Vector3(-0.45, 0.35, 0),
  });

  // 4. Right Earbud (Mirrored)
  const rightBud = leftBud.clone();
  rightBud.position.set(0.2, 0.72, 0);
  rightBud.scale.set(-1, 1, 1);
  group.add(rightBud);
  explodedParts.push({
    mesh: rightBud,
    originalPosition: rightBud.position.clone(),
    explodedOffset: new THREE.Vector3(0.45, 0.35, 0),
  });

  const setColorway = (finish: 'obsidian' | 'titanium' | 'rosegold' | 'alpine') => {
    switch (finish) {
      case 'obsidian':
        caseMat.color.setHex(0x0f172a);
        earbudMat.color.setHex(0x1e293b);
        ledMat.color.setHex(0x10b981);
        ledMat.emissive.setHex(0x059669);
        break;
      case 'titanium':
        caseMat.color.setHex(0x475569);
        earbudMat.color.setHex(0x64748b);
        ledMat.color.setHex(0x38bdf8);
        ledMat.emissive.setHex(0x0284c7);
        break;
      case 'rosegold':
        caseMat.color.setHex(0x831843);
        earbudMat.color.setHex(0x9d174d);
        ledMat.color.setHex(0xf472b6);
        ledMat.emissive.setHex(0xdb2777);
        break;
      case 'alpine':
        caseMat.color.setHex(0xf8fafc);
        earbudMat.color.setHex(0xe2e8f0);
        ledMat.color.setHex(0x10b981);
        ledMat.emissive.setHex(0x059669);
        break;
    }
  };

  return { group, explodedParts, setColorway };
}

/**
 * Model factory by SKU / category.
 */
export function createProduct3DModel(skuOrName: string): ProceduralProductResult {
  const clean = skuOrName.toUpperCase();
  if (clean.includes('FAN') || clean.includes('AERO') || clean.includes('CEILING')) {
    return createCeilingFanModel();
  }
  if (clean.includes('WRK') || clean.includes('PROART') || clean.includes('STUDIO') || clean.includes('STATION')) {
    return createWorkstationModel();
  }
  if (clean.includes('SPO') || clean.includes('YNX') || clean.includes('RKT') || clean.includes('RACKET')) {
    return createRacketModel();
  }
  return createAudioPodsModel();
}
