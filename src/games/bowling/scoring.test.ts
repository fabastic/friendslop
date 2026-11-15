import { scoreGame, gameStatus, frameMarks, provisionalScore } from './scoring.ts';

declare const process: { exit(code: number): never };

let failed = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) console.log(`ok   ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`);
  }
}
const rep = (v: number, n: number): number[] => Array(n).fill(v);

eq('perfect game', scoreGame(rep(10, 12)).total, 300);
eq('perfect over', gameStatus(rep(10, 12)).over, true);
eq('all 5s', scoreGame(rep(5, 21)).total, 150);
eq('all 5s over', gameStatus(rep(5, 21)).over, true);
eq('all gutters', scoreGame(rep(0, 20)).total, 0);
eq('gutters over', gameStatus(rep(0, 20)).over, true);
eq('gutters not over at 19', gameStatus(rep(0, 19)).over, false);
eq('9-0 x10', scoreGame(Array(10).fill([9, 0]).flat()).total, 90);

// tenth frame strike then 3 standing
eq('tenth X 7 -> 3 standing', gameStatus([...rep(0, 18), 10, 7]), {
  frame: 9, ball: 2, over: false, pinsStanding: 3, freshRack: false,
});
eq('tenth spare fresh', gameStatus([...rep(0, 18), 6, 4]).freshRack, true);
eq('tenth open over', gameStatus([...rep(0, 18), 6, 3]).over, true);
eq('tenth X X fresh', gameStatus([...rep(0, 18), 10, 10]).freshRack, true);

// partial game
const partial = scoreGame([10, 7, 3, 9, 0, 10]);
eq('partial cumulatives', partial.frames.map((f) => f.cumulative), [20, 39, 48, null]);
eq('partial status', gameStatus([10, 7, 3, 9, 0, 10]), {
  frame: 4, ball: 0, over: false, pinsStanding: 10, freshRack: true,
});
eq('mid frame status', gameStatus([3]), { frame: 0, ball: 1, over: false, pinsStanding: 7, freshRack: false });
eq('classic game', scoreGame([10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1]).total, 167);

eq('marks strike', frameMarks([10], false), ['X']);
eq('marks spare', frameMarks([7, 3], false), ['7', '/']);
eq('marks gutter', frameMarks([0, 0], false), ['-', '-']);
eq('marks tenth XXX', frameMarks([10, 10, 10], true), ['X', 'X', 'X']);
eq('marks tenth X 7 /', frameMarks([10, 7, 3], true), ['X', '7', '/']);
eq('marks tenth 6 / X', frameMarks([6, 4, 10], true), ['6', '/', 'X']);

eq('provisional strike alone', provisionalScore([10]), { cumulative: [10], pending: [true], total: 10 });
eq('provisional strike + 1', provisionalScore([10, 7]).total, 24);
eq('provisional strike + 2 = exact', provisionalScore([10, 7, 2]).cumulative, [19, 28]);
eq('provisional spare', provisionalScore([6, 4]), { cumulative: [10], pending: [true], total: 10 });
eq('provisional open frame in progress', provisionalScore([9, 0, 3]).total, 12);
eq('provisional perfect game', provisionalScore(Array(12).fill(10)).total, 300);

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
