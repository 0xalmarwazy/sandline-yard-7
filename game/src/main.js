// SANDLINE — Yard 7. Bootstrap and the game loop.
// The simulation runs at a fixed 60 Hz step, decoupled from rendering:
// the loop accumulates real time and steps the sim in 1/60 s slices, then
// renders once. All wiring lives here; modules never import each other in
// a cycle (weapons fires through a callback into combat).

import { createAudioHook, unlockAudio } from './audio.js';
import { initBots, stepBots } from './bots.js';
import { resolveShot, stepGrenades } from './combat.js';
import { applyShot, attractCam, parseShot } from './demo.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { stepPlayer } from './player.js';
import { createRenderer } from './render.js';
import { startMatch, startRound, stepRound } from './round.js';
import { createState } from './state.js';
import { stepWeapons, tryThrowGrenade } from './weapons.js';

const STEP = 1 / 60;

const { shot, seed } = parseShot();
const state = createState(seed);
state.audioHook = createAudioHook(state);
initBots(state);

const container = document.getElementById('game');
const renderer = createRenderer(state, container);
const hud = createHud(state, {
  onPlay() {
    unlockAudio();
    if (state.phase === 'menu') {
      startMatch(state);
      input.requestLock();
    } else if (state.phase === 'matchEnd') {
      startMatch(state);
      input.requestLock();
    } else {
      input.requestLock();
    }
  },
});
const input = createInput(state, renderer.dom, (locked) => {
  if (!locked && state.phase === 'live') {
    // Pausing mid-round: nothing to do, the overlay covers the screen.
  }
});

// Demo screenshot mode: start a round, then force the fixed setup.
if (shot) {
  startMatch(state);
  applyShot(state, shot);
  state.demoCam = null;
}

// One fixed simulation step.
function step(dt) {
  state.time += dt;
  state.tick++;
  // Damage vignette decay.
  state.damageFlash = Math.max(0, state.damageFlash - dt * 1.6);

  if (state.phase === 'menu') {
    attractCam(state, state.time);
    input.clearTransient();
    return;
  }

  stepRound(state, dt);
  // Round end freezes everyone until the next round starts.
  if (state.phase === 'menu' || state.phase === 'matchEnd' || state.phase === 'roundEnd') {
    input.clearTransient();
    return;
  }

  const p = state.players[0];
  if (p.alive) {
    stepPlayer(state, dt);
    if (state.input.grenade) tryThrowGrenade(state, p, 'frag');
    if (state.input.smoke) tryThrowGrenade(state, p, 'smoke');
  } else if (state.input.firePressed && state.spectate >= 0) {
    // Click while dead cycles the spectate target.
    const team = state.players.filter((e) => e.team === p.team && e.alive && !e.isPlayer);
    if (team.length > 0) {
      const idx = team.findIndex((e) => e.id === state.spectate);
      state.spectate = team[(idx + 1) % team.length].id;
    }
  }
  stepBots(state, dt);
  stepWeapons(state, dt, (shooter, def, dir) => resolveShot(state, shooter, def, dir));
  stepGrenades(state, dt);

  // Prune expired short-lived lists (bounded, in place).
  prune(state.tracers);
  prune(state.impacts);
  prune(state.noises);
  prune(state.smoke);
  prune(state.callouts);
  input.clearTransient();
}

function prune(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (state.time > list[i].until) list.splice(i, 1);
  }
}

// Fixed-step loop with an accumulator; rendering runs once per frame.
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let elapsed = (now - last) / 1000;
  last = now;
  if (elapsed > 0.25) elapsed = 0.25; // tab was away: never spiral
  acc += elapsed;
  let steps = 0;
  while (acc >= STEP && steps < 8) {
    step(STEP);
    acc -= STEP;
    steps++;
  }
  if (steps === 8) acc = 0;
  renderer.update(elapsed);
  hud.update(state);
}
requestAnimationFrame(frame);

// Debug handle for automated checks (not part of the game): lets a test
// drive read state, step the sim and inject input without a real mouse.
window.__sandline = {
  state,
  step: (n) => { for (let i = 0; i < n; i++) step(STEP); },
  version: 'yard7-2.0.0',
};
