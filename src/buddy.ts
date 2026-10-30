import * as vscode from 'vscode';
import { buddyStatus } from './buddyLines';
import { AGENT_LABEL, STATE_LABEL, ago, folderName } from './labels';
import type { Session } from './watcher';

export interface BuddyActions {
  openFolder(cwd: string): void;
  toggleMute(): void;
  onPoke(): void;
}

/** Sidebar view with an animated character that talks about the agents' status. */
export class BuddyViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'agentWatch.buddy';

  private view?: vscode.WebviewView;
  private sessions: Session[] = [];
  private muted = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly actions: BuddyActions,
  ) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);
    view.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === 'ready') this.post();
      else if (msg?.type === 'open' && typeof msg.cwd === 'string') this.actions.openFolder(msg.cwd);
      else if (msg?.type === 'toggleMute') this.actions.toggleMute();
      else if (msg?.type === 'poke') this.actions.onPoke();
    });
    view.onDidChangeVisibility(() => view.visible && this.post());
    view.onDidDispose(() => (this.view = undefined));
  }

  update(sessions: Session[], muted: boolean) {
    this.sessions = sessions;
    this.muted = muted;
    this.post();
  }

  private post() {
    if (!this.view?.visible) return;
    const now = Date.now();
    const status = buddyStatus(this.sessions, now);
    const character = vscode.workspace.getConfiguration('agentWatch').get<string>('buddy', 'cat');
    this.view.webview.postMessage({
      type: 'status',
      character,
      muted: this.muted,
      mood: status.mood,
      line: status.line,
      focusCwd: status.focus?.cwd,
      sessions: this.sessions.map((s) => ({
        key: s.key,
        agent: AGENT_LABEL[s.agent],
        folder: folderName(s),
        cwd: s.cwd,
        state: s.state,
        stateLabel: STATE_LABEL[s.state],
        ago: ago(s.lastActivity, now),
      })),
    });
  }

  private html(webview: vscode.Webview, media: vscode.Uri): string {
    const nonce = [...Array(32)].map(() => Math.floor(Math.random() * 36).toString(36)).join('');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'buddy.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'buddy.js'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${css}">
  <title>Agent Buddy</title>
</head>
<body>
  <div class="stage">
    <button class="bubble" id="bubble" title="Click to open this project"></button>
    <button class="buddy" id="buddy" title="Poke me!" aria-label="Agent buddy"></button>
    <div class="shadow"></div>
  </div>
  <div class="toolbar">
    <button id="mute" class="link"></button>
  </div>
  <ul class="sessions" id="sessions"></ul>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}
