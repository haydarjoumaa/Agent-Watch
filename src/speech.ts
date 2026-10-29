import { spawn } from 'child_process';
import { MeowKind, meowFile } from './meow';

/** cat: meow + squeaky voice; meow: just the meow; plain: the normal system voice. */
export type VoiceStyle = 'cat' | 'meow' | 'plain';

type Command = [string, string[]];

/** Run the first command that exists, then call `done` when it finishes. */
function runFirst(commands: Command[], done?: () => void) {
  const [head, ...rest] = commands;
  if (!head) {
    done?.();
    return;
  }
  try {
    const child = spawn(head[0], head[1], { stdio: 'ignore' });
    child.on('error', () => runFirst(rest, done)); // not installed: try the next one
    child.on('exit', () => done?.());
  } catch {
    runFirst(rest, done);
  }
}

function playSound(file: string, done?: () => void) {
  if (process.platform === 'darwin') return runFirst([['afplay', [file]]], done);
  if (process.platform === 'win32') {
    const quoted = `'${file.replace(/'/g, "''")}'`;
    return runFirst([['powershell', ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer ${quoted}).PlaySync()`]]], done);
  }
  runFirst([['pw-play', [file]], ['paplay', [file]], ['aplay', ['-q', file]]], done);
}

/** Speak with the OS's built-in voice; `cute` raises the pitch for the cat. Does nothing if no voice exists. */
export function speak(text: string, cute = false) {
  if (!text) return;
  if (process.platform === 'darwin') {
    return runFirst([['say', [cute ? `[[pbas 62]] ${text}` : text]]]);
  }
  if (process.platform === 'win32') {
    const escaped = text.replace(/[<>&'"]/g, '');
    const ssml = cute
      ? `<speak version='1.0' xml:lang='en-US'><prosody pitch='x-high' rate='fast'>${escaped}</prosody></speak>`
      : `<speak version='1.0' xml:lang='en-US'>${escaped}</speak>`;
    return runFirst([
      [
        'powershell',
        ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).SpeakSsml("${ssml}")`],
      ],
    ]);
  }
  runFirst([['spd-say', cute ? ['-t', 'child_female', '-p', '60', '-r', '10', text] : [text]]]);
}

/** Play the alert in the chosen style: a meow, words, or both. */
export function announce(kind: MeowKind, text: string, style: VoiceStyle) {
  if (style === 'plain') return speak(text);
  let file: string;
  try {
    file = meowFile(kind);
  } catch {
    return speak(text, style === 'cat');
  }
  playSound(file, style === 'cat' ? () => speak(text, true) : undefined);
}
