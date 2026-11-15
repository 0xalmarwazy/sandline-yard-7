// Round flow: buy phase, live play, plant/defuse, win conditions, money,
// and the match. One step function drives the phase machine; the buy menu
// and the bomb channel live here because both are round rules, not combat.

import { ECON, ROUND, SITES, WEAPONS } from './config.js';
import { applyDamage } from './combat.js';
import { assignTeamPlans, callout } from './tactics.js';
import { aliveCount, playerOf, pushFeed, resetRoundEntities, setBanner } from './state.js';

export const BUY_ITEMS = [
  { key: 1, id: 'k9', name: 'K9 SMG', price: 1400, desc: 'Fast automatic, close quarters' },
  { key: 2, id: 'm870', name: 'M870 Breacher', price: 1200, desc: '8-pellet shotgun, devastating up close' },
  { key: 3, id: 'vk47', name: 'VK-47 Rifle', price: 2700, desc: 'Hard-hitting automatic rifle' },
  { key: 4, id: 'frag', name: 'HE-1 Frag', price: 300, desc: 'Grenade — throw with G' },
  { key: 5, id: 'ammo', name: 'Ammo refill', price: 150, desc: 'Full reserve for your current weapon' },
  { key: 6, id: 'smoke', name: 'SM-2 Smoke', price: 300, desc: 'Smoke cloud, blocks sight — throw with F' },
];

export function startMatch(state) {
  state.score.van = 0;
  state.score.jac = 0;
  state.money = ECON.startMoney;
  state.round = 1;
  state.matchWinner = null;
  for (const e of state.players) {
    e.kills = 0;
    e.deaths = 0;
    e.owned = { p9: true, k9: false, vk47: false, m870: false };
    e.weapon = 'p9';
    e.grenades = 0;
    e.smokes = 0;
  }
  state.stats.shots = 0;
  state.stats.hits = 0;
  state.stats.headshots = 0;
  startRound(state);
}

export function startRound(state) {
  resetRoundEntities(state);
  assignTeamPlans(state);
  buyBotLoadouts(state);
  state.phase = 'buy';
  state.phaseTime = 0;
  state.roundTimeLeft = ROUND.roundTime;
  state.roundWinner = null;
  state.roundReason = '';
  state.buyOpen = true;
  const plan = state.plan;
  const planLine = plan ? `Plan: ${plan.name} — site ${plan.site}` : 'Buy your gear — press B to close';
  setBanner(state, `ROUND ${state.round}`, planLine, 3);
  state.audioHook('roundStart');
}

function buyBotLoadouts(state) {
  const r = state.round;
  for (const e of state.players) {
    if (e.isPlayer || !e.bot) continue;
    const rng = state.rng;
    // Bots upgrade as the match goes on, like a real economy.
    let pick = 'p9';
    if (r >= 4) pick = rng() < 0.6 ? 'vk47' : 'k9';
    else if (r === 3) pick = rng() < 0.5 ? 'k9' : 'm870';
    else if (r === 2) pick = rng() < 0.5 ? 'k9' : 'p9';
    if (pick !== 'p9') {
      e.owned[pick] = true;
      e.weapon = pick;
      e.mag[pick] = WEAPONS[pick].mag;
      e.reserve[pick] = WEAPONS[pick].reserve;
    }
    if (r >= 2 && rng() < 0.6) e.grenades = 1;
    if (r >= 2 && rng() < 0.4) e.smokes = 1;
  }
}

export function buyItem(state, key) {
  const p = playerOf(state);
  if (state.phase !== 'buy' || !p.alive) return false;
  const item = BUY_ITEMS.find((b) => b.key === key);
  if (!item || state.money < item.price) {
    state.audioHook('deny');
    return false;
  }
  if (item.id === 'frag') {
    if (p.grenades >= 2) { state.audioHook('deny'); return false; }
    p.grenades++;
  } else if (item.id === 'smoke') {
    if (p.smokes >= 2) { state.audioHook('deny'); return false; }
    p.smokes++;
  } else if (item.id === 'ammo') {
    const def = WEAPONS[p.weapon];
    if (p.reserve[p.weapon] >= def.reserve) { state.audioHook('deny'); return false; }
    p.reserve[p.weapon] = def.reserve;
  } else {
    if (p.owned[item.id]) { state.audioHook('deny'); return false; }
    p.owned[item.id] = true;
    p.weapon = item.id;
    p.mag[item.id] = WEAPONS[item.id].mag;
    p.reserve[item.id] = WEAPONS[item.id].reserve;
  }
  state.money -= item.price;
  state.audioHook('buy');
  return true;
}

function siteAt(x, z) {
  for (const key of Object.keys(SITES)) {
    const s = SITES[key];
    if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return s;
  }
  return null;
}

function stepBomb(state, dt) {
  const bomb = state.bomb;
  const p = playerOf(state);
  if (bomb.state === 'idle') {
    // Find a planter: the player holding E in a site, else a planting bot.
    let planter = null, site = null;
    if (p.alive && state.input.use) {
      site = siteAt(p.pos.x, p.pos.z);
      if (site) planter = p;
    }
    if (!planter) {
      for (const e of state.players) {
        if (e.team !== 'van' || !e.alive || e.isPlayer || !e.bot) continue;
        if (e.bot.state !== 'plant') continue;
        const s = siteAt(e.pos.x, e.pos.z);
        if (s) { planter = e; site = s; break; }
      }
    }
    if (planter && site) {
      if (bomb.channeler !== planter.id) {
        bomb.channeler = planter.id;
        state.audioHook('plantStart');
      }
      bomb.plantProgress += dt / ROUND.plantTime;
      if (bomb.plantProgress >= 1) {
        bomb.state = 'planted';
        bomb.site = site.id;
        bomb.pos.x = planter.pos.x;
        bomb.pos.y = 0;
        bomb.pos.z = planter.pos.z;
        bomb.timer = ROUND.bombTime;
        bomb.plantProgress = 0;
        bomb.channeler = -1;
        if (planter.isPlayer) state.money = Math.min(state.money + ECON.plantBonus, ECON.maxMoney);
        setBanner(state, 'BOMB PLANTED', `Site ${site.id} — ${ROUND.bombTime}s to detonation`, 3);
        pushFeed(state, `Bomb planted at ${site.id}`, 'van');
        if (!planter.isPlayer) callout(state, planter, 'planted', `site ${site.id}`);
        state.audioHook('planted');
      }
    } else {
      bomb.plantProgress = Math.max(0, bomb.plantProgress - dt * 0.5);
      bomb.channeler = -1;
    }
    return;
  }
  if (bomb.state !== 'planted') return;
  // A planted bomb: defenders race the timer.
  const prevSecond = Math.ceil(bomb.timer);
  bomb.timer -= dt;
  if (Math.ceil(bomb.timer) !== prevSecond) {
    state.audioHook('beep', bomb.timer < 10 ? 2 : 1);
  }
  if (bomb.timer <= 0) {
    bomb.state = 'exploded';
    explodeBomb(state);
    endRound(state, 'van', 'The bomb detonated');
    return;
  }
  let defuser = null;
  if (p.alive && state.input.use) {
    const d = Math.hypot(p.pos.x - bomb.pos.x, p.pos.z - bomb.pos.z);
    if (d < 2.5) defuser = p;
  }
  if (!defuser) {
    for (const e of state.players) {
      if (e.team !== 'jac' || !e.alive || !e.bot) continue;
      if (e.bot.state !== 'defuse') continue;
      const d = Math.hypot(e.pos.x - bomb.pos.x, e.pos.z - bomb.pos.z);
      if (d < 2.5) { defuser = e; break; }
    }
  }
  if (defuser) {
    if (bomb.channeler !== defuser.id) {
      bomb.channeler = defuser.id;
      state.audioHook('defuseStart');
      if (!defuser.isPlayer) callout(state, defuser, 'defusing');
    }
    bomb.defuseProgress += dt / ROUND.defuseTime;
    if (bomb.defuseProgress >= 1) {
      bomb.state = 'defused';
      bomb.defuseProgress = 0;
      bomb.channeler = -1;
      endRound(state, 'jac', 'The bomb was defused');
    }
  } else {
    bomb.defuseProgress = Math.max(0, bomb.defuseProgress - dt * 0.5);
    bomb.channeler = -1;
  }
}

function explodeBomb(state) {
  const b = state.bomb;
  state.impacts.push({ x: b.pos.x, y: 1, z: b.pos.z, until: state.time + 0.8, big: true });
  state.audioHook('explosion', b.pos);
  for (const e of state.players) {
    if (!e.alive) continue;
    const d = Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z);
    if (d > 14) continue;
    const dmg = 220 * (1 - (d / 14) * 0.6);
    applyDamage(state, e, dmg, null, false);
  }
}

function endRound(state, winner, reason) {
  if (state.phase !== 'live') return;
  state.phase = 'roundEnd';
  state.phaseTime = 0;
  state.roundWinner = winner;
  state.roundReason = reason;
  state.score[winner]++;
  state.buyOpen = false;
  if (winner === 'van') {
    state.money = Math.min(state.money + ECON.winBonus, ECON.maxMoney);
  } else {
    state.money = Math.min(state.money + ECON.lossBonus, ECON.maxMoney);
  }
  const name = winner === 'van' ? 'VANGUARD' : 'JACKALS';
  setBanner(state, `${name} WIN THE ROUND`, reason, ROUND.endTime);
  state.audioHook(winner === 'van' ? 'win' : 'lose');
}

export function stepRound(state, dt) {
  const input = state.input;
  if (state.phase === 'matchEnd') {
    if (input.reload) startMatch(state);
    return;
  }
  if (state.phase === 'menu') return;

  if (state.phase === 'buy') {
    if (input.buy) state.buyOpen = !state.buyOpen;
    if (input.buyKey >= 1 && input.buyKey <= 6) buyItem(state, input.buyKey);
    state.phaseTime += dt;
    if (state.phaseTime >= ROUND.buyTime) {
      state.phase = 'live';
      state.phaseTime = 0;
      state.buyOpen = false;
      setBanner(state, 'PLANT THE BOMB', 'Site A: Warehouse — Site B: Depot', 3);
    }
    return;
  }

  if (state.phase === 'roundEnd') {
    state.phaseTime += dt;
    if (state.phaseTime >= ROUND.endTime) {
      if (state.score.van >= ROUND.matchToWin || state.score.jac >= ROUND.matchToWin) {
        state.phase = 'matchEnd';
        state.matchWinner = state.score.van >= ROUND.matchToWin ? 'van' : 'jac';
        state.audioHook(state.matchWinner === 'van' ? 'win' : 'lose');
      } else {
        state.round++;
        startRound(state);
      }
    }
    return;
  }

  // Live.
  if (input.buy) state.buyOpen = false;
  state.roundTimeLeft -= dt;
  stepBomb(state, dt);
  if (state.phase !== 'live') return; // bomb ended the round
  const vanAlive = aliveCount(state, 'van');
  const jacAlive = aliveCount(state, 'jac');
  if (jacAlive === 0) {
    endRound(state, 'van', 'All Jackals eliminated');
  } else if (vanAlive === 0 && state.bomb.state !== 'planted') {
    endRound(state, 'jac', 'All Vanguard eliminated');
  } else if (vanAlive === 0 && state.bomb.state === 'planted') {
    // Bomb still ticks: defenders must defuse.
  } else if (state.roundTimeLeft <= 0) {
    if (state.bomb.state === 'planted') {
      // Timer stops mattering once the bomb is down.
      state.roundTimeLeft = 0;
    } else {
      endRound(state, 'jac', 'Time expired — bomb never planted');
    }
  }
}
