import { spawn } from 'child_process';
import type { VoiceProfile } from './characters';
import * as natural from './naturalVoice';
import { SoundKind, soundFile } from './sounds';

// Where the natural voice lives, when it's enabled; undefined means always use the system voice.
let naturalDir: string | undefined;
export function setNaturalVoiceDir(dir: string | undefined) {
  naturalDir = dir;
}

/** character: sound + character voice; sound: only the sound; plain: the normal system voice. */
export type VoiceStyle = 'character' | 'sound' | 'plain';

/** Accept the setting values used before characters existed. */
export function normalizeStyle(value: string | undefined): VoiceStyle {
  if (value === 'plain') return 'plain';
  if (value === 'sound' || value === 'meow') return 'sound';
  return 'character';
}

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

/** Volume is baked into the generated WAV, so players run at their normal level. */
function playSound(file: string, done?: () => void) {
  if (process.platform === 'darwin') return runFirst([['afplay', [file]]], done);
  if (process.platform === 'win32') {
    const quoted = `'${file.replace(/'/g, "''")}'`;
    return runFirst([['powershell', ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer ${quoted}).PlaySync()`]]], done);
  }
  runFirst([['pw-play', [file]], ['paplay', [file]], ['aplay', ['-q', file]]], done);
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Speak with the OS's built-in voice, bent to `voice` when given. `volume` is 0–1.
 * Does nothing if no voice exists. `done` runs once speaking has finished.
 */
export function speak(text: string, voice?: VoiceProfile, volume = 1, done?: () => void) {
  if (!text) return done?.();
  const v = clamp(volume, 0, 1);
  if (naturalDir && natural.isInstalled(naturalDir)) {
    natural
      .synthesize(naturalDir, text, voice?.natural ?? { pitch: 1, speed: 1 }, v)
      .then((file) => playSound(file, done))
      .catch(() => systemSpeak(text, voice, v, done));
    return;
  }
  systemSpeak(text, voice, v, done);
}

/** The OS's built-in voice (eSpeak on Linux, `say` on macOS, Windows speech). */
function systemSpeak(text: string, voice: VoiceProfile | undefined, v: number, done?: () => void) {
  if (process.platform === 'darwin') {
    let prefix = `[[volm ${v.toFixed(2)}]]`;
    if (voice) {
      prefix += ` [[pbas ${Math.round(50 + voice.pitch * 0.25)}]]`;
      prefix += ` [[pmod ${Math.round(clamp(40 + voice.range * 0.4, 0, 100))}]]`;
      prefix += ` [[rate ${Math.round(175 * (1 + voice.rate / 100))}]]`;
    }
    return runFirst([['say', [`${prefix} ${text}`]]], done);
  }
  if (process.platform === 'win32') {
    const escaped = text.replace(/[<>&'"]/g, '');
    const prosody = voice ? ` pitch='${voice.pitch >= 0 ? '+' : ''}${Math.round(voice.pitch / 2)}%' rate='${voice.rate >= 0 ? '+' : ''}${voice.rate}%'` : '';
    const ssml = `<speak version='1.0' xml:lang='en-US'><prosody volume='${Math.round(v * 100)}'${prosody}>${escaped}</prosody></speak>`;
    return runFirst([
      [
        'powershell',
        ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).SpeakSsml("${ssml}")`],
      ],
    ], done);
  }
  // -w waits until speech ends; -i is volume; -p pitch, -R pitch range, -r rate (all -100..100).
  const args = ['-w', '-i', String(Math.round(v * 200 - 100))];
  if (voice) {
    if (voice.variant) args.push('-y', voice.variant);
    args.push('-p', String(voice.pitch), '-R', String(voice.range), '-r', String(voice.rate));
  }
  runFirst([['spd-say', [...args, text]]], done);
}

/** Words get lost at the low volumes that suit sound effects, so speech plays a bit louder. */
export function speechVolume(volume: number): number {
  return clamp(volume * 1.6, 0.4, 1);
}

/** Play the character's sound, then (in `character` style) say `text` in its voice. Empty `text` means sound only. */
export function announce(sound: SoundKind, text: string, style: VoiceStyle, voice: VoiceProfile, volume = 1) {
  const spoken = speechVolume(volume);
  if (style === 'plain') return speak(text, undefined, spoken);
  let file: string;
  try {
    file = soundFile(sound, volume);
  } catch {
    return speak(text, voice, spoken);
  }
  if (style === 'sound' || !text) return playSound(file);
  playSound(file, () => speak(text, voice, spoken));
}
