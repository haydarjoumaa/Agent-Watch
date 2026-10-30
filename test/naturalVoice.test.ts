import { describe, expect, it } from 'vitest';
import { styleWav } from '../src/naturalVoice';
import { soundWav } from '../src/sounds';

const peak = (wav: Buffer) => {
  let p = 0;
  for (let i = 44; i < wav.length; i += 2) p = Math.max(p, Math.abs(wav.readInt16LE(i)));
  return p;
};

describe('styleWav', () => {
  const input = soundWav('meow-happy', 1); // any 16-bit mono WAV at 22050 Hz

  it('shifts pitch by changing the playback rate', () => {
    expect(styleWav(input, { pitch: 1.35, speed: 1 }, 1).readUInt32LE(24)).toBe(Math.round(22050 * 1.35));
    expect(styleWav(input, { pitch: 0.95, speed: 1 }, 1).readUInt32LE(24)).toBe(Math.round(22050 * 0.95));
  });

  it('applies volume and keeps a valid WAV', () => {
    const out = styleWav(input, { pitch: 1, speed: 1 }, 0.5);
    expect(out.toString('ascii', 0, 4)).toBe('RIFF');
    expect(out.readUInt32LE(4)).toBe(out.length - 8);
    expect(peak(out) / peak(input)).toBeCloseTo(0.5, 1);
  });

  it('rejects non-WAV input', () => {
    expect(() => styleWav(Buffer.from('nope'), { pitch: 1, speed: 1 }, 1)).toThrow();
  });
});
