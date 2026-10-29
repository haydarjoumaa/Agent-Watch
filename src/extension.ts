import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AgentState } from './parsers';
import { Session, SessionWatcher } from './watcher';

const POLL_MS = 2000;
// Windows that don't own the session's folder wait this long before trying to claim a notification,
// so the window that does own it gets to show it.
const UNOWNED_NOTIFY_DELAY_MS = 1500;
const CLAIM_DIR = path.join(os.tmpdir(), 'agent-watch-claims');

const AGENT_LABEL = { claude: 'Claude', codex: 'Codex' } as const;
const STATE_LABEL: Record<AgentState, string> = {
  working: 'working',
  needs_approval: 'may need approval',
  needs_input: 'waiting for you',
  done: 'finished',
};

export function activate(context: vscode.ExtensionContext) {
  const config = () => vscode.workspace.getConfiguration('agentWatch');
  const watcher = new SessionWatcher(() => ({
    approvalDelayMs: config().get<number>('approvalDelaySeconds', 5) * 1000,
    staleMs: config().get<number>('staleAfterMinutes', 30) * 60_000,
  }));

  let muted = context.globalState.get<boolean>('muted', false);
  let sessions: Session[] = [];
  let previous = new Map<string, AgentState>();
  let firstScan = true;

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = 'agentWatch.showSessions';
  status.show();

  const render = () => {
    const waiting = sessions.filter((s) => s.state === 'needs_approval' || s.state === 'needs_input');
    const working = sessions.filter((s) => s.state === 'working').length;
    const mute = muted ? '$(bell-slash) ' : '';
    if (waiting.length > 0) {
      status.text = `${mute}$(bell-dot) ${waiting.length} agent${waiting.length > 1 ? 's' : ''} waiting`;
      status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      status.text = working > 0 ? `${mute}$(sync~spin) ${working} working` : `${mute}$(check) Agents idle`;
      status.backgroundColor = undefined;
    }
    status.tooltip = sessions.length
      ? sessions.map((s) => `${AGENT_LABEL[s.agent]} · ${folderName(s)} · ${STATE_LABEL[s.state]}`).join('\n')
      : 'No active Claude Code or Codex sessions';
  };

  const tick = () => {
    try {
      sessions = watcher.scan();
    } catch {
      return;
    }
    const next = new Map(sessions.map((s) => [s.key, s.state]));
    if (!firstScan && !muted) {
      for (const s of sessions) {
        if (s.state !== previous.get(s.key) && shouldNotify(s.state)) notify(s);
      }
    }
    previous = next;
    firstScan = false;
    render();
  };

  const shouldNotify = (state: AgentState) =>
    state === 'needs_approval' ||
    state === 'needs_input' ||
    (state === 'done' && config().get<boolean>('notifyWhenFinished', true));

  const notify = (s: Session) => {
    const owned = ownsFolder(s.cwd);
    const claimId = `${s.key}-${s.state}-${Math.floor(s.lastActivity)}`;
    const show = () => {
      if (!claim(claimId)) return; // another window already showed it
      const msg = `${AGENT_LABEL[s.agent]} ${STATE_LABEL[s.state]} — ${folderName(s)}`;
      const actions = owned || !s.cwd ? [] : ['Open project'];
      vscode.window.showInformationMessage(msg, ...actions).then((choice) => {
        if (choice === 'Open project') openFolder(s.cwd!);
      });
    };
    if (owned) show();
    else setTimeout(show, UNOWNED_NOTIFY_DELAY_MS);
  };

  const timer = setInterval(tick, POLL_MS);
  cleanupClaims();
  tick();

  context.subscriptions.push(
    status,
    { dispose: () => clearInterval(timer) },
    vscode.commands.registerCommand('agentWatch.showSessions', async () => {
      if (sessions.length === 0) {
        vscode.window.showInformationMessage('Agent Watch: no active Claude Code or Codex sessions.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        sessions.map((s) => ({
          label: `${stateIcon(s.state)} ${AGENT_LABEL[s.agent]} — ${folderName(s)}`,
          description: STATE_LABEL[s.state],
          detail: `${s.cwd ?? 'unknown folder'} · ${ago(s.lastActivity)}`,
          session: s,
        })),
        { placeHolder: 'Select a session to open its project' },
      );
      if (pick?.session.cwd) openFolder(pick.session.cwd);
    }),
    vscode.commands.registerCommand('agentWatch.toggleMute', async () => {
      muted = !muted;
      await context.globalState.update('muted', muted);
      render();
      vscode.window.showInformationMessage(`Agent Watch notifications ${muted ? 'muted' : 'on'}.`);
    }),
  );
}

export function deactivate() {}

function folderName(s: Session): string {
  return s.cwd ? path.basename(s.cwd) : s.sessionId.slice(0, 8);
}

function stateIcon(state: AgentState): string {
  switch (state) {
    case 'needs_approval':
      return '$(warning)';
    case 'needs_input':
      return '$(comment-discussion)';
    case 'done':
      return '$(pass)';
    default:
      return '$(sync)';
  }
}

function ago(ms: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  return min < 60 ? `${min}m ago` : `${Math.round(min / 60)}h ago`;
}

function ownsFolder(cwd?: string): boolean {
  if (!cwd) return false;
  return (vscode.workspace.workspaceFolders ?? []).some((f) => {
    const rel = path.relative(f.uri.fsPath, cwd);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

function openFolder(cwd: string) {
  if (ownsFolder(cwd)) return;
  // VS Code focuses an existing window if this folder is already open there.
  vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(cwd), { forceNewWindow: true });
}

/** First window to create the claim file shows the notification; the rest stay quiet. */
function claim(id: string): boolean {
  try {
    fs.mkdirSync(CLAIM_DIR, { recursive: true });
    fs.writeFileSync(path.join(CLAIM_DIR, id.replace(/[^\w.-]/g, '_')), '', { flag: 'wx' });
    return true;
  } catch (err) {
    // If claims can't be written at all, notify rather than stay silent.
    return (err as NodeJS.ErrnoException).code !== 'EEXIST';
  }
}

function cleanupClaims() {
  try {
    const cutoff = Date.now() - 86_400_000;
    for (const f of fs.readdirSync(CLAIM_DIR)) {
      const p = path.join(CLAIM_DIR, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch {
    // Nothing to clean.
  }
}
