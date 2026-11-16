/**
 * Pin-leave patterns: what's still standing after a first ball. Every one of the 1022 possible
 * leaves maps to a name, a caption and a gag style (how the standing pins act out).
 *
 * Pin numbers (bowler's view):   7 8 9 10
 *                                 4 5 6
 *                                  2 3
 *                                   1
 */

export type Gag = 'shiver' | 'wave' | 'huddle' | 'stripe' | 'highfive' | 'taunt' | 'gossip';

export interface Leave {
  id: string;
  name: string;
  caption: string;
  split: boolean;
  gag: Gag;
  pins: number[];
}

const ADJ: [number, number][] = [
  [1, 2], [1, 3], [2, 3], [2, 4], [2, 5], [3, 5], [3, 6], [4, 5], [5, 6],
  [4, 7], [4, 8], [5, 8], [5, 9], [6, 9], [6, 10], [7, 8], [8, 9], [9, 10],
];

const NAMED: { pins: number[]; id: string; name: string; caption: string; gag?: Gag }[] = [
  { pins: [7, 10], id: 'goalposts', name: 'Goal posts', caption: 'The legendary 7-10!', gag: 'wave' },
  { pins: [4, 6, 7, 10], id: 'bigfour', name: 'Big Four', caption: 'Four corners, zero mercy', gag: 'wave' },
  { pins: [4, 6, 7, 9, 10], id: 'greekchurch', name: 'Greek Church', caption: 'They built a whole church back there', gag: 'wave' },
  { pins: [2, 7], id: 'baby27', name: 'Baby split', caption: 'Tiny gap, big sigh', gag: 'highfive' },
  { pins: [3, 10], id: 'baby310', name: 'Baby split', caption: 'Tiny gap, big sigh', gag: 'highfive' },
  { pins: [5, 7, 10], id: 'lily', name: 'The Lily', caption: 'Three little pins, three big problems', gag: 'wave' },
  { pins: [8, 10], id: 'cincinnati', name: 'Cincinnati', caption: 'Left and right, nothing between', gag: 'wave' },
  { pins: [7, 9], id: 'wideopen', name: 'Wide open', caption: 'So close, yet so far', gag: 'wave' },
  { pins: [4, 10], id: 'fourten', name: 'Four-ten', caption: 'A long walk across the lane', gag: 'wave' },
  { pins: [6, 7], id: 'sixseven', name: 'Six-seven', caption: 'Corner to corner', gag: 'wave' },
  { pins: [4, 6], id: 'foursix', name: 'Four-six', caption: 'Gap in the middle', gag: 'wave' },
  { pins: [4, 9], id: 'fournine', name: 'Four-nine', caption: 'Diagonal drama', gag: 'wave' },
  { pins: [6, 8], id: 'sixeight', name: 'Six-eight', caption: 'Diagonal drama', gag: 'wave' },
  { pins: [2, 4, 5, 8], id: 'bucket', name: 'The Bucket', caption: 'Bucket list!', gag: 'huddle' },
  { pins: [3, 5, 6, 9], id: 'bucket', name: 'The Bucket', caption: 'Bucket list!', gag: 'huddle' },
  { pins: [1, 2, 4, 7], id: 'leftfence', name: 'Left fence', caption: 'All lined up on the left', gag: 'stripe' },
  { pins: [1, 3, 6, 10], id: 'rightfence', name: 'Right fence', caption: 'All lined up on the right', gag: 'stripe' },
  { pins: [2, 4, 7], id: 'leftrail', name: 'Left rail', caption: 'Hugging the left gutter', gag: 'stripe' },
  { pins: [3, 6, 10], id: 'rightrail', name: 'Right rail', caption: 'Hugging the right gutter', gag: 'stripe' },
  { pins: [1, 5], id: 'sleeper15', name: 'Sleeper', caption: 'One hides behind the other', gag: 'gossip' },
  { pins: [2, 8], id: 'sleeper28', name: 'Sleeper', caption: 'Peekaboo pin!', gag: 'gossip' },
  { pins: [3, 9], id: 'sleeper39', name: 'Sleeper', caption: 'Peekaboo pin!', gag: 'gossip' },
  { pins: [5, 8, 9], id: 'christmastree', name: 'Christmas tree', caption: 'Festive, but annoying', gag: 'huddle' },
  { pins: [1, 2, 3], id: 'headset', name: 'Front door', caption: 'They stood their ground', gag: 'taunt' },
];

const SINGLE_CAPTION: Record<number, string> = {
  1: 'The head pin just… stayed?', 2: 'Lonely little 2', 3: 'Lonely little 3', 4: 'The 4 holds on',
  5: 'Kingpin survives!', 6: 'The 6 is shaking', 7: 'The dreaded 7-pin', 8: 'The 8 is hiding',
  9: 'The 9 is hiding', 10: 'The ten-pin tap!',
};

function groups(standing: number[]): number[][] {
  const set = new Set(standing);
  const seen = new Set<number>();
  const out: number[][] = [];
  for (const s of standing) {
    if (seen.has(s)) continue;
    const g: number[] = [];
    const stack = [s];
    seen.add(s);
    while (stack.length) {
      const c = stack.pop()!;
      g.push(c);
      for (const [a, b] of ADJ) {
        const o = a === c ? b : b === c ? a : 0;
        if (o && set.has(o) && !seen.has(o)) {
          seen.add(o);
          stack.push(o);
        }
      }
    }
    out.push(g.sort((x, y) => x - y));
  }
  return out;
}

const ROW = (n: number): number => (n === 1 ? 0 : n <= 3 ? 1 : n <= 6 ? 2 : 3);

/** `standing` = pin numbers (1..10) still up after the first ball. Null for 0 or 10 standing. */
export function classifyLeave(standing: readonly number[]): Leave | null {
  const pins = [...new Set(standing)].filter((n) => n >= 1 && n <= 10).sort((a, b) => a - b);
  if (pins.length === 0 || pins.length === 10) return null;
  const key = pins.join('-');
  const gs = groups(pins);
  const split = !pins.includes(1) && gs.length >= 2;
  const named = NAMED.find((n) => n.pins.join('-') === key);
  if (named) return { id: named.id, name: named.name, caption: named.caption, split, gag: named.gag ?? (split ? 'wave' : 'huddle'), pins };
  if (pins.length === 1) {
    const n = pins[0];
    return { id: `single${n}`, name: `${n}-pin`, caption: SINGLE_CAPTION[n], split: false, gag: 'shiver', pins };
  }
  if (split) {
    const wide = gs.length >= 3 ? 'Triple split' : pins.length >= 4 ? 'Big split' : 'Split';
    return { id: 'split', name: `${wide} ${key}`, caption: gs.length >= 3 ? 'Islands everywhere!' : 'Mind the gap!', split, gag: 'wave', pins };
  }
  if (pins.length >= 7) return { id: 'many', name: `${pins.length} left`, caption: 'The pins are laughing at you', split, gag: 'taunt', pins };
  if (pins.length === 2) return { id: 'pair', name: `${key}`, caption: 'Best buddies, still standing', split, gag: 'highfive', pins };
  // a straight line along one side or one row?
  const rows = new Set(pins.map(ROW));
  if (rows.size === 1) return { id: 'row', name: `Back row ${key}`, caption: 'Standing in a neat little row', split, gag: 'stripe', pins };
  if (gs.length === 1) return { id: 'cluster', name: `Cluster ${key}`, caption: `${pins.length} pins huddled together`, split, gag: 'huddle', pins };
  return { id: 'scatter', name: `${pins.length} left`, caption: `${pins.length} pins still standing`, split, gag: 'gossip', pins };
}

/** Pin number (1..10) for each pinSpots() index, from their positions (head pin = nearest the bowler). */
export function pinNumbers(homes: readonly { x: number; z: number }[]): number[] {
  const order = homes.map((h, i) => ({ i, x: h.x, z: h.z })).sort((a, b) => b.z - a.z || a.x - b.x);
  const nums = new Array<number>(homes.length);
  let n = 1;
  for (let row = 0, k = 0; row < 4; row++) {
    const slice = order.slice(k, k + row + 1).sort((a, b) => a.x - b.x);
    for (const s of slice) nums[s.i] = n++;
    k += row + 1;
  }
  return nums;
}
