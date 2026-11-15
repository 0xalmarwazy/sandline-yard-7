// Rendering: the three.js scene, bot meshes, the first-person viewmodel
// and short-lived effects. Reads state, never writes it (except pruning
// nothing — the sim owns all state). All geometries and materials are
// shared; per-frame work reuses preallocated buffers.

import * as THREE from 'three';
import { PALETTE, SITES, TEAMS } from './config.js';
import { buildMap } from './map.js';
import { eyeHeight } from './player.js';

const MAX_TRACERS = 64;
const MAX_RINGS = 16;

function nameTexture(text, colorHex) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,12,16,0.55)';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = colorHex;
  g.font = '700 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeBotMesh(e) {
  const teamColor = TEAMS[e.team].color;
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.9 });
  const accentMat = new THREE.MeshStandardMaterial({
    color: e.team === 'van' ? 0xbae6fd : 0xfecaca, roughness: 0.5, emissive: teamColor, emissiveIntensity: 0.25,
  });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.62, 4, 10), bodyMat);
  body.position.y = 0.98;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), darkMat);
  head.position.y = 1.58;
  head.castShadow = true;
  group.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.06), accentMat);
  visor.position.set(0, 1.6, -0.22);
  group.add(visor);
  // Kit detail: backpack, shoulder pads and a team chest stripe so bots
  // read as soldiers, not capsules, at screenshot distance.
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.44, 0.18), darkMat);
  pack.position.set(0, 1.28, 0.3);
  pack.castShadow = true;
  group.add(pack);
  const padGeo = new THREE.BoxGeometry(0.14, 0.1, 0.22);
  const padL = new THREE.Mesh(padGeo, darkMat);
  padL.position.set(-0.3, 1.44, 0);
  group.add(padL);
  const padR = new THREE.Mesh(padGeo, darkMat);
  padR.position.set(0.3, 1.44, 0);
  group.add(padR);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.07, 0.03), accentMat);
  stripe.position.set(0, 1.18, -0.31);
  group.add(stripe);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.62), darkMat);
  gun.position.set(0.22, 1.22, -0.4);
  group.add(gun);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.52, 24),
    new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: nameTexture(e.name, `#${teamColor.toString(16).padStart(6, '0')}`),
    transparent: true, depthTest: true,
  }));
  sprite.scale.set(1.7, 0.42, 1);
  sprite.position.y = 2.15;
  sprite.renderOrder = 10;
  group.add(sprite);
  group.userData = { body, head, gun, sprite, ring, pack, padL, padR, stripe };
  return group;
}

// Shared radial-gradient texture (sun, clouds, muzzle flashes): one
// canvas, drawn once, reused everywhere a soft glow is needed.
function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Sky dome gradient: blue zenith, pale mid-band, warm golden-hour horizon.
function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#5f9fd0');
  grad.addColorStop(0.55, '#a9c8de');
  grad.addColorStop(0.78, '#f6cf9a');
  grad.addColorStop(1, '#e8b57e');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeViewmodel() {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.55, metalness: 0.5 });
  const tan = new THREE.MeshStandardMaterial({ color: 0x9a7d4f, roughness: 0.7, metalness: 0.2 });
  const accent = new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.5, metalness: 0.3 });
  // Slim receiver + tan handguard + stock: reads as a rifle, not a slab.
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.36), dark);
  group.add(receiver);
  const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.2), tan);
  handguard.position.set(0, -0.005, -0.26);
  group.add(handguard);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.16), dark);
  stock.position.set(0, -0.01, 0.24);
  group.add(stock);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.42);
  group.add(barrel);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.15, 0.08), dark);
  mag.position.set(0, -0.12, -0.03);
  mag.rotation.x = 0.15;
  group.add(mag);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.12, 0.07), dark);
  grip.position.set(0, -0.1, 0.14);
  grip.rotation.x = -0.3;
  group.add(grip);
  const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), accent);
  frontSight.position.set(0, 0.08, -0.32);
  group.add(frontSight);
  const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.06), accent);
  rearSight.position.set(0, 0.07, 0.08);
  group.add(rearSight);
  // Muzzle flash quad at the barrel tip.
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0, 0.02, -0.62);
  group.add(flash);
  group.userData.flash = flash;
  group.userData.barrel = barrel;
  group.userData.stock = stock;
  return group;
}

// Viewmodel barrel shape per weapon: [radius, length]. The vk47 gets a long
// barrel, the m870 a thick one, the p9 a stub — so the gun in your hands
// matches what you bought.
const VM_BARREL = {
  p9: [0.016, 0.22], k9: [0.018, 0.26], m870: [0.034, 0.34], vk47: [0.024, 0.42],
};
// Whole-gun scale per weapon: the sidearm is a compact pistol, the
// shotgun the biggest gun in the hand.
const VM_SCALE = { p9: 0.62, k9: 0.74, m870: 0.85, vk47: 0.8 };

export function createRenderer(state, container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 60, 160);

  // Sky dome + sun + clouds: the horizon is atmosphere, not a flat colour.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(240, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
  );
  scene.add(sky);
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture([[0, 'rgba(255,250,230,1)'], [0.35, 'rgba(255,220,150,0.9)'], [1, 'rgba(255,180,90,0)']]),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  sunSprite.scale.set(70, 70, 1);
  sunSprite.position.set(120, 62, 76);
  scene.add(sunSprite);
  const cloudTex = radialTexture([[0, 'rgba(255,255,255,0.85)'], [0.6, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']]);
  for (const [cx, cy, cz, s] of [[-140, 75, -120, 90], [60, 88, -160, 110], [150, 70, 60, 80], [-60, 95, 150, 100], [10, 65, -190, 70]]) {
    const cloud = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
    cloud.scale.set(s, s * 0.36, 1);
    cloud.position.set(cx, cy, cz);
    scene.add(cloud);
  }

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 300);
  camera.rotation.order = 'YXZ';

  // Lighting: golden hour — warm low sun, sky/ground bounce, plus a low
  // ambient floor so shadow-side faces stay readable instead of going black.
  const hemi = new THREE.HemisphereLight(0xc3d4e2, 0x8a7a5a, 1.5);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.4);
  sun.position.set(55, 28, 35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -55;
  sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55;
  sun.shadow.camera.bottom = -55;
  sun.shadow.camera.far = 170;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  buildMap(scene);

  // Bot meshes, one per bot entity (the player is first-person: no body).
  const botMeshes = new Map();
  for (const e of state.players) {
    if (e.isPlayer) continue;
    const mesh = makeBotMesh(e);
    scene.add(mesh);
    botMeshes.set(e.id, mesh);
  }

  // Viewmodel + muzzle light, parented to the camera. A small fill light
  // rides with the camera so the gun never reads as a black silhouette.
  const viewmodel = makeViewmodel();
  viewmodel.position.set(0.3, -0.27, -0.72);
  viewmodel.rotation.y = -0.06;
  viewmodel.scale.setScalar(0.8);
  camera.add(viewmodel);
  const vmLight = new THREE.PointLight(0xfff2dd, 2.5, 3.5, 1.6);
  vmLight.position.set(0.1, 0.15, -0.3);
  camera.add(vmLight);
  const muzzleLight = new THREE.PointLight(0xffc46b, 0, 9, 1.8);
  muzzleLight.position.set(0.2, -0.1, -0.8);
  camera.add(muzzleLight);
  scene.add(camera);

  // Tracers: one LineSegments, positions rebuilt from state each frame.
  // Each tracer draws 3 parallel lines (a faked thickness: WebGL ignores
  // line width), so shots read at a glance.
  const tracerGeo = new THREE.BufferGeometry();
  const tracerPos = new Float32Array(MAX_TRACERS * 18);
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
  const tracers = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({
    color: 0xfff2c0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  tracers.frustumCulled = false;
  scene.add(tracers);

  // Impact rings, pooled.
  const rings = [];
  const ringGeo = new THREE.RingGeometry(0.08, 0.16, 20);
  for (let i = 0; i < MAX_RINGS; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    m.visible = false;
    scene.add(m);
    rings.push({ mesh: m, born: 0 });
  }
  let ringNext = 0;

  // Explosion flash: one reusable sphere.
  const boom = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  boom.visible = false;
  scene.add(boom);
  const boomLight = new THREE.PointLight(0xff9a3d, 0, 30, 1.5);
  scene.add(boomLight);

  // Grenade meshes, pooled. 8 slots: 10 players can have more live
  // grenades than the v1 pool of 4.
  const grenadeMeshes = [];
  const grenadeGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.6 });
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(grenadeGeo, grenadeMat);
    m.visible = false;
    scene.add(m);
    grenadeMeshes.push(m);
  }

  // Bot muzzle flashes: pooled sprites on the shared radial texture,
  // triggered when a bot's lastShotAt advances.
  const flashTex = radialTexture([[0, 'rgba(255,255,220,1)'], [0.4, 'rgba(255,190,80,0.9)'], [1, 'rgba(255,120,20,0)']]);
  const botFlashes = [];
  for (let i = 0; i < 9; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTex, color: 0xffd27a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    sprite.scale.set(0.7, 0.7, 1);
    sprite.visible = false;
    scene.add(sprite);
    botFlashes.push({ sprite, until: 0 });
  }
  let botFlashIdx = 0;
  const botShotSeen = new Map();

  // Smoke clouds: pooled groups of translucent spheres, one material per
  // group so each cloud fades independently near expiry.
  const smokeGroups = [];
  for (let i = 0; i < 4; i++) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x8f9296, transparent: true, opacity: 0, depthWrite: false });
    const geo = new THREE.IcosahedronGeometry(1, 1);
    for (let j = 0; j < 5; j++) {
      const m = new THREE.Mesh(geo, mat);
      const a = (j / 5) * Math.PI * 2 + i * 1.3;
      m.position.set(Math.cos(a) * 1.6, 0.4 + (j % 3) * 0.7, Math.sin(a) * 1.6);
      m.scale.setScalar(1.4 + (j % 2) * 0.5);
      group.add(m);
    }
    group.visible = false;
    scene.add(group);
    smokeGroups.push({ group, mat });
  }

  // Bomb: a case with a blinking beacon and a red ring on the ground,
  // shown once planted — big enough to read across a site.
  const bombGroup = new THREE.Group();
  const bombCase = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.3, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.5, metalness: 0.5 }),
  );
  bombCase.position.y = 0.15;
  bombGroup.add(bombCase);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2222 }),
  );
  beacon.position.y = 0.38;
  bombGroup.add(beacon);
  const bombRing = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.72, 24),
    new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
  );
  bombRing.rotation.x = -Math.PI / 2;
  bombRing.position.y = 0.03;
  bombGroup.add(bombRing);
  const bombLight = new THREE.PointLight(0xff2222, 0, 6, 2);
  bombLight.position.y = 0.6;
  bombGroup.add(bombLight);
  bombGroup.visible = false;
  scene.add(bombGroup);

  // Site beacons: soft light columns over each site so they read at a glance,
  // plus a tinted point light in the site's colour (teal A, amber B).
  for (const key of Object.keys(SITES)) {
    const s = SITES[key];
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 2.2, 14, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    col.position.set(s.cx, 7, s.cz);
    scene.add(col);
    const glow = new THREE.PointLight(s.color, 30, 26, 1.8);
    glow.position.set(s.cx, 4, s.cz);
    scene.add(glow);
  }

  let bobPhase = 0;
  let lastShotSeen = -1;
  let lastVmWeapon = '';
  const _v = new THREE.Vector3();

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);

  function update(dt) {
    const p = state.players[0];
    const now = state.time;

    // Camera: demo override, spectate, or the player's eyes.
    if (state.demoCam) {
      camera.position.set(state.demoCam.pos.x, state.demoCam.pos.y, state.demoCam.pos.z);
      camera.lookAt(state.demoCam.look.x, state.demoCam.look.y, state.demoCam.look.z);
    } else if (!p.alive && state.spectate >= 0) {
      const t = state.players[state.spectate];
      if (t && t.alive) {
        camera.position.set(t.pos.x, t.pos.y + eyeHeight(t), t.pos.z);
        camera.rotation.set(-t.pitch, -t.yaw, 0);
      }
    } else {
      camera.position.set(p.pos.x, p.pos.y + eyeHeight(p), p.pos.z);
      camera.rotation.set(-p.pitch + p.recoil, -p.yaw, 0);
    }

    // Viewmodel: walk bob, recoil kick, reload dip, muzzle flash.
    const speed = Math.hypot(p.vel.x, p.vel.z);
    bobPhase += dt * (2 + speed * 1.6);
    const bobAmp = Math.min(0.012, speed * 0.002);
    // Swap the barrel shape when the weapon changes (scale, not new geometry).
    if (p.weapon !== lastVmWeapon) {
      lastVmWeapon = p.weapon;
      const [r, len] = VM_BARREL[p.weapon] || VM_BARREL.p9;
      const barrel = viewmodel.userData.barrel;
      barrel.scale.set(r / 0.02, len / 0.3, r / 0.02);
      barrel.position.z = -(0.27 + len / 2);
      viewmodel.userData.flash.position.z = -(0.32 + len);
      viewmodel.scale.setScalar(VM_SCALE[p.weapon] || 0.8);
      viewmodel.userData.stock.visible = p.weapon !== 'p9';
    }
    viewmodel.visible = p.alive && !state.demoCam;
    if (viewmodel.visible) {
      const reloadDip = p.reloadLeft > 0 ? Math.sin(Math.min(1, p.reloadLeft / 0.6) * Math.PI) * 0.25 : 0;
      viewmodel.position.set(
        0.3 + Math.sin(bobPhase) * bobAmp,
        -0.27 + Math.abs(Math.cos(bobPhase)) * bobAmp - reloadDip,
        -0.72 + p.recoil * 1.2,
      );
      viewmodel.rotation.x = p.recoil * 2.2 - reloadDip * 0.8;
      viewmodel.rotation.z = Math.sin(bobPhase) * bobAmp * 0.4;
    }
    const flash = viewmodel.userData.flash;
    if (p.lastShotAt !== lastShotSeen && p.lastShotAt >= 0) {
      lastShotSeen = p.lastShotAt;
      flash.material.opacity = 0.95;
      flash.rotation.z = Math.random() * Math.PI;
      muzzleLight.intensity = 14;
    }
    flash.material.opacity = Math.max(0, flash.material.opacity - dt * 18);
    muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 160);

    // Bots: position, facing, walk bob, death fall.
    for (const e of state.players) {
      if (e.isPlayer) continue;
      const mesh = botMeshes.get(e.id);
      if (!mesh) continue;
      mesh.visible = true;
      mesh.position.set(e.pos.x, e.pos.y, e.pos.z);
      if (e.alive) {
        mesh.rotation.set(0, -e.yaw, 0);
        const moving = Math.hypot(e.vel.x, e.vel.z);
        mesh.position.y = e.pos.y + (moving > 0.5 ? Math.abs(Math.sin(now * 9 + e.id)) * 0.04 : 0);
        mesh.userData.body.scale.y = e.crouched ? 0.82 : 1;
        mesh.userData.head.position.y = e.crouched ? 1.32 : 1.58;
        mesh.userData.pack.position.y = e.crouched ? 1.08 : 1.28;
        mesh.userData.padL.position.y = e.crouched ? 1.24 : 1.44;
        mesh.userData.padR.position.y = e.crouched ? 1.24 : 1.44;
        mesh.userData.stripe.position.y = e.crouched ? 1.0 : 1.18;
        mesh.userData.sprite.visible = true;
        // Muzzle flash when this bot just fired.
        const prevShot = botShotSeen.get(e.id) ?? -1;
        if (e.lastShotAt > prevShot) {
          botShotSeen.set(e.id, e.lastShotAt);
          const f = botFlashes[botFlashIdx];
          botFlashIdx = (botFlashIdx + 1) % botFlashes.length;
          f.sprite.position.set(
            e.pos.x + Math.sin(e.yaw) * 0.7,
            e.pos.y + 1.25,
            e.pos.z - Math.cos(e.yaw) * 0.7,
          );
          f.sprite.visible = true;
          f.until = now + 0.06;
        }
      } else {
        // Fallen: lying flat, fading ring.
        mesh.rotation.set(-Math.PI / 2, -e.yaw, 0);
        mesh.position.y = 0.25;
        mesh.userData.sprite.visible = false;
      }
    }

    // Hide expired bot muzzle flashes.
    for (const f of botFlashes) {
      if (f.sprite.visible && now > f.until) f.sprite.visible = false;
    }

    // Tracers: 3 parallel lines each (main + two offset by 0.035 m
    // perpendicular), so a shot reads as a streak, not a hair.
    const list = state.tracers;
    let n = 0;
    for (let i = 0; i < list.length && n < MAX_TRACERS; i++) {
      const t = list[i];
      if (now > t.until) continue;
      const dx = t.x1 - t.x0, dz = t.z1 - t.z0;
      const dl = Math.hypot(dx, dz) || 1;
      const px = (-dz / dl) * 0.035, pz = (dx / dl) * 0.035;
      const o = n * 18;
      tracerPos[o] = t.x0; tracerPos[o + 1] = t.y0; tracerPos[o + 2] = t.z0;
      tracerPos[o + 3] = t.x1; tracerPos[o + 4] = t.y1; tracerPos[o + 5] = t.z1;
      tracerPos[o + 6] = t.x0 + px; tracerPos[o + 7] = t.y0; tracerPos[o + 8] = t.z0 + pz;
      tracerPos[o + 9] = t.x1 + px; tracerPos[o + 10] = t.y1; tracerPos[o + 11] = t.z1 + pz;
      tracerPos[o + 12] = t.x0 - px; tracerPos[o + 13] = t.y0; tracerPos[o + 14] = t.z0 - pz;
      tracerPos[o + 15] = t.x1 - px; tracerPos[o + 16] = t.y1; tracerPos[o + 17] = t.z1 - pz;
      n++;
    }
    tracerGeo.setDrawRange(0, n * 6);
    tracerGeo.attributes.position.needsUpdate = true;

    // Impact rings: spawn on new impacts, expand and fade.
    for (const imp of state.impacts) {
      if (imp.shown) continue;
      imp.shown = true;
      const ring = rings[ringNext];
      ringNext = (ringNext + 1) % MAX_RINGS;
      ring.mesh.visible = true;
      ring.mesh.position.set(imp.x, imp.y, imp.z);
      ring.mesh.lookAt(camera.position);
      ring.born = now;
      ring.big = !!imp.big;
      // Flesh hits render red, wall hits gold (combat.js sets `color`).
      ring.mesh.material.color.setHex(imp.color || 0xffd27a);
      ring.mesh.material.opacity = 0.9;
      if (imp.big) {
        boom.visible = true;
        boom.position.set(imp.x, imp.y + 0.5, imp.z);
        boom.scale.setScalar(0.5);
        boom.material.opacity = 0.9;
        boomLight.position.set(imp.x, imp.y + 2, imp.z);
        boomLight.intensity = 60;
      }
    }
    for (const ring of rings) {
      if (!ring.mesh.visible) continue;
      const age = now - ring.born;
      const life = ring.big ? 0.7 : 0.3;
      if (age > life) { ring.mesh.visible = false; continue; }
      const s = 1 + age * (ring.big ? 14 : 6);
      ring.mesh.scale.setScalar(s);
      ring.mesh.material.opacity = 0.9 * (1 - age / life);
    }
    if (boom.visible) {
      boom.scale.addScalar(dt * 22);
      boom.material.opacity = Math.max(0, boom.material.opacity - dt * 2.2);
      boomLight.intensity = Math.max(0, boomLight.intensity - dt * 120);
      if (boom.material.opacity <= 0) boom.visible = false;
    }

    // Grenades.
    for (let i = 0; i < grenadeMeshes.length; i++) {
      const g = state.grenades[i];
      const m = grenadeMeshes[i];
      if (g) {
        m.visible = true;
        m.position.set(g.pos.x, g.pos.y, g.pos.z);
      } else {
        m.visible = false;
      }
    }

    // Smoke clouds: pool follows state.smoke, blooming in over 1 s and
    // fading out over the last 2 s of the cloud's life.
    let si = 0;
    for (const c of state.smoke) {
      if (si >= smokeGroups.length) break;
      const s = smokeGroups[si++];
      const age = now - c.born;
      const fadeIn = Math.min(1, age / 1);
      const fadeOut = Math.min(1, Math.max(0, c.until - now) / 2);
      s.mat.opacity = 0.38 * fadeIn * fadeOut;
      s.group.position.set(c.x, 1.1, c.z);
      s.group.scale.setScalar(0.6 + 0.4 * fadeIn);
      s.group.visible = s.mat.opacity > 0.01;
    }
    for (; si < smokeGroups.length; si++) smokeGroups[si].group.visible = false;

    // Bomb.
    const planted = state.bomb.state === 'planted';
    bombGroup.visible = planted;
    if (planted) {
      bombGroup.position.set(state.bomb.pos.x, 0, state.bomb.pos.z);
      const blink = Math.sin(now * (state.bomb.timer < 10 ? 14 : 6)) > 0;
      beacon.material.color.setHex(blink ? 0xff2222 : 0x550000);
      bombLight.intensity = blink ? 6 : 0;
      bombRing.material.opacity = blink ? 0.7 : 0.25;
    }

    // Site light columns stay; nothing else to sync.
    renderer.render(scene, camera);
    _v.set(0, 0, 0);
  }

  return { renderer, scene, camera, update, resize, dom: renderer.domElement };
}
