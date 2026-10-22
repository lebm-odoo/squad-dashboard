import { type Kind, kindOf, type RuleFiles } from './classify';
import { length, re, round, splitLines, strip } from './py';

export const profiles = ['back', 'front', 'views', 'data', 'test'] as const;
export type Profile = (typeof profiles)[number];
/** `[path, added lines, removed lines]`, as numstat gives them. */
export type FileStat = [string, number, number];
/** Added and removed lines per path that are moves or renames rather than written code. */
export type Mechanical = Record<string, [number, number]>;

/** Whether a change is big enough to be searched for moved and renamed lines: 100 lines of files that count. */
export function worthMechanics(repo: string, files: FileStat[], ruleFiles: RuleFiles) {
  return files.reduce((total, [path, ins, dels]) => total + (kindOf(repo, path, ruleFiles) ? ins + dels : 0), 0) >= 100;
}

/** What each kind of file brought to the weighted lines: its lines, the mechanical ones among them, its weight. */
export type WeightPart = { ins: number; dels: number; mechanical: number; weight: number; weighted: number };

/** Weighted lines of a change, its lines per profile, how many of its lines are mechanical, and the part of each kind of file. */
export function substance(repo: string, files: FileStat[], mechanical: Mechanical | null, ruleFiles: RuleFiles) {
  // What a line of each kind of file weighs next to a line of Python or JavaScript logic: views, templates, styles and tests
  // take less thought per line, data files are mostly bulk.
  const weights: Record<Kind, number> = {
    back: 1,
    front: 1,
    migration: 0.8,
    rules: 0.8,
    template: 0.7,
    views: 0.6,
    style: 0.5,
    test: 0.5,
    data: 0.15,
    other: 0.1,
  };
  const profileOf: Record<Kind, Profile> = {
    back: 'back',
    migration: 'back',
    rules: 'back',
    front: 'front',
    template: 'front',
    style: 'front',
    views: 'views',
    data: 'data',
    test: 'test',
    other: 'data',
  };
  // Removing code is cheaper than writing it; a moved or renamed line is mechanical, whatever the file. Past a few hundred
  // lines, data is generated or bulk imported.
  const deletion = 0.3;
  const moved = 0.1;
  const [dataFull, dataBulk] = [300, 0.02];

  let weighted = 0;
  let data = 0;
  let mechanicalTotal = 0;
  const profile = Object.fromEntries(profiles.map((name) => [name, 0])) as Record<Profile, number>;
  const parts: Partial<Record<Kind, WeightPart>> = {};
  for (const [path, ins, dels] of files) {
    const kind = kindOf(repo, path, ruleFiles);
    if (!kind) continue;
    const [mechanicalIns, mechanicalDels] = mechanical?.[path] ?? [0, 0];
    const [mIns, mDels] = [Math.min(mechanicalIns, ins), Math.min(mechanicalDels, dels)];
    const lines = ins - mIns + deletion * (dels - mDels);
    const part = parts[kind] ?? { ins: 0, dels: 0, mechanical: 0, weight: weights[kind], weighted: 0 };
    parts[kind] = part;
    if (kind === 'data') data += lines;
    else {
      weighted += weights[kind] * lines;
      part.weighted += weights[kind] * lines;
    }
    weighted += Math.min(moved, weights[kind]) * (mIns + mDels);
    part.weighted += Math.min(moved, weights[kind]) * (mIns + mDels);
    part.ins += ins;
    part.dels += dels;
    part.mechanical += mIns + mDels;
    profile[profileOf[kind]] += ins - mIns + dels - mDels;
    mechanicalTotal += mIns + mDels;
  }
  const bulk = weights.data * Math.min(data, dataFull) + dataBulk * Math.max(0, data - dataFull);
  weighted += bulk;
  if (parts.data) parts.data.weighted += bulk;
  return { weighted: round(weighted), profile, mechanical: mechanicalTotal, parts };
}

type Opcode = { tag: 'replace' | 'delete' | 'insert'; i1: number; i2: number; j1: number; j2: number };

/** `difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes()`, the `equal` ones left out. */
export function changedOpcodes(a: string[], b: string[]): Opcode[] {
  const positions = new Map<string, number[]>();
  b.forEach((element, j) => {
    const list = positions.get(element);
    if (list) list.push(j);
    else positions.set(element, [j]);
  });
  const longest = (alo: number, ahi: number, blo: number, bhi: number) => {
    let [besti, bestj, bestsize] = [alo, blo, 0];
    let lengths = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>();
      for (const j of positions.get(a[i] as string) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (lengths.get(j - 1) ?? 0) + 1;
        next.set(j, k);
        if (k > bestsize) [besti, bestj, bestsize] = [i - k + 1, j - k + 1, k];
      }
      lengths = next;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) [besti, bestj, bestsize] = [besti - 1, bestj - 1, bestsize + 1];
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
    return [besti, bestj, bestsize] as const;
  };

  const blocks: (readonly [number, number, number])[] = [];
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop() as [number, number, number, number];
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (!k) continue;
    blocks.push([i, j, k]);
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  const merged: [number, number, number][] = [];
  let [i1, j1, k1] = [0, 0, 0];
  for (const [i2, j2, k2] of blocks) {
    if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2;
    else {
      if (k1) merged.push([i1, j1, k1]);
      [i1, j1, k1] = [i2, j2, k2];
    }
  }
  if (k1) merged.push([i1, j1, k1]);
  merged.push([a.length, b.length, 0]);

  const ops: Opcode[] = [];
  let [i, j] = [0, 0];
  for (const [ai, bj, size] of merged) {
    const tag = i < ai && j < bj ? 'replace' : i < ai ? 'delete' : j < bj ? 'insert' : null;
    if (tag) ops.push({ tag, i1: i, i2: ai, j1: j, j2: bj });
    [i, j] = [ai + size, bj + size];
  }
  return ops;
}

/**
 * Lines of a `-U0` diff that are mechanical, per path: `[added, removed]`, the path `null` for a hunk with no file.
 *
 * Moved: removed and added identically elsewhere in the same change. Renamed: a removed line and the added line facing it
 * differ only by token substitutions that repeat at least 3 times.
 */
export function mechanicalLines(diff: string) {
  type Hunk = { path: string | null; plus: string[]; minus: string[] };
  const hunks: Hunk[] = [];
  let current: string | null = null;
  let hunk: Hunk | null = null;
  for (const line of splitLines(diff)) {
    if (line.startsWith('+++ ')) current = line.startsWith('+++ b/') ? line.slice(6) : current;
    else if (line.startsWith('--- ')) current = line.startsWith('--- a/') ? line.slice(6) : null;
    else if (line.startsWith('@@')) {
      hunk = { path: current, plus: [], minus: [] };
      hunks.push(hunk);
    } else if (hunk && (line[0] === '+' || line[0] === '-') && !line.startsWith('+++') && !line.startsWith('---'))
      (line[0] === '+' ? hunk.plus : hunk.minus).push(strip(line.slice(1)));
  }
  const significant = (line: string) => length(line) >= 8;
  const count = (side: 'plus' | 'minus') => {
    const counter = new Map<string, number>();
    for (const h of hunks) for (const line of h[side]) if (significant(line)) counter.set(line, (counter.get(line) ?? 0) + 1);
    return counter;
  };
  const [added, removed] = [count('plus'), count('minus')];
  const both = () =>
    new Map([...added].filter(([line]) => removed.has(line)).map(([line, n]) => [line, Math.min(n, removed.get(line) as number)]));
  const moved = { plus: both(), minus: both() };

  const out = new Map<string | null, [number, number]>();
  const slot = (path: string | null) => out.get(path) ?? (out.set(path, [0, 0]).get(path) as [number, number]);
  const rest = hunks.map(({ path, plus, minus }) => {
    const kept = { plus: [] as string[], minus: [] as string[] };
    for (const side of ['plus', 'minus'] as const) {
      for (const line of side === 'plus' ? plus : minus) {
        const left = moved[side].get(line) ?? 0;
        if (left > 0) {
          moved[side].set(line, left - 1);
          slot(path)[side === 'plus' ? 0 : 1]++;
        } else kept[side].push(line);
      }
    }
    return { path, ...kept };
  });

  const tokens = new RegExp(`${re.word}+|[^${re.word.slice(1, -1)}${re.space.slice(1, -1)}]`, 'gu');
  const pairs: { path: string | null; substitutions: string[] }[] = [];
  const substitutions = new Map<string, number>();
  let compared = 0;
  for (const { path, plus, minus } of rest) {
    for (let n = 0; n < Math.min(plus.length, minus.length); n++) {
      const [line, old] = [plus[n] as string, minus[n] as string];
      // Long lines (minified code, JSON, base64) are content, not renames; past 20000 pairs the diff is bulk anyway.
      if (!significant(line) || line === old || length(line) > 200 || length(old) > 200 || compared >= 20000) continue;
      compared++;
      const [a, b] = [old.match(tokens) ?? [], line.match(tokens) ?? []];
      const ops = changedOpcodes(a, b);
      if (ops.length && ops.length <= 3 && ops.every((op) => op.tag === 'replace' && op.i2 - op.i1 === 1 && op.j2 - op.j1 === 1)) {
        const keys = ops.map((op) => `${a[op.i1]}\u0000${b[op.j1]}`);
        pairs.push({ path, substitutions: keys });
        for (const key of new Set(keys)) substitutions.set(key, (substitutions.get(key) ?? 0) + 1);
      }
    }
  }
  for (const { path, substitutions: keys } of pairs) {
    if (keys.every((key) => (substitutions.get(key) ?? 0) >= 3)) {
      const counts = slot(path);
      counts[0]++;
      counts[1]++;
    }
  }
  return out;
}
