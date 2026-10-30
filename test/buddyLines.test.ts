import { describe, expect, it } from 'vitest';
import { buddyStatus } from '../src/buddyLines';
import { CHARACTERS, character, spokenAlert } from '../src/characters';
import type { AgentState } from '../src/parsers';
import type { Session } from '../src/watcher';

const now = 1_000_000_000;
const session = (state: AgentState, folder: string, agent: 'claude' | 'codex' = 'claude', agoMs = 0): Session => ({
  key: `${agent}:${folder}`,
  agent,
  sessionId: folder,
  cwd: `/home/me/${folder}`,
  state,
  lastActivity: now - agoMs,
});

describe('buddyStatus', () => {
  it('sleeps when there are no sessions', () => {
    expect(buddyStatus([], now).mood).toBe('sleep');
  });

  it('puts approval above everything else', () => {
    const s = buddyStatus([session('working', 'a'), session('done', 'b'), session('needs_approval', 'web-app', 'codex')], now);
    expect(s.mood).toBe('alert');
    expect(s.line).toBe('Psst! Codex might need your approval in web-app.');
    expect(s.focus?.cwd).toBe('/home/me/web-app');
    expect(s.short).toBe('Codex needs you · web-app');
  });

  it('is happy right after a session finishes, then calms down', () => {
    expect(buddyStatus([session('done', 'api', 'claude', 10_000)], now).mood).toBe('happy');
    expect(buddyStatus([session('done', 'api', 'claude', 10 * 60_000)], now).mood).toBe('idle');
  });

  it('summarises several working agents', () => {
    const s = buddyStatus([session('working', 'a'), session('working', 'b', 'codex')], now);
    expect(s.mood).toBe('working');
    expect(s.line).toContain('2 agents');
  });
});

describe('spokenAlert', () => {
  it('keeps plain lines short', () => {
    expect(spokenAlert(session('done', 'barber-platform', 'codex'))).toBe('Codex is done.');
    expect(spokenAlert(session('needs_approval', 'x'), undefined, 'Haydar')).toBe('Haydar, Claude needs your approval.');
  });

  it('says nothing for working sessions', () => {
    expect(spokenAlert(session('working', 'x'))).toBe('');
  });
});

describe('characters', () => {
  it('each character has its own wording', () => {
    expect(spokenAlert(session('needs_approval', 'api'), CHARACTERS.cat, 'Haydar')).toBe('Haydar, Claude needs you. Meow!');
    expect(spokenAlert(session('done', 'api', 'codex'), CHARACTERS.cat, 'Haydar')).toBe('Codex is done, Haydar. Purr!');
    expect(spokenAlert(session('needs_approval', 'my-app'), CHARACTERS.coach, 'Haydar')).toBe("Haydar! Claude needs you. Let's go!");
    expect(spokenAlert(session('done', 'api'), CHARACTERS.robot, 'Haydar')).toBe('Claude task complete, Haydar.');
  });

  it('reads naturally without a name', () => {
    expect(spokenAlert(session('needs_approval', 'api'), CHARACTERS.cat)).toBe('Claude needs you. Meow!');
    expect(spokenAlert(session('needs_input', 'api'), CHARACTERS.coach)).toBe('Champ, Claude has a question!');
    expect(CHARACTERS.coach.hello('')).toBe("Let's go, champ! I've got your agents.");
    expect(CHARACTERS.cat.hello('Haydar')).toBe("Meow, Haydar! I'm watching your agents.");
  });

  it('keeps every spoken line short', () => {
    for (const c of Object.values(CHARACTERS)) {
      for (const say of Object.values(c.says)) expect(say('Claude', 'Alexandra').split(' ').length).toBeLessThanOrEqual(7);
    }
  });

  it('every character has faces for every mood and sounds for every alert', () => {
    for (const c of Object.values(CHARACTERS)) {
      for (const mood of ['sleep', 'idle', 'working', 'alert', 'happy'] as const) expect(c.faces[mood]).toHaveLength(2);
      for (const k of ['needs_approval', 'needs_input', 'done', 'hello', 'poke'] as const) expect(c.sounds[k]).toBeTruthy();
    }
  });

  it('falls back to the cat for unknown settings', () => {
    expect(character('unicorn').id).toBe('cat');
    expect(character('coach').id).toBe('coach');
  });
});
