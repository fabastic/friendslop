// Pure ten-pin scoring. `rolls` is the list of pins knocked down per ball, in order.

export interface FrameScore {
  rolls: number[];
  /** Score earned by this frame alone (null until bonus balls are known). */
  score: number | null;
  /** Running total up to and including this frame (null until known). */
  cumulative: number | null;
}

export interface GameStatus {
  /** 0-based frame the next ball belongs to (9 when over). */
  frame: number;
  /** 0-based ball index within that frame. */
  ball: number;
  over: boolean;
  /** Pins standing for the next ball. */
  pinsStanding: number;
  /** True when the next ball is thrown at a full rack. */
  freshRack: boolean;
}

export function splitFrames(rolls: readonly number[]): number[][] {
  const frames: number[][] = [];
  let i = 0;
  for (let f = 0; f < 10 && i < rolls.length; f++) {
    if (f < 9) {
      if (rolls[i] === 10) {
        frames.push([10]);
        i += 1;
      } else {
        frames.push(rolls.slice(i, i + 2));
        i += 2;
      }
    } else {
      frames.push(rolls.slice(i, i + 3));
      i += 3;
    }
  }
  return frames;
}

export function scoreGame(rolls: readonly number[]): { frames: FrameScore[]; total: number } {
  const frames = splitFrames(rolls);
  const out: FrameScore[] = [];
  let i = 0;
  let running = 0;
  let known = true;
  for (let f = 0; f < frames.length; f++) {
    const fr = frames[f];
    let score: number | null = null;
    if (f < 9) {
      if (fr[0] === 10) {
        score = rolls.length > i + 2 ? 10 + rolls[i + 1] + rolls[i + 2] : null;
        i += 1;
      } else if (fr.length === 2 && fr[0] + fr[1] === 10) {
        score = rolls.length > i + 2 ? 10 + rolls[i + 2] : null;
        i += 2;
      } else {
        score = fr.length === 2 ? fr[0] + fr[1] : null;
        i += 2;
      }
    } else {
      const done = fr.length === 3 || (fr.length === 2 && fr[0] + fr[1] < 10);
      score = done ? fr.reduce((a, b) => a + b, 0) : null;
    }
    if (score === null) known = false;
    if (known && score !== null) running += score;
    out.push({ rolls: fr, score, cumulative: known ? running : null });
  }
  return { frames: out, total: running };
}

export function gameStatus(rolls: readonly number[]): GameStatus {
  const frames = splitFrames(rolls);
  if (frames.length === 0) return { frame: 0, ball: 0, over: false, pinsStanding: 10, freshRack: true };
  const lastIdx = frames.length - 1;
  const last = frames[lastIdx];

  if (lastIdx < 9) {
    const complete = last[0] === 10 || last.length === 2;
    if (complete) {
      return { frame: lastIdx + 1, ball: 0, over: false, pinsStanding: 10, freshRack: true };
    }
    return { frame: lastIdx, ball: 1, over: false, pinsStanding: 10 - last[0], freshRack: false };
  }

  // Tenth frame
  const [a, b] = last;
  if (last.length === 3 || (last.length === 2 && a + b < 10)) {
    return { frame: 9, ball: last.length, over: true, pinsStanding: 0, freshRack: false };
  }
  if (last.length === 1) {
    const fresh = a === 10;
    return { frame: 9, ball: 1, over: false, pinsStanding: fresh ? 10 : 10 - a, freshRack: fresh };
  }
  // two balls, bonus ball earned
  const fresh = (a === 10 && b === 10) || (a < 10 && a + b === 10);
  return { frame: 9, ball: 2, over: false, pinsStanding: fresh ? 10 : 10 - b, freshRack: fresh };
}

/** Display marks for a frame: X, /, -, digits. */
export function frameMarks(fr: readonly number[], tenth: boolean): string[] {
  const marks: string[] = [];
  let rackStart = 0; // index where the current rack started
  for (let k = 0; k < fr.length; k++) {
    const v = fr[k];
    const firstOfRack = k === rackStart;
    if (firstOfRack && v === 10) {
      marks.push('X');
      rackStart = k + 1;
    } else if (!firstOfRack && fr[k - 1] + v === 10) {
      marks.push('/');
      rackStart = k + 1;
    } else {
      marks.push(v === 0 ? '-' : String(v));
      if (!firstOfRack) rackStart = k + 1;
    }
    if (!tenth && marks.length >= 2) break;
  }
  return marks;
}

/**
 * Running score that never sits at 0 while bonus balls are pending: unfinished strike/spare frames
 * count their own pins plus whatever bonus balls have been thrown so far. `pending` marks frames
 * still waiting for bonus balls, so the UI can show them as "10+".
 */
export function provisionalScore(rolls: readonly number[]): { cumulative: number[]; pending: boolean[]; total: number } {
  const frames = splitFrames(rolls);
  const exact = scoreGame(rolls).frames;
  const cumulative: number[] = [];
  const pending: boolean[] = [];
  let run = 0;
  let i = 0;
  frames.forEach((fr, f) => {
    let score: number;
    let isPending = false;
    if (exact[f].score !== null) {
      score = exact[f].score!;
    } else if (f < 9 && (fr[0] === 10 || (fr.length === 2 && fr[0] + fr[1] === 10))) {
      const ownBalls = fr[0] === 10 ? 1 : 2;
      const bonusWanted = fr[0] === 10 ? 2 : 1;
      const bonus = rolls.slice(i + ownBalls, i + ownBalls + bonusWanted);
      score = 10 + bonus.reduce((a, b) => a + b, 0);
      isPending = true;
    } else {
      score = fr.reduce((a, b) => a + b, 0); // open frame in progress or unfinished tenth
      isPending = f === 9 && fr.length > 0;
    }
    i += f < 9 ? (fr[0] === 10 ? 1 : fr.length) : fr.length;
    run += score;
    cumulative.push(run);
    pending.push(isPending);
  });
  return { cumulative, pending, total: run };
}
