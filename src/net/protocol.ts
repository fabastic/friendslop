/** Wire protocol for Jelly Bowl online rooms (JSON over PeerJS data channels). */

export interface LobbyPlayer {
  seat: number;
  peerId: string;
  name: string;
  species: string;
  color: string;
}

export interface StartConfig {
  name: string;
  species: string;
  color: string;
}

export interface ChatLine {
  seat: number;
  name: string;
  text: string;
}

/** The bowler's throw: everything a peer needs to replay the launch locally. */
export interface ThrowMsg {
  t: 'throw';
  seat: number;
  x: number;
  aim: number;
  power: number;
  spin: number;
  /** Index into the shared (seeded) ball skin table so everyone shows the same ball. */
  skin: number;
  /** Authoritative pins standing at release. */
  sb: number;
  /** Bitmask of pins still in play at release (the thrower's view). */
  act: number;
  /** Sender's peer id (seats renumber when someone leaves; peer ids don't). */
  pid?: string;
}

export type NetMsg =
  /** host → everyone: full lobby snapshot (also carries chat history + game-running flag). */
  | { t: 'lobby'; players: LobbyPlayer[]; running: boolean; chat: ChatLine[] }
  /** guest → host: introduce / update my profile. */
  | { t: 'hello'; name: string; species: string; color: string }
  /** host → everyone: begin the game with this line-up (seat order). */
  | { t: 'start'; configs: StartConfig[] }
  | ThrowMsg
  /** bowler → everyone: authoritative pin outcome of their roll. */
  | { t: 'roll'; seat: number; mask: number; pid?: string }
  /** bowler → everyone: throttled aim state so peers can show the bowler (and get shoved). */
  | { t: 'aim'; seat: number; x: number; aim: number; spin: number; skin: number; pid?: string }
  /** roamer → everyone: throttled free-roam position. */
  | { t: 'roam'; seat: number; x: number; z: number; ry: number; y: number; pid?: string }
  /** host → everyone: close the round leaderboard and start the next round. */
  | { t: 'continue' }
  /** host → everyone: final board → new game with the current room line-up. */
  | { t: 'again'; configs: StartConfig[] }
  /** host → everyone: a player left mid-game; splice them out of the rotation. */
  | { t: 'remove'; seat: number; name: string; restartTurn: boolean; endGame: boolean; pid?: string }
  /** guest → host (host relays to everyone, keeping history). */
  | { t: 'chat'; seat: number; text: string }
  /** anyone → everyone (direct). */
  | { t: 'emote'; seat: number; id: number };

export const EMOTES = ['🎳', '😂', '👏', '😭', '🎉', '😤', '🥳', '❤️'];
export const MAX_PLAYERS = 4;
export const CHAT_MAX = 140;
export const CHAT_HISTORY = 30;

/** Room codes: 5 chars, no ambiguous 0/O/1/I/L. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 5;

export function makeCode(): string {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0];
  return s;
}

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
}

export function isNetMsg(m: unknown): m is NetMsg {
  return typeof m === 'object' && m !== null && typeof (m as { t?: unknown }).t === 'string';
}
