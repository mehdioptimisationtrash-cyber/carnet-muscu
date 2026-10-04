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

// ---------- repos ----------
const poly = { name: 'Développé couché', mode: 'reps' }, iso = { name: 'Poulie triceps', mode: 'reps' };
assert.strictEqual(C.restKind(poly), 'poly'); assert.strictEqual(C.restKind(iso), 'iso'); assert.strictEqual(C.restKind({ name: 'Gainage', mode: 'temps' }), 'iso');
assert.deepStrictEqual([C.restFor(poly, 1), C.restFor(poly, 2), C.restFor(poly, 3), C.restFor(poly)], [110, 120, 140, 120]);
assert.deepStrictEqual([C.restFor(iso, 1), C.restFor(iso, 3)], [65, 95]);
assert.strictEqual(C.restFor({ ...iso, restBase: 60 }, 1), 60);                   // jamais sous 1 min
assert.strictEqual(C.restFor({ ...poly, restBase: 170 }, 3), 180);           // plafond 3 min
assert.strictEqual(C.restFor({ ...poly, restBase: 60 }, 2), 75);             // polyarticulaire : 1:15 minimum
// une série de 8 reps dure ~39 s : validations espacées de 39 + repos réel
const at = (secs) => secs.reduce((a, s) => [...a, a[a.length - 1] + s * 1000], [0]).map((x) => x + 1e12);
const mk = (restReal, feels, prop = 120, reps = 8) => at(restReal.map((r) => r + reps * 3 + 15)).map((t, i) => ({ done: true, reps, at: t, rest: prop, feel: feels[i] }));
// repos respecté mais série suivante à fond → on allonge
const long = C.analyzeRest(poly, mk([120, 120], [2, 3, 3]));
assert.strictEqual(long.real, 120); assert.strictEqual(long.delta, 20);
// repos très dépassé, séries suivantes faciles → conseil de repartir au bip, pas d'allongement
const over = C.analyzeRest(poly, mk([200, 210], [2, 1, 2]));
assert.ok(over.ratio > 1.6); assert.ok(over.delta <= 0);
assert.match(C.restAdvice(poly, over).text, /Repars au bip/);
// repos écourté et ça passe → on raccourcit
const fast = C.analyzeRest(poly, mk([80, 85], [2, 2, 1]));
assert.ok(fast.delta < 0); assert.strictEqual(C.restAdvice(poly, fast).level, 'good');
// pauses anormales ignorées
assert.strictEqual(C.analyzeRest(poly, mk([900], [2, 2])), null);
assert.strictEqual(C.nextRestAdj({ restAdj: 55 }, 20), 60);
console.log('repos OK');

// ---------- très difficile, repos mesuré par ▶, fatigue, moyennes ----------
assert.strictEqual(C.next(e, T(40, 10), R(40, 11, 4), ctx(stack)).reps, 10);           // échec : on garde la cible
assert.ok(C.next(e, T(40, 10), R(40, 7, 4), ctx(stack)).deload);
assert.strictEqual(C.restFor(poly, 4), 160);
assert.strictEqual(C.restFor(poly, 2, [3, 3, 4, 2]), 130);                              // séance dure : +10 s
assert.strictEqual(C.restFor(poly, 2, [1, 2, 3]), 120);
const a1 = { done: true, reps: 8, at: 1e12, rest: 120, feel: 2 }, b1 = { done: true, reps: 8, start: 1e12 + 95e3, at: 1e12 + 130e3, feel: 2 };
assert.strictEqual(C.realRest(poly, a1, b1), 95);                                        // chronométré : start − validation précédente
const st = C.restStats([{ date: '2026-09-30', exos: { x: { name: 'Développé couché', sets: [a1, b1] } } }], [{ id: 'x', name: 'Développé couché', mode: 'reps' }]);
assert.deepStrictEqual([st.all.n, st.all.real, st.poly.n, st.feel[2].n, st.measured], [1, 95, 1, 1, 100]);
console.log('repos v2 OK');
// repos écourté (70 s pour 140 proposées) puis série dure : pas d'allongement du repos proposé
assert.strictEqual(C.analyzeRest(poly, mk([70, 75], [2, 3, 3], 140)).delta, 0);
console.log('repos v3 OK');

// repos habituel appris : médiane des repos chronométrés (+20 s quand la série suivante a coincé)
const timed = (rests, feels) => { let t = 1e12; return feels.map((f, i) => { const r = { done: true, reps: 10, feel: f, rest: 120 }; if (i) { t += rests[i - 1] * 1000; r.start = t; t += 40000; } else t += 40000; r.at = t; return r; }); };
const hist = [{ date: '2026-10-01', exos: { x: { sets: timed([65, 70, 60], [2, 2, 2, 2]) } } }, { date: '2026-10-03', exos: { x: { sets: timed([62, 64], [2, 3, 2]) } } }];
assert.strictEqual(C.personalRest({ id: 'x', name: 'Développé couché', mode: 'reps' }, hist), 75);   // 60 64 65 70 82(62+20) → médiane 65 → plancher polyarticulaire 1:15
assert.strictEqual(C.personalRest({ id: 'x', name: 'Curl', mode: 'reps' }, hist.slice(0, 1)), 65);
assert.strictEqual(C.personalRest({ id: 'y', name: 'Curl', mode: 'reps' }, hist), null);
console.log('repos personnel OK');
