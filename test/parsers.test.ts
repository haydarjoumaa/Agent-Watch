import { describe, expect, it } from 'vitest';
import { codexCwdFromHead, deriveState, parseClaude, parseCodex } from '../src/parsers';

const jsonl = (...entries: unknown[]) => entries.map((e) => JSON.stringify(e)).join('\n');

const cwd = '/home/me/project';
const claudeBase = { sessionId: 'abc', cwd, isSidechain: false };
const prompt = { ...claudeBase, type: 'user', message: { content: 'do the thing' } };
const toolUse = (id: string, name = 'Bash') => ({
  ...claudeBase,
  type: 'assistant',
  message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name }] },
});
const toolResult = (id: string) => ({
  ...claudeBase,
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id }] },
});
const endTurn = {
  ...claudeBase,
  type: 'assistant',
  message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] },
};

describe('parseClaude', () => {
  it('reports a pending tool call', () => {
    const p = parseClaude(jsonl(prompt, toolUse('t1')), 'file-id');
    expect(p).toMatchObject({ agent: 'claude', sessionId: 'abc', cwd, phase: 'tool_pending' });
    expect(p?.pending).toEqual([{ name: 'Bash', input: {} }]);
  });

  it('clears the pending call once its result arrives', () => {
    expect(parseClaude(jsonl(prompt, toolUse('t1'), toolResult('t1')), 'x')?.phase).toBe('working');
  });

  it('detects a finished turn', () => {
    expect(parseClaude(jsonl(prompt, toolUse('t1'), toolResult('t1'), endTurn), 'x')?.phase).toBe('turn_done');
  });

  it('treats a new prompt as working again', () => {
    expect(parseClaude(jsonl(endTurn, prompt), 'x')?.phase).toBe('working');
  });

  it('treats AskUserQuestion as waiting for input', () => {
    expect(parseClaude(jsonl(prompt, toolUse('q', 'AskUserQuestion')), 'x')?.phase).toBe('needs_input');
  });

  it('does not flag long-running subagent calls as approvals', () => {
    expect(parseClaude(jsonl(prompt, toolUse('a', 'Agent')), 'x')?.phase).toBe('working');
  });

  it('treats an interruption as the end of the turn', () => {
    const interrupt = { ...claudeBase, type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } };
    expect(parseClaude(jsonl(prompt, toolUse('t1'), interrupt), 'x')?.phase).toBe('turn_done');
  });

  it('ignores sidechain entries', () => {
    const side = { ...toolUse('s1'), isSidechain: true };
    expect(parseClaude(jsonl(prompt, toolUse('t1'), toolResult('t1'), endTurn, side), 'x')?.phase).toBe('turn_done');
  });

  it('skips garbage and partial lines, and returns null with nothing usable', () => {
    expect(parseClaude('ial line}\nnot json\n{"type":"api-request"}', 'x')).toBeNull();
    expect(parseClaude(`ial line}\n${jsonl(prompt, toolUse('t1'))}`, 'x')?.phase).toBe('tool_pending');
  });
});

const ev = (type: string, extra = {}) => ({ type: 'event_msg', payload: { type, ...extra } });
const call = (id: string) => ({ type: 'response_item', payload: { type: 'custom_tool_call', call_id: id, name: 'apply_patch' } });
const output = (id: string) => ({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: id } });
const turnCtx = (policy: string) => ({ type: 'turn_context', payload: { cwd, approval_policy: policy } });

describe('parseCodex', () => {
  it('reads session id and cwd from session_meta', () => {
    const meta = { type: 'session_meta', payload: { session_id: 'sess', cwd } };
    expect(parseCodex(jsonl(meta, ev('task_started')), 'f')).toMatchObject({
      agent: 'codex', sessionId: 'sess', cwd, phase: 'working',
    });
  });

  it('detects a completed task', () => {
    expect(parseCodex(jsonl(ev('task_started'), call('c1'), output('c1'), ev('task_complete')), 'f')?.phase).toBe('turn_done');
  });

  it('treats an aborted turn as done', () => {
    expect(parseCodex(jsonl(ev('task_started'), call('c1'), ev('turn_aborted')), 'f')?.phase).toBe('turn_done');
  });

  it('reports a pending call', () => {
    expect(parseCodex(jsonl(turnCtx('on-request'), ev('task_started'), call('c1')), 'f')?.phase).toBe('tool_pending');
  });

  it('records the approval policy and parses call arguments', () => {
    const exec = { type: 'response_item', payload: { type: 'function_call', call_id: 'e1', name: 'exec_command', arguments: '{"cmd":"npm install","sandbox_permissions":"require_escalated"}' } };
    const p = parseCodex(jsonl(turnCtx('on-request'), ev('task_started'), exec), 'f');
    expect(p?.mode).toBe('on-request');
    expect(p?.pending).toEqual([{ name: 'exec_command', input: { cmd: 'npm install', sandbox_permissions: 'require_escalated' } }]);
  });

  it('treats request_user_input as waiting for the user', () => {
    const ask = { type: 'response_item', payload: { type: 'function_call', call_id: 'q1', name: 'request_user_input', arguments: '{}' } };
    expect(parseCodex(jsonl(ev('task_started'), ask), 'f')?.phase).toBe('needs_input');
  });

  it('does not count polling calls as pending', () => {
    const wait = { type: 'response_item', payload: { type: 'function_call', call_id: 'w1', name: 'wait', arguments: '{}' } };
    expect(parseCodex(jsonl(ev('task_started'), wait), 'f')?.phase).toBe('working');
  });

  it('uses fallbacks when the head of the file was not in the tail', () => {
    expect(parseCodex(jsonl(ev('task_complete')), 'file-id', '/x')).toMatchObject({ sessionId: 'file-id', cwd: '/x' });
  });

  it('returns null for unrelated lines', () => {
    expect(parseCodex(jsonl({ type: 'token_usage_record', payload: {} }), 'f')).toBeNull();
  });
});

describe('codexCwdFromHead', () => {
  it('extracts cwd from a truncated first line', () => {
    const head = '{"type":"session_meta","payload":{"cwd":"/home/me/my \\"proj\\"","base_instructions":{"text":"You are';
    expect(codexCwdFromHead(head)).toBe('/home/me/my "proj"');
  });
});

describe('deriveState', () => {
  it('waits for the approval delay before flagging approval', () => {
    expect(deriveState('tool_pending', 1000, 5000)).toBe('working');
    expect(deriveState('tool_pending', 6000, 5000)).toBe('needs_approval');
    expect(deriveState('tool_pending', 6000, 5000, false)).toBe('working');
  });

  it('maps the other phases directly', () => {
    expect(deriveState('needs_input', 0, 5000)).toBe('needs_input');
    expect(deriveState('turn_done', 0, 5000)).toBe('done');
    expect(deriveState('working', 99999, 5000)).toBe('working');
  });
});
