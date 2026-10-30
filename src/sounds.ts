import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Every character sound is synthesized on the fly, so the extension ships no audio files.

export type SoundKind =
  | 'meow-alert'
  | 'meow-question'
  | 'meow-happy'
  | 'meow-hello'
  | 'meow-trill'
  | 'whistle'
  | 'whistle-short'
  | 'bell'
  | 'beep-alert'
  | 'beep-question'
  | 'beep-happy'
  | 'beep-hello';

const SAMPLE_RATE = 22050;

// ---------- Meow: a pitch glide through formant-shaped harmonics ("mi-a-ow") ----------

interface MeowShape {
  duration: number; // seconds
  /** Pitch contour as [time fraction, Hz] points. */
  pitch: [number, number][];
  /** Rolled-"r" flutter rate in Hz, for trills. */
  flutter?: number;
}

const MEOWS: Record<string, MeowShape> = {
  // Urgent "MRROW!"
  alert: { duration: 0.55, pitch: [[0, 520], [0.25, 900], [0.6, 820], [1, 500]] },
  // Rising at the end, like asking something: "mew?"
  question: { duration: 0.5, pitch: [[0, 600], [0.4, 700], [0.7, 650], [1, 950]] },
  // Long, content "meeeow~"
  happy: { duration: 0.75, pitch: [[0, 650], [0.3, 800], [0.7, 700], [1, 520]] },
  // Short, friendly "mew"
  hello: { duration: 0.35, pitch: [[0, 700], [0.4, 850], [1, 650]] },
  // Rolled, rising "mrrrp!" that cats make when greeting
  trill: { duration: 0.4, pitch: [[0, 550], [0.6, 750], [1, 900]], flutter: 28 },
};

// Formants (Hz) for the vowels in "m-i-a-o-w": [time fraction, F1, F2].
const VOWELS: [number, number, number][] = [
  [0, 300, 1800],
  [0.25, 400, 2300],
  [0.55, 850, 1400],
  [0.85, 550, 950],
  [1, 400, 800],
];

function interp(points: [number, ...number[]][], t: number, index: number): number {
  for (let i = 1; i < points.length; i++) {
    const [t1] = points[i];
    if (t <= t1) {
      const [t0] = points[i - 1];
      const a = points[i - 1][index];
      const b = points[i][index];
      const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      // Smoothstep makes the glides sound less mechanical.
      const s = f * f * (3 - 2 * f);
      return a + (b - a) * s;
    }
  }
  return points[points.length - 1][index];
}

/** Resonance gain of a formant at frequency `f`. */
function formant(f: number, center: number, bandwidth: number): number {
  const d = (f - center) / bandwidth;
  return 1 / (1 + d * d);
}

function meow({ duration, pitch, flutter }: MeowShape): Float32Array {
  const n = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(n);
  const phases = new Float64Array(24);

  for (let i = 0; i < n; i++) {
    const t = i / n;
    const vibrato = 1 + 0.015 * Math.sin(2 * Math.PI * 6 * (i / SAMPLE_RATE));
    const f0 = interp(pitch, t, 1) * vibrato;
    const f1 = interp(VOWELS, t, 1);
    const f2 = interp(VOWELS, t, 2);

    let v = 0;
    for (let h = 1; h <= phases.length; h++) {
      const fh = f0 * h;
      if (fh > SAMPLE_RATE / 2 - 500) break;
      phases[h - 1] += (2 * Math.PI * fh) / SAMPLE_RATE;
      // Steep roll-off of upper harmonics keeps the meow soft rather than buzzy.
      const gain = (formant(fh, f1, 120) + 0.5 * formant(fh, f2, 180) + 0.03) / h ** 1.8;
      v += gain * Math.sin(phases[h - 1]);
    }

    // Soft "m" onset, then a swell and a gentle fade.
    const attack = Math.min(1, t / 0.12);
    const release = Math.min(1, (1 - t) / 0.25);
    const roll = flutter ? 0.55 + 0.45 * Math.sin(2 * Math.PI * flutter * (i / SAMPLE_RATE)) : 1;
    samples[i] = v * attack * attack * release * roll;
  }
  return samples;
}

// ---------- Coach's pea whistle: a warbling high tone with a little breath ----------

function whistle(blasts: [start: number, length: number][]): Float32Array {
  const total = Math.max(...blasts.map(([s, l]) => s + l));
  const n = Math.floor(total * SAMPLE_RATE);
  const samples = new Float32Array(n);
  let phase = 0;
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

  for (let i = 0; i < n; i++) {
    const sec = i / SAMPLE_RATE;
    const blast = blasts.find(([s, l]) => sec >= s && sec < s + l);
    if (!blast) continue;
    const [start, length] = blast;
    const local = sec - start;
    const env = Math.min(1, local / 0.015) * Math.min(1, (length - local) / 0.04);
    // The pea rattling inside the whistle wobbles both pitch and loudness.
    const pea = Math.sin(2 * Math.PI * 32 * sec);
    phase += (2 * Math.PI * (2300 + 110 * pea)) / SAMPLE_RATE;
    samples[i] = env * (0.65 + 0.35 * pea) * (Math.sin(phase) + 0.08 * noise());
  }
  return samples;
}

// ---------- Boxing-ring bell: two strikes of decaying inharmonic partials ----------

function bell(): Float32Array {
  const strikes = [0, 0.32];
  const partials: [ratio: number, amp: number, decay: number][] = [
    [1, 1, 0.9],
    [2.0, 0.45, 0.6],
    [2.76, 0.35, 0.4],
    [5.4, 0.12, 0.18],
  ];
  const n = Math.floor(1.4 * SAMPLE_RATE);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const sec = i / SAMPLE_RATE;
    let v = 0;
    for (const s of strikes) {
      const local = sec - s;
      if (local < 0) continue;
      const attack = Math.min(1, local / 0.003);
      for (const [ratio, amp, decay] of partials) {
        v += attack * amp * Math.exp(-local / decay) * Math.sin(2 * Math.PI * 880 * ratio * local);
      }
    }
    samples[i] = v;
  }
  return samples;
}

// ---------- Robot beeps: soft square-ish tones in a little melody ----------

function beeps(notes: [hz: number, length: number][]): Float32Array {
  const gap = 0.05;
  const total = notes.reduce((sum, [, l]) => sum + l + gap, 0);
  const samples = new Float32Array(Math.floor(total * SAMPLE_RATE));
  let offset = 0;
  for (const [hz, length] of notes) {
    const len = Math.floor(length * SAMPLE_RATE);
    for (let j = 0; j < len; j++) {
      const local = j / SAMPLE_RATE;
      const env = Math.min(1, local / 0.01) * Math.min(1, (length - local) / 0.02);
      const w = 2 * Math.PI * hz * local;
      samples[offset + j] = env * (Math.sin(w) + 0.25 * Math.sin(3 * w) + 0.1 * Math.sin(5 * w));
    }
    offset += Math.floor((length + gap) * SAMPLE_RATE);
  }
  return samples;
}

function synthesize(kind: SoundKind): Float32Array {
  switch (kind) {
    case 'whistle':
      return whistle([[0, 0.14], [0.22, 0.45]]); // "tweet-tweeeet"
    case 'whistle-short':
      return whistle([[0, 0.2]]);
    case 'bell':
      return bell();
    case 'beep-alert':
      return beeps([[880, 0.12], [1320, 0.12], [880, 0.12], [1320, 0.12]]);
    case 'beep-question':
      return beeps([[660, 0.12], [990, 0.22]]);
    case 'beep-happy':
      return beeps([[660, 0.1], [880, 0.1], [1320, 0.22]]);
    case 'beep-hello':
      return beeps([[990, 0.1], [1320, 0.12]]);
    default:
      return meow(MEOWS[kind.slice('meow-'.length)]);
  }
}

/** Some sounds are naturally piercing; keep them in line with the soft meow at the same volume. */
const LOUDNESS: Partial<Record<SoundKind, number>> = {
  whistle: 0.45,
  'whistle-short': 0.45,
  'beep-alert': 0.6,
  'beep-question': 0.6,
  'beep-happy': 0.6,
  'beep-hello': 0.6,
};

/** A mono 16-bit WAV of the sound. `volume` is 0–1. */
export function soundWav(kind: SoundKind, volume = 1): Buffer {
  const samples = synthesize(kind);
  const n = samples.length;
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const level = Math.min(1, Math.max(0, volume)) * (LOUDNESS[kind] ?? 1);
  const scale = peak > 0 ? (0.8 * level) / peak : 0;

  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(samples[i] * scale * 32767), i * 2);

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Path to a cached WAV file for this sound, generating it on first use. */
export function soundFile(kind: SoundKind, volume = 1): string {
  const level = Math.round(Math.min(1, Math.max(0, volume)) * 100);
  const dir = path.join(os.tmpdir(), 'agent-watch-sounds');
  const file = path.join(dir, `${kind}-v4-${level}.wav`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, soundWav(kind, level / 100));
  }
  return file;
}
