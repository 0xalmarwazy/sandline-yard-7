// HUD: all DOM updates, the buy menu, the minimap and the overlays.
// Reads state once per frame and only touches the DOM when a value changed.

import { BUY_ITEMS } from './round.js';
import { SITES, TEAMS, WALLS, WEAPONS } from './config.js';
import { aliveCount } from './state.js';

function el(id) {
  return document.getElementById(id);
}

function fmtTime(s) {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function createHud(state, callbacks) {
  const refs = {};
  for (const id of [
    'health-num', 'health-bar', 'money', 'ammo-mag', 'ammo-reserve',
    'weapon-name', 'grenades', 'timer', 'score-van', 'score-jac', 'round-num',
    'feed', 'radio', 'banner', 'banner-title', 'banner-sub', 'buy-menu', 'buy-list',
    'bomb-status', 'bomb-timer', 'plant-bar', 'plant-fill', 'plant-label',
    'team-van', 'team-jac', 'crosshair', 'hitmarker', 'dmgdir', 'vignette', 'minimap',
    'overlay', 'overlay-title', 'overlay-copy', 'play-btn', 'end-stats',
    'hint', 'spectate',
  ]) refs[id] = el(id);

  const cache = {};
  function setText(key, value) {
    if (cache[key] === value) return;
    cache[key] = value;
    const node = refs[key];
    if (node) node.textContent = value;
  }
  function setWidth(key, pct) {
    const v = `${Math.round(pct)}%`;
    if (cache[key] === v) return;
    cache[key] = v;
    const node = refs[key];
    if (node) node.style.width = v;
  }
  function show(node, on) {
    if (!node) return;
    const hidden = node.hasAttribute('hidden');
    if (on && hidden) node.removeAttribute('hidden');
    if (!on && !hidden) node.setAttribute('hidden', '');
  }

  // Minimap: static map layer drawn once, dots each frame.
  const mm = refs.minimap ? refs.minimap.getContext('2d') : null;
  const MM = 168;
  const toMmX = (x) => ((x + 45) / 90) * MM;
  const toMmZ = (z) => ((z + 35) / 70) * MM;
  function drawMinimapBase() {
    if (!mm) return;
    mm.fillStyle = '#14161a';
    mm.fillRect(0, 0, MM, MM);
    mm.fillStyle = '#2c323a';
    for (const w of WALLS) {
      mm.fillRect(toMmX(w.x0), toMmZ(w.z0), toMmX(w.x1) - toMmX(w.x0), toMmZ(w.z1) - toMmZ(w.z0));
    }
    for (const key of Object.keys(SITES)) {
      const s = SITES[key];
      mm.fillStyle = key === 'A' ? '#2dd4bf' : '#f59e0b';
      mm.globalAlpha = 0.35;
      mm.fillRect(toMmX(s.x0), toMmZ(s.z0), toMmX(s.x1) - toMmX(s.x0), toMmZ(s.z1) - toMmZ(s.z0));
      mm.globalAlpha = 1;
      mm.fillStyle = '#e9e6df';
      mm.font = 'bold 13px system-ui, sans-serif';
      mm.textAlign = 'center';
      mm.fillText(key, toMmX(s.cx), toMmZ(s.cz) + 4);
    }
  }
  drawMinimapBase();

  function drawMinimap() {
    if (!mm) return;
    drawMinimapBase();
    for (const e of state.players) {
      if (!e.alive) continue;
      const friendly = e.team === 'van';
      mm.fillStyle = friendly ? '#38bdf8' : '#ef4444';
      if (e.isPlayer) {
        // Player: a triangle pointing where they look.
        mm.save();
        mm.translate(toMmX(e.pos.x), toMmZ(e.pos.z));
        mm.rotate(Math.atan2(Math.sin(e.yaw), -Math.cos(e.yaw)) + Math.PI / 2);
        mm.beginPath();
        mm.moveTo(0, -6); mm.lineTo(4, 5); mm.lineTo(-4, 5);
        mm.closePath(); mm.fill();
        mm.restore();
      } else {
        mm.beginPath();
        mm.arc(toMmX(e.pos.x), toMmZ(e.pos.z), 3.5, 0, Math.PI * 2);
        mm.fill();
      }
    }
    if (state.bomb.state === 'planted') {
      mm.fillStyle = '#ff2222';
      mm.beginPath();
      mm.arc(toMmX(state.bomb.pos.x), toMmZ(state.bomb.pos.z), 4.5, 0, Math.PI * 2);
      mm.fill();
    }
  }

  // Buy menu rows, built once.
  if (refs['buy-list']) {
    refs['buy-list'].innerHTML = '';
    for (const item of BUY_ITEMS) {
      const row = document.createElement('div');
      row.className = 'buy-row';
      row.innerHTML = `<span class="buy-key">${item.key}</span>
        <span class="buy-name">${item.name}</span>
        <span class="buy-desc">${item.desc}</span>
        <span class="buy-price">$${item.price}</span>`;
      refs['buy-list'].appendChild(row);
    }
  }

  refs['play-btn']?.addEventListener('click', () => callbacks.onPlay());

  let lastFeedLen = 0;
  function updateFeed() {
    const now = state.time;
    while (state.feed.length > 0 && state.feed[0].until < now) state.feed.shift();
    if (state.feed.length === lastFeedLen) return;
    lastFeedLen = state.feed.length;
    if (!refs.feed) return;
    refs.feed.innerHTML = '';
    for (const f of state.feed) {
      const div = document.createElement('div');
      div.className = `feed-line ${f.team}`;
      div.textContent = f.text;
      refs.feed.appendChild(div);
    }
  }

  let lastRadioLen = 0;
  let lastRadioText = '';
  function updateRadio() {
    const list = state.callouts;
    const key = list.map((c) => c.text).join('|');
    if (list.length === lastRadioLen && key === lastRadioText) return;
    lastRadioLen = list.length;
    lastRadioText = key;
    if (!refs.radio) return;
    refs.radio.innerHTML = '';
    for (const c of list) {
      const div = document.createElement('div');
      div.className = `radio-line ${c.team}`;
      div.textContent = c.text;
      refs.radio.appendChild(div);
    }
  }

  function update(state) {
    const p = state.players[0];
    const inGame = state.phase === 'buy' || state.phase === 'live' || state.phase === 'roundEnd';
    show(refs['crosshair'], inGame && p.alive && !state.buyOpen);
    if (refs.vignette) {
      const a = p.alive ? Math.min(0.75, state.damageFlash * 0.8 + (p.health < 35 ? 0.3 : 0)) : 0.6;
      refs.vignette.style.opacity = String(a);
    }

    // Hitmarker: flash on a hit, red on a kill or headshot.
    const hm = state.hitmark;
    const hmOn = inGame && p.alive && state.time - hm.at < 0.18 && hm.at >= 0;
    show(refs.hitmarker, hmOn);
    if (refs.hitmarker) refs.hitmarker.classList.toggle('kill', hm.kill || hm.head);

    // Damage direction: rotate the arc toward whoever shot you.
    if (refs.dmgdir) {
      const on = p.alive && state.damageFlash > 0.25 && state.damageFromYaw !== undefined;
      refs.dmgdir.style.opacity = on ? String(Math.min(1, state.damageFlash)) : '0';
      if (on) {
        const deg = (state.damageFromYaw - p.yaw) * (180 / Math.PI);
        refs.dmgdir.style.transform = `rotate(${deg.toFixed(0)}deg)`;
      }
    }

    // Health / ammo / money.
    setText('health-num', String(Math.max(0, Math.ceil(p.health))));
    setWidth('health-bar', Math.max(0, p.health));
    setText('money', `$${state.money}`);
    const def = WEAPONS[p.weapon];
    setText('ammo-mag', String(p.mag[p.weapon]));
    setText('ammo-reserve', `/ ${p.reserve[p.weapon]}`);
    setText('weapon-name', def.name.toUpperCase());
    const nades = [];
    if (p.grenades > 0) nades.push(`G ×${p.grenades}`);
    if (p.smokes > 0) nades.push(`F ×${p.smokes}`);
    setText('grenades', nades.join('  '));
    const ammoEl = document.getElementById('ammo');
    if (ammoEl) ammoEl.classList.toggle('empty', p.mag[p.weapon] === 0);

    // Score / timer / round.
    setText('score-van', String(state.score.van));
    setText('score-jac', String(state.score.jac));
    setText('round-num', `ROUND ${state.round}`);
    if (state.bomb.state === 'planted') {
      setText('timer', fmtTime(state.bomb.timer));
      refs.timer?.classList.add('danger');
    } else if (state.phase === 'live') {
      setText('timer', fmtTime(state.roundTimeLeft));
      refs.timer?.classList.remove('danger');
    } else if (state.phase === 'buy') {
      setText('timer', `BUY ${fmtTime(Math.max(0, 15 - state.phaseTime))}`);
      refs.timer?.classList.remove('danger');
    } else {
      setText('timer', '--:--');
    }

    // Team pips.
    setText('team-van', `VAN ${aliveCount(state, 'van')}`);
    setText('team-jac', `JAC ${aliveCount(state, 'jac')}`);

    // Bomb status line.
    if (state.bomb.state === 'planted') {
      setText('bomb-status', `BOMB @ SITE ${state.bomb.site}`);
      setText('bomb-timer', fmtTime(state.bomb.timer));
      show(refs['bomb-status'], true);
    } else {
      show(refs['bomb-status'], false);
    }

    // Plant / defuse progress bar.
    const planting = state.bomb.state === 'idle' && state.bomb.plantProgress > 0.01;
    const defusing = state.bomb.state === 'planted' && state.bomb.defuseProgress > 0.01;
    if (planting || defusing) {
      const pct = planting ? state.bomb.plantProgress : state.bomb.defuseProgress;
      setText('plant-label', planting ? 'PLANTING…' : 'DEFUSING…');
      setWidth('plant-fill', pct * 100);
      show(refs['plant-bar'], true);
    } else {
      show(refs['plant-bar'], false);
    }

    // Banner.
    if (state.banner && state.time < state.banner.until) {
      setText('banner-title', state.banner.text);
      setText('banner-sub', state.banner.sub);
      show(refs.banner, true);
    } else {
      show(refs.banner, false);
    }

    // Buy menu.
    show(refs['buy-menu'], state.buyOpen && state.phase === 'buy');

    // Hint line: contextual, one line.
    let hint = '';
    if (state.phase === 'buy') hint = 'B buy menu · 1–6 buy · WASD move · Click fire';
    else if (state.phase === 'live' && p.alive) {
      const inSite = Object.values(SITES).some((s) => p.pos.x >= s.x0 && p.pos.x <= s.x1 && p.pos.z >= s.z0 && p.pos.z <= s.z1);
      if (state.bomb.state === 'idle' && inSite) hint = 'Hold E to plant the bomb';
      else if (state.bomb.state === 'planted' && Math.hypot(p.pos.x - state.bomb.pos.x, p.pos.z - state.bomb.pos.z) < 2.5) hint = 'Hold E to defuse';
      else if (state.bomb.state === 'planted') hint = `Bomb planted at site ${state.bomb.site}`;
      else hint = 'Plant the bomb at A or B · E plant · G frag · F smoke · Ctrl crouch';
    }
    setText('hint', hint);
    show(refs.hint, hint !== '');

    // Spectate label.
    if (!p.alive && state.spectate >= 0) {
      const t = state.players[state.spectate];
      setText('spectate', t ? `Spectating ${t.name}` : '');
      show(refs.spectate, true);
    } else {
      show(refs.spectate, false);
    }

    // Crosshair spread follows the current weapon spread.
    if (refs.crosshair) {
      const spread = p.alive ? 4 + (p.bloom * 220) + (Math.hypot(p.vel.x, p.vel.z) * 1.6) : 4;
      refs.crosshair.style.setProperty('--gap', `${spread.toFixed(1)}px`);
    }

    // Overlays.
    if (state.phase === 'menu') {
      setText('overlay-title', 'SANDLINE');
      setText('overlay-copy', 'Yard 7 — a 5v5 tactical shooter. Plant the bomb, hold the sites, win 5 rounds. Vanguard attacks; Jackals defend.');
      setText('play-btn', 'Click to play');
      show(refs.overlay, true);
      show(refs['end-stats'], false);
    } else if (state.phase === 'matchEnd') {
      const won = state.matchWinner === 'van';
      setText('overlay-title', won ? 'VANGUARD WINS THE MATCH' : 'JACKALS WIN THE MATCH');
      setText('overlay-copy', `Final score ${state.score.van} – ${state.score.jac}. Press R or click below to run it back.`);
      setText('play-btn', 'Play again');
      const acc = state.stats.shots > 0 ? Math.round((state.stats.hits / state.stats.shots) * 100) : 0;
      setText('end-stats', `Your line: ${p.kills} kills · ${p.deaths} deaths · ${acc}% accuracy · ${state.stats.headshots} headshots`);
      show(refs.overlay, true);
      show(refs['end-stats'], true);
    } else if (!state.locked && inGame && !state.demoCam && !state.demo) {
      setText('overlay-title', 'PAUSED');
      setText('overlay-copy', 'Click to lock the mouse and keep playing.');
      setText('play-btn', 'Resume');
      show(refs.overlay, true);
      show(refs['end-stats'], false);
    } else {
      show(refs.overlay, false);
    }

    updateFeed();
    updateRadio();
    drawMinimap();
  }

  return { update };
}
