// Weapons: fire timing, reload, spread, recoil. This module decides
// WHEN a shot happens and WHERE it goes; combat.js decides WHAT it
// hits. Shots go through the onShot callback main.js wires up, so
// this module never imports combat.js (no import cycle).

import { GRENADE, SMOKE, WEAPONS } from './config.js';
import { speedFraction } from './player.js';
import { callout } from './tactics.js';

// Current spread in radians: base + movement penalty + bloom.
// Crouching and standing still are rewarded; spraying is not.
export function spreadFor(e, def) {
  const move = speedFraction(e);
  const crouchBonus = e.crouched ? 0.6 : 1;
  return (def.spread + def.moveSpread * move + e.bloom + e.aimErr) * crouchBonus;
}

// Aim direction from yaw/pitch plus recoil kick and a random cone
// offset. Writes into out ({x,y,z}); no allocation.
export function aimDirection(e, spread, rng, out) {
  const pitch = e.pitch - e.recoil; // recoil kicks the muzzle up
  const cy = Math.cos(pitch);
  const dx = Math.sin(e.yaw) * cy;
  const dy = -Math.sin(pitch);
  const dz = -Math.cos(e.yaw) * cy;
  // Random point in a disc of radius `spread`, applied to the direction.
  const a = rng() * Math.PI * 2;
  const r = spread * Math.sqrt(rng());
  // Right vector and up vector for the yaw (pitch ignored for the offset).
  const rx = Math.cos(e.yaw), rz = Math.sin(e.yaw);
  out.x = dx + rx * Math.cos(a) * r;
  out.y = dy + Math.sin(a) * r;
  out.z = dz + rz * Math.cos(a) * r;
  const len = Math.hypot(out.x, out.y, out.z);
  out.x /= len; out.y /= len; out.z /= len;
  return out;
}

const _dir = { x: 0, y: 0, z: 0 };

function startReload(state, e) {
  const def = WEAPONS[e.weapon];
  if (e.reloadLeft > 0) return;
  if (e.mag[e.weapon] >= def.mag) return;
  if (e.reserve[e.weapon] <= 0) return;
  e.reloadLeft = def.reload;
  if (e.isPlayer) state.audioHook('reload');
}

function finishReload(e) {
  const def = WEAPONS[e.weapon];
  const need = def.mag - e.mag[e.weapon];
  const take = Math.min(need, e.reserve[e.weapon]);
  e.mag[e.weapon] += take;
  e.reserve[e.weapon] -= take;
}

function fireOne(state, e, def, onShot) {
  e.mag[e.weapon]--;
  e.cooldown = 60 / def.rpm;
  e.bloom = Math.min(e.bloom + def.recoil * 0.55, 0.06);
  e.recoil = Math.min(e.recoil + def.recoil, 0.11);
  e.lastShotAt = state.time;
  const spread = spreadFor(e, def);
  for (let p = 0; p < def.pellets; p++) {
    aimDirection(e, spread, state.rng, _dir);
    onShot(e, def, _dir);
  }
  if (e.isPlayer) {
    state.stats.shots += def.pellets;
    state.audioHook('shoot', def.id);
  }
  // Every shot is heard: bots within earshot investigate.
  state.noises.push({ x: e.pos.x, z: e.pos.z, radius: 26, until: state.time + 0.6 });
}

// Per-tick weapon update for every living entity. Bots signal via
// bot.wantFire (held trigger) and bot.wantShot (one pull).
export function stepWeapons(state, dt, onShot) {
  for (const e of state.players) {
    if (!e.alive) continue;
    e.cooldown = Math.max(0, e.cooldown - dt);
    e.bloom = Math.max(0, e.bloom - dt * 0.05);
    if (e.reloadLeft > 0) {
      e.reloadLeft -= dt;
      if (e.reloadLeft <= 0) finishReload(e);
      continue;
    }
    const def = WEAPONS[e.weapon];
    const input = state.input;
    let held = false, pulse = false;
    if (e.isPlayer) {
      held = input.fire;
      pulse = input.firePressed;
      if (input.reload) startReload(state, e);
      if (e.mag[e.weapon] === 0 && pulse && e.reserve[e.weapon] > 0) startReload(state, e);
      if (e.mag[e.weapon] === 0 && pulse) state.audioHook('dry');
    } else if (e.bot) {
      held = e.bot.wantFire;
      pulse = e.bot.wantShot;
      e.bot.wantShot = false;
      // Bots reload the moment the mag runs dry — and say so, so the
      // team knows who is out of the fight for two seconds.
      if (e.mag[e.weapon] === 0 && e.reloadLeft <= 0) {
        startReload(state, e);
        if (e.reloadLeft > 0) callout(state, e, 'reload');
      }
    }
    const want = def.auto ? held : pulse;
    if (want && e.cooldown <= 0 && e.mag[e.weapon] > 0) {
      fireOne(state, e, def, onShot);
    }
  }
}

// Throw a grenade along the entity's aim: 'frag' (damage) or 'smoke'
// (a sight-blocking cloud, see combat.js). False when the entity has
// none left or is mid-reload.
export function tryThrowGrenade(state, e, type = 'frag') {
  const def = type === 'smoke' ? SMOKE : GRENADE;
  if (type === 'smoke') {
    if (e.smokes <= 0 || e.reloadLeft > 0) return false;
    e.smokes--;
  } else {
    if (e.grenades <= 0 || e.reloadLeft > 0) return false;
    e.grenades--;
  }
  e.cooldown = Math.max(e.cooldown, 0.5);
  const pitch = e.pitch - e.recoil;
  const cy = Math.cos(pitch);
  const dir = { x: Math.sin(e.yaw) * cy, y: -Math.sin(pitch), z: -Math.cos(e.yaw) * cy };
  state.grenades.push({
    owner: e.id,
    kind: type,
    pos: { x: e.pos.x + dir.x * 0.5, y: e.pos.y + 1.4, z: e.pos.z + dir.z * 0.5 },
    vel: {
      x: dir.x * 13 + e.vel.x,
      y: dir.y * 13 + 3.5,
      z: dir.z * 13 + e.vel.z,
    },
    fuse: def.fuse,
  });
  if (e.isPlayer) state.audioHook('throw');
  return true;
}
