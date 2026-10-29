# Agent Watch

A VS Code extension that tells you when **Claude Code** or **Codex** needs your attention.

**Zero setup.** No hooks, no config changes, no database, no server, no account. Install it and it works.

## What you get

- **Status bar cat** (always visible, bottom left): a little animated cat face that shows what
  your agents are doing, e.g. `(=^･ω･^=) Claude busy · my-app` or `(=ↀωↀ=)! Codex needs you · api`.
  Click it to open the big cat.
- **Agent Cat** (in the Explorer sidebar): a bigger animated cat with a speech bubble.
  - sleeps when nothing is running, bobs along while agents work,
  - jumps and waves when an agent needs you, celebrates when one finishes,
  - click the bubble to open that project, click the cat to poke it.
  - Tip: drag the "Agent Cat" view to the right-hand (secondary) sidebar to keep it on screen all the time.
- **Cat voice**: alerts are announced with a synthesized meow, then a squeaky cat voice with
  cat puns ("Mrrow! Claude needs your approval in my app." / "Codex finished. Purrfect!").
  Poking the big cat makes it meow. Uses your computer's built-in voice
  (`spd-say` on Linux, `say` on macOS, Windows speech); the meow is generated, no audio files.
  Try it: **Agent Watch: Test Cat Voice**.

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
| `agentWatch.buddy` | cat | `cat` or `robot` |
| `agentWatch.speakAloud` | true | Play sound alerts |
| `agentWatch.voice` | cat | `cat` (meow + cat voice), `meow` (meow only), `plain` (normal voice) |
| `agentWatch.showPopups` | true | Show VS Code pop-up notifications |

Command palette: **Agent Watch: Show Buddy**, **Show Agent Sessions**, **Mute/Unmute Notifications**, **Test Cat Voice**.

## Develop

```bash
npm install
npm run compile
npm test          # parser tests
npm run package   # builds agent-watch-<version>.vsix
code --install-extension agent-watch-0.4.0.vsix
```

Press F5 in VS Code to try it in an Extension Development Host.
