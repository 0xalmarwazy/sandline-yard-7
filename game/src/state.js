// The single state store. One object holds the whole game; every module
// reads and writes this object and nothing else holds game state.
// Entities (player and bots) share one shape so combat, movement and the
// renderer treat them the same way.

import { BOT_NAMES, ECON, ROUND, SPAWNS, WEAPONS } from './config.js';
import { mulberry32 } from './util.js';

export function makeEntity(id, name, team, isPlayer) {
  return {
    id, name, team, isPlayer,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0, pitch: 0,
    health: 100, alive: true,
    crouched: false, onGround: true,
    // Loadout.
    weapon: 'p9',
    owned: { p9: true, k9: false, vk47: false, m870: false },
    mag: { p9: WEAPONS.p9.mag, k9: 0, vk47: 0, m870: 0 },
    reserve: { p9: WEAPONS.p9.reserve, k9: 0, vk47: 0, m870: 0 },
    grenades: 0,
    // Gun state.
    cooldown: 0, reloadLeft: 0, bloom: 0, recoil: 0, triggerHeld: false,
    aimErr: 0, // extra spread for bots (aim error); always 0 for the player
    // Per-entity timers and FX hooks the renderer reads.
    lastShotAt: -1, lastDamageAt: -1, lastDamageFrom: -1, deaths: 0, kills: 0,
    flashUntil: 0,
    // Bot brain (null for the player). Filled by bots.js.
    bot: null,
  };
}

export function createState(seed) {
  const rng = mulberry32(seed);
  const players = [];
  players.push(makeEntity(0, 'You', 'van', true));
  BOT_NAMES.van.forEach((name, i) => players.push(makeEntity(1 + i, name, 'van', false)));
  BOT_NAMES.jac.forEach((name, i) => players.push(makeEntity(3 + i, name, 'jac', false)));
  return {
    seed,
    rng,
    time: 0,
    tick: 0,
    // Match / round flow.
    phase: 'menu', // menu | buy | live | roundEnd | matchEnd
    phaseTime: 0,
    round: 1,
    roundTimeLeft: ROUND.roundTime,
    score: { van: 0, jac: 0 },
    money: ECON.startMoney,
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    players,
    // Bomb.
    bomb: {
      state: 'idle', // idle | planted | exploded | defused
      site: null,
      pos: { x: 0, y: 0, z: 0 },
      timer: 0,
      plantProgress: 0,
      defuseProgress: 0,
      channeler: -1, // entity id currently planting/defusing, -1 = none
    },
    // Projectiles and short-lived effects (pooled arrays, reused).
    grenades: [],
    tracers: [],
    impacts: [],
    // Noise events bots can hear: {x, z, radius, until}.
    noises: [],
    // Kill feed entries: {text, team, until}.
    feed: [],
    // Round banner shown centre screen: {text, sub, until}.
    banner: null,
    // Damage direction for the player's vignette (radians, world yaw).
    damageFlash: 0,
    // Camera override for demo/attract mode (null in normal play).
    demoCam: null,
    // Who the dead player spectates (entity id, -1 = none).
    spectate: -1,
    // Input state, written by input.js, read by the sim.
    input: {
      forward: false, back: false, left: false, right: false,
      crouch: false, jump: false, fire: false, firePressed: false,
      reload: false, buy: false, use: false, grenade: false,
      slot: 0, // 1..4 weapon slots, 0 = none pressed this tick
      buyKey: 0, // 1..5 buy menu choice, 0 = none
      lookDX: 0, lookDY: 0,
    },
    locked: false, // pointer lock held
    buyOpen: false,
    muted: false,
    demo: false, // ?shot= mode: no pointer lock, no pause overlay
    // Stats for the end screen.
    stats: { shots: 0, hits: 0, headshots: 0 },
  };
}

// Put every entity back on its spawn with full health and its kept loadout.
// Money and owned weapons survive between rounds; ammo refills.
export function resetRoundEntities(state) {
  const used = { van: 0, jac: 0 };
  for (const e of state.players) {
    const spawn = SPAWNS[e.team][used[e.team]++];
    e.pos.x = spawn.x; e.pos.y = 0; e.pos.z = spawn.z;
    e.vel.x = 0; e.vel.y = 0; e.vel.z = 0;
    e.yaw = spawn.yaw; e.pitch = 0;
    e.health = 100; e.alive = true;
    e.crouched = false; e.onGround = true;
    e.cooldown = 0; e.reloadLeft = 0; e.bloom = 0; e.recoil = 0; e.aimErr = 0;
    for (const id of Object.keys(e.owned)) {
      if (!e.owned[id]) continue;
      e.mag[id] = WEAPONS[id].mag;
      e.reserve[id] = WEAPONS[id].reserve;
    }
    if (e.bot) {
      e.bot.state = 'route';
      e.bot.route.length = 0;
      e.bot.routeIndex = 0;
      e.bot.target = -1;
      e.bot.lastKnown = null;
      e.bot.holdUntil = 0;
      e.bot.burstLeft = 0;
      e.bot.aimError = 0;
      e.bot.strafeDir = 1;
      e.bot.strafeUntil = 0;
      e.bot.decideAt = 0;
    }
  }
  state.grenades.length = 0;
  state.tracers.length = 0;
  state.impacts.length = 0;
  state.noises.length = 0;
  state.bomb.state = 'idle';
  state.bomb.site = null;
  state.bomb.timer = 0;
  state.bomb.plantProgress = 0;
  state.bomb.defuseProgress = 0;
  state.bomb.channeler = -1;
  state.spectate = -1;
}

export function aliveCount(state, team) {
  let n = 0;
  for (const e of state.players) if (e.team === team && e.alive) n++;
  return n;
}

export function playerOf(state) {
  return state.players[0];
}

export function pushFeed(state, text, team) {
  state.feed.push({ text, team, until: state.time + 5 });
  if (state.feed.length > 5) state.feed.shift();
}

export function setBanner(state, text, sub, seconds) {
  state.banner = { text, sub, until: state.time + seconds };
}
