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
    smokes: 0, // SM-2 smoke grenades carried
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
  let nextId = 0;
  players.push(makeEntity(nextId++, 'You', 'van', true));
  for (const name of BOT_NAMES.van) players.push(makeEntity(nextId++, name, 'van', false));
  for (const name of BOT_NAMES.jac) players.push(makeEntity(nextId++, name, 'jac', false));
  return {
    seed,
    rng,
    time: 0,
    tick: 0,
    // Match / round flow.
    phase: 'menu', // menu | buy | live | roundEnd | matchEnd
    phaseTime: 0,
    liveAt: 0, // state.time when the live phase started (pair stagger clock)
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
    // Smoke clouds: {x, z, r, until} — block line of sight (combat.js).
    smoke: [],
    // Noise events bots can hear: {x, z, radius, until}.
    noises: [],
    // Kill feed entries: {text, team, until}.
    feed: [],
    // Radio callouts from bots: {text, team, until} — the HUD shows them
    // in their own panel so team coordination is visible to the player.
    callouts: [],
    calloutAt: { van: -10, jac: -10 }, // team-wide radio throttle (seconds); -10 so the first callout is never throttled
    // This round's attack plan {name, site}, set by tactics.js.
    plan: null,
    // Team-shared intel: each team's latest known enemy position
    // {x, z, at} or null. Written when any bot spots an enemy; read by
    // every teammate's think step (tactics.js).
    intel: { van: null, jac: null },
    // Hitmarker: the player's latest hit (HUD flashes it briefly).
    hitmark: { at: -1, kill: false, head: false },
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
      reload: false, buy: false, use: false, grenade: false, smoke: false,
      slot: 0, // 1..4 weapon slots, 0 = none pressed this tick
      buyKey: 0, // 1..6 buy menu choice, 0 = none
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
      e.bot.role = 'entry';
      e.bot.planSite = 'A';
      e.bot.calloutAt = -10;
      e.bot.rotateAt = 0;
      e.bot.lurkUntil = 0;
      e.bot.goAt = 0;
      e.bot.coverCalled = false;
      e.bot.helpCalled = false;
    }
  }
  state.grenades.length = 0;
  state.tracers.length = 0;
  state.impacts.length = 0;
  state.noises.length = 0;
  state.smoke.length = 0;
  state.callouts.length = 0;
  state.intel.van = null;
  state.intel.jac = null;
  state.plan = null;
  state.calloutAt.van = -10;
  state.calloutAt.jac = -10;
  state.hitmark.at = -1;
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

// A bot radio callout: rate-limited per team in tactics.js, shown in the
// HUD's radio panel. Max 3 on screen.
export function pushCallout(state, text, team) {
  state.callouts.push({ text, team, until: state.time + 4.5 });
  if (state.callouts.length > 3) state.callouts.shift();
}

export function setBanner(state, text, sub, seconds) {
  state.banner = { text, sub, until: state.time + seconds };
}
