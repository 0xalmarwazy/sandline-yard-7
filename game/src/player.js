// Movement: acceleration, friction, crouch, jump and AABB collision.
// One step function serves the player and the bots alike, so both move by
// the same rules. Yaw 0 faces north (-z); forward = (sin yaw, -cos yaw).

import { MOVE, WALLS, WEAPON_ORDER } from './config.js';
import { clamp, resolveCircleBox } from './util.js';

const LOOK_SENS = 0.0023;
const PITCH_MAX = 1.45;

// Move an entity by its wish direction (unit XZ, may be zero length).
// Acceleration-based: speed builds over ~0.15 s, friction stops it fast.
// Collision slides along walls: x and z are integrated separately.
export function moveEntity(state, e, wishX, wishZ, wantCrouch, wantJump, dt) {
  e.crouched = wantCrouch;
  const maxSpeed = e.crouched ? MOVE.crouch : MOVE.walk;
  const accel = e.onGround ? MOVE.accel : MOVE.airAccel;

  if (wishX !== 0 || wishZ !== 0) {
    const len = Math.hypot(wishX, wishZ);
    const nx = wishX / len, nz = wishZ / len;
    e.vel.x += nx * accel * dt;
    e.vel.z += nz * accel * dt;
    const speed = Math.hypot(e.vel.x, e.vel.z);
    if (speed > maxSpeed) {
      e.vel.x = (e.vel.x / speed) * maxSpeed;
      e.vel.z = (e.vel.z / speed) * maxSpeed;
    }
  } else if (e.onGround) {
    const f = Math.max(0, 1 - MOVE.friction * dt);
    e.vel.x *= f;
    e.vel.z *= f;
    if (Math.hypot(e.vel.x, e.vel.z) < 0.02) { e.vel.x = 0; e.vel.z = 0; }
  }

  if (wantJump && e.onGround) {
    e.vel.y = MOVE.jumpVel;
    e.onGround = false;
  }
  e.vel.y -= MOVE.gravity * dt;

  // Integrate one axis at a time so a wall blocks only that axis (slide).
  e.pos.x += e.vel.x * dt;
  collide(e);
  e.pos.z += e.vel.z * dt;
  collide(e);
  e.pos.y += e.vel.y * dt;
  if (e.pos.y <= 0) {
    e.pos.y = 0;
    e.vel.y = 0;
    e.onGround = true;
  }
  // Keep everyone inside the arena even if a wall is missed.
  e.pos.x = clamp(e.pos.x, -44.5, 44.5);
  e.pos.z = clamp(e.pos.z, -34.5, 34.5);
}

function collide(e) {
  for (let i = 0; i < WALLS.length; i++) {
    resolveCircleBox(e.pos, MOVE.radius, WALLS[i]);
  }
}

export function eyeHeight(e) {
  return e.crouched ? MOVE.eyeCrouch : MOVE.eyeStand;
}

export function eyePos(e, out) {
  out.x = e.pos.x;
  out.y = e.pos.y + eyeHeight(e);
  out.z = e.pos.z;
  return out;
}

// The player's own step: mouse look, WASD wish, weapon slots.
export function stepPlayer(state, dt) {
  const p = state.players[0];
  const input = state.input;
  if (!p.alive) return;

  p.yaw += input.lookDX * LOOK_SENS;
  p.pitch = clamp(p.pitch + input.lookDY * LOOK_SENS, -PITCH_MAX, PITCH_MAX);
  input.lookDX = 0;
  input.lookDY = 0;
  // Recoil recovery: the kick decays back toward zero.
  p.recoil = Math.max(0, p.recoil - dt * 0.09);

  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  let wx = 0, wz = 0;
  if (input.forward) { wx += sin; wz -= cos; }
  if (input.back) { wx -= sin; wz += cos; }
  if (input.left) { wx -= cos; wz -= sin; }
  if (input.right) { wx += cos; wz += sin; }
  // Firing slows you slightly; reloading slows you more.
  const slow = p.reloadLeft > 0 ? 0.7 : 1;
  moveEntity(state, p, wx * slow, wz * slow, input.crouch, input.jump, dt);

  // Weapon slots 1..4 map to WEAPON_ORDER; only owned weapons switch.
  if (input.slot >= 1 && input.slot <= 4) {
    const id = WEAPON_ORDER[input.slot - 1];
    if (p.owned[id] && p.weapon !== id && p.reloadLeft <= 0) {
      p.weapon = id;
      p.cooldown = Math.max(p.cooldown, 0.25);
    }
  }
}

// Speed as a 0..1 fraction of walk speed: drives spread and the HUD.
export function speedFraction(e) {
  return clamp(Math.hypot(e.vel.x, e.vel.z) / MOVE.walk, 0, 1);
}
