// Procedural sound: every effect is synthesized with WebAudio, so the game
// ships no audio files. The sim calls state.audioHook(name, arg); this
// module owns the AudioContext and ignores calls before the first gesture.

let ctx = null;
let master = null;

function ensure() {
  if (ctx) {
    if (ctx.state === 'suspended') {
      const r = ctx.resume();
      if (r && r.catch) r.catch(() => {});
    }
    return true;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    return true;
  } catch {
    return false;
  }
}

function noiseBuffer(seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

let _noise = null;
function burst({ freq = 1000, q = 1, dur = 0.12, gain = 0.5, type = 'lowpass', when = 0 }) {
  if (!ctx) return;
  if (!_noise) _noise = noiseBuffer(0.5);
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = _noise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start(t, Math.random() * 0.3, dur + 0.05);
}

function tone({ freq = 440, dur = 0.1, gain = 0.3, type = 'sine', when = 0, slide = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide !== 0) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// Distance-attenuated gain for a world position (listener = player).
function atten(state, pos) {
  if (!pos || !state) return 1;
  const p = state.players[0];
  const d = Math.hypot(pos.x - p.pos.x, pos.z - p.pos.z);
  return Math.max(0.05, 1 - d / 45);
}

export function createAudioHook(state) {
  return function audioHook(name, arg) {
    if (state.muted) return;
    if (!ensure()) return;
    switch (name) {
      case 'shoot': {
        const deep = arg === 'vk47' || arg === 'm870';
        burst({ freq: deep ? 700 : 1400, dur: deep ? 0.16 : 0.09, gain: deep ? 0.7 : 0.45 });
        tone({ freq: deep ? 120 : 200, dur: 0.08, gain: 0.25, type: 'square', slide: -60 });
        break;
      }
      case 'dry':
        tone({ freq: 1200, dur: 0.03, gain: 0.2, type: 'square' });
        break;
      case 'reload':
        tone({ freq: 900, dur: 0.04, gain: 0.2, type: 'square' });
        tone({ freq: 600, dur: 0.05, gain: 0.2, type: 'square', when: 0.18 });
        break;
      case 'hit':
        tone({ freq: 1800, dur: 0.05, gain: 0.25, type: 'sine' });
        break;
      case 'headshot':
        tone({ freq: 2400, dur: 0.07, gain: 0.3, type: 'sine' });
        tone({ freq: 3200, dur: 0.06, gain: 0.2, type: 'sine', when: 0.05 });
        break;
      case 'kill':
        tone({ freq: 660, dur: 0.09, gain: 0.25, type: 'triangle' });
        tone({ freq: 990, dur: 0.12, gain: 0.25, type: 'triangle', when: 0.08 });
        break;
      case 'death':
        tone({ freq: 300, dur: 0.4, gain: 0.3, type: 'sawtooth', slide: -200 });
        break;
      case 'buy':
        tone({ freq: 880, dur: 0.07, gain: 0.25, type: 'triangle' });
        tone({ freq: 1320, dur: 0.09, gain: 0.25, type: 'triangle', when: 0.07 });
        break;
      case 'deny':
        tone({ freq: 220, dur: 0.12, gain: 0.25, type: 'square' });
        break;
      case 'throw':
        burst({ freq: 500, dur: 0.15, gain: 0.2 });
        break;
      case 'explosion': {
        const a = atten(state, arg);
        burst({ freq: 220, dur: 0.7, gain: 0.9 * a });
        tone({ freq: 70, dur: 0.6, gain: 0.6 * a, type: 'sine', slide: -30 });
        break;
      }
      case 'beep':
        tone({ freq: arg === 2 ? 1600 : 1200, dur: 0.06, gain: 0.3, type: 'square' });
        break;
      case 'plantStart':
      case 'defuseStart':
        tone({ freq: 500, dur: 0.08, gain: 0.25, type: 'triangle' });
        break;
      case 'planted':
        tone({ freq: 440, dur: 0.15, gain: 0.3, type: 'square' });
        tone({ freq: 440, dur: 0.15, gain: 0.3, type: 'square', when: 0.2 });
        break;
      case 'roundStart':
        tone({ freq: 520, dur: 0.1, gain: 0.2, type: 'triangle' });
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.16, gain: 0.25, type: 'triangle', when: i * 0.11 }));
        break;
      case 'lose':
        [392, 330, 262].forEach((f, i) => tone({ freq: f, dur: 0.18, gain: 0.25, type: 'triangle', when: i * 0.13 }));
        break;
      default:
        break;
    }
  };
}

// Call from a user gesture so the context is allowed to start.
export function unlockAudio() {
  ensure();
}
