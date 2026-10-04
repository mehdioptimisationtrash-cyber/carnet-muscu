// node tools/test_plan.js — progression par exercice (Coach.plan), sur les vraies séances de Mehdi
const assert = require('assert');
const C = require('../coach.js');
const ctx = (opts) => ({ options: opts, autoDeload: true });
const T = (...a) => a.map(([charge, reps, fails]) => ({ charge, reps, fails: fails || 0 }));
const R = (...a) => a.map(([charge, reps, feel, done = true]) => ({ charge, reps, feel, done }));
const ex = (sets, o = {}) => ({ mode: 'reps', repMin: 8, repMax: 15, sets, ...o });
const show = (p) => p.sets.map((s) => `${s.charge}x${s.reps}`).join(' ');

// Poulie triceps 02/10 : cible 18×14/14/13/13, fait 18×10🙂 18×10😣 18×7🥵 14×10😣 → échec net, recalé (pas 18×14 !)
const tri = C.plan(ex(T([18, 14], [18, 14], [18, 13], [18, 13])), T([18, 14], [18, 14], [18, 13], [18, 13]), R([18, 10, 2], [18, 10, 3], [18, 7, 4], [14, 10, 3]), ctx([14, 18, 23, 30]));
console.log('triceps   ', show(tri), '|', tri.why);
assert.ok(tri.deload); assert.ok(tri.sets.every((s) => s.charge === 14 && s.reps >= 8 && s.reps <= 13));
// séries identiques
assert.ok(tri.sets.every((s) => s.charge === tri.sets[0].charge && s.reps === tri.sets[0].reps));

// Développé assis 03/10 : 43×14🙂 13🙂 13😣 13😣, cible 43×14/13/13/13 → moyenne 2,5 → on consolide 43×13 partout
const da = C.plan(ex(T([43, 14], [43, 13], [43, 13], [43, 13])), T([43, 14], [43, 13], [43, 13], [43, 13]), R([43, 14, 2], [43, 13, 2], [43, 13, 3], [43, 13, 3]), ctx([43, 52, 61]));
console.log('dév assis ', show(da), '|', da.why);
assert.strictEqual(show(da), '43x13 43x13 43x13 43x13');

// Développé couché 03/10 : cible 40×9, fait 8🙂 9😣 9🙂 9🙂 → presque : on retente 40×9 (fails 1)
const dc = C.plan(ex(T([40, 9], [40, 9], [40, 9], [40, 9])), T([40, 9], [40, 9], [40, 9], [40, 9]), R([40, 8, 2], [40, 9, 3], [40, 9, 2], [40, 9, 2]), ctx([30, 35, 40, 45]));
console.log('couché    ', show(dc), '|', dc.why);
assert.strictEqual(show(dc), '40x9 40x9 40x9 40x9'); assert.strictEqual(dc.sets[0].fails, 1);
// ... et la 2e fois : recalé sur la force réelle
const dc2 = C.plan(ex(T([40, 9, 1], [40, 9, 1], [40, 9, 1], [40, 9, 1])), T([40, 9, 1], [40, 9, 1], [40, 9, 1], [40, 9, 1]), R([40, 8, 3], [40, 9, 3], [40, 8, 3], [40, 9, 3]), ctx([30, 35, 40, 45]));
console.log('couché ×2 ', show(dc2), '|', dc2.why);
assert.ok(dc2.deload && dc2.sets[0].charge === 35 && dc2.sets[0].reps >= 10 && dc2.sets[0].reps <= 12);

// Biceps haltères 03/10 : 6×15😄😄😄🙂 → facile en haut de plage, 8 kg trop loin (+33 %) → reps jusqu'à 20
const bi = C.plan(ex(T([6, 15], [6, 15], [6, 15], [6, 15])), T([6, 15], [6, 15], [6, 15], [6, 15]), R([6, 15, 1], [6, 15, 1], [6, 15, 1], [6, 15, 2]), ctx([2, 4, 6, 8, 10]));
console.log('biceps    ', show(bi), '|', bi.why);
assert.strictEqual(show(bi), '6x17 6x17 6x17 6x17');

// Fessiers 02/10 : 50×15🙂 ×4 → palier : 55 kg, reps estimées
const fe = C.plan(ex(T([50, 15], [50, 15], [50, 15], [50, 15])), T([50, 15], [50, 15], [50, 15], [50, 15]), R([50, 15, 2], [50, 15, 2], [50, 15, 2], [50, 15, 2]), ctx([50, 55, 60, 65]));
console.log('fessiers  ', show(fe), '|', fe.why);
assert.ok(fe.up && fe.sets[0].charge === 55 && fe.sets[0].reps >= 8);

// Traction (poids du corps) : cible 10, fait 4😣 4😣 puis 3e série non faite → recalé à 4
const tr = C.plan(ex(T(['PDC', 10], ['PDC', 10], ['PDC', 10])), T(['PDC', 10], ['PDC', 10], ['PDC', 10]), R(['PDC', 4, 3], ['PDC', 4, 3], ['PDC', 10, undefined, false]), ctx([]));
console.log('traction  ', show(tr), '|', tr.why);
assert.strictEqual(show(tr), 'PDCx4 PDCx4 PDCx4');

// Gainage (temps) : 40 s 🙂 ×4 → +5 s
const ga = C.plan(ex(T(['PDC', 40], ['PDC', 40]), { mode: 'temps', repMin: 20, repMax: 60 }), T(['PDC', 40], ['PDC', 40]), R(['PDC', 40, 2], ['PDC', 40, 2]), ctx([]));
assert.strictEqual(show(ga), 'PDCx45 PDCx45');

// facile partout en milieu de plage → +2 ; série non finie + dur → échec net
assert.strictEqual(show(C.plan(ex(T([30, 10], [30, 10])), T([30, 10], [30, 10]), R([30, 10, 1], [30, 10, 1]), ctx([30, 36]))), '30x12 30x12');
assert.ok(C.plan(ex(T([30, 10], [30, 10], [30, 10])), T([30, 10], [30, 10], [30, 10]), R([30, 10, 3], [30, 10, 4], [30, 10, undefined, false]), ctx([23, 30, 36])).deload);
// pas faite du tout → même cible
assert.strictEqual(C.plan(ex(T([30, 10])), T([30, 10]), R([30, 10, undefined, false]), ctx([30])).why, 'pas faite : même cible');
console.log('plan OK');
// pyramide (dernière série plus lourde) : les reps se calent sur la charge de travail principale
const lp = C.plan(ex(T([36, 14], [36, 14], [36, 14], [43, 8])), T([36, 14], [36, 14], [36, 14], [43, 8]), R([36, 14, 2], [36, 14, 3], [36, 14, 3], [43, 8, 3]), ctx([30, 36, 43, 50]));
console.log('pulldown  ', show(lp), '|', lp.why);
assert.strictEqual(show(lp), '36x14 36x14 36x14 36x14');
console.log('pyramide OK');
