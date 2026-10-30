import type { Mood } from './buddyLines';
import { AGENT_LABEL } from './labels';
import type { NaturalVoiceStyle } from './naturalVoice';
import type { SoundKind } from './sounds';
import type { Session } from './watcher';

/** "Haydar, " before the sentence / ", Haydar" after it; nothing when the name is unknown. */
const pre = (name: string) => (name ? `${name}, ` : '');
const post = (name: string) => (name ? `, ${name}` : '');

export type CharacterId = 'cat' | 'coach' | 'robot';

/** How the system voice is bent to fit a character. Values are -100..100, 0 = the voice's default. */
export interface VoiceProfile {
  pitch: number;
  /** How much the pitch moves around: low is monotone, high is sing-song. */
  range: number;
  rate: number;
  /** speech-dispatcher voice variant on Linux, when one suits the character. */
  variant?: string;
  /** How the natural (Piper) voice is bent, when it's installed. */
  natural: NaturalVoiceStyle;
}

type AlertState = 'needs_approval' | 'needs_input' | 'done';

export interface Character {
  id: CharacterId;
  /** Two-frame faces for the status bar, swapped on a timer so the character looks alive. */
  faces: Record<Mood, [string, string]>;
  sounds: Record<AlertState | 'hello' | 'poke', SoundKind>;
  voice: VoiceProfile;
  /** What the character says for an alert. `name` is the user's first name, or '' when unknown. Keep it short. */
  says: Record<AlertState, (agent: string, name: string) => string>;
  hello: (name: string) => string;
}

const CAT: Character = {
  id: 'cat',
  faces: {
    sleep: ['(=ᵕ.ᵕ=) z', '(=ᵕ.ᵕ=) zZ'],
    idle: ['(=^･ｪ･^=)', '(=-ｪ-=)'],
    working: ['(=^･ω･^=)', '(=^･ω･^=)ﾉ'],
    alert: ['(=ↀωↀ=)!', '(=ↀωↀ=)!!'],
    happy: ['(=^▽^=)♪', '(=^▽^=)♥'],
  },
  sounds: {
    needs_approval: 'meow-alert',
    needs_input: 'meow-question',
    done: 'meow-happy',
    hello: 'meow-hello',
    poke: 'meow-trill',
  },
  // Kept moderate: extreme pitch and melody make eSpeak hard to understand.
  voice: { pitch: 55, range: 45, rate: -20, variant: 'English (America)+Annie', natural: { pitch: 1.35, speed: 1 } },
  says: {
    needs_approval: (a, n) => `${pre(n)}${a} needs you. Meow!`,
    needs_input: (a, n) => `${pre(n)}${a} has a question. Mew?`,
    done: (a, n) => `${a} is done${post(n)}. Purr!`,
  },
  hello: (n) => `Meow${post(n)}! I'm watching your agents.`,
};

const COACH: Character = {
  id: 'coach',
  faces: {
    sleep: ['(－_－) zz', '(－_－) zZ'],
    idle: ['(•_•)', '(•_•)ゞ'],
    working: ['ᕦ(ò_óˇ)ᕤ', 'ᕙ(ò_ó)ᕗ'],
    alert: ['(ง •̀_•́)ง!', '(ง •̀_•́)ง!!'],
    happy: ['ᕦ(^o^)ᕤ', '\\(^o^)/'],
  },
  sounds: {
    needs_approval: 'whistle',
    needs_input: 'whistle-short',
    done: 'bell',
    hello: 'whistle-short',
    poke: 'whistle-short',
  },
  voice: { pitch: -10, range: 35, rate: -5, natural: { pitch: 0.95, speed: 1.08 } },
  says: {
    needs_approval: (a, n) => `${n || 'Champ'}! ${a} needs you. Let's go!`,
    needs_input: (a, n) => `${n || 'Champ'}, ${a} has a question!`,
    done: (a, n) => `${a} is done. Great set${post(n)}!`,
  },
  hello: (n) => `Let's go${post(n || 'champ')}! I've got your agents.`,
};

const ROBOT: Character = {
  id: 'robot',
  faces: {
    sleep: ['[-_-] z', '[-_-] zZ'],
    idle: ['[o_o]', '[-_-]'],
    working: ['[o_o]⚙', '[O_O]⚙'],
    alert: ['[O_O]!', '[O_O]!!'],
    happy: ['[^_^]', '[^o^]'],
  },
  sounds: {
    needs_approval: 'beep-alert',
    needs_input: 'beep-question',
    done: 'beep-happy',
    hello: 'beep-hello',
    poke: 'beep-hello',
  },
  voice: { pitch: -20, range: -60, rate: -20, natural: { pitch: 1, speed: 0.95, robot: true } },
  says: {
    needs_approval: (a, n) => `Beep! ${pre(n)}${a} needs approval.`,
    needs_input: (a, n) => `Beep! ${pre(n)}${a} has a question.`,
    done: (a, n) => `${a} task complete${post(n)}.`,
  },
  hello: (n) => `Hello${n ? ` ${n}` : ''}. Monitoring your agents.`,
};

export const CHARACTERS: Record<CharacterId, Character> = { cat: CAT, coach: COACH, robot: ROBOT };

export function character(id: string | undefined): Character {
  return CHARACTERS[id as CharacterId] ?? CAT;
}

const PLAIN_SAYS: Character['says'] = {
  needs_approval: (a, n) => `${pre(n)}${a} needs your approval.`,
  needs_input: (a, n) => `${pre(n)}${a} has a question.`,
  done: (a) => `${a} is done.`,
};

export const plainHello = (name: string) => `Hi${name ? ` ${name}` : ''}! I'm watching your agents.`;

/** The short sentence spoken for an alert; `c` omitted means plain wording. */
export function spokenAlert(s: Session, c?: Character, name = ''): string {
  if (s.state === 'working') return '';
  return (c?.says ?? PLAIN_SAYS)[s.state](AGENT_LABEL[s.agent], name);
}
