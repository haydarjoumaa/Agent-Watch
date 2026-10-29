import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BuddyViewProvider } from './buddy';
import { STATUS_FACES, buddyStatus, meowFor, spokenAlert } from './buddyLines';
import { AGENT_LABEL, STATE_LABEL, ago, folderName } from './labels';
import { AgentState } from './parsers';
import { VoiceStyle, announce } from './speech';
import { Session, SessionWatcher } from './watcher';

const POLL_MS = 2000;
const ANIMATION_MS = 800;
// Windows that don't own the session's folder wait this long before trying to claim a notification,
// so the window that does own it gets to show it.
const UNOWNED_NOTIFY_DELAY_MS = 1500;
const CLAIM_DIR = path.join(os.tmpdir(), 'agent-watch-claims');

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
  status.command = 'agentWatch.showBuddy';
  status.show();

  const toggleMute = async () => {
    muted = !muted;
    await context.globalState.update('muted', muted);
    render();
    vscode.window.showInformationMessage(`Agent Watch alerts ${muted ? 'muted' : 'on'}.`);
  };

  const voiceStyle = () => config().get<VoiceStyle>('voice', 'cat');
  const onPoke = () => {
    if (!muted && config().get<boolean>('speakAloud', true) && voiceStyle() !== 'plain') {
      announce('hello', '', 'meow');
    }
  };

  const buddy = new BuddyViewProvider(context.extensionUri, { openFolder, toggleMute, onPoke });

  // The status bar cat is always visible; its face alternates between two frames.
  let frame = 0;
  const renderStatus = () => {
    const { mood, short } = buddyStatus(sessions);
    const mute = muted ? '$(bell-slash) ' : '';
    status.text = `${mute}${STATUS_FACES[mood][frame]} ${short}`;
    status.backgroundColor =
      mood === 'alert' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  };

  const render = () => {
    renderStatus();
    status.tooltip = sessions.length
      ? sessions.map((s) => `${AGENT_LABEL[s.agent]} · ${folderName(s)} · ${STATE_LABEL[s.state]}`).join('\n') +
        '\n\nClick to see the big cat'
      : 'No active Claude Code or Codex sessions. Click to see the big cat';
    buddy.update(sessions, muted);
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
      if (config().get<boolean>('speakAloud', true)) {
        const style = voiceStyle();
        announce(meowFor(s.state), spokenAlert(s, style !== 'plain'), style);
      }
      if (!config().get<boolean>('showPopups', true)) return;
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
  const animation = setInterval(() => {
    frame = 1 - frame;
    renderStatus();
  }, ANIMATION_MS);
  cleanupClaims();
  tick();

  context.subscriptions.push(
    status,
    { dispose: () => clearInterval(timer) },
    { dispose: () => clearInterval(animation) },
    vscode.window.registerWebviewViewProvider(BuddyViewProvider.viewId, buddy),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('agentWatch') && render()),
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
    vscode.commands.registerCommand('agentWatch.toggleMute', toggleMute),
    vscode.commands.registerCommand('agentWatch.showBuddy', () =>
      vscode.commands.executeCommand(`${BuddyViewProvider.viewId}.focus`),
    ),
    vscode.commands.registerCommand('agentWatch.testVoice', () => {
      const style = voiceStyle();
      const text =
        style === 'plain'
          ? 'Hi! I am your agent buddy. I will tell you when Claude or Codex needs you.'
          : 'Meow! I am your agent cat. I will tell you when Claude or Codex needs you. Purr.';
      announce('hello', text, style);
    }),
  );
}

export function deactivate() {}

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
