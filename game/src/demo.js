// Demo and attract mode. Two jobs: the menu's slow orbit over the map,
// and deterministic ?shot=<name> setups so screenshots are real renders of
// fixed game states (buy phase, combat, bomb site, round end).
// This is a real game feature, not a capture hack: the attract camera runs
// on the menu for every player.

import { SITES } from './config.js';
import { setBanner } from './state.js';

export function parseShot() {
  const q = new URLSearchParams(window.location.search);
  const shot = q.get('shot');
  const seed = Number(q.get('seed')) || 1;
  return { shot: ['start', 'combat', 'site', 'end'].includes(shot) ? shot : null, seed };
}

// Menu attract camera: a slow orbit high over the yard.
export function attractCam(state, time) {
  const a = time * 0.05;
  const r = 46;
  state.demoCam = {
    pos: { x: Math.sin(a) * r, y: 26, z: Math.cos(a) * r * 0.7 },
    look: { x: 0, y: 0, z: -4 },
  };
}

function place(e, x, z, yaw) {
  e.pos.x = x; e.pos.z = z; e.pos.y = 0;
  e.vel.x = 0; e.vel.y = 0; e.vel.z = 0;
  e.yaw = yaw; e.pitch = 0;
  e.alive = true;
  e.health = 100;
}

function holdBot(e, yaw) {
  if (!e.bot) return;
  e.bot.state = 'hold';
  e.bot.holdYaw = yaw;
  e.bot.route.length = 0;
  e.bot.routeIndex = 0;
  e.bot.target = -1;
}

// Set up a fixed game state for one screenshot. Called after startRound.
export function applyShot(state, shot) {
  const p = state.players[0];
  const [rook, sable] = [state.players[1], state.players[2]];
  const [vex, mira, dusk] = [state.players[3], state.players[4], state.players[5]];
  state.demo = true;

  if (shot === 'start') {
    // Buy phase at the attacker spawn, looking down mid, buy menu open.
    // Teammates stand ahead of the player so they read in frame without
    // blocking the camera. No banner here: startRound's already expired
    // by capture time and would overlap the menu.
    state.phase = 'buy';
    state.phaseTime = 2;
    place(p, -6, 24, 0);
    place(rook, -12, 18, 0.2);
    place(sable, 0, 18, -0.2);
    holdBot(rook, 0);
    holdBot(sable, 0);
    state.buyOpen = true;
    state.banner = null; // startRound's banner would overlap the menu
    return;
  }

  if (shot === 'combat') {
    // Mid-lane firefight: two Jackals in view ahead of the player.
    state.phase = 'live';
    state.phaseTime = 20;
    state.roundTimeLeft = 80;
    state.buyOpen = false;
    state.banner = null; // no buy-phase banner in a firefight
    p.owned.vk47 = true;
    p.weapon = 'vk47';
    p.mag.vk47 = 30;
    p.reserve.vk47 = 90;
    place(p, 0, 10, 0);
    place(rook, -3, 14, 0.3);
    place(vex, 2, -8, Math.PI);
    place(mira, -5, -12, Math.PI - 0.3);
    place(dusk, 8, -16, Math.PI + 0.2);
    place(sable, 6, 16, -0.4);
    holdBot(vex, Math.PI);
    holdBot(mira, Math.PI);
    holdBot(dusk, Math.PI);
    // A couple of tracers already in the air sell the firefight.
    state.tracers.push(
      { x0: 2, y0: 1.4, z0: -8, x1: 0.5, y1: 1.5, z1: 6, until: state.time + 30, team: 'jac' },
      { x0: -5, y0: 1.4, z0: -12, x1: -1, y1: 1.2, z1: 8, until: state.time + 30, team: 'jac' },
    );
    return;
  }

  if (shot === 'site') {
    // Bomb planted at A: the player stands inside the site looking at the
    // bomb and its beacon, teammates and Jackals around the walls.
    state.phase = 'live';
    state.phaseTime = 45;
    state.roundTimeLeft = 0;
    state.buyOpen = false;
    state.bomb.state = 'planted';
    state.bomb.site = 'A';
    state.bomb.pos.x = SITES.A.cx;
    state.bomb.pos.y = 0;
    state.bomb.pos.z = SITES.A.cz;
    state.bomb.timer = 22;
    p.owned.vk47 = true;
    p.weapon = 'vk47';
    p.mag.vk47 = 18;
    p.reserve.vk47 = 60;
    place(p, -23, -19, -1.0);
    place(rook, -28, -18, -2.6);
    place(vex, -36, -20, 0.9);
    place(mira, -14, -16, -2.2);
    place(dusk, -30, -28, 0.4);
    place(sable, -19, -23, -2.0);
    holdBot(rook, -2.6);
    holdBot(vex, 0.9);
    holdBot(mira, -2.2);
    holdBot(dusk, 0.4);
    holdBot(sable, -2.0);
    setBanner(state, 'BOMB PLANTED', 'Site A — 22s to detonation', 30);
    return;
  }

  if (shot === 'end') {
    // Round just won: the banner and the score tell the story.
    state.phase = 'roundEnd';
    state.phaseTime = 1;
    state.round = 5;
    state.score.van = 3;
    state.score.jac = 2;
    state.roundWinner = 'van';
    state.roundReason = 'All Jackals eliminated';
    state.buyOpen = false;
    place(p, 0, 6, 0);
    place(rook, -4, 10, 0.4);
    place(sable, 5, 12, -0.3);
    // The Jackals are down (placed, then marked dead — place revives).
    place(vex, 2, -6, Math.PI);
    place(mira, -6, -10, Math.PI);
    place(dusk, 6, -14, Math.PI);
    for (const e of [vex, mira, dusk]) {
      e.alive = false;
      e.health = 0;
    }
    setBanner(state, 'VANGUARD WIN THE ROUND', 'All Jackals eliminated', 30);
  }
}
