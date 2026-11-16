// Small pure helpers shared by the sim: seeded RNG, math, collision and
// visibility tests. No three.js here — the sim runs on plain numbers.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Shortest-arc angle difference, in (-PI, PI].
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}
export function turnToward(current, target, maxStep) {
  const d = angleDelta(current, target);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

export function dist2(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

// Circle (x,z,r) vs AABB (x0,z0,x1,z1): push the circle out. Returns true
// when a push happened. Mutates pos in place; no allocation.
export function resolveCircleBox(pos, r, box) {
  const cx = clamp(pos.x, box.x0, box.x1);
  const cz = clamp(pos.z, box.z0, box.z1);
  const dx = pos.x - cx, dz = pos.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    pos.x = cx + (dx / d) * r;
    pos.z = cz + (dz / d) * r;
  } else {
    // Centre inside the box: push out along the smallest penetration.
    const pl = pos.x - box.x0, pr = box.x1 - pos.x;
    const pt = pos.z - box.z0, pb = box.z1 - pos.z;
    const m = Math.min(pl, pr, pt, pb);
    if (m === pl) pos.x = box.x0 - r;
    else if (m === pr) pos.x = box.x1 + r;
    else if (m === pt) pos.z = box.z0 - r;
    else pos.z = box.z1 + r;
  }
  return true;
}

// 2D segment (ax,az)-(bx,bz) vs AABB: true when the segment crosses the box.
// Used for line-of-sight; callers pass only walls tall enough to block sight.
export function segmentHitsBox(ax, az, bx, bz, box) {
  const dx = bx - ax, dz = bz - az;
  let tmin = 0, tmax = 1;
  if (Math.abs(dx) < 1e-9) {
    if (ax < box.x0 || ax > box.x1) return false;
  } else {
    let t1 = (box.x0 - ax) / dx, t2 = (box.x1 - ax) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < box.z0 || az > box.z1) return false;
  } else {
    let t1 = (box.z0 - az) / dz, t2 = (box.z1 - az) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

// 3D ray vs AABB (slab method). Origin o, unit direction d, box with top h.
// Returns the hit distance or Infinity. The box sits on the ground (y 0..h).
export function rayBox(o, d, box) {
  let tmin = 0, tmax = Infinity;
  const axes = [
    [o.x, d.x, box.x0, box.x1],
    [o.y, d.y, 0, box.h],
    [o.z, d.z, box.z0, box.z1],
  ];
  for (let i = 0; i < 3; i++) {
    const [oo, dd, lo, hi] = axes[i];
    if (Math.abs(dd) < 1e-9) {
      if (oo < lo || oo > hi) return Infinity;
    } else {
      let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// Ray vs sphere. Returns hit distance or Infinity.
export function raySphere(o, d, cx, cy, cz, r) {
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

// Breadth-first shortest path over a waypoint graph. nodes: [{x,z}], edges:
// [a,b] pairs. Fills out (a reused array) with node ids from start to goal,
// excluding start, including goal. Returns out.
const _prev = new Int32Array(64);
const _queue = new Int32Array(64);
const _seen = new Uint8Array(64);
export function findPath(nodes, edges, start, goal, out) {
  out.length = 0;
  if (start === goal) return out;
  const n = nodes.length;
  _seen.fill(0, 0, n);
  _prev.fill(-1, 0, n);
  let head = 0, tail = 0;
  _queue[tail++] = start;
  _seen[start] = 1;
  while (head < tail) {
    const cur = _queue[head++];
    if (cur === goal) break;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      let next = -1;
      if (e[0] === cur) next = e[1];
      else if (e[1] === cur) next = e[0];
      else continue;
      if (_seen[next]) continue;
      _seen[next] = 1;
      _prev[next] = cur;
      _queue[tail++] = next;
    }
  }
  if (!_seen[goal]) return out;
  const rev = [];
  let cur = goal;
  while (cur !== start && cur !== -1) {
    rev.push(cur);
    cur = _prev[cur];
  }
  for (let i = rev.length - 1; i >= 0; i--) out.push(rev[i]);
  return out;
}

// Nearest waypoint id to (x,z).
export function nearestWaypoint(nodes, x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const dx = nodes[i].x - x, dz = nodes[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
