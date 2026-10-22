// Python's semantics where the V1 relied on them and JavaScript differs: the ported calculations must give the same results.

const whitespace = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';

/** Python's `\s`, `\w` and `\d` in a `str` pattern are Unicode-aware; JavaScript's are not, even with the `u` flag. */
export const re = {
  space: `[${whitespace}]`,
  word: '[\\p{L}\\p{N}_]',
  digit: '\\p{Nd}',
  /** Python's `\b`. */
  boundary: '(?:(?<![\\p{L}\\p{N}_])(?=[\\p{L}\\p{N}_])|(?<=[\\p{L}\\p{N}_])(?![\\p{L}\\p{N}_]))',
  /** Python's `^` under `re.M`: the start, or after a `\n` only. */
  lineStart: '(?<![^\\n])',
};

const edges = new RegExp(`^${re.space}+|${re.space}+$`, 'gu');
const runs = new RegExp(`${re.space}+`, 'u');
// biome-ignore lint/suspicious/noControlCharactersInRegex: the separators Python's splitlines() breaks on.
const breaks = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

export const strip = (text: string) => text.replace(edges, '');

/** `str.strip(chars)`. */
export function stripChars(text: string, chars: string) {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text.charAt(start))) start++;
  while (end > start && chars.includes(text.charAt(end - 1))) end--;
  return text.slice(start, end);
}

/** `str.split()`. */
export const splitWords = (text: string) => strip(text).split(runs).filter(Boolean);

/** `str.splitlines()`. */
export function splitLines(text: string) {
  const lines = text.split(breaks);
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}

/** `len(str)`: code points, not UTF-16 units. */
export function length(text: string) {
  let count = text.length;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) count--;
  }
  return count;
}

/** `round(x)`: halves go to the even neighbour. */
export function round(value: number) {
  const nearest = Math.round(value);
  return Math.abs(value % 1) === 0.5 ? 2 * Math.round(value / 2) : nearest;
}

/** `round(x, 1)`: like `toFixed`, but an exact half (x.25, x.75) goes to the even neighbour. */
export function roundTenths(value: number) {
  const quarters = value * 4;
  if (Number.isInteger(quarters) && quarters % 2 !== 0) return round(value * 10) / 10;
  return Number(value.toFixed(1));
}

/** `Counter.most_common()`: by count, ties in insertion order. */
export const mostCommon = (counter: Map<string, number>) => [...counter].sort((a, b) => b[1] - a[1]);
