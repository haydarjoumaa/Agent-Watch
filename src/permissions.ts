import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AgentKind, PendingCall } from './parsers';

// Decides whether a pending tool call could be sitting at an approval prompt, using the
// agent's mode and the user's own "always allow" rules. When unsure, it answers yes:
// a slow alert is better than a missed one.

export interface ClaudeRules {
  allow: string[];
  ask: string[];
  defaultMode?: string;
}

/** Claude tools that never ask for permission. */
const CLAUDE_NO_PERMISSION = new Set([
  'Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoWrite', 'TodoRead', 'ToolSearch',
  'BashOutput', 'KillShell', 'TaskOutput', 'TaskStop', 'TaskList', 'TaskGet', 'TaskCreate', 'TaskUpdate',
]);
const CLAUDE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
/** Modes where Claude doesn't stop for approval prompts. */
const CLAUDE_NO_PROMPT_MODES = new Set(['bypassPermissions', 'auto']);

/** Codex tools that never ask for approval on their own. */
const CODEX_NO_APPROVAL = new Set(['apply_patch', 'update_plan', 'view_image', 'run']);
const CODEX_SHELL_TOOLS = new Set(['exec_command', 'shell', 'local_shell', 'container.exec']);
/** Codex "code mode": a JS snippet that calls tools.exec_command({...}) itself. */
const CODEX_CODE_MODE_TOOL = 'exec';

// ---------- Claude ----------

export function claudeNeedsApproval(call: PendingCall, mode: string | undefined, cwd: string | undefined, rules: ClaudeRules): boolean {
  const effectiveMode = mode ?? rules.defaultMode;
  if (effectiveMode && CLAUDE_NO_PROMPT_MODES.has(effectiveMode)) return false;
  if (CLAUDE_NO_PERMISSION.has(call.name)) return false;
  if (effectiveMode === 'acceptEdits' && CLAUDE_EDIT_TOOLS.has(call.name)) return false;
  if (rules.ask.some((r) => claudeRuleMatches(r, call, cwd))) return true;
  if (rules.allow.some((r) => claudeRuleMatches(r, call, cwd))) return false;
  return true;
}

export function claudeRuleMatches(rule: string, call: PendingCall, cwd?: string): boolean {
  const m = /^([^(]+?)\s*(?:\(([\s\S]*)\))?$/.exec(rule.trim());
  if (!m) return false;
  const [, ruleName, rawSpec] = m;

  if (!toolNameMatches(ruleName, call.name)) return false;
  if (rawSpec === undefined || rawSpec === '*' || rawSpec === '') return true;
  const spec = rawSpec.replace(/\\([()])/g, '$1');

  if (call.name === 'Bash') {
    const command = String(call.input?.command ?? '');
    const parts = splitShell(command);
    return parts.length > 0 && parts.every((part) => bashSpecMatches(spec, part));
  }
  if (call.name === 'WebFetch' && spec.startsWith('domain:')) {
    const domain = spec.slice('domain:'.length).toLowerCase();
    try {
      const host = new URL(String(call.input?.url ?? '')).hostname.toLowerCase();
      return host === domain || host.endsWith(`.${domain}`);
    } catch {
      return false;
    }
  }
  const file = call.input?.file_path ?? call.input?.notebook_path ?? call.input?.path;
  if (typeof file === 'string') return pathSpecMatches(spec, file, cwd);
  return false; // a specifier we don't understand: assume it doesn't cover this call
}

function toolNameMatches(ruleName: string, toolName: string): boolean {
  if (ruleName === toolName) return true;
  // "Edit" rules cover every file-editing tool.
  if (ruleName === 'Edit' && CLAUDE_EDIT_TOOLS.has(toolName)) return true;
  if (ruleName.startsWith('mcp__')) {
    if (ruleName.endsWith('__*')) return toolName.startsWith(ruleName.slice(0, -1));
    if (ruleName.split('__').length === 2) return toolName.startsWith(`${ruleName}__`); // whole server
  }
  return false;
}

/** Split a shell command into the simple commands joined by &&, ||, ;, | or newlines. */
export function splitShell(command: string): string[] {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function bashSpecMatches(spec: string, command: string): boolean {
  if (spec.endsWith(':*')) {
    const prefix = spec.slice(0, -2);
    return command === prefix || command.startsWith(`${prefix} `);
  }
  return globToRegExp(spec, true).test(command);
}

function pathSpecMatches(spec: string, file: string, cwd?: string): boolean {
  let pattern: string;
  if (spec.startsWith('//')) pattern = spec.slice(1);
  else if (spec.startsWith('~/')) pattern = path.join(os.homedir(), spec.slice(2));
  else if (spec.startsWith('/') && cwd) pattern = path.join(cwd, spec);
  else pattern = `**/${spec}`;
  return globToRegExp(pattern, false).test(path.resolve(cwd ?? '/', file));
}

/** `*` matches anything in commands; in paths `*` stays within one folder and `**` crosses folders. */
function globToRegExp(glob: string, starMatchesSlash: boolean): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // "**/" also matches zero folders
      } else {
        re += starMatchesSlash ? '.*' : '[^/]*';
      }
    } else if (c === '?') {
      re += starMatchesSlash ? '.' : '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, 's');
}

// ---------- Codex ----------

/** One "always allow" prefix rule; each element is a token or a list of alternatives. */
export type CodexPrefix = (string | string[])[];

export function codexNeedsApproval(call: PendingCall, policy: string | undefined, allowRules: CodexPrefix[]): boolean {
  if (policy === 'never') return false;
  if (CODEX_NO_APPROVAL.has(call.name)) return false;
  if (CODEX_SHELL_TOOLS.has(call.name)) {
    const escalated =
      call.input?.sandbox_permissions === 'require_escalated' || call.input?.with_escalated_permissions === true;
    if (!escalated && policy !== 'untrusted') return false; // runs in the sandbox without asking
    const cmd = call.input?.cmd ?? call.input?.command;
    const tokens = Array.isArray(cmd) ? cmd.map(String) : shellTokens(String(cmd ?? ''));
    return !allowRules.some((rule) => prefixMatches(rule, tokens));
  }
  if (call.name === CODEX_CODE_MODE_TOOL && typeof call.input === 'string') {
    if (policy === 'untrusted') return true;
    if (!/require_escalated|with_escalated_permissions["']?\s*:\s*true/.test(call.input)) return false;
    // Escalated: quiet only if every command in the script is covered by an allow rule.
    const cmds = [...call.input.matchAll(/["']?cmd["']?\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => {
      try {
        return JSON.parse(`"${m[1]}"`) as string;
      } catch {
        return m[1];
      }
    });
    return cmds.length === 0 || !cmds.every((c) => allowRules.some((rule) => prefixMatches(rule, shellTokens(c))));
  }
  return true; // unknown tool (e.g. MCP): it may ask
}

function shellTokens(cmd: string): string[] {
  return (cmd.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((t) => t.replace(/^(['"])(.*)\1$/, '$2'));
}

function prefixMatches(rule: CodexPrefix, tokens: string[]): boolean {
  if (rule.length === 0 || tokens.length < rule.length) return false;
  return rule.every((want, i) => (Array.isArray(want) ? want.includes(tokens[i]) : want === tokens[i]));
}

/** Parse `prefix_rule(pattern=[...], decision="allow")` lines from a Codex .rules file. */
export function parseCodexRules(text: string): CodexPrefix[] {
  const rules: CodexPrefix[] = [];
  for (const m of text.matchAll(/prefix_rule\(([\s\S]*?)\)\s*$/gm)) {
    const body = m[1];
    if (!/decision\s*=\s*"allow"/.test(body)) continue;
    const pattern = /pattern\s*=\s*(\[[\s\S]*?\])\s*(?:,|$)/.exec(body);
    if (!pattern) continue;
    try {
      const parsed = JSON.parse(pattern[1]);
      if (Array.isArray(parsed)) rules.push(parsed);
    } catch {
      // Not JSON-compatible (e.g. single quotes): skip.
    }
  }
  return rules;
}

// ---------- Loading settings from disk (cached by mtime) ----------

const fileCache = new Map<string, { mtimeMs: number; value: unknown }>();

function cachedRead<T>(file: string, parse: (text: string) => T): T | undefined {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    fileCache.delete(file);
    return undefined;
  }
  const hit = fileCache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.value as T | undefined;
  let value: T | undefined;
  try {
    value = parse(fs.readFileSync(file, 'utf8'));
  } catch {
    value = undefined;
  }
  fileCache.set(file, { mtimeMs: stat.mtimeMs, value });
  return value;
}

function claudeSettingsFiles(cwd?: string): string[] {
  const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const files = [
    '/etc/claude-code/managed-settings.json',
    path.join(home, 'settings.json'),
    path.join(home, 'settings.local.json'),
  ];
  // Project settings: walk up from the session's folder.
  for (let dir = cwd; dir && path.dirname(dir) !== dir; dir = path.dirname(dir)) {
    files.push(path.join(dir, '.claude', 'settings.json'), path.join(dir, '.claude', 'settings.local.json'));
  }
  return files;
}

export function loadClaudeRules(cwd?: string): ClaudeRules {
  const rules: ClaudeRules = { allow: [], ask: [] };
  for (const file of claudeSettingsFiles(cwd)) {
    const perms = cachedRead(file, (t) => JSON.parse(t)?.permissions);
    if (!perms || typeof perms !== 'object') continue;
    if (Array.isArray(perms.allow)) rules.allow.push(...perms.allow.filter((r: unknown) => typeof r === 'string'));
    if (Array.isArray(perms.ask)) rules.ask.push(...perms.ask.filter((r: unknown) => typeof r === 'string'));
    if (!rules.defaultMode && typeof perms.defaultMode === 'string') rules.defaultMode = perms.defaultMode;
  }
  return rules;
}

export function loadCodexRules(): CodexPrefix[] {
  const dir = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'rules');
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith('.rules'));
  } catch {
    return [];
  }
  return names.flatMap((f) => cachedRead(path.join(dir, f), parseCodexRules) ?? []);
}

/** Could any of the session's pending calls be waiting at an approval prompt? */
export function approvalPossible(agent: AgentKind, pending: PendingCall[], mode?: string, cwd?: string): boolean {
  if (agent === 'claude') {
    const rules = loadClaudeRules(cwd);
    return pending.some((c) => claudeNeedsApproval(c, mode, cwd, rules));
  }
  const rules = loadCodexRules();
  return pending.some((c) => codexNeedsApproval(c, mode, rules));
}
