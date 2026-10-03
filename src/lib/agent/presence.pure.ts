/**
 * Presence — the one sentence and the one mood Aurixa shows at any moment.
 *
 * The header, the launcher capsule, the voice stage and the orb all have to
 * agree about what Aurixa is doing, or the surface contradicts itself ("Reply
 * ready" on the launcher while the header still says "Thinking…"). So the
 * decision lives here, once, and every surface renders its answer.
 *
 * Order is the rule: a person speaking to Aurixa outranks everything, an
 * approval Aurixa is waiting on outranks a reply the user has not read, and
 * idle is what is left.
 */
import { narrateTool } from './toolNarration.pure';

export type PresenceMood =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'working'
  | 'writing'
  | 'speaking'
  | 'attention'
  | 'done';

export interface PresenceInput {
  listening?: boolean;
  transcribing?: boolean;
  speaking?: boolean;
  /** A request is in flight (the existing `loading` flag). */
  busy?: boolean;
  /** Tokens of the reply have begun to arrive. */
  writing?: boolean;
  /** The tool currently running, if any. */
  activeTool?: string | null;
  /** An assistant message is waiting on Approve / Cancel. */
  awaitingApproval?: boolean;
  /** A reply finished while the panel was closed and nobody has looked yet. */
  unseenReply?: boolean;
}

export interface Presence {
  mood: PresenceMood;
  /** Short status for the header and capsule. Sentence case, no full stop. */
  status: string;
  /** True while Aurixa is doing something the user is waiting on. */
  active: boolean;
}

export const IDLE_STATUS = 'Ready when you are';

export function derivePresence(input: PresenceInput): Presence {
  if (input.listening) return { mood: 'listening', status: 'Listening…', active: true };
  if (input.transcribing) return { mood: 'thinking', status: 'Catching that…', active: true };
  if (input.activeTool) {
    return { mood: 'working', status: `${narrateTool(input.activeTool).active}…`, active: true };
  }
  if (input.speaking) return { mood: 'speaking', status: 'Speaking', active: true };
  if (input.busy && input.writing) return { mood: 'writing', status: 'Writing…', active: true };
  if (input.busy) return { mood: 'thinking', status: 'Thinking…', active: true };
  if (input.awaitingApproval) return { mood: 'attention', status: 'Needs your go-ahead', active: false };
  if (input.unseenReply) return { mood: 'done', status: 'Reply ready', active: false };
  return { mood: 'idle', status: IDLE_STATUS, active: false };
}
