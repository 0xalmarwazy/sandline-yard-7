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

function makeViewmodel() {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.6, metalness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.5, metalness: 0.3 });
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.5), dark);
  group.add(receiver);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.34, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.4);
  group.add(barrel);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.1), dark);
  mag.position.set(0, -0.15, -0.05);
  mag.rotation.x = 0.15;
  group.add(mag);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), dark);
  grip.position.set(0, -0.12, 0.18);
  grip.rotation.x = -0.3;
  group.add(grip);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.1), accent);
  sight.position.set(0, 0.1, -0.1);
  group.add(sight);
  // Muzzle flash quad at the barrel tip.
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0, 0.02, -0.62);
  group.add(flash);
  group.userData.flash = flash;
  group.userData.barrel = barrel;
  return group;
}

// Viewmodel barrel shape per weapon: [radius, length]. The vk47 gets a long
// barrel, the m870 a thick one, the p9 a stub — so the gun in your hands
// matches what you bought.
const VM_BARREL = {
  p9: [0.02, 0.26], k9: [0.022, 0.3], m870: [0.04, 0.38], vk47: [0.028, 0.46],
};

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

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 300);
  camera.rotation.order = 'YXZ';

  // Lighting: golden hour — warm low sun, sky/ground bounce, plus a low
  // ambient floor so shadow-side faces stay readable instead of going black.
  const hemi = new THREE.HemisphereLight(0xc3d4e2, 0x8a7a5a, 1.5);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.4);
  sun.position.set(30, 45, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -55;
  sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55;
  sun.shadow.camera.bottom = -55;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0005;
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

  // Viewmodel + muzzle light, parented to the camera.
  const viewmodel = makeViewmodel();
  viewmodel.position.set(0.26, -0.24, -0.55);
  viewmodel.scale.setScalar(0.85);
  camera.add(viewmodel);
  const muzzleLight = new THREE.PointLight(0xffc46b, 0, 9, 1.8);
  muzzleLight.position.set(0.2, -0.1, -0.8);
  camera.add(muzzleLight);
  scene.add(camera);

  // Tracers: one LineSegments, positions rebuilt from state each frame.
  const tracerGeo = new THREE.BufferGeometry();
  const tracerPos = new Float32Array(MAX_TRACERS * 6);
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
  const tracers = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({
    color: 0xffe9a8, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false,
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

  // Bot muzzle flashes: one shared radial-gradient texture, pooled sprites,
  // triggered when a bot's lastShotAt advances.
  const flashTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,220,1)');
    grad.addColorStop(0.4, 'rgba(255,190,80,0.9)');
    grad.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
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

  // Bomb: a small case with a blinking beacon, shown once planted.
  const bombGroup = new THREE.Group();
  const bombCase = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.25, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.5, metalness: 0.5 }),
  );
  bombCase.position.y = 0.13;
  bombGroup.add(bombCase);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2222 }),
  );
  beacon.position.y = 0.32;
  bombGroup.add(beacon);
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
      new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
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
      barrel.scale.set(r / 0.025, len / 0.34, r / 0.025);
      barrel.position.z = -(0.23 + len / 2);
      viewmodel.userData.flash.position.z = -(0.28 + len);
    }
    viewmodel.visible = p.alive && !state.demoCam;
    if (viewmodel.visible) {
      const reloadDip = p.reloadLeft > 0 ? Math.sin(Math.min(1, p.reloadLeft / 0.6) * Math.PI) * 0.25 : 0;
      viewmodel.position.set(
        0.26 + Math.sin(bobPhase) * bobAmp,
        -0.24 + Math.abs(Math.cos(bobPhase)) * bobAmp - reloadDip,
        -0.55 + p.recoil * 1.2,
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

    // Tracers.
    const list = state.tracers;
    let n = 0;
    for (let i = 0; i < list.length && n < MAX_TRACERS; i++) {
      const t = list[i];
      if (now > t.until) continue;
      const o = n * 6;
      tracerPos[o] = t.x0; tracerPos[o + 1] = t.y0; tracerPos[o + 2] = t.z0;
      tracerPos[o + 3] = t.x1; tracerPos[o + 4] = t.y1; tracerPos[o + 5] = t.z1;
      n++;
    }
    tracerGeo.setDrawRange(0, n * 2);
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
    }

    // Site light columns stay; nothing else to sync.
    renderer.render(scene, camera);
    _v.set(0, 0, 0);
  }

  return { renderer, scene, camera, update, resize, dom: renderer.domElement };
}
