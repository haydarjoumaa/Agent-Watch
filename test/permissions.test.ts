import { describe, expect, it } from 'vitest';
import {
  ClaudeRules,
  claudeNeedsApproval,
  claudeRuleMatches,
  codexNeedsApproval,
  parseCodexRules,
  splitShell,
} from '../src/permissions';
import { inQuietHours } from '../src/quiet';

const bash = (command: string) => ({ name: 'Bash', input: { command } });
const rules = (allow: string[] = [], ask: string[] = []): ClaudeRules => ({ allow, ask });
const cwd = '/home/me/app';

describe('claudeRuleMatches', () => {
  it('matches Bash prefix and glob rules', () => {
    expect(claudeRuleMatches('Bash(npm run test:*)', bash('npm run test -- --watch'))).toBe(true);
    expect(claudeRuleMatches('Bash(npm run *)', bash('npm run build'))).toBe(true);
    expect(claudeRuleMatches('Bash(npm run *)', bash('npm install'))).toBe(false);
    expect(claudeRuleMatches('Bash', bash('anything'))).toBe(true);
  });

  it('requires every part of a compound command to match', () => {
    expect(claudeRuleMatches('Bash(npm run *)', bash('npm run build && rm -rf dist'))).toBe(false);
  });

  it('unescapes parentheses in rules', () => {
    expect(claudeRuleMatches('Bash(node -e \\"f\\(\\)\\")', bash('node -e "f()"'))).toBe(false);
    expect(claudeRuleMatches('Bash(node -e f\\(\\))', bash('node -e f()'))).toBe(true);
  });

  it('matches WebFetch domains and MCP servers', () => {
    const fetch = { name: 'WebFetch', input: { url: 'https://docs.example.com/x' } };
    expect(claudeRuleMatches('WebFetch(domain:example.com)', fetch)).toBe(true);
    expect(claudeRuleMatches('WebFetch(domain:other.com)', fetch)).toBe(false);
    expect(claudeRuleMatches('mcp__github', { name: 'mcp__github__create_issue', input: {} })).toBe(true);
  });

  it('matches path rules', () => {
    const edit = { name: 'Edit', input: { file_path: '/home/me/app/src/a.ts' } };
    expect(claudeRuleMatches('Edit(//home/me/app/**)', edit, cwd)).toBe(true);
    expect(claudeRuleMatches('Edit(/src/**)', edit, cwd)).toBe(true);
    expect(claudeRuleMatches('Edit(/test/**)', edit, cwd)).toBe(false);
  });
});

describe('claudeNeedsApproval', () => {
  it('skips read-only tools and no-prompt modes', () => {
    expect(claudeNeedsApproval({ name: 'Read', input: {} }, 'default', cwd, rules())).toBe(false);
    expect(claudeNeedsApproval(bash('rm -rf x'), 'bypassPermissions', cwd, rules())).toBe(false);
    expect(claudeNeedsApproval({ name: 'Edit', input: {} }, 'acceptEdits', cwd, rules())).toBe(false);
  });

  it('uses allow and ask rules', () => {
    expect(claudeNeedsApproval(bash('npm test'), 'default', cwd, rules(['Bash(npm test:*)']))).toBe(false);
    expect(claudeNeedsApproval(bash('npm test'), 'default', cwd, rules(['Bash'], ['Bash(npm test:*)']))).toBe(true);
    expect(claudeNeedsApproval(bash('npm test'), 'default', cwd, rules())).toBe(true);
  });

  it('falls back to defaultMode from settings', () => {
    expect(claudeNeedsApproval(bash('x'), undefined, cwd, { allow: [], ask: [], defaultMode: 'bypassPermissions' })).toBe(false);
  });
});

describe('codexNeedsApproval', () => {
  const exec = (cmd: string, escalated = false) => ({
    name: 'exec_command',
    input: escalated ? { cmd, sandbox_permissions: 'require_escalated' } : { cmd },
  });

  it('only escalated commands ask under on-request', () => {
    expect(codexNeedsApproval(exec('npm test'), 'on-request', [])).toBe(false);
    expect(codexNeedsApproval(exec('npm install', true), 'on-request', [])).toBe(true);
  });

  it('respects allow rules and the never policy', () => {
    expect(codexNeedsApproval(exec('npm install', true), 'on-request', [['npm', ['install', 'ci']]])).toBe(false);
    expect(codexNeedsApproval(exec('npm install', true), 'never', [])).toBe(false);
  });

  it('asks for every command under untrusted', () => {
    expect(codexNeedsApproval(exec('ls'), 'untrusted', [])).toBe(true);
  });

  it('looks inside code-mode scripts for escalation', () => {
    const script = (s: string) => ({ name: 'exec', input: s });
    expect(codexNeedsApproval(script('await tools.exec_command({cmd:"rg foo"})'), 'on-request', [])).toBe(false);
    const escalated = script('await tools.exec_command({cmd:"npm install",sandbox_permissions:"require_escalated"})');
    expect(codexNeedsApproval(escalated, 'on-request', [])).toBe(true);
    expect(codexNeedsApproval(escalated, 'on-request', [['npm', 'install']])).toBe(false);
  });

  it('never asks for patches', () => {
    expect(codexNeedsApproval({ name: 'apply_patch', input: '*** Begin Patch' }, 'on-request', [])).toBe(false);
  });
});

describe('parseCodexRules', () => {
  it('reads allow prefix rules', () => {
    const text = 'prefix_rule(pattern=["pwd"], decision="allow")\nprefix_rule(pattern=["rm"], decision="forbidden")\n';
    expect(parseCodexRules(text)).toEqual([['pwd']]);
  });
});

describe('splitShell', () => {
  it('splits on shell operators', () => {
    expect(splitShell('a && b || c; d | e')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('inQuietHours', () => {
  const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m);
  it('handles ranges that wrap past midnight', () => {
    expect(inQuietHours('22:00-08:00', at(23))).toBe(true);
    expect(inQuietHours('22:00-08:00', at(7, 59))).toBe(true);
    expect(inQuietHours('22:00-08:00', at(8))).toBe(false);
    expect(inQuietHours('22:00-08:00', at(12))).toBe(false);
  });

  it('handles same-day ranges and empty settings', () => {
    expect(inQuietHours('12:00-13:00', at(12, 30))).toBe(true);
    expect(inQuietHours('', at(12))).toBe(false);
    expect(inQuietHours('nonsense', at(12))).toBe(false);
  });
});
