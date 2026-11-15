// Team tactics: round plans, roles, radio callouts and shared intel.
// One module owns everything a bot does *as a teammate* so bots.js stays
// about one bot's own senses and movement. This module never moves a bot
// itself: it writes plan fields on the bot (role, lane, via, lurkUntil,
// holdWp) and bots.js executes them. No import cycle: bots.js imports the
// callout/intel helpers from here; this module imports no bot code.

import { HOLD_SPOTS, SITES } from './config.js';
import { pushCallout } from './state.js';

// Lane waypoint chains: [entry, ...site]. A bot routes through the chain
// in order, so a lane choice is a real path, not a hint.
const LANES = {
  west: { entry: 2, toA: [2, 4], toB: [2, 17, 8, 13, 12] },
  mid: { entry: 7, toA: [7, 5, 4], toB: [7, 8, 13, 12] },
  east: { entry: 10, toA: [10, 18, 8, 5, 4], toB: [10, 12] },
};
// Post-plant hold spots per site: corners the attackers cover after the
// bomb is down (waypoint ids).
const SITE_HOLDS = { A: [19, 5], B: [20, 13] };
// Defender approach waypoints for rotations.
const APPROACH = { A: 5, B: 13 };

// Short zone label for a position, used in callouts.
export function zoneOf(x, z) {
  for (const key of Object.keys(SITES)) {
    const s = SITES[key];
    if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return `${key} site`;
  }
  if (x < -33) return 'west';
  if (x > 33) return 'east';
  if (z > 18) return 'south';
  if (z < -18) return 'north';
  return 'mid';
}

// Which site, if any, a position belongs to: 'A', 'B' or null.
export function siteOf(x, z) {
  for (const key of Object.keys(SITES)) {
    const s = SITES[key];
    if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return key;
  }
  return null;
}

// Share a sighting with the whole team: every teammate's think step reads
// intel and reacts (investigate nearby, rotate across the map).
export function shareIntel(state, team, x, z) {
  state.intel[team] = { x, z, at: state.time };
}

// One radio callout, throttled per bot (6 s) and per team (1.5 s) so the
// feed stays readable. kind picks the sentence; detail fills it in.
// `entity` is the bot entity (its brain holds the throttle).
export function callout(state, entity, kind, detail) {
  const now = state.time;
  const b = entity.bot;
  if (!b || now < b.calloutAt) return;
  if (now < state.calloutAt[entity.team] + 1.5) return;
  let text = '';
  if (kind === 'contact') text = `${entity.name}: Contact ${detail}!`;
  else if (kind === 'planting') text = `${entity.name}: Planting ${detail}`;
  else if (kind === 'planted') text = `${entity.name}: Bomb down ${detail} — hold angles`;
  else if (kind === 'rotating') text = `${entity.name}: Rotating to ${detail}`;
  else if (kind === 'plan') text = `${entity.name}: ${detail}`;
  else if (kind === 'defusing') text = `${entity.name}: Defusing — cover me`;
  else return;
  b.calloutAt = now + 6;
  state.calloutAt[entity.team] = now;
  pushCallout(state, text, entity.team);
}

// Post-plant hold waypoint for one attacker, spread over the site's spots.
export function siteHoldWp(site, index) {
  const spots = SITE_HOLDS[site];
  return spots[index % spots.length];
}

export function approachWp(site) {
  return APPROACH[site];
}

function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// Round setup: pick the attackers' plan and give every bot a role, a lane
// and a waypoint chain. Plans rotate so no two rounds play the same.
//   split: two lanes into the site, one lurker pressuring the other site.
//   rush:  all four through one lane, entries first, planter last.
//   fake:  three bots show at the off-site, then swing to the real one.
export function assignTeamPlans(state) {
  const rng = state.rng;
  const site = rng() < 0.5 ? 'A' : 'B';
  const off = site === 'A' ? 'B' : 'A';
  const planRoll = rng();
  const planName = planRoll < 0.4 ? 'split' : planRoll < 0.7 ? 'rush' : 'fake';
  state.plan = { name: planName, site };

  const vans = state.players.filter((e) => e.team === 'van' && !e.isPlayer && e.bot);
  const jacs = state.players.filter((e) => e.team === 'jac' && e.bot);

  const lanes = ['west', 'mid', 'east'];
  const rushLane = lanes[Math.floor(rng() * lanes.length)];
  vans.forEach((e, i) => {
    const b = e.bot;
    b.role = 'entry';
    b.planSite = site;
    b.target = -1;
    b.lastKnown = null;
    b.state = 'route';
    b.lurkUntil = 0;
    if (planName === 'split') {
      const lane = lanes[i % lanes.length];
      b.lane = lane;
      if (i === 3) {
        // The lurker pressures the off-site, then joins the real push.
        b.role = 'lurker';
        b.via = LANES[lane][off === 'A' ? 'toA' : 'toB'].slice(0, 2);
        b.lurkUntil = state.time + 26;
      } else {
        b.via = LANES[lane][site === 'A' ? 'toA' : 'toB'].slice();
        if (i === 1) b.role = 'planter';
        if (i === 2) b.role = 'support';
      }
    } else if (planName === 'rush') {
      b.lane = rushLane;
      b.via = LANES[rushLane][site === 'A' ? 'toA' : 'toB'].slice();
      if (i === 3) b.role = 'planter';
      if (i === 1) b.role = 'support';
    } else {
      // fake: three bots show at the off-site, planter goes to the real one.
      b.lane = lanes[i % lanes.length];
      if (i === 1) {
        b.role = 'planter';
        b.via = LANES.mid[site === 'A' ? 'toA' : 'toB'].slice();
      } else {
        b.via = LANES[b.lane][off === 'A' ? 'toA' : 'toB'].slice(0, 2);
        b.lurkUntil = state.time + 22;
      }
    }
    b.route.length = 0;
    b.routeIndex = 0;
    b.destWp = b.via.length > 0 ? b.via[b.via.length - 1] : -1;
  });

  // Defenders: 2 anchors on A, 2 on B, 1 roamer in mid who rotates to
  // wherever the contact is.
  const aSpots = shuffle(rng, HOLD_SPOTS.filter((s) => s.site === 'A'));
  const bSpots = shuffle(rng, HOLD_SPOTS.filter((s) => s.site === 'B'));
  const midSpots = shuffle(rng, HOLD_SPOTS.filter((s) => !s.site));
  jacs.forEach((e, i) => {
    const b = e.bot;
    b.target = -1;
    b.lastKnown = null;
    b.state = 'route';
    b.lurkUntil = 0;
    let spot;
    if (i < 2) { b.role = 'anchor'; spot = aSpots[i % aSpots.length]; }
    else if (i < 4) { b.role = 'anchor'; spot = bSpots[(i - 2) % bSpots.length]; }
    else { b.role = 'roamer'; spot = midSpots[0]; }
    b.holdWp = spot.wp;
    b.holdYaw = spot.yaw;
    b.site = spot.site || site;
    b.planSite = site;
    b.via = [spot.wp];
    b.route.length = 0;
    b.routeIndex = 0;
    b.destWp = spot.wp;
  });

  // Announce the plan on the radio so the player hears the intent.
  if (vans.length > 0) {
    const laneWord = planName === 'rush' ? rushLane : 'split lanes';
    callout(state, vans[0], 'plan', planName === 'fake'
      ? `Fake ${off}, real push ${site} — go on my mark`
      : `${planName === 'split' ? 'Split push' : 'Rush'} ${site} — ${laneWord}`);
  }
  if (jacs.length > 0) callout(state, jacs[0], 'plan', 'Holding 2-1-2 — call your contact');
  return site;
}
