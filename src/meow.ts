import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// A synthesized "mi-a-ow": a pitch glide through formant-shaped harmonics.
// Generated on the fly, so the extension ships no audio files.

export type MeowKind = 'alert' | 'question' | 'happy' | 'hello';

interface MeowShape {
  duration: number; // seconds
  /** Pitch contour as [time fraction, Hz] points. */
  pitch: [number, number][];
}

const SHAPES: Record<MeowKind, MeowShape> = {
  // Urgent, loud "MRROW!"
  alert: { duration: 0.55, pitch: [[0, 520], [0.25, 900], [0.6, 820], [1, 500]] },
  // Rising at the end, like asking something: "mew?"
  question: { duration: 0.5, pitch: [[0, 600], [0.4, 700], [0.7, 650], [1, 950]] },
  // Long, content "meeeow~"
  happy: { duration: 0.75, pitch: [[0, 650], [0.3, 800], [0.7, 700], [1, 520]] },
  // Short, friendly "mew"
  hello: { duration: 0.35, pitch: [[0, 700], [0.4, 850], [1, 650]] },
};

// Formants (Hz) for the vowels in "m-i-a-o-w".
const VOWELS: [number, number, number][] = [
  // [time fraction, F1, F2]
  [0, 300, 1800], // m / i
  [0.25, 400, 2300], // i
  [0.55, 850, 1400], // a
  [0.85, 550, 950], // o
  [1, 400, 800], // w
];

const SAMPLE_RATE = 22050;

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

export function meowWav(kind: MeowKind): Buffer {
  const { duration, pitch } = SHAPES[kind];
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
      const gain = (formant(fh, f1, 120) + 0.7 * formant(fh, f2, 180) + 0.05) / h;
      v += gain * Math.sin(phases[h - 1]);
    }

    // Soft "m" onset, then a swell and a gentle fade.
    const attack = Math.min(1, t / 0.12);
    const release = Math.min(1, (1 - t) / 0.25);
    samples[i] = v * attack * attack * release;
  }

  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const scale = peak > 0 ? 0.8 / peak : 0;

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

/** Path to a cached WAV file for this meow, generating it on first use. */
export function meowFile(kind: MeowKind): string {
  const dir = path.join(os.tmpdir(), 'agent-watch-sounds');
  const file = path.join(dir, `meow-${kind}-v1.wav`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, meowWav(kind));
  }
  return file;
}
