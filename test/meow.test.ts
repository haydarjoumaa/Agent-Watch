import { describe, expect, it } from 'vitest';
import { meowWav } from '../src/meow';

describe('meowWav', () => {
  it('produces a valid, non-silent mono 16-bit WAV', () => {
    const wav = meowWav('alert');
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    let peak = 0;
    for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
    expect(peak).toBeGreaterThan(20000);
    expect(peak).toBeLessThanOrEqual(32767);
  });
});
