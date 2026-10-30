import { AGENT_LABEL, folderName } from './labels';
import type { Session } from './watcher';

export type Mood = 'sleep' | 'idle' | 'working' | 'alert' | 'happy';

export interface BuddyStatus {
  mood: Mood;
  /** Shown in the speech bubble. */
  line: string;
  /** Short version for the status bar. */
  short: string;
  /** Session the bubble is about, so clicking it can open the project. */
  focus?: Session;
}

// How long the buddy stays happy after an agent finishes.
const HAPPY_MS = 2 * 60_000;

/** Pick the most important thing to say, in priority order. */
export function buddyStatus(sessions: Session[], now = Date.now()): BuddyStatus {
  const approval = sessions.find((s) => s.state === 'needs_approval');
  if (approval) {
    return {
      mood: 'alert',
      line: `Psst! ${AGENT_LABEL[approval.agent]} might need your approval in ${folderName(approval)}.`,
      short: `${AGENT_LABEL[approval.agent]} needs you · ${folderName(approval)}`,
      focus: approval,
    };
  }

  const input = sessions.find((s) => s.state === 'needs_input');
  if (input) {
    return {
      mood: 'alert',
      line: `${AGENT_LABEL[input.agent]} is asking you something in ${folderName(input)}.`,
      short: `${AGENT_LABEL[input.agent]} has a question · ${folderName(input)}`,
      focus: input,
    };
  }

  const justDone = sessions.find((s) => s.state === 'done' && now - s.lastActivity < HAPPY_MS);
  if (justDone) {
    return {
      mood: 'happy',
      line: `${AGENT_LABEL[justDone.agent]} finished in ${folderName(justDone)}! Your turn.`,
      short: `${AGENT_LABEL[justDone.agent]} finished · ${folderName(justDone)}`,
      focus: justDone,
    };
  }

  const working = sessions.filter((s) => s.state === 'working');
  if (working.length === 1) {
    const w = working[0];
    return {
      mood: 'working',
      line: `${AGENT_LABEL[w.agent]} is busy in ${folderName(w)}…`,
      short: `${AGENT_LABEL[w.agent]} busy · ${folderName(w)}`,
      focus: w,
    };
  }
  if (working.length > 1) {
    return {
      mood: 'working',
      line: `${working.length} agents are working hard. I'm keeping an eye on them.`,
      short: `${working.length} agents busy`,
    };
  }

  if (sessions.length > 0) {
    return {
      mood: 'idle',
      line: `All quiet. ${sessions.length} agent session${sessions.length > 1 ? 's' : ''} resting.`,
      short: 'all quiet',
    };
  }
  return { mood: 'sleep', line: 'Zzz… no agents running. Wake me when you start one.', short: 'napping' };
}
