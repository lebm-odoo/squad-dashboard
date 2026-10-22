import { expect, test } from 'bun:test';
import { coauthorsOf, isMergedCommit, isPortTitle, mergebotCommand, parseTrailers, portSubject, trigramOf } from './messages';

const merged = `[FIX] hr: keep the manager

task-1234567, opw-7654321

closes odoo/odoo#200001
Related: odoo/enterprise#90001

Co-authored-by: Someone (abcd) <abcd@odoo.com>
Signed-off-by: Reviewer Name (efgh) <efgh@odoo.com>`;

test('reads the trailers mergebot writes', () => {
  expect(parseTrailers(merged)).toEqual({
    tasks: ['1234567'],
    opws: ['7654321'],
    closes: [['odoo/odoo', '200001']],
    reviewers: ['Reviewer Name (efgh)'],
  });
  expect([...coauthorsOf(merged)]).toEqual(['abcd']);
  expect(isMergedCommit(merged)).toBe(true);
  expect(isMergedCommit('[FIX] hr: work in progress')).toBe(false);
});

test('sees a port of the same change', () => {
  expect(portSubject('[FW][FIX] hr: Keep the manager')).toBe('[fix] hr: keep the manager');
  expect(isPortTitle('[FW] [FIX] hr: x')).toBe(true);
  expect(isPortTitle('[FIX] hr: x')).toBe(false);
});

test('recognises an r+ or an r- among other commands, and only the one asked', () => {
  expect(mergebotCommand('LGTM\n@robodoo r+ rebase-ff', 'r+')).toBe(true);
  expect(mergebotCommand('robodoo: delegate+ r+!', 'r+')).toBe(true);
  expect(mergebotCommand('robodoo r-', 'r+')).toBe(false);
  expect(mergebotCommand('@robodoo r-', 'r-')).toBe(true);
  expect(mergebotCommand('robodoobot r+', 'r+')).toBe(false);
  expect(mergebotCommand(null, 'r+')).toBe(false);
});

test('reads the trigram of a name', () => {
  expect(trigramOf('Some One (abcd)')).toBe('abcd');
  expect(trigramOf(' fw-bot ')).toBe('fw-bot');
});
