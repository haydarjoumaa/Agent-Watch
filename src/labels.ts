import * as path from 'path';
import type { AgentState } from './parsers';
import type { Session } from './watcher';

export const AGENT_LABEL = { claude: 'Claude', codex: 'Codex' } as const;

export const STATE_LABEL: Record<AgentState, string> = {
  working: 'working',
  needs_approval: 'may need approval',
  needs_input: 'waiting for you',
  done: 'finished',
};

export function folderName(s: Session): string {
  return s.cwd ? path.basename(s.cwd) : s.sessionId.slice(0, 8);
}

export function ago(ms: number, now = Date.now()): string {
  const sec = Math.max(0, Math.round((now - ms) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  return min < 60 ? `${min}m ago` : `${Math.round(min / 60)}h ago`;
}
