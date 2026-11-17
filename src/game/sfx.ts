/**
 * 효과음 — 음원 파일 없이 Web Audio로 짧게 합성한다(저작권 확인이 필요 없다).
 * 설정에서 끌 수 있고, 앱이 백그라운드로 가면 즉시 멈춘다.
 */

export type Sfx =
  | 'launch'
  | 'bumper'
  | 'coin'
  | 'milestone'
  | 'drain'
  | 'open'
  | 'flag'
  | 'boom'
  | 'win'
  | 'buy';

let enabled = true;
let suspended = false;
let ctx: AudioContext | null = null;

/** 광고·결제처럼 다른 화면이 소리를 내는 동안 효과음을 멈춘다 */
export function setSfxSuspended(on: boolean): void {
  suspended = on;
  if (!ctx) return;
  if (on) void ctx.suspend();
  else if (enabled && !document.hidden) void ctx.resume();
}
const lastPlayed = new Map<Sfx, number>();

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  if (!on) void ctx?.suspend();
}

function audio(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    ctx = Ctor ? new Ctor() : null;
  } catch {
    ctx = null;
  }
  return ctx;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else if (enabled && !suspended) void ctx.resume();
  });
}

function tone(ac: AudioContext, at: number, freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function noise(ac: AudioContext, at: number, dur: number, gain: number) {
  const length = Math.floor(ac.sampleRate * dur);
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const src = ac.createBufferSource();
  const g = ac.createGain();
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  src.buffer = buffer;
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(at);
}

const MIN_GAP: Partial<Record<Sfx, number>> = { bumper: 45, open: 40 };

export function playSfx(name: Sfx): void {
  if (!enabled || suspended || (typeof document !== 'undefined' && document.hidden)) return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? 0) < (MIN_GAP[name] ?? 0)) return;
  lastPlayed.set(name, now);

  const ac = audio();
  if (!ac) return;
  if (ac.state === 'suspended') void ac.resume();
  const t = ac.currentTime;
  switch (name) {
    case 'launch':
      tone(ac, t, 180, 0.25, 'sawtooth', 0.08, 520);
      break;
    case 'bumper':
      tone(ac, t, 660 + Math.random() * 120, 0.08, 'square', 0.05);
      break;
    case 'coin':
      tone(ac, t, 988, 0.08, 'square', 0.06);
      tone(ac, t + 0.07, 1319, 0.16, 'square', 0.06);
      break;
    case 'milestone':
      [523, 659, 784, 1047].forEach((f, i) => tone(ac, t + i * 0.08, f, 0.18, 'triangle', 0.08));
      break;
    case 'drain':
      tone(ac, t, 330, 0.4, 'triangle', 0.09, 110);
      break;
    case 'open':
      tone(ac, t, 520, 0.05, 'triangle', 0.05);
      break;
    case 'flag':
      tone(ac, t, 740, 0.07, 'triangle', 0.06, 880);
      break;
    case 'boom':
      noise(ac, t, 0.5, 0.35);
      tone(ac, t, 120, 0.45, 'sine', 0.2, 40);
      break;
    case 'win':
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(ac, t + i * 0.09, f, 0.22, 'triangle', 0.08));
      break;
    case 'buy':
      tone(ac, t, 784, 0.1, 'triangle', 0.07);
      tone(ac, t + 0.09, 1175, 0.2, 'triangle', 0.07);
      break;
  }
}
