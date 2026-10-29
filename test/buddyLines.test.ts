import { describe, expect, it } from 'vitest';
import { buddyStatus, meowFor, spokenAlert } from '../src/buddyLines';
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
  it('speaks folder names without dashes', () => {
    expect(spokenAlert(session('done', 'barber-platform', 'codex'))).toBe('Codex finished in barber platform.');
  });

  it('says nothing for working sessions', () => {
    expect(spokenAlert(session('working', 'x'))).toBe('');
  });
});

describe('cat voice', () => {
  it('uses cat puns', () => {
    expect(spokenAlert(session('done', 'api', 'codex'), true)).toBe('Codex finished in api. Purrfect!');
    expect(spokenAlert(session('needs_approval', 'api'), true)).toBe('Mrrow! Claude needs your approval in api.');
  });

  it('picks a meow per alert', () => {
    expect(meowFor('needs_approval')).toBe('alert');
    expect(meowFor('needs_input')).toBe('question');
    expect(meowFor('done')).toBe('happy');
  });
});
