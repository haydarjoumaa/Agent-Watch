# Agent Watch

A VS Code extension that tells you when **Claude Code** or **Codex** needs your attention.

**Zero setup.** No hooks, no config changes, no database, no server, no account. Install it and it works.

## What you get

- **Status bar** (bottom left): `Agents idle`, `2 working`, or `1 agent waiting` (highlighted).
  Hover to see every session; click to pick one and jump to its project.
- **Notifications** when an agent:
  - may need approval for a tool call,
  - is asking you a question (e.g. AskUserQuestion / plan approval),
  - finished its turn (can be turned off with `agentWatch.notifyWhenFinished`).

With several VS Code windows open, each event pops up once, in the window that has that
project open (or another window if none does).

## How it works

Both agents already log every session on your machine:

| Agent | Log location |
|---|---|
| Claude Code | `~/.claude/projects/<project>/<session>.jsonl` (or `$CLAUDE_CONFIG_DIR`) |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (or `$CODEX_HOME`) |

Every 2 seconds Agent Watch reads the end of recently changed logs and works out each session's
state. It **only reads** these files: it never changes them or any agent setting, never approves or
rejects anything, and sends nothing over the network.

## Limits (please read)

- States are **inferred**, not reported by the agents. "May need approval" means a tool call has
  had no result for `approvalDelaySeconds` (default 5). A slow command such as a long test run
  can trigger it too.
- Codex sessions running with approval policy `never` are never shown as needing approval.
- The log formats are not a public API. An agent update may change them; if parsing fails, Agent
  Watch shows nothing rather than a wrong alert.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `agentWatch.approvalDelaySeconds` | 5 | Quiet time before a pending tool call counts as "may need approval" |
| `agentWatch.staleAfterMinutes` | 30 | Hide sessions idle longer than this |
| `agentWatch.notifyWhenFinished` | true | Also notify when an agent finishes a turn |

Command palette: **Agent Watch: Show Agent Sessions**, **Agent Watch: Mute/Unmute Notifications**.

## Develop

```bash
npm install
npm run compile
npm test          # parser tests
npm run package   # builds agent-watch-<version>.vsix
code --install-extension agent-watch-0.1.0.vsix
```

Press F5 in VS Code to try it in an Extension Development Host.
