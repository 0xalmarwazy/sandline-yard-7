// Combat: hitscan raycasts, damage, grenades and explosions.
// Bodies are two spheres (torso + head) so headshots fall out of the same
// ray test as body hits. Walls are tested first: a wall always wins.

import { ECON, GRENADE, WALLS } from './config.js';
import { eyePos } from './player.js';
import { pushFeed } from './state.js';
import { rayBox, raySphere, segmentHitsBox } from './util.js';

const _origin = { x: 0, y: 0, z: 0 };
const _dir = { x: 0, y: 0, z: 0 };

// Cast one hitscan pellet from shooter's eye along dir. Returns a hit record
// reused across calls (callers read it before the next cast).
const _hit = { entity: null, head: false, dist: 0, x: 0, y: 0, z: 0 };
export function raycastShot(state, shooter, dir, maxRange) {
  eyePos(shooter, _origin);
  _dir.x = dir.x; _dir.y = dir.y; _dir.z = dir.z;
  let best = maxRange;
  let hitWall = true;
  for (let i = 0; i < WALLS.length; i++) {
    const t = rayBox(_origin, _dir, WALLS[i]);
    if (t < best) best = t;
  }
  // Ground plane.
  if (_dir.y < -1e-6) {
    const t = -_origin.y / _dir.y;
    if (t >= 0 && t < best) best = t;
  }
  let hitEntity = null, hitHead = false;
  for (const e of state.players) {
    if (e === shooter || !e.alive) continue;
    const crouch = e.crouched ? 0.45 : 0;
    // Head sphere, then torso sphere.
    const headT = raySphere(_origin, _dir, e.pos.x, e.pos.y + 1.55 - crouch, e.pos.z, 0.26);
    const bodyT = raySphere(_origin, _dir, e.pos.x, e.pos.y + 0.95 - crouch * 0.5, e.pos.z, 0.46);
    const t = Math.min(headT, bodyT);
    if (t < best) {
      best = t;
      hitEntity = e;
      hitHead = headT <= bodyT;
      hitWall = false;
    }
  }
  _hit.entity = hitEntity;
  _hit.head = hitHead;
  _hit.dist = best;
  _hit.x = _origin.x + _dir.x * best;
  _hit.y = Math.max(0.02, _origin.y + _dir.y * best);
  _hit.z = _origin.z + _dir.z * best;
  _hit.wall = hitWall;
  return _hit;
}

// The shot callback main.js wires into stepWeapons: one pellet, one ray.
export function resolveShot(state, shooter, def, dir) {
  const hit = raycastShot(state, shooter, dir, def.range);
  // Tracer from the muzzle to the hit point (renderer fades it).
  state.tracers.push({
    x0: shooter.pos.x, y0: shooter.pos.y + 1.35, z0: shooter.pos.z,
    x1: hit.x, y1: hit.y, z1: hit.z, until: state.time + 0.06,
    team: shooter.team,
  });
  if (state.tracers.length > 64) state.tracers.shift();
  if (hit.entity) {
    const dmg = def.damage * (hit.head ? def.headMult : 1);
    if (shooter.isPlayer) {
      state.stats.hits++;
      if (hit.head) state.stats.headshots++;
      state.audioHook(hit.head ? 'headshot' : 'hit');
    }
    applyDamage(state, hit.entity, dmg, shooter, hit.head);
  } else if (hit.wall && hit.dist < def.range) {
    state.impacts.push({ x: hit.x, y: hit.y, z: hit.z, until: state.time + 0.25 });
    if (state.impacts.length > 32) state.impacts.shift();
  }
}

export function applyDamage(state, target, amount, attacker, head) {
  if (!target.alive) return;
  target.health -= amount;
  target.lastDamageAt = state.time;
  if (attacker) {
    target.lastDamageFrom = attacker.id;
    if (target.isPlayer) {
      const dx = attacker.pos.x - target.pos.x;
      const dz = attacker.pos.z - target.pos.z;
      state.damageFromYaw = Math.atan2(dx, -dz);
      state.damageFlash = 1;
    }
  }
  if (target.health <= 0) {
    target.health = 0;
    target.alive = false;
    target.deaths++;
    if (state.bomb.channeler === target.id) state.bomb.channeler = -1;
    if (attacker && attacker !== target) {
      attacker.kills++;
      if (attacker.isPlayer) {
        state.money = Math.min(state.money + ECON.killBonus, ECON.maxMoney);
      }
      pushFeed(state, `${attacker.name}  ▸  ${target.name}${head ? '  ◉' : ''}`, attacker.team);
    } else {
      pushFeed(state, `${target.name} died`, target.team);
    }
    if (target.isPlayer) {
      state.audioHook('death');
      // Spectate the first living teammate.
      state.spectate = -1;
      for (const e of state.players) {
        if (e.team === target.team && e.alive && !e.isPlayer) { state.spectate = e.id; break; }
      }
    }
    if (attacker && attacker.isPlayer) state.audioHook('kill');
  }
}

// Grenade physics: gravity, ground bounce, fuse, radial damage with falloff
// and a wall check so cover actually protects.
export function stepGrenades(state, dt) {
  const list = state.grenades;
  for (let i = list.length - 1; i >= 0; i--) {
    const g = list[i];
    g.fuse -= dt;
    g.vel.y -= 14.5 * dt;
    g.pos.x += g.vel.x * dt;
    g.pos.y += g.vel.y * dt;
    g.pos.z += g.vel.z * dt;
    if (g.pos.y < 0.12) {
      g.pos.y = 0.12;
      g.vel.y = Math.abs(g.vel.y) * 0.4;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
    }
    for (let w = 0; w < WALLS.length; w++) {
      const b = WALLS[w];
      if (g.pos.x > b.x0 && g.pos.x < b.x1 && g.pos.z > b.z0 && g.pos.z < b.z1 && g.pos.y < b.h) {
        // Simple bounce: reverse the smaller penetration axis.
        const pl = g.pos.x - b.x0, pr = b.x1 - g.pos.x;
        const pt = g.pos.z - b.z0, pb = b.z1 - g.pos.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl || m === pr) g.vel.x *= -0.4;
        else g.vel.z *= -0.4;
        g.pos.x += g.vel.x * dt;
        g.pos.z += g.vel.z * dt;
      }
    }
    if (g.fuse <= 0) {
      explodeGrenade(state, g);
      list.splice(i, 1);
    }
  }
}

function explodeGrenade(state, g) {
  const owner = state.players[g.owner];
  state.impacts.push({ x: g.pos.x, y: 0.4, z: g.pos.z, until: state.time + 0.5, big: true });
  state.audioHook('explosion', g.pos);
  state.noises.push({ x: g.pos.x, z: g.pos.z, radius: 40, until: state.time + 0.8 });
  for (const e of state.players) {
    if (!e.alive) continue;
    const dx = e.pos.x - g.pos.x, dz = e.pos.z - g.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > GRENADE.radius) continue;
    // Cover check: a tall wall between the blast and the body halves damage.
    let blocked = false;
    for (let w = 0; w < WALLS.length; w++) {
      const b = WALLS[w];
      if (b.h < 1.35) continue;
      if (segmentHitsBox(g.pos.x, g.pos.z, e.pos.x, e.pos.z, b)) { blocked = true; break; }
    }
    const falloff = 1 - (d / GRENADE.radius) * 0.7;
    const dmg = GRENADE.damage * falloff * (blocked ? 0.4 : 1);
    applyDamage(state, e, dmg, owner, false);
  }
}

// Line of sight between two points: any tall wall on the segment blocks it.
export function hasLineOfSight(ax, az, bx, bz) {
  for (let i = 0; i < WALLS.length; i++) {
    const b = WALLS[i];
    if (b.h < 1.35) continue;
    if (segmentHitsBox(ax, az, bx, bz, b)) return false;
  }
  return true;
}
