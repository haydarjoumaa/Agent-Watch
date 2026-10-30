import { describe, expect, it } from 'vitest';
import { SoundKind, soundWav } from '../src/sounds';
import { normalizeStyle } from '../src/speech';

const peak = (wav: Buffer) => {
  let p = 0;
  for (let i = 44; i < wav.length; i += 2) p = Math.max(p, Math.abs(wav.readInt16LE(i)));
  return p;
};

const ALL: SoundKind[] = [
  'meow-alert', 'meow-question', 'meow-happy', 'meow-hello', 'meow-trill',
  'whistle', 'whistle-short', 'bell',
  'beep-alert', 'beep-question', 'beep-happy', 'beep-hello',
];

describe('soundWav', () => {
  it.each(ALL)('%s is a valid, audible mono 16-bit WAV', (kind) => {
    const wav = soundWav(kind);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    expect(peak(wav)).toBeGreaterThan(10000);
    expect(peak(wav)).toBeLessThanOrEqual(32767);
  });

  it('scales with volume', () => {
    const full = peak(soundWav('meow-happy', 1));
    expect(peak(soundWav('meow-happy', 0.3)) / full).toBeCloseTo(0.3, 1);
    expect(peak(soundWav('meow-happy', 0))).toBe(0);
  });

  it('keeps the piercing whistle quieter than a meow at the same volume', () => {
    expect(peak(soundWav('whistle', 1))).toBeLessThan(peak(soundWav('meow-alert', 1)));
  });
});

describe('normalizeStyle', () => {
  it('maps old setting values', () => {
    expect(normalizeStyle('cat')).toBe('character');
    expect(normalizeStyle('meow')).toBe('sound');
    expect(normalizeStyle('plain')).toBe('plain');
    expect(normalizeStyle(undefined)).toBe('character');
  });
});
