// Map rendering: turns the config's wall boxes into three.js geometry,
// plus the ground, site markings, barrels and the skyline. All textures are
// generated on canvas at runtime — the game ships no image assets.

import * as THREE from 'three';
import { PALETTE, SITES, WALLS } from './config.js';

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#c2a878';
  g.fillRect(0, 0, 512, 512);
  // Sand speckle.
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
    g.fillRect(x, y, 2, 2);
  }
  // Paving seams every 64 px.
  g.strokeStyle = 'rgba(0,0,0,0.10)';
  g.lineWidth = 2;
  for (let i = 0; i <= 512; i += 64) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 7);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function letterTexture(letter, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = color;
  g.lineWidth = 10;
  g.strokeRect(14, 14, 228, 228);
  g.fillStyle = color;
  g.font = '900 150px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 128, 136);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function hazardTexture(color) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1c1e22';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = color;
  for (let i = -128; i < 256; i += 32) {
    g.beginPath();
    g.moveTo(i, 128); g.lineTo(i + 16, 128); g.lineTo(i + 16 + 128, 0); g.lineTo(i + 128, 0);
    g.closePath(); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Concrete: speckle + panel seams on the wall colour, drawn once and
// re-tiled per wall size through cached materials (repeat bucketed so a
// 90 m perimeter wall and a 2 m pillar share a handful of textures).
function concreteCanvas() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#62686f';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)';
    g.fillRect(x, y, 2, 2);
  }
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 3;
  for (let i = 0; i <= 256; i += 128) {
    g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
  }
  return c;
}

// Container ribs: light-grey vertical corrugation; the material colour
// tints it teal or amber (colour multiplies the map).
function ribCanvas() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#c8c8c8';
  g.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 16) {
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(x, 0, 4, 128);
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.fillRect(x + 8, 0, 4, 128);
  }
  return c;
}

function signTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1c1e22';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.strokeRect(8, 8, 496, 112);
  g.fillStyle = color;
  g.font = '900 64px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildMap(scene) {
  const group = new THREE.Group();
  group.name = 'map';

  const mats = {
    wall: new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.95 }),
    wallTop: new THREE.MeshStandardMaterial({ color: PALETTE.wallTop, roughness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: PALETTE.wallDark, roughness: 0.95 }),
    crate: new THREE.MeshStandardMaterial({ color: PALETTE.crate, roughness: 0.9 }),
    containerA: new THREE.MeshStandardMaterial({ color: PALETTE.containerA, roughness: 0.7, metalness: 0.25 }),
    containerB: new THREE.MeshStandardMaterial({ color: PALETTE.containerB, roughness: 0.7, metalness: 0.25 }),
  };

  // Textured wall/container materials, cached by repeat bucket. Walls get
  // the concrete canvas (colour baked in); containers get the rib canvas
  // tinted by their palette colour.
  const concrete = concreteCanvas();
  const ribs = ribCanvas();
  const texCache = new Map();
  function tiledMaterial(canvas, rx, ry, color) {
    const key = `${canvas.width}-${rx}x${ry}-${color}`;
    if (!texCache.has(key)) {
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(rx, ry);
      tex.colorSpace = THREE.SRGBColorSpace;
      texCache.set(key, new THREE.MeshStandardMaterial({ map: tex, color, roughness: 0.9 }));
    }
    return texCache.get(key);
  }
  function wallMatFor(w, sx, sz) {
    if (w.kind === 'containerA' || w.kind === 'containerB') {
      const color = w.kind === 'containerA' ? PALETTE.containerA : PALETTE.containerB;
      return tiledMaterial(ribs, Math.max(1, Math.round(sx / 2)), 1, color);
    }
    if (w.kind === 'wall') {
      return tiledMaterial(concrete, Math.max(1, Math.round(Math.max(sx, sz) / 6)), Math.max(1, Math.round(w.h / 3)), 0xffffff);
    }
    return mats[w.kind] || mats.wall;
  }

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 70),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Apron outside the walls so the horizon is not void.
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: PALETTE.groundDark, roughness: 1 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.05;
  group.add(apron);

  // Walls, crates, containers: one box per config entry, top face trimmed.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const w of WALLS) {
    const sx = w.x1 - w.x0, sz = w.z1 - w.z0;
    const mesh = new THREE.Mesh(boxGeo, wallMatFor(w, sx, sz));
    mesh.scale.set(sx, w.h, sz);
    mesh.position.set((w.x0 + w.x1) / 2, w.h / 2, (w.z0 + w.z1) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (w.kind === 'wall' && w.h >= 3.4) {
      const trim = new THREE.Mesh(boxGeo, mats.wallTop);
      trim.scale.set(sx + 0.08, 0.12, sz + 0.08);
      trim.position.set((w.x0 + w.x1) / 2, w.h + 0.06, (w.z0 + w.z1) / 2);
      group.add(trim);
    }
    if (w.kind === 'crate') {
      // A darker lid line so crates read as stacked boxes.
      const lid = new THREE.Mesh(boxGeo, mats.crate);
      lid.scale.set(sx * 0.92, 0.08, sz * 0.92);
      lid.position.set((w.x0 + w.x1) / 2, w.h - 0.04, (w.z0 + w.z1) / 2);
      group.add(lid);
    }
  }

  // Signage: the yard's name on the mid-doors wall (both faces) and a
  // site sign on each hut, in the site's colour.
  function addSign(text, color, w, h, x, y, z, rotY) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: signTexture(text, color) }),
    );
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    group.add(m);
  }
  addSign('YARD 7', '#f0a830', 5.5, 1.4, -4.5, 2.2, 5.06, 0);
  addSign('YARD 7', '#f0a830', 5.5, 1.4, 4.5, 2.2, 5.06, 0);
  addSign('YARD 7', '#f0a830', 5.5, 1.4, -4.5, 2.2, 3.94, Math.PI);
  addSign('YARD 7', '#f0a830', 5.5, 1.4, 4.5, 2.2, 3.94, Math.PI);
  addSign('WAREHOUSE A', '#2dd4bf', 2.8, 0.7, -30.94, 1.9, -26.5, Math.PI / 2);
  addSign('DEPOT B', '#f59e0b', 2.8, 0.7, 30.94, 1.9, -26.5, -Math.PI / 2);

  // Stacked containers: a second box on top of four ground containers.
  // Visual only — collision is unchanged, so bot navigation is
  // unaffected (bullets pass through the top box, as with barrels).
  const stackMatA = tiledMaterial(ribs, 2, 1, PALETTE.containerA);
  const stackMatB = tiledMaterial(ribs, 2, 1, PALETTE.containerB);
  for (const [x, z, mat] of [[-26, -29.75, stackMatA], [26, -29.75, stackMatB], [8, 15.25, stackMatA], [-8, -14.75, stackMatB]]) {
    const m = new THREE.Mesh(boxGeo, mat);
    m.scale.set(4, 2.6, 2.5);
    m.position.set(x, 2.6 + 1.3, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  // Bomb sites: a letter decal and a hazard border on the ground.
  for (const key of Object.keys(SITES)) {
    const s = SITES[key];
    const hex = `#${s.color.toString(16).padStart(6, '0')}`;
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshBasicMaterial({ map: letterTexture(s.id, hex), transparent: true, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(s.cx, 0.02, s.cz);
    group.add(decal);
    const borderMat = new THREE.MeshBasicMaterial({ map: hazardTexture(hex), transparent: true, opacity: 0.85 });
    const w = s.x1 - s.x0, d = s.z1 - s.z0;
    const mkBorder = (bw, bd, bx, bz) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(bw, bd), borderMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(bx, 0.015, bz);
      group.add(m);
    };
    mkBorder(w, 0.7, s.cx, s.z0 + 0.35);
    mkBorder(w, 0.7, s.cx, s.z1 - 0.35);
    mkBorder(0.7, d, s.x0 + 0.35, s.cz);
    mkBorder(0.7, d, s.x1 - 0.35, s.cz);
  }

  // Barrels: visual cover dressing near lanes (no collision: flush
  // against walls or in spots the waypoints avoid).
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.05, 12);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x7a2e2e, roughness: 0.8, metalness: 0.2 });
  const barrelMat2 = new THREE.MeshStandardMaterial({ color: 0x2e5a7a, roughness: 0.8, metalness: 0.2 });
  const barrels = [
    [-42, -12, 0], [-42, -10.8, 1], [42, 10, 1], [42, 11.2, 0],
    [-12, 30, 0], [14, 30, 1], [-14, -30, 1], [12, -30, 0],
    [-6, 26, 1], [8, -26, 0],
    [6, -8, 0], [-6, -8, 1], [5, 15, 1], [-5, 15, 0],
  ];
  for (const [x, z, v] of barrels) {
    const b = new THREE.Mesh(barrelGeo, v === 0 ? barrelMat : barrelMat2);
    b.position.set(x, 0.52, z);
    b.castShadow = true;
    group.add(b);
  }

  // Ground markings: painted arrows at lane entries, tyre tracks along
  // mid, oil stains near containers. Flat decals, no collision.
  function arrowTexture() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(240,168,48,0.75)';
    g.beginPath();
    g.moveTo(64, 12); g.lineTo(104, 72); g.lineTo(80, 72); g.lineTo(80, 116);
    g.lineTo(48, 116); g.lineTo(48, 72); g.lineTo(24, 72);
    g.closePath(); g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const arrowMat = new THREE.MeshBasicMaterial({ map: arrowTexture(), transparent: true, depthWrite: false });
  for (const [x, z] of [[0, 22], [-38, 6], [38, 6]]) {
    const a = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), arrowMat);
    a.rotation.x = -Math.PI / 2;
    a.position.set(x, 0.02, z);
    group.add(a);
  }
  const trackMat = new THREE.MeshBasicMaterial({ color: 0x3a2f1e, transparent: true, opacity: 0.16, depthWrite: false });
  for (const [x, z, len] of [[-1.4, 10, 14], [1.4, 10, 14], [-38.6, -2, 12], [-37.4, -2, 12]]) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(1.1, len), trackMat);
    t.rotation.x = -Math.PI / 2;
    t.position.set(x, 0.018, z);
    group.add(t);
  }
  const stainMat = new THREE.MeshBasicMaterial({ color: 0x1a140c, transparent: true, opacity: 0.28, depthWrite: false });
  for (const [x, z, r] of [[-26, -27, 1.1], [8, 14, 0.9], [26, -28, 1.2], [0, 0, 0.8]]) {
    const s = new THREE.Mesh(new THREE.CircleGeometry(r, 20), stainMat);
    s.rotation.x = -Math.PI / 2;
    s.position.set(x, 0.018, z);
    group.add(s);
  }

  // More dressing: pallets, sandbag rows, tyre stacks. Visual only —
  // flush to walls or clear of the waypoint lines.
  const palletMat = new THREE.MeshStandardMaterial({ color: 0x7d6242, roughness: 0.95 });
  for (const [x, z, ry] of [[-42, 28, 0.4], [42, -8, -0.3], [-8, -32, 0.1]]) {
    const p = new THREE.Mesh(boxGeo, palletMat);
    p.scale.set(1.3, 0.16, 1.1);
    p.position.set(x, 0.08, z);
    p.rotation.y = ry;
    p.castShadow = true;
    group.add(p);
    const load = new THREE.Mesh(boxGeo, mats.crate);
    load.scale.set(1.0, 0.55, 0.85);
    load.position.set(x, 0.44, z);
    load.rotation.y = ry;
    load.castShadow = true;
    group.add(load);
  }
  const sandMat = new THREE.MeshStandardMaterial({ color: 0x6e6248, roughness: 1 });
  for (const [x, z, ry] of [[2.5, 8, 0], [-2.5, -12, 0], [36, -14, Math.PI / 2]]) {
    const s = new THREE.Mesh(boxGeo, sandMat);
    s.scale.set(2.4, 0.55, 0.5);
    s.position.set(x, 0.28, z);
    s.rotation.y = ry;
    s.castShadow = true;
    group.add(s);
  }
  const tyreGeo = new THREE.TorusGeometry(0.34, 0.15, 8, 18);
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x1e1e22, roughness: 0.95 });
  for (const [x, z] of [[-40, -32], [40, 28]]) {
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Mesh(tyreGeo, tyreMat);
      t.rotation.x = Math.PI / 2;
      t.position.set(x, 0.16 + i * 0.3, z);
      t.castShadow = true;
      group.add(t);
    }
  }

  // Skyline: dark slabs outside the walls for depth at a glance.
  const skyMat = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 1 });
  const skyline = [
    [-60, -20, 18, 14], [-30, -55, 24, 20], [10, -58, 16, 11],
    [55, -30, 20, 16], [62, 15, 14, 22], [-62, 25, 16, 12],
    [-20, 55, 30, 9], [35, 52, 18, 13],
  ];
  for (const [x, z, w, h] of skyline) {
    const m = new THREE.Mesh(boxGeo, skyMat);
    m.scale.set(w, h, 8);
    m.position.set(x, h / 2 - 0.1, z);
    group.add(m);
  }

  // Tower cranes: a mast, a jib and a counter-jib each, silhouetted
  // against the sky outside the arena.
  const craneMat = new THREE.MeshStandardMaterial({ color: 0x3a3e45, roughness: 0.9 });
  for (const [x, z, rotY] of [[-58, -45, 0.5], [58, 42, -0.9]]) {
    const crane = new THREE.Group();
    const mast = new THREE.Mesh(boxGeo, craneMat);
    mast.scale.set(1.2, 20, 1.2);
    mast.position.y = 10;
    crane.add(mast);
    const jib = new THREE.Mesh(boxGeo, craneMat);
    jib.scale.set(14, 0.8, 0.8);
    jib.position.set(3.5, 19.5, 0);
    crane.add(jib);
    const counter = new THREE.Mesh(boxGeo, craneMat);
    counter.scale.set(5, 0.8, 0.8);
    counter.position.set(-4.5, 19.5, 0);
    crane.add(counter);
    const cable = new THREE.Mesh(boxGeo, craneMat);
    cable.scale.set(0.12, 6, 0.12);
    cable.position.set(9, 16.5, 0);
    crane.add(cable);
    crane.position.set(x, 0, z);
    crane.rotation.y = rotY;
    group.add(crane);
  }

  scene.add(group);
  return group;
}
