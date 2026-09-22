/* Test unitaire de normalizeSteps (apps-script/Code.gs) hors Apps Script : SpreadsheetApp/Utilities remplacés par des bouchons.
 * Usage : node tools/test_codegs.js apps-script/Code.gs
 */
const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
const stubs = `const SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSpreadsheetTimeZone: () => 'Europe/Paris' }) };
const Utilities = { formatDate: () => '2026-09-22' };`;
const fn = new Function(stubs + src + '; return normalizeSteps;')();
const cases = [
  [{ iphone: 961, montre: 1520 }, { '2026-09-22': { n: 1520, src: 'sante', detail: 'montre (montre 1520 · iphone 961)' } }],
  [{ iphone: 961, montre: 0 }, { '2026-09-22': { n: 961, src: 'sante', detail: 'iphone (montre 0 · iphone 961)' } }],
  [{ iphone: '961', montre: '', date: '2026-09-21' }, { '2026-09-21': { n: 961, src: 'sante', detail: 'iphone (montre – · iphone 961)' } }],
  [{ steps: 8432 }, { '2026-09-22': { n: 8432, src: 'sante', detail: '' } }],
  [{ steps: { '2026-09-20': { n: 7777, src: 'manuel' } } }, { '2026-09-20': { n: 7777, src: 'manuel', detail: '' } }],
  [{ steps: [1, 2] }, null],
  [{ iphone: 'abc' }, null],
  [{}, null],
];
let ok = true;
for (const [input, expected] of cases) { const got = fn(input); const pass = JSON.stringify(got) === JSON.stringify(expected); ok = ok && pass; console.log(pass ? 'ok  ' : 'FAIL', JSON.stringify(input), '→', JSON.stringify(got)); }
process.exit(ok ? 0 : 1);
