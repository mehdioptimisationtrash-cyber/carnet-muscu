// node tools/test_injury.js — blessures : exercices touchés, phases, cibles allégées (injury.js)
const assert = require('assert');
const I = require('../injury.js');
const exos = [
  { id: 'ef', name: 'Élévation frontale poulie', step: 2, stack: [23, 30, 36], sets: [] },
  { id: 'dm', name: 'Développé millitaire', step: 2, sets: [] },
  { id: 'he', name: 'Haltères extérieurs', step: 1, sets: [] },
  { id: 'dc', name: 'Développé couché', step: 2, stack: [30, 35, 40, 45], sets: [] },
  { id: 'lc', name: 'Leg curl', sets: [] },
  { id: 'bb', name: 'Biceps barre altère', sets: [] },
];
assert.deepStrictEqual(I.suggest('epaule', exos), { ef: 'stop', dm: 'stop', he: 'stop', dc: 'reduce' });
assert.deepStrictEqual(I.suggest('coude', exos), { dm: 'reduce', dc: 'reduce', bb: 'stop' });                   // leg curl ≠ curl des bras
// grade 1 : 0–2 protection, 3–9 reprise, 10–20 renforcement, 21–31 retour, puis fini
const inj = { id: 'i', date: '2026-09-29', zone: 'epaule', severity: 'leger', exos: { ef: 'stop', dc: 'reduce' }, pains: [] };
const ph = (d) => I.phaseOf(inj, d).n;
assert.deepStrictEqual([ph('2026-09-29'), ph('2026-10-01'), ph('2026-10-02'), ph('2026-10-09'), ph('2026-10-20'), ph('2026-10-31')], [1, 1, 2, 3, 4, 5]);
// une douleur repousse de 3 jours
assert.strictEqual(I.phaseOf({ ...inj, pains: ['2026-10-03'] }, '2026-10-02').n, 1);
const S = { injuries: [inj] };
assert.ok(I.forExo(S, exos[0], '2026-10-01').pause);
assert.strictEqual(I.forExo(S, exos[3], '2026-10-01').f, 0.6);                         // indirect : allégé dès le début
assert.strictEqual(I.forExo(S, exos[4], '2026-10-01'), null);
const st2 = I.forExo(S, exos[0], '2026-10-04');
assert.deepStrictEqual(I.adaptTargets(exos[0], [{ charge: 30, reps: 10 }, { charge: 30, reps: 10 }, { charge: 30, reps: 10 }], st2), [{ charge: 23, reps: 15 }, { charge: 23, reps: 15 }]);   // 40 % de 30 = 12 → plus petite plaque, 2 séries
assert.deepStrictEqual(I.adaptTargets(exos[3], [{ charge: 40, reps: 9 }], I.forExo(S, exos[3], '2026-10-04')), [{ charge: 30, reps: 9 }]);   // 70 % de 40 = 28 → 30 (bas de pile)
assert.deepStrictEqual(I.adaptTargets(exos[1], [{ charge: 10, reps: 10 }], { f: 0.6, reps: 12, sets: 3 }), [{ charge: 6, reps: 12 }]);
assert.strictEqual(I.forExo({ injuries: [{ ...inj, healed: '2026-10-05' }] }, exos[0], '2026-10-06'), null);
assert.strictEqual(I.forExo(S, exos[0], '2026-11-30'), null);                          // protocole fini
// grade 3 : pause jusqu'au feu vert, puis phase 2 d'un grade 2
const sev = { ...inj, severity: 'severe' };
assert.strictEqual(I.phaseOf(sev, '2026-10-20').name, 'Avis médical');
assert.strictEqual(I.phaseOf({ ...sev, clearedAt: '2026-10-20' }, '2026-10-20').n, 2);
console.log('injury OK');
