import { classifyLeave, pinNumbers } from './leaves.ts';

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

eq('none standing', classifyLeave([]), null);
eq('all standing', classifyLeave([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), null);
eq('7-10', classifyLeave([10, 7])?.id, 'goalposts');
eq('7-10 split', classifyLeave([7, 10])?.split, true);
eq('big four', classifyLeave([4, 6, 7, 10])?.id, 'bigfour');
eq('baby split', classifyLeave([2, 7])?.id, 'baby27');
eq('bucket', classifyLeave([2, 4, 5, 8])?.id, 'bucket');
eq('single 10', classifyLeave([10])?.gag, 'shiver');
eq('single 5', classifyLeave([5])?.caption, 'Kingpin survives!');
eq('generic split', classifyLeave([4, 9, 10])?.id, 'split');
eq('triple split', classifyLeave([2, 6, 8])?.name.startsWith('Triple'), true);
eq('head pin up is never a split', classifyLeave([1, 7])?.split, false);
eq('pair', classifyLeave([5, 9])?.id, 'pair');
eq('cluster', classifyLeave([2, 4, 5])?.id, 'cluster');
eq('many', classifyLeave([1, 2, 3, 4, 5, 6, 7, 8])?.id, 'many');

// every one of the 1022 possible leaves gets a non-empty name and caption
let ok = 0;
for (let m = 1; m < 1023; m++) {
  const pins: number[] = [];
  for (let b = 0; b < 10; b++) if (m & (1 << b)) pins.push(b + 1);
  const l = classifyLeave(pins);
  if (l && l.name && l.caption) ok++;
}
eq('all 1022 leaves classified', ok, 1022);

// pinSpots-like layout: rows go away from the bowler (more negative z)
const homes = [
  { x: 0, z: -18 },
  { x: -0.15, z: -18.3 }, { x: 0.15, z: -18.3 },
  { x: -0.3, z: -18.6 }, { x: 0, z: -18.6 }, { x: 0.3, z: -18.6 },
  { x: -0.45, z: -18.9 }, { x: -0.15, z: -18.9 }, { x: 0.15, z: -18.9 }, { x: 0.45, z: -18.9 },
];
eq('pin numbering', pinNumbers(homes), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
