import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BuddyViewProvider } from './buddy';
import { buddyStatus } from './buddyLines';
import { character, plainHello, spokenAlert } from './characters';
import { AGENT_LABEL, STATE_LABEL, ago, folderName } from './labels';
import { AgentState } from './parsers';
import { inQuietHours } from './quiet';
import * as naturalVoice from './naturalVoice';
import { announce, normalizeStyle, setNaturalVoiceDir } from './speech';
import { detectUserName } from './userName';
import { Session, SessionWatcher } from './watcher';

const POLL_MS = 2000;
const ANIMATION_MS = 800;
const SOUND_COOLDOWN_MS = 30_000;
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

  const voiceStyle = () => normalizeStyle(config().get<string>('voice'));
  const buddyChar = () => character(config().get<string>('buddy', 'cat'));
  const volume = () => config().get<number>('volume', 30) / 100;
  const detectedName = detectUserName();
  // What the buddy calls you: the setting if given, else your Git name. "-" means don't use a name.
  const userName = () => {
    const set = config().get<string>('userName', '').trim();
    return set === '-' ? '' : set || detectedName;
  };
  let lastSoundAt = 0;
  const onPoke = () => {
    if (!muted && config().get<boolean>('speakAloud', true) && voiceStyle() !== 'plain') {
      const c = buddyChar();
      announce(c.sounds.poke, '', 'sound', c.voice, volume());
    }
  };

  const buddy = new BuddyViewProvider(context.extensionUri, { openFolder, toggleMute, onPoke });

  // The status bar cat is always visible; its face alternates between two frames.
  let frame = 0;
  const renderStatus = () => {
    const { mood, short } = buddyStatus(sessions);
    const mute = muted ? '$(bell-slash) ' : '';
    status.text = `${mute}${buddyChar().faces[mood][frame]} ${short}`;
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
      // Approvals and questions block the agent, so they always make a sound. "Finished" stays
      // quiet when you're already looking at the window where that agent runs.
      const watching =
        s.state === 'done' &&
        owned &&
        vscode.window.state.focused &&
        config().get<boolean>('quietWhenWatching', true);
      const quietTime = inQuietHours(config().get<string>('quietHours', ''));
      // Approvals always get through; anything else waits for a quiet gap since the last sound.
      const tooSoon = s.state !== 'needs_approval' && Date.now() - lastSoundAt < SOUND_COOLDOWN_MS;
      if (config().get<boolean>('speakAloud', true) && !watching && !quietTime && !tooSoon) {
        lastSoundAt = Date.now();
        const style = voiceStyle();
        const c = buddyChar();
        // "Finished" is good news, not urgent: just the character's sound, no words.
        const text = s.state === 'done' && style !== 'plain' ? '' : spokenAlert(s, style === 'plain' ? undefined : c, userName());
        if (s.state !== 'working') announce(c.sounds[s.state], text, style, c.voice, volume());
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

  // Natural voice (Piper): lives in the extension's storage so updates don't re-download it.
  const voiceDir = path.join(context.globalStorageUri.fsPath, 'natural-voice');
  const applyVoiceSetting = () =>
    setNaturalVoiceDir(config().get<boolean>('naturalVoice', true) ? voiceDir : undefined);
  applyVoiceSetting();

  let installing = false;
  const installVoice = async () => {
    if (installing) return;
    if (!naturalVoice.isSupported()) {
      vscode.window.showWarningMessage('Agent Watch: the natural voice is not available for this system.');
      return;
    }
    installing = true;
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Agent Watch: installing natural voice' },
        (progress) => naturalVoice.install(voiceDir, (message) => progress.report({ message })),
      );
      await config().update('naturalVoice', true, vscode.ConfigurationTarget.Global);
      applyVoiceSetting();
      vscode.commands.executeCommand('agentWatch.testVoice');
    } catch (err) {
      vscode.window.showErrorMessage(`Agent Watch: couldn't install the natural voice. ${(err as Error).message}`);
    } finally {
      installing = false;
    }
  };

  // Offer it once, to people who use the voice at all.
  if (
    naturalVoice.isSupported() &&
    !naturalVoice.isInstalled(voiceDir) &&
    config().get<boolean>('speakAloud', true) &&
    voiceStyle() !== 'sound' &&
    !context.globalState.get<boolean>('naturalVoiceOffered')
  ) {
    context.globalState.update('naturalVoiceOffered', true);
    vscode.window
      .showInformationMessage(
        'Agent Watch: install a clearer, natural-sounding voice? (one-time download, about 90 MB)',
        'Install',
        'Not now',
      )
      .then((choice) => {
        if (choice === 'Install') installVoice();
      });
  }
  tick();

  context.subscriptions.push(
    status,
    { dispose: () => clearInterval(timer) },
    { dispose: () => clearInterval(animation) },
    vscode.window.registerWebviewViewProvider(BuddyViewProvider.viewId, buddy),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('agentWatch')) return;
      applyVoiceSetting();
      render();
    }),
    vscode.commands.registerCommand('agentWatch.installNaturalVoice', installVoice),
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
      const c = buddyChar();
      const text = style === 'plain' ? plainHello(userName()) : c.hello(userName());
      announce(c.sounds.hello, text, style, c.voice, volume());
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
