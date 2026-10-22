import { re, splitLines } from './py';

/**
 * Net models and fields a change adds outside tests, and the tests it adds, from its `-U0` diffs of the Python files outside
 * tests and of the tests: a definition moved elsewhere in the same diff cancels out.
 */
export function schemaCounts(pythonDiff: string, testsDiff: string) {
  const model = new RegExp(`^${re.space}*_name${re.space}*=${re.space}*['"]((?:${re.word}|\\.)+)['"]`, 'u');
  const field = new RegExp(`^${re.space}*(${re.word}+)${re.space}*=${re.space}*fields\\.${re.word}+\\(`, 'u');
  const test = new RegExp(`^\\+${re.space}*(async${re.space}+)?(def test_${re.word}+\\(|test\\(["'])`, 'u');
  const added = new Map<string, number>();
  const removed = new Map<string, number>();
  for (const line of splitLines(pythonDiff)) {
    if ((line[0] !== '+' && line[0] !== '-') || line.startsWith('+++') || line.startsWith('---')) continue;
    const side = line[0] === '+' ? added : removed;
    const definition = model.exec(line.slice(1));
    const assignment = definition ? null : field.exec(line.slice(1));
    const key = definition ? `model:${definition[1]}` : assignment ? `field:${assignment[1]}` : null;
    if (key) side.set(key, (side.get(key) ?? 0) + 1);
  }
  const net = (kind: string) =>
    [...added]
      .filter(([key]) => key.startsWith(`${kind}:`))
      .reduce((total, [key, n]) => total + Math.max(0, n - (removed.get(key) ?? 0)), 0);
  return {
    newModels: net('model'),
    newFields: net('field'),
    newTests: splitLines(testsDiff).filter((line) => test.test(line)).length,
  };
}
