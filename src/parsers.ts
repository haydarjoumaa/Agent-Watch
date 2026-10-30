// Parsers for the session logs Claude Code and Codex already write locally.
// These formats are not a public API, so everything here is best-effort:
// unknown or malformed lines are skipped, and an unreadable log yields null.

export type AgentKind = 'claude' | 'codex';

/** What the log says, independent of time. */
export type Phase = 'working' | 'tool_pending' | 'needs_input' | 'turn_done';

/** What we show, after factoring in how long the log has been quiet. */
export type AgentState = 'working' | 'needs_approval' | 'needs_input' | 'done';

/** A tool call that has been issued but has no result yet. */
export interface PendingCall {
  name: string;
  input: any;
}

export interface ParsedSession {
  agent: AgentKind;
  sessionId: string;
  cwd?: string;
  phase: Phase;
  /** Calls that could be waiting on an approval prompt (excludes long-running and ask-the-user tools). */
  pending: PendingCall[];
  /** Claude's permission mode or Codex's approval policy, as last seen in the log. */
  mode?: string;
}

// Tools that legitimately run for a long time without any approval involved.
const LONG_RUNNING_TOOLS = new Set(['Agent', 'Task', 'wait', 'write_stdin']);
// Tools whose whole purpose is to wait for the user.
const ASK_USER_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode', 'request_user_input', 'request_user_input_async']);

function parseLines(text: string): any[] {
  const out: any[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // Partial first line from a tail read, or garbage: skip.
    }
  }
  return out;
}

export function parseClaude(text: string, fallbackSessionId: string): ParsedSession | null {
  let sessionId = fallbackSessionId;
  let cwd: string | undefined;
  let mode: string | undefined;
  let seen = false;
  let turnDone = false;
  const pending = new Map<string, PendingCall>(); // tool_use id -> call

  for (const entry of parseLines(text)) {
    if (entry?.type !== 'user' && entry?.type !== 'assistant') continue;
    if (entry.isSidechain) continue;
    seen = true;
    if (typeof entry.sessionId === 'string') sessionId = entry.sessionId;
    if (typeof entry.cwd === 'string') cwd = entry.cwd;
    if (typeof entry.permissionMode === 'string') mode = entry.permissionMode;

    const content = entry.message?.content;
    if (entry.type === 'assistant') {
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'tool_use' && typeof block.id === 'string') {
            pending.set(block.id, { name: String(block.name ?? ''), input: block.input ?? {} });
          }
        }
      }
      turnDone = entry.message?.stop_reason === 'end_turn';
      continue;
    }

    // User entry: either tool results or a new prompt / interruption.
    const blocks = Array.isArray(content) ? content : [{ type: 'text', text: content }];
    let isPrompt = false;
    for (const block of blocks) {
      if (block?.type === 'tool_result') {
        pending.delete(block.tool_use_id);
      } else if (block?.type === 'text') {
        isPrompt = true;
        if (String(block.text ?? '').startsWith('[Request interrupted')) {
          pending.clear();
          turnDone = true;
          isPrompt = false;
        }
      }
    }
    if (isPrompt) {
      pending.clear();
      turnDone = false;
    }
  }

  if (!seen) return null;
  return { agent: 'claude', sessionId, cwd, mode, ...phaseFrom([...pending.values()], turnDone) };
}

function phaseFrom(calls: PendingCall[], turnDone: boolean): { phase: Phase; pending: PendingCall[] } {
  const waiting = calls.filter((c) => !LONG_RUNNING_TOOLS.has(c.name) && !ASK_USER_TOOLS.has(c.name));
  if (calls.some((c) => ASK_USER_TOOLS.has(c.name))) return { phase: 'needs_input', pending: waiting };
  if (waiting.length > 0) return { phase: 'tool_pending', pending: waiting };
  if (calls.length > 0) return { phase: 'working', pending: [] };
  return { phase: turnDone ? 'turn_done' : 'working', pending: [] };
}

function parseArguments(raw: unknown): any {
  if (typeof raw !== 'string') return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // free-form input, e.g. a patch or a code-mode script
  }
}

export function parseCodex(
  text: string,
  fallbackSessionId: string,
  fallbackCwd?: string,
): ParsedSession | null {
  let sessionId = fallbackSessionId;
  let cwd = fallbackCwd;
  let mode: string | undefined;
  let seen = false;
  let turnDone = false;
  const pending = new Map<string, PendingCall>(); // call_id -> call

  for (const entry of parseLines(text)) {
    const p = entry?.payload;
    if (!p || typeof p !== 'object') continue;

    switch (entry.type) {
      case 'session_meta':
        if (typeof p.cwd === 'string') cwd = p.cwd;
        if (typeof p.session_id === 'string') sessionId = p.session_id;
        break;
      case 'turn_context':
        if (typeof p.cwd === 'string') cwd = p.cwd;
        if (typeof p.approval_policy === 'string') mode = p.approval_policy;
        break;
      case 'event_msg':
        if (p.type === 'task_started') {
          seen = true;
          turnDone = false;
          pending.clear();
        } else if (p.type === 'task_complete' || p.type === 'turn_aborted') {
          seen = true;
          turnDone = true;
          pending.clear();
        }
        break;
      case 'response_item':
        if (typeof p.type !== 'string' || typeof p.call_id !== 'string') break;
        seen = true;
        if (p.type.endsWith('_call_output')) pending.delete(p.call_id);
        else if (p.type.endsWith('_call')) {
          pending.set(p.call_id, { name: String(p.name ?? ''), input: parseArguments(p.arguments ?? p.input) });
        }
        break;
    }
  }

  if (!seen) return null;
  return { agent: 'codex', sessionId, cwd, mode, ...phaseFrom([...pending.values()], turnDone) };
}

/** Pull `cwd` out of the head of a Codex log, whose first line can be too large to read whole. */
export function codexCwdFromHead(head: string): string | undefined {
  const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head);
  if (!m) return undefined;
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return undefined;
  }
}

/**
 * @param approvalPossible whether any pending call could actually be showing an approval prompt
 *   (false when the user's permission rules or mode auto-allow every pending call).
 */
export function deriveState(
  phase: Phase,
  quietMs: number,
  approvalDelayMs: number,
  approvalPossible = true,
): AgentState {
  switch (phase) {
    case 'tool_pending':
      return approvalPossible && quietMs >= approvalDelayMs ? 'needs_approval' : 'working';
    case 'needs_input':
      return 'needs_input';
    case 'turn_done':
      return 'done';
    default:
      return 'working';
  }
}
