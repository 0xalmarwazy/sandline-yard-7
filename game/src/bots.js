// Bot brains: routes, holds, perception (sight + hearing), burst fire and
// objective play. Decisions run at ~8 Hz (think), movement every tick.
// Bots move with the same physics as the player (moveEntity) and shoot with
// the same weapons (stepWeapons) — no separate rules for them.

import { EDGES, HOLD_SPOTS, SITES, WAYPOINTS } from './config.js';
import { hasLineOfSight } from './combat.js';
import { moveEntity } from './player.js';
import { tryThrowGrenade } from './weapons.js';
import { angleDelta, dist2, findPath, nearestWaypoint, turnToward } from './util.js';

const THINK_EVERY = 0.12;
const SEE_DIST = 48;
const HEAR_FALLOFF = 1;

export function initBots(state) {
  for (const e of state.players) {
    if (e.isPlayer) continue;
    e.bot = {
      state: 'route',
      route: [], routeIndex: 0, destWp: -1,
      target: -1, trackTime: 0,
      lastKnown: null,
      holdWp: -1, holdYaw: 0, scanPhase: 0,
      burstUntil: 0, pauseUntil: 0, nextShotAt: 0,
      strafeDir: 1, strafeUntil: 0,
      decideAt: 0, reactAt: 0,
      wantFire: false, wantShot: false,
      site: 'A', lane: 'mid',
      stuckAt: 0, lastX: 0, lastZ: 0,
      throwAt: 0,
    };
  }
}

// Round setup: pick the attackers' target site, give each bot a lane or a
// hold spot, and send them on their way.
export function assignBotPlans(state) {
  const rng = state.rng;
  const site = rng() < 0.5 ? 'A' : 'B';
  const siteWp = site === 'A' ? 4 : 12;
  const lanes = ['west', 'mid', 'east'];
  let laneIdx = 0;
  const defSpots = [...HOLD_SPOTS];
  // Shuffle the hold spots so defenders vary.
  for (let i = defSpots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = defSpots[i]; defSpots[i] = defSpots[j]; defSpots[j] = t;
  }
  let spotIdx = 0;
  for (const e of state.players) {
    if (e.isPlayer || !e.bot) continue;
    const b = e.bot;
    b.target = -1;
    b.lastKnown = null;
    b.state = 'route';
    if (e.team === 'van') {
      b.site = site;
      b.lane = lanes[laneIdx++ % lanes.length];
      b.destWp = siteWp;
      routeTo(state, e, siteWp);
    } else {
      const spot = defSpots[spotIdx++ % defSpots.length];
      b.holdWp = spot.wp;
      b.holdYaw = spot.yaw;
      b.site = spot.site || site;
      b.destWp = spot.wp;
      routeTo(state, e, spot.wp);
    }
  }
  return site;
}

const _path = [];
export function routeTo(state, e, destWp) {
  const b = e.bot;
  const from = nearestWaypoint(WAYPOINTS, e.pos.x, e.pos.z);
  findPath(WAYPOINTS, EDGES, from, destWp, _path);
  b.route.length = 0;
  for (let i = 0; i < _path.length; i++) b.route.push(_path[i]);
  b.routeIndex = 0;
  b.destWp = destWp;
}

function nearestEnemy(state, e) {
  let best = null, bestD = Infinity;
  for (const other of state.players) {
    if (other.team === e.team || !other.alive) continue;
    const d = dist2(e.pos.x, e.pos.z, other.pos.x, other.pos.z);
    if (d < bestD) { bestD = d; best = other; }
  }
  return { enemy: best, dist: bestD };
}

function canSee(state, e, other) {
  const dx = other.pos.x - e.pos.x, dz = other.pos.z - e.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > SEE_DIST) return false;
  const yawTo = Math.atan2(dx, -dz);
  if (Math.abs(angleDelta(e.yaw, yawTo)) > 1.05) return false;
  return hasLineOfSight(e.pos.x, e.pos.z, other.pos.x, other.pos.z);
}

function hearNoise(state, e) {
  for (let i = 0; i < state.noises.length; i++) {
    const n = state.noises[i];
    if (state.time > n.until) continue;
    const d = dist2(e.pos.x, e.pos.z, n.x, n.z);
    if (d < n.radius * HEAR_FALLOFF) return n;
  }
  return null;
}

function think(state, e) {
  const b = e.bot;
  const now = state.time;
  // Perception: nearest visible enemy, or the one that just shot us.
  const { enemy, dist } = nearestEnemy(state, e);
  let seen = null;
  if (enemy && canSee(state, e, enemy)) seen = enemy;
  if (!seen && e.lastDamageAt > now - 1.2 && e.lastDamageFrom >= 0) {
    const shooter = state.players[e.lastDamageFrom];
    if (shooter && shooter.alive && shooter.team !== e.team) {
      b.lastKnown = { x: shooter.pos.x, z: shooter.pos.z, at: now };
    }
  }
  if (seen) {
    if (b.target !== seen.id) {
      b.target = seen.id;
      b.trackTime = 0;
      b.reactAt = now + 0.35 + state.rng() * 0.3;
    }
    b.lastKnown = { x: seen.pos.x, z: seen.pos.z, at: now };
    b.state = 'engage';
    return;
  }
  if (b.target !== -1) {
    // Lost sight: keep hunting the last known position briefly.
    if (b.lastKnown && now - b.lastKnown.at < 3) {
      b.state = 'investigate';
      if (b.destWp !== -2) {
        b.destWp = -2;
        b.route.length = 0;
        b.routeIndex = 0;
      }
      return;
    }
    b.target = -1;
  }

  const bomb = state.bomb;
  if (bomb.state === 'planted') {
    if (e.team === 'jac') {
      b.state = 'defuse';
      const siteWp = bomb.site === 'A' ? 4 : 12;
      if (b.destWp !== siteWp) routeTo(state, e, siteWp);
    } else {
      b.state = 'hold';
      const siteWp = bomb.site === 'A' ? 4 : 12;
      if (b.destWp !== siteWp) routeTo(state, e, siteWp);
    }
    return;
  }

  // Hearing: a fresh noise nearby is worth investigating.
  const noise = hearNoise(state, e);
  if (noise && b.state !== 'investigate') {
    b.lastKnown = { x: noise.x, z: noise.z, at: now };
    b.state = 'investigate';
    b.destWp = -2;
    b.route.length = 0;
    b.routeIndex = 0;
    return;
  }

  // Role behaviour.
  if (e.team === 'van') {
    const site = SITES[b.site];
    const inSite = e.pos.x >= site.x0 && e.pos.x <= site.x1 && e.pos.z >= site.z0 && e.pos.z <= site.z1;
    if (inSite && bomb.state === 'idle') {
      b.state = 'plant';
      return;
    }
    if (b.state !== 'route' || b.routeIndex >= b.route.length) {
      const siteWp = b.site === 'A' ? 4 : 12;
      if (b.destWp !== siteWp || b.routeIndex >= b.route.length) routeTo(state, e, siteWp);
      b.state = 'route';
    }
  } else {
    if (b.state !== 'route' && b.state !== 'hold') b.state = 'route';
    if (b.state === 'route' && b.routeIndex >= b.route.length) {
      b.state = 'hold';
    }
  }
}

function faceToward(e, targetYaw, dt, rate) {
  e.yaw = turnToward(e.yaw, targetYaw, rate * dt);
}

// Steer along the current route. Returns the wish direction.
function routeWish(state, e, out) {
  const b = e.bot;
  out.x = 0; out.z = 0;
  if (b.routeIndex >= b.route.length) return out;
  const wp = WAYPOINTS[b.route[b.routeIndex]];
  const dx = wp.x - e.pos.x, dz = wp.z - e.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1.3) {
    b.routeIndex++;
    return routeWish(state, e, out);
  }
  out.x = dx / d; out.z = dz / d;
  return out;
}

const _wish = { x: 0, z: 0 };

function stepBot(state, e, dt) {
  const b = e.bot;
  const now = state.time;
  if (now >= b.decideAt) {
    b.decideAt = now + THINK_EVERY;
    think(state, e);
  }

  let wishX = 0, wishZ = 0, crouch = false, jump = false;
  b.wantFire = false;

  if (b.state === 'engage' && b.target >= 0) {
    const t = state.players[b.target];
    if (!t || !t.alive) {
      b.target = -1;
      b.state = 'route';
    } else {
      const dx = t.pos.x - e.pos.x, dz = t.pos.z - e.pos.z;
      const d = Math.hypot(dx, dz);
      const yawTo = Math.atan2(dx, -dz);
      faceToward(e, yawTo, dt, 7);
      b.trackTime += dt;
      // Aim error: worse at range, better the longer we track.
      const base = 0.018 + d * 0.0011;
      e.aimErr = base * Math.max(0.35, 1 - b.trackTime * 0.22);
      // Strafe perpendicular to the target, flipping every 0.5–1.1 s.
      if (now >= b.strafeUntil) {
        b.strafeDir = state.rng() < 0.5 ? -1 : 1;
        b.strafeUntil = now + 0.5 + state.rng() * 0.6;
      }
      const px = Math.cos(e.yaw) * b.strafeDir, pz = Math.sin(e.yaw) * b.strafeDir;
      wishX = px * 0.7; wishZ = pz * 0.7;
      // Crouch to steady aim at range.
      crouch = d > 16;
      // Burst fire after the reaction delay.
      if (now >= b.reactAt) {
        if (now >= b.pauseUntil) {
          if (now < b.burstUntil) {
            b.wantFire = true;
          } else {
            b.burstUntil = now + 0.35 + state.rng() * 0.25;
            b.pauseUntil = b.burstUntil + 0.45 + state.rng() * 0.5;
            b.wantFire = true;
          }
        }
        // Semi-auto weapons need trigger pulses.
        if (e.weapon === 'p9' || e.weapon === 'm870') {
          b.wantFire = false;
          if (now >= b.nextShotAt && now < b.burstUntil) {
            b.wantShot = true;
            b.nextShotAt = now + 0.3 + state.rng() * 0.15;
          }
        }
      }
    }
  } else if (b.state === 'plant' || b.state === 'defuse') {
    // Stand still and channel; round.js advances the progress. Face the
    // site centre (plant) or the bomb (defuse).
    if (b.state === 'defuse' && state.bomb.state === 'planted') {
      const dx = state.bomb.pos.x - e.pos.x, dz = state.bomb.pos.z - e.pos.z;
      if (Math.hypot(dx, dz) > 2.2) {
        wishX = dx / Math.hypot(dx, dz); wishZ = dz / Math.hypot(dx, dz);
      }
      faceToward(e, Math.atan2(dx, -dz), dt, 6);
    } else {
      const site = SITES[b.site];
      faceToward(e, Math.atan2(site.cx - e.pos.x, -(site.cz - e.pos.z)), dt, 4);
    }
    crouch = true;
  } else if (b.state === 'hold') {
    // Scan a slow arc around the hold yaw; crouch to hold the angle.
    b.scanPhase += dt * 0.5;
    const sweep = Math.sin(b.scanPhase) * 0.55;
    faceToward(e, b.holdYaw + sweep, dt, 2.5);
    crouch = true;
    // Drift to the hold waypoint if we are not there yet.
    if (b.holdWp >= 0) {
      const wp = WAYPOINTS[b.holdWp];
      const d = dist2(e.pos.x, e.pos.z, wp.x, wp.z);
      if (d > 1.5) {
        if (b.routeIndex >= b.route.length) routeTo(state, e, b.holdWp);
        routeWish(state, e, _wish);
        wishX = _wish.x; wishZ = _wish.z;
      }
    }
  } else if (b.state === 'investigate' && b.lastKnown) {
    const dx = b.lastKnown.x - e.pos.x, dz = b.lastKnown.z - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 2) {
      b.lastKnown = null;
      b.state = e.team === 'van' ? 'route' : 'hold';
      if (e.team === 'jac') {
        b.holdWp = nearestWaypoint(WAYPOINTS, e.pos.x, e.pos.z);
        routeTo(state, e, b.holdWp);
      }
    } else {
      // Walk straight at it when close, else route via waypoints.
      if (hasLineOfSight(e.pos.x, e.pos.z, b.lastKnown.x, b.lastKnown.z)) {
        wishX = dx / d; wishZ = dz / d;
        faceToward(e, Math.atan2(dx, -dz), dt, 5);
      } else {
        const dest = nearestWaypoint(WAYPOINTS, b.lastKnown.x, b.lastKnown.z);
        if (b.destWp !== dest) routeTo(state, e, dest);
        routeWish(state, e, _wish);
        wishX = _wish.x; wishZ = _wish.z;
        if (wishX !== 0 || wishZ !== 0) faceToward(e, Math.atan2(wishX, -wishZ), dt, 5);
      }
    }
  } else {
    // Route: follow the waypoint list, facing where we walk.
    routeWish(state, e, _wish);
    wishX = _wish.x; wishZ = _wish.z;
    if (wishX !== 0 || wishZ !== 0) faceToward(e, Math.atan2(wishX, -wishZ), dt, 6);
  }

  // Stuck check: barely moved in 2.5 s while trying to walk.
  if (wishX !== 0 || wishZ !== 0) {
    if (now - b.stuckAt > 2.5) {
      const moved = dist2(e.pos.x, e.pos.z, b.lastX, b.lastZ);
      if (moved < 0.5) {
        // Re-path from here and sidestep once to unstick.
        if (b.destWp >= 0) routeTo(state, e, b.destWp);
        const tx = wishX; wishX = -wishZ; wishZ = tx;
      }
      b.stuckAt = now;
      b.lastX = e.pos.x; b.lastZ = e.pos.z;
    }
  }

  // Opportunistic grenade: a known enemy behind cover, 8–20 m away.
  if (e.grenades > 0 && b.lastKnown && now >= b.throwAt && b.state !== 'engage') {
    const d = dist2(e.pos.x, e.pos.z, b.lastKnown.x, b.lastKnown.z);
    if (d > 8 && d < 20 && !hasLineOfSight(e.pos.x, e.pos.z, b.lastKnown.x, b.lastKnown.z)) {
      e.yaw = Math.atan2(b.lastKnown.x - e.pos.x, -(b.lastKnown.z - e.pos.z));
      e.pitch = -0.55;
      if (tryThrowGrenade(state, e)) b.throwAt = now + 8;
    }
  }

  moveEntity(state, e, wishX, wishZ, crouch, jump, dt);
}

export function stepBots(state, dt) {
  for (const e of state.players) {
    if (e.isPlayer || !e.alive || !e.bot) continue;
    stepBot(state, e, dt);
  }
}
