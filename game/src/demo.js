// Demo and attract mode. Two jobs: the menu's slow orbit over the map,
// and deterministic ?shot=<name> setups so screenshots are real renders of
// fixed game states (buy phase, combat, bomb site, round end).
// This is a real game feature, not a capture hack: the attract camera runs
// on the menu for every player.

import { SITES } from './config.js';
import { pushCallout, setBanner } from './state.js';

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
  const [rook, sable, ash, flint] = [state.players[1], state.players[2], state.players[3], state.players[4]];
  const [vex, mira, dusk, nyx, onyx] = [state.players[5], state.players[6], state.players[7], state.players[8], state.players[9]];
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
    place(ash, -6, 16, 0);
    place(flint, 5, 20, -0.4);
    holdBot(rook, 0);
    holdBot(sable, 0);
    holdBot(ash, 0);
    holdBot(flint, 0);
    state.buyOpen = true;
    state.banner = null; // startRound's banner would overlap the menu
    return;
  }

  if (shot === 'combat') {
    // Mid-north firefight, past the doors: the player stands in the open
    // with four Jackals ahead at 12–22 m, tracers crossing, a smoke cloud
    // on the north entry and a contact callout on the radio. The bots
    // engage for real (they see the player), so the tracers, muzzle
    // flashes and feed are the live sim, not props.
    state.phase = 'live';
    state.phaseTime = 20;
    state.roundTimeLeft = 80;
    state.buyOpen = false;
    state.banner = null; // no buy-phase banner in a firefight
    p.owned.vk47 = true;
    p.weapon = 'vk47';
    p.mag.vk47 = 30;
    p.reserve.vk47 = 90;
    p.grenades = 1;
    p.smokes = 1;
    state.money = 500;
    place(p, 0, -2, 0);
    place(rook, -3.5, 1, 0.3);
    place(sable, 4, 2, -0.4);
    place(ash, -6, 4, 0.2);
    place(flint, 6.5, 5, 0);
    place(vex, 2, -14, Math.PI);
    place(mira, -5, -18, Math.PI - 0.3);
    place(dusk, 8, -20, Math.PI + 0.2);
    place(nyx, -2, -24, Math.PI);
    place(onyx, 12, -16, Math.PI + 0.5);
    // Everyone holds: the staged bots must not walk through the frame
    // during the seconds before the capture.
    holdBot(rook, 0);
    holdBot(sable, 0);
    holdBot(ash, 0);
    holdBot(flint, 0);
    holdBot(vex, Math.PI);
    holdBot(mira, Math.PI);
    holdBot(dusk, Math.PI);
    holdBot(nyx, Math.PI);
    holdBot(onyx, Math.PI);
    // Tracers already in the air sell the firefight.
    state.tracers.push(
      { x0: 2, y0: 1.4, z0: -14, x1: 0.5, y1: 1.5, z1: 0, until: state.time + 30, team: 'jac' },
      { x0: -5, y0: 1.4, z0: -18, x1: -1, y1: 1.2, z1: 2, until: state.time + 30, team: 'jac' },
      { x0: 8, y0: 1.4, z0: -20, x1: 1.5, y1: 1.3, z1: -2, until: state.time + 30, team: 'jac' },
      { x0: -3.5, y0: 1.4, z0: 1, x1: 2, y1: 1.4, z1: -13, until: state.time + 30, team: 'van' },
    );
    // A smoke cloud on the north entry, mid-bloom.
    state.smoke.push({ x: 6, z: -26, r: 4.5, born: state.time - 0.6, until: state.time + 30 });
    pushCallout(state, 'Rook: Contact mid!', 'van');
    return;
  }

  if (shot === 'site') {
    // Bomb planted at A: the player stands close to the bomb, looking at
    // it and its beacon, teammates and Jackals around the walls, and a
    // smoke cloud covering the north entry.
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
    p.grenades = 1;
    p.smokes = 0;
    state.money = 800;
    place(p, -27, -19, -0.8);
    place(rook, -33, -15, -2.4);
    place(sable, -20, -27, -2.0);
    place(ash, -33, -22, -2.2);
    place(flint, -27, -29, -0.6);
    place(vex, -36, -20, 0.9);
    place(mira, -14, -16, -2.2);
    place(dusk, -27, -29, 0.4);
    place(nyx, -38, -26, 0.7);
    place(onyx, -22, -30, -0.2);
    holdBot(rook, -2.4);
    holdBot(sable, -2.0);
    holdBot(ash, -2.2);
    holdBot(flint, -0.6);
    holdBot(vex, 0.9);
    holdBot(mira, -2.2);
    holdBot(dusk, 0.4);
    holdBot(nyx, 0.7);
    holdBot(onyx, -0.2);
    state.smoke.push({ x: -31, z: -30, r: 4.5, born: state.time - 0.6, until: state.time + 30 });
    pushCallout(state, 'Flint: Bomb down A — hold angles', 'van');
    setBanner(state, 'BOMB PLANTED', 'Site A — 22s to detonation', 30);
    return;
  }

  if (shot === 'end') {
    // Round just won: the banner and the score tell the story. The player
    // stands at a slight diagonal so the fallen Jackals spread across the
    // frame instead of lining up behind the mid pillars.
    state.phase = 'roundEnd';
    state.phaseTime = 1;
    state.round = 5;
    state.score.van = 3;
    state.score.jac = 2;
    state.roundWinner = 'van';
    state.roundReason = 'All Jackals eliminated';
    state.buyOpen = false;
    place(p, -3, -3, 0.15);
    place(rook, -7, 0, 0.4);
    place(sable, 2, 1, -0.3);
    place(ash, -10, -2, 0.3);
    place(flint, 5, -1, -0.4);
    // The Jackals are down (placed, then marked dead — place revives).
    place(vex, 2, -10, Math.PI);
    place(mira, -6, -14, Math.PI);
    place(dusk, 6, -18, Math.PI);
    place(nyx, -2, -20, Math.PI);
    place(onyx, 10, -12, Math.PI);
    for (const e of [vex, mira, dusk, nyx, onyx]) {
      e.alive = false;
      e.health = 0;
    }
    setBanner(state, 'VANGUARD WIN THE ROUND', 'All Jackals eliminated', 30);
  }
}
