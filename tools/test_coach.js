// node tools/test_coach.js — progression auto-régulée par le ressenti (coach.js)
const assert = require('assert');
const C = require('../coach.js');
const stack = [30, 35, 40, 45];
const ctx = (st, auto = true) => ({ nextCharge: (c) => st.find((v) => v > c) ?? null, prevCharge: (c) => [...st].reverse().find((v) => v < c) ?? null, autoDeload: auto });
const e = { name: 'Développé couché', mode: 'reps', repMin: 8, repMax: 15 };
const T = (charge, reps, fails = 0) => ({ charge, reps, fails });
const R = (charge, reps, feel) => ({ charge, reps, done: true, feel });

// réussite : facile +2, moyen +1, pas noté +1, difficile = on consolide
assert.deepStrictEqual([C.next(e, T(40, 9), R(40, 9, 1), ctx(stack)).reps, C.next(e, T(40, 9), R(40, 9, 2), ctx(stack)).reps, C.next(e, T(40, 9), R(40, 9), ctx(stack)).reps, C.next(e, T(40, 9), R(40, 9, 3), ctx(stack)).reps], [11, 10, 10, 9]);
// palier : 40×15 moyen → 45 kg, reps estimées (≈ 9) au lieu de repartir à 8
const up = C.next(e, T(40, 15), R(40, 15, 2), ctx(stack));
assert.strictEqual(up.charge, 45); assert.ok(up.up); assert.strictEqual(up.reps, 9);
// facile à 14 → +2 dépasse 15 → palier
assert.strictEqual(C.next(e, T(40, 14), R(40, 14, 1), ctx(stack)).charge, 45);
// plaque suivante trop loin (23 → 30 = +30 %) : on prolonge jusqu'à 20 reps, puis on saute
const tri = [23, 30, 36];
const ext = C.next(e, T(23, 15), R(23, 15, 2), ctx(tri));
assert.strictEqual(ext.charge, 23); assert.strictEqual(ext.reps, 16); assert.match(ext.why, /20/);
const jump = C.next(e, T(23, 20), R(23, 20, 2), ctx(tri));
assert.strictEqual(jump.charge, 30); assert.ok(jump.reps >= 7 && jump.reps <= 13, String(jump.reps));
// raté de 3+ reps à fond → allègement immédiat ; raté léger → on retente ; 2e échec → allège (auto)
assert.ok(C.next(e, T(40, 10), R(40, 6, 3), ctx(stack)).deload);
const miss = C.next(e, T(40, 10), R(40, 9, 3), ctx(stack));
assert.strictEqual(miss.charge, 40); assert.strictEqual(miss.fails, 1);
assert.ok(C.next(e, T(40, 10, 1), R(40, 9, 2), ctx(stack)).deload);
assert.ok(!C.next(e, T(40, 10, 1), R(40, 9, 2), ctx(stack, false)).deload);
// poids du corps : plafonné à repMax ; temps : facile +10 s, dur +0
assert.strictEqual(C.next({ ...e, repMax: 20 }, T('PDC', 19), R('PDC', 19, 1), ctx(stack)).reps, 20);
assert.deepStrictEqual([C.next({ mode: 'temps', repMax: 60 }, T('PDC', 40), R('PDC', 40, 1), ctx([])).reps, C.next({ mode: 'temps', repMax: 60 }, T('PDC', 40), R('PDC', 40, 3), ctx([])).reps], [50, 40]);
// pas faite → même cible
assert.strictEqual(C.next(e, T(40, 10), { charge: 40, reps: 10, done: false }, ctx(stack)).reps, 10);
// 1RM corrigé du ressenti : 40×8 facile > 40×8 à fond
assert.ok(C.e1rmFelt(40, 8, 1) > C.e1rmFelt(40, 8, 3));
// conseils
const S = (...f) => f.map((x) => R(40, 10, x));
assert.match(C.advise(e, [S(1, 1, 1), S(1, 1, 1, 1)])[0].title, /trop facile/);
assert.match(C.advise(e, [S(1, 2, 3, 3)])[0].title, /fin/);
assert.match(C.advise(e, [S(3, 3, 3), S(3, 3, 3, 2)])[0].title, /2 séances/);
assert.strictEqual(C.advise(e, [S(2, 2, 2)])[0].level, 'good');
assert.deepStrictEqual(C.advise(e, [[R(40, 10)]]), []);
console.log('coach OK');
