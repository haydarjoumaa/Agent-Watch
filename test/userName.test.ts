import { describe, expect, it } from 'vitest';
import { firstName } from '../src/userName';

describe('firstName', () => {
  it('takes and capitalises the first name', () => {
    expect(firstName('haydar jomaa')).toBe('Haydar');
    expect(firstName('  Zoë  Smith\n')).toBe('Zoë');
  });

  it('rejects things that are not names', () => {
    expect(firstName('')).toBe('');
    expect(firstName(undefined)).toBe('');
    expect(firstName('user123')).toBe('');
    expect(firstName('me@example.com')).toBe('');
  });
});
