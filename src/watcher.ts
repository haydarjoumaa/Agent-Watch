import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AgentKind,
  AgentState,
  ParsedSession,
  codexCwdFromHead,
  deriveState,
  parseClaude,
  parseCodex,
} from './parsers';

export interface Session {
  key: string;
  agent: AgentKind;
  sessionId: string;
  cwd?: string;
  state: AgentState;
  lastActivity: number; // log file mtime, ms
}

export interface WatchOptions {
  approvalDelayMs: number;
  staleMs: number;
}

const TAIL_BYTES = 512 * 1024;
const HEAD_BYTES = 256 * 1024;

interface CachedFile {
  mtimeMs: number;
  size: number;
  parsed: ParsedSession | null;
}

const claudeRoot = () =>
  path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
const codexRoot = () =>
  path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');

function readRange(file: string, start: number, length: number): string {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, start);
    return buf.toString('utf8', 0, n);
  } finally {
    fs.closeSync(fd);
  }
}

function safeReaddir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Top-level transcripts only; subagent logs live in subfolders. */
function claudeFiles(): string[] {
  const root = claudeRoot();
  const files: string[] = [];
  for (const proj of safeReaddir(root)) {
    if (!proj.isDirectory()) continue;
    const dir = path.join(root, proj.name);
    for (const f of safeReaddir(dir)) {
      if (f.isFile() && f.name.endsWith('.jsonl')) files.push(path.join(dir, f.name));
    }
  }
  return files;
}

/** Codex files are bucketed by date; today and yesterday cover any live session. */
function codexFiles(): string[] {
  const root = codexRoot();
  const files: string[] = [];
  for (const offset of [0, 1]) {
    const d = new Date(Date.now() - offset * 86_400_000);
    const dir = path.join(
      root,
      String(d.getFullYear()),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    );
    for (const f of safeReaddir(dir)) {
      if (f.isFile() && f.name.endsWith('.jsonl')) files.push(path.join(dir, f.name));
    }
  }
  return files;
}

function idFromFilename(file: string): string {
  const base = path.basename(file, '.jsonl');
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.exec(base);
  return uuid ? uuid[0] : base;
}

function parseFile(agent: AgentKind, file: string, size: number): ParsedSession | null {
  const start = Math.max(0, size - TAIL_BYTES);
  const tail = readRange(file, start, size - start);
  const id = idFromFilename(file);
  if (agent === 'claude') return parseClaude(tail, id);
  const headCwd = start > 0 ? codexCwdFromHead(readRange(file, 0, HEAD_BYTES)) : undefined;
  return parseCodex(tail, id, headCwd);
}

/** Polls the agents' log folders and reports the current state of recently active sessions. */
export class SessionWatcher {
  private cache = new Map<string, CachedFile>();

  constructor(private options: () => WatchOptions) {}

  scan(now = Date.now()): Session[] {
    const { approvalDelayMs, staleMs } = this.options();
    const sessions = new Map<string, Session>();
    const live = new Set<string>();

    const sources: [AgentKind, string[]][] = [
      ['claude', claudeFiles()],
      ['codex', codexFiles()],
    ];
    for (const [agent, files] of sources) {
      for (const file of files) {
        let stat: fs.Stats;
        try {
          stat = fs.statSync(file);
        } catch {
          continue;
        }
        if (now - stat.mtimeMs > staleMs) continue;
        live.add(file);

        let cached = this.cache.get(file);
        if (!cached || cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size) {
          let parsed: ParsedSession | null = null;
          try {
            parsed = parseFile(agent, file, stat.size);
          } catch {
            // Unreadable right now; try again next tick.
          }
          cached = { mtimeMs: stat.mtimeMs, size: stat.size, parsed };
          this.cache.set(file, cached);
        }
        const p = cached.parsed;
        if (!p) continue;

        const key = `${p.agent}:${p.sessionId}`;
        const existing = sessions.get(key);
        if (existing && existing.lastActivity >= stat.mtimeMs) continue;
        sessions.set(key, {
          key,
          agent: p.agent,
          sessionId: p.sessionId,
          cwd: p.cwd,
          state: deriveState(p.phase, now - stat.mtimeMs, approvalDelayMs),
          lastActivity: stat.mtimeMs,
        });
      }
    }

    for (const file of this.cache.keys()) if (!live.has(file)) this.cache.delete(file);
    return [...sessions.values()].sort((a, b) => b.lastActivity - a.lastActivity);
  }
}
