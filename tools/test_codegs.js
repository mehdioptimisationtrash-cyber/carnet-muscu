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
// macros recopiées d'Assiette (onglet « jours » : date, kcal, protéines, glucides, lipides, fibres)
const macrosFromRows = new Function(stubs + src + '; return macrosFromRows;')();
const rows = [['2026-09-24', 2104.6, 151, 210.2, 70, 25], [new Date('2026-09-25T00:00:00'), 0, 0, 0, 0, 0], ['date abîmée', 100, 1, 1, 1, 1], ['2026-09-23', '1800', '', 'x', 60, null]];
const toKey = (v) => (v && typeof v.getTime === 'function' ? '2026-09-25' : String(v));
const expectedM = { '2026-09-24': { kcal: 2105, p: 151, c: 210, f: 70, fib: 25 }, '2026-09-23': { kcal: 1800, p: 0, c: 0, f: 60, fib: 0 } };
const gotM = macrosFromRows(rows, toKey);
const passM = JSON.stringify(gotM) === JSON.stringify(expectedM); ok = ok && passM;
console.log(passM ? 'ok  ' : 'FAIL', 'macrosFromRows →', JSON.stringify(gotM));
process.exit(ok ? 0 : 1);
