/**
 * Procedural fleet meshes — drones, aerostat, UGV / armored (preset-agnostic).
 * Used by Urban theatre spawn and Industrial scaled agents.
 * @module fleet-agents-mesh
 */
import * as THREE from "three";

function createDroneMesh() {
  // Ported from components/hero/Drone.tsx — chunky utility quadcopter
  // One grid cell is roughly a city block; keep robots small against buildings.
  const SCALE = 0.24;
  const grp = new THREE.Group();
  grp.scale.setScalar(SCALE);

  const chassisColor = 0x1c1f25;
  const trimColor = 0x33383f;

  const chassisMat = new THREE.MeshStandardMaterial({ color: chassisColor, metalness: 0.55, roughness: 0.45 });
  const trimMat = new THREE.MeshStandardMaterial({ color: trimColor, metalness: 0.6, roughness: 0.4 });
  const blackMat = new THREE.MeshStandardMaterial({ color: 0x06080a, metalness: 0.85, roughness: 0.18 });

  // Chassis (hex prism)
  const chassis = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.22, 6), chassisMat);
  chassis.rotation.y = Math.PI / 6;
  grp.add(chassis);

  // Top deck
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.06, 6), trimMat);
  deck.position.y = 0.13;
  deck.rotation.y = Math.PI / 6;
  grp.add(deck);

  // Antennas
  const antMat = new THREE.MeshStandardMaterial({ color: 0x0a0c0f, roughness: 0.6 });
  const a1 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 6), antMat);
  a1.position.set(0.18, 0.28, -0.05);
  grp.add(a1);
  const a2 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 6), antMat);
  a2.position.set(-0.16, 0.24, 0.06);
  grp.add(a2);

  // Nose sensor cowl
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.3, 12), trimMat);
  nose.position.set(0, -0.03, 0.4);
  nose.rotation.x = Math.PI / 2;
  grp.add(nose);

  // Camera ball
  const cam = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 16), blackMat);
  cam.position.set(0, -0.14, 0.5);
  grp.add(cam);
  // Lens highlight
  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.9, roughness: 0.05, emissive: 0x1a3a32, emissiveIntensity: 0.4 })
  );
  lens.position.set(0, -0.14, 0.55);
  grp.add(lens);

  // Status ring (emissive band)
  const statusRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.44, 0.012, 6, 28),
    new THREE.MeshStandardMaterial({ color: 0x5dffb4, emissive: 0x5dffb4, emissiveIntensity: 1.6, toneMapped: false })
  );
  statusRing.rotation.x = Math.PI / 2;
  statusRing.position.y = -0.02;
  grp.add(statusRing);

  // Arms (X-config)
  const armPositions = [
    [0.62, 0.04, 0.58],
    [-0.62, 0.04, 0.58],
    [0.62, 0.04, -0.58],
    [-0.62, 0.04, -0.58]
  ];
  const armMat = new THREE.MeshStandardMaterial({ color: trimColor, metalness: 0.5, roughness: 0.55 });
  for (const [px, py, pz] of armPositions) {
    const angle = Math.atan2(pz, px);
    const armGrp = new THREE.Group();
    armGrp.position.set(px / 2, py, pz / 2);
    armGrp.rotation.y = -angle;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 8), armMat);
    arm.rotation.z = Math.PI / 2;
    armGrp.add(arm);
    grp.add(armGrp);
  }

  // Motor housings
  const motorMat = new THREE.MeshStandardMaterial({ color: 0x0a0c10, metalness: 0.7, roughness: 0.3 });
  for (const [px, py, pz] of armPositions) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 12), motorMat);
    m.position.set(px, py + 0.05, pz);
    grp.add(m);
  }

  // Spinning rotor discs
  const rotors = new THREE.Group();
  const discMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.28, roughness: 0.9, depthWrite: false });
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x181a1e, transparent: true, opacity: 0.55 });
  for (const [px, py, pz] of armPositions) {
    const rg = new THREE.Group();
    rg.position.set(px, py + 0.15, pz);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.012, 24), discMat);
    rg.add(disc);
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.012, 0.05), bladeMat);
    rg.add(b1);
    const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.012, 0.05), bladeMat);
    b2.rotation.y = Math.PI / 2;
    rg.add(b2);
    rotors.add(rg);
  }
  grp.add(rotors);

  // Nav lights
  const navGreen = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x5dffb4, emissive: 0x5dffb4, emissiveIntensity: 3, toneMapped: false })
  );
  navGreen.position.set(0, 0, 0.58);
  grp.add(navGreen);
  const navRed = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xff5d6c, emissive: 0xff5d6c, emissiveIntensity: 2.2, toneMapped: false })
  );
  navRed.position.set(0, 0, -0.36);
  grp.add(navRed);
  const navBelly = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.4, toneMapped: false })
  );
  navBelly.position.set(0, -0.13, 0);
  grp.add(navBelly);

  // Small cyan halo light so the drone reads from other POVs
  const navLight = new THREE.PointLight(0x00bfff, 1.4, 5);
  navLight.position.y = 0.05;
  grp.add(navLight);

  grp.userData = { rotors: rotors.children, statusRing, beacon: navGreen, navLight };
  return grp;
}

function createUgvMesh() {
  // Tracked rescue rover — sloped armor, light bar, segmented tracks
  const grp = new THREE.Group();
  grp.scale.setScalar(0.58);
  const chassisColor = 0x222a22;
  const trimColor = 0x3a4a3a;

  const chassisMat = new THREE.MeshStandardMaterial({ color: chassisColor, metalness: 0.4, roughness: 0.6 });
  const trimMat = new THREE.MeshStandardMaterial({ color: trimColor, metalness: 0.5, roughness: 0.55 });

  // Main hull (boxy)
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.7), chassisMat);
  hull.position.y = 0.22;
  grp.add(hull);

  // Sloped front armor
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.18), chassisMat);
  front.position.set(0, 0.25, 0.42);
  front.rotation.x = -0.35;
  grp.add(front);

  // Sensor turret on top
  const turret = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.34), trimMat);
  turret.position.set(0, 0.36, -0.05);
  grp.add(turret);

  // Camera lens
  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x06080a, metalness: 0.9, roughness: 0.08 })
  );
  lens.position.set(0, 0.36, 0.14);
  grp.add(lens);

  // Light bar (emissive)
  const lightBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.05, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x39ff14, emissive: 0x39ff14, emissiveIntensity: 1.8, toneMapped: false })
  );
  lightBar.position.set(0, 0.44, -0.05);
  grp.add(lightBar);

  // Tracks
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x141a14, roughness: 0.92, metalness: 0.05 });
  const treadOuter = new THREE.MeshStandardMaterial({ color: 0x1d251d, roughness: 0.85 });
  const trackL = new THREE.Group();
  trackL.position.x = -0.36;
  const trackR = new THREE.Group();
  trackR.position.x = 0.36;
  for (const side of [trackL, trackR]) {
    const tread = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.78), trackMat);
    tread.position.y = 0.13;
    side.add(tread);
    // 6 segmented track plates on the visible side
    for (let i = 0; i < 6; i += 1) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.1), treadOuter);
      plate.position.set(side === trackL ? -0.025 : 0.025, 0.05, -0.32 + i * 0.13);
      side.add(plate);
    }
    grp.add(side);
  }

  // Headlights
  const hlMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c8, emissiveIntensity: 1.6, toneMapped: false });
  const hlL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 10), hlMat);
  hlL.position.set(-0.2, 0.24, 0.52);
  grp.add(hlL);
  const hlR = hlL.clone();
  hlR.position.x = 0.2;
  grp.add(hlR);

  // Forward-throwing spot light (so other POVs see the UGV illuminate ground ahead)
  const spot = new THREE.SpotLight(0xfff2c8, 1.2, 6, Math.PI / 5, 0.55, 1.2);
  spot.position.set(0, 0.5, 0.4);
  spot.target.position.set(0, 0, 2.5);
  grp.add(spot);
  grp.add(spot.target);

  // Hover-light so the UGV reads from other POVs
  const navLight = new THREE.PointLight(0x39ff14, 1.0, 4);
  navLight.position.y = 0.5;
  grp.add(navLight);

  grp.userData = { navLight, lightBar, beacon: lightBar };
  return grp;
}

function createBalloonMesh() {
  // Aerostat — translucent envelope, gondola, tethered comm relay halo
  const grp = new THREE.Group();
  grp.scale.setScalar(0.68);

  const envelopeMat = new THREE.MeshStandardMaterial({
    color: 0xc8b4ff,
    emissive: 0xc8b4ff,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.78,
    roughness: 0.35,
    metalness: 0.05
  });
  const envelope = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 18), envelopeMat);
  envelope.scale.set(1, 1.2, 1);
  envelope.position.y = 0.15;
  grp.add(envelope);

  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.32, 0.18, 14, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x8c7bb0, roughness: 0.7 })
  );
  skirt.position.y = -0.42;
  grp.add(skirt);

  const gondola = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.18, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x3a3450, roughness: 0.7, metalness: 0.25 })
  );
  gondola.position.y = -0.6;
  grp.add(gondola);

  // Comm-relay halo (visible from other POVs)
  const haloLight = new THREE.PointLight(0xc8b4ff, 1.4, 10);
  haloLight.position.y = 0.1;
  grp.add(haloLight);

  // Beacon strip on the envelope
  const beacon = new THREE.Mesh(
    new THREE.TorusGeometry(0.45, 0.012, 6, 28),
    new THREE.MeshStandardMaterial({ color: 0xc8b4ff, emissive: 0xc8b4ff, emissiveIntensity: 1.6, toneMapped: false })
  );
  beacon.rotation.x = Math.PI / 2;
  beacon.position.y = 0.15;
  grp.add(beacon);

  // Tether (visible thin line trailing down)
  const tether = new THREE.Mesh(
    new THREE.CylinderGeometry(0.01, 0.01, 3.0, 6),
    new THREE.MeshBasicMaterial({ color: 0xc8b4ff, transparent: true, opacity: 0.45, fog: false })
  );
  tether.position.y = -2.1;
  grp.add(tether);

  grp.userData = { navLight: haloLight, beacon, statusRing: beacon };
  return grp;
}

function createArmoredMesh() {
  // Heavy armored ground rescuer — wide tracked chassis, sloped armor wedges,
  // amber light bar, six road wheels (visual; not driven by physics).
  const grp = new THREE.Group();
  grp.scale.setScalar(0.62);
  const chassisColor = 0x6a3b18;
  const trimColor = 0x8a4a20;

  const chassisMat = new THREE.MeshStandardMaterial({ color: chassisColor, metalness: 0.55, roughness: 0.5 });
  const trimMat = new THREE.MeshStandardMaterial({ color: trimColor, metalness: 0.55, roughness: 0.45 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xff8c3c, emissive: 0xff8c3c, emissiveIntensity: 1.4, toneMapped: false });

  // Lower hull
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.22, 1.0), chassisMat);
  hull.position.y = 0.22;
  grp.add(hull);

  // Sloped front armor
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.26, 0.22), trimMat);
  front.position.set(0, 0.26, 0.58);
  front.rotation.x = -0.42;
  grp.add(front);

  // Sloped rear armor
  const rear = front.clone();
  rear.position.set(0, 0.26, -0.58);
  rear.rotation.x = 0.42;
  grp.add(rear);

  // Upper hull
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.7), trimMat);
  upper.position.set(0, 0.42, -0.05);
  grp.add(upper);

  // Sensor / remote-weapon-station mast
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.34), chassisMat);
  mast.position.set(0, 0.56, -0.05);
  grp.add(mast);

  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x05080a, metalness: 0.9, roughness: 0.08 })
  );
  lens.position.set(0, 0.56, 0.13);
  grp.add(lens);

  // Amber light bar (emissive, this is the beacon)
  const lightBar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.07), accentMat);
  lightBar.position.set(0, 0.65, -0.05);
  grp.add(lightBar);

  // Tracks
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x12100a, roughness: 0.92, metalness: 0.05 });
  for (const side of [-1, 1]) {
    const tread = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 1.0), trackMat);
    tread.position.set(side * 0.42, 0.12, 0);
    grp.add(tread);
    // six road wheels per side (purely visual)
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x2a2218, roughness: 0.7, metalness: 0.3 });
    for (let i = 0; i < 6; i += 1) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 14), wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 0.42, 0.07, -0.42 + i * 0.17);
      grp.add(wheel);
    }
  }

  // Headlights
  const hlMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 1.6, toneMapped: false });
  const hlL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), hlMat);
  hlL.position.set(-0.28, 0.26, 0.7);
  grp.add(hlL);
  const hlR = hlL.clone();
  hlR.position.x = 0.28;
  grp.add(hlR);

  const spot = new THREE.SpotLight(0xffd9a0, 1.3, 8, Math.PI / 4.5, 0.5, 1.2);
  spot.position.set(0, 0.55, 0.55);
  spot.target.position.set(0, 0, 3);
  grp.add(spot);
  grp.add(spot.target);

  const navLight = new THREE.PointLight(0xff8c3c, 1.2, 5);
  navLight.position.y = 0.7;
  grp.add(navLight);

  grp.userData = { navLight, lightBar, beacon: lightBar };
  return grp;
}

export function createAgentMesh(type) {
  if (type === "drone") return createDroneMesh();
  if (type === "balloon") return createBalloonMesh();
  if (type === "ground_armored") return createArmoredMesh();
  return createUgvMesh();
}

export function agentBaseAltitude(type) {
  if (type === "drone") return 1.5;
  if (type === "balloon") return 3.6;
  return 0;
}
