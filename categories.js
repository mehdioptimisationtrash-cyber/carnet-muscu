/* Séances alternées « Devant » / « Derrière » (demande de Mehdi, 2026-09-23).
 * Devant = chaîne antérieure (pecs, biceps, quadriceps, abdos, épaules avant) ;
 * Derrière = chaîne postérieure (dos, ischios, fessiers, triceps, lombaires, arrière d'épaule).
 * Chaque exercice porte `cat` ; la prochaine séance = l'inverse de la dernière séance enregistrée.
 * Module pur (aucun DOM) : utilisable dans le navigateur (window.Cats) et sous Node (tests).
 */
(function (root) {
  'use strict';
  const CATS = { devant: 'Devant', derriere: 'Derrière' };
  const other = (c) => (c === 'devant' ? 'derriere' : 'devant');
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // mots-clés testés dans l'ordre : le premier qui correspond gagne (« derrière » d'abord : « extension triceps » ≠ « leg extension »)
  const RULES = [
    ['derriere', /tricep|dips|barre au front|kickback|\bdos\b|lomb|renverse|dorsa|lat\b|lats|pulldown|tirage|rowing|\brow\b|traction|pull.?up|souleve|deadlift|ischio|leg curl|curl jambe|hamstring|fess|glute|hip thrust|pont|oiseau|face pull|reverse fly|arriere|trapez|shrug|extension epaule/],
    ['devant', /pec|couche|bench|chest|developpe|militaire|press|pompe|push|ecarte|butterfly|bicep|curl|quadri|squat|leg press|presse|leg extension|fente|lunge|abdo|crunch|gainage|planche|plank|releve de jambe|elevation|lateral|exterieur|mollet|calf/],
  ];

  /** @param {string} name @returns {'devant'|'derriere'|null} */
  function guessCat(name) {
    const n = norm(name);
    for (const [cat, re] of RULES) if (re.test(n)) return cat;
    return null;
  }
  const catOf = (e) => (e && CATS[e.cat] ? e.cat : guessCat(e && e.name) || 'devant');

  /** Catégorie d'une séance enregistrée : `entry.cat`, sinon la majorité de ses exercices (égalité → null). */
  function entryCat(entry, exos) {
    if (!entry) return null;
    if (CATS[entry.cat]) return entry.cat;
    const byId = new Map((exos || []).map((e) => [e.id, e]));
    let dv = 0, dr = 0;
    for (const [id, x] of Object.entries(entry.exos || {})) {
      if (!(x.sets || []).some((r) => r.done)) continue;
      const c = catOf(byId.get(id) || { name: x.name });
      if (c === 'devant') dv++; else dr++;
    }
    return dv === dr ? null : dv > dr ? 'devant' : 'derriere';
  }

  /** Prochaine séance à faire. `settings.nextCat = {cat, after}` force le choix tant qu'aucune séance n'a été ajoutée depuis. */
  function nextCat(state) {
    const last = (state.history || []).at(-1);
    const o = state.settings && state.settings.nextCat;
    if (o && CATS[o.cat] && (o.after || 0) === ((last && last.at) || 0)) return o.cat;
    const c = entryCat(last, state.exos);
    return c ? other(c) : 'devant';
  }

  const api = { CATS, other, guessCat, catOf, entryCat, nextCat };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Cats = api;
})(typeof window !== 'undefined' ? window : globalThis);
