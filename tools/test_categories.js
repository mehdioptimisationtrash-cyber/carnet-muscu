// node tools/test_categories.js — logique Devant / Derrière (categories.js)
const assert = require('assert');
const C = require('../categories.js');
const cases = {
  'Développé assis': 'devant', 'Pecs': 'devant', 'Leg press': 'devant', 'Gainage': 'devant', 'Crunch': 'devant',
  'Développé millitaire': 'devant', 'Développé couché': 'devant', 'Haltères extérieurs': 'devant', 'Curl biceps': 'devant', 'Leg extension': 'devant', 'Squat': 'devant',
  'Lat pulldown': 'derriere', 'Horizontal row': 'derriere', 'Leg curl': 'derriere', 'Oiseau': 'derriere', 'Bas du dos renversé': 'derriere',
  'Poulie triceps': 'derriere', 'Poulie extension epaule': 'derriere', 'Extension triceps': 'derriere', 'Hip thrust': 'derriere', 'Élévations latérales': 'devant',
};
for (const [n, c] of Object.entries(cases)) assert.strictEqual(C.guessCat(n), c, n);
assert.strictEqual(C.guessCat('Truc inconnu'), null);

const exos = [{ id: 'a', name: 'Pecs', cat: 'devant' }, { id: 'b', name: 'Crunch', cat: 'devant' }, { id: 'c', name: 'Lat pulldown', cat: 'derriere' }];
const done = [{ done: true }];
const entry = (ids, at) => ({ at, exos: Object.fromEntries(ids.map(i => [i, { name: i, sets: done }])) });
// séance majoritairement devant → prochaine = derrière
assert.strictEqual(C.nextCat({ exos, settings: {}, history: [entry(['a', 'b', 'c'], 1)] }), 'derriere');
assert.strictEqual(C.nextCat({ exos, settings: {}, history: [entry(['c'], 1)] }), 'devant');
// catégorie enregistrée prioritaire
assert.strictEqual(C.nextCat({ exos, settings: {}, history: [{ ...entry(['a'], 1), cat: 'derriere' }] }), 'devant');
// aucun historique → devant
assert.strictEqual(C.nextCat({ exos, settings: {}, history: [] }), 'devant');
// choix forcé valable tant qu'aucune séance n'est ajoutée
const h = [entry(['a', 'b'], 5)];
assert.strictEqual(C.nextCat({ exos, settings: { nextCat: { cat: 'devant', after: 5 } }, history: h }), 'devant');
assert.strictEqual(C.nextCat({ exos, settings: { nextCat: { cat: 'devant', after: 4 } }, history: h }), 'derriere');
// exercice sans cat : deviné par son nom
assert.strictEqual(C.catOf({ name: 'Leg curl' }), 'derriere');
console.log('categories OK');
