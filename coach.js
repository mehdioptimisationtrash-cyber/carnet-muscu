/* Coach : progression auto-régulée par le ressenti (demande de Mehdi, 2026-09-26).
 * Après chaque série validée, Mehdi note la difficulté : 😄 facile / 🙂 moyen / 😣 difficile.
 * On la traduit en « reps en réserve » (RIR, échelle utilisée en préparation physique) :
 *   facile = 3 reps ou plus en réserve · moyen = 1 à 2 · difficile = 0 (à l'échec ou presque).
 * L'hypertrophie se joue quand on finit à 1–3 reps de l'échec : trop facile = stimulus faible → on accélère ;
 * difficile = on consolide avant d'ajouter ; raté à fond de beaucoup = charge trop lourde → on allège tout de suite.
 * Au passage de charge, les reps visées à la nouvelle charge sont estimées depuis la force réelle du jour
 * (1RM d'Epley corrigé du RIR), au lieu de repartir mécaniquement à 8.
 * Module pur (aucun DOM) : window.Coach dans le navigateur, require() sous Node pour les tests.
 */
(function (root) {
  'use strict';
  const FEELS = {
    1: { e: '😄', t: 'Facile', s: '3 reps ou plus en réserve', rir: 3 },
    2: { e: '🙂', t: 'Moyen', s: '1 à 2 reps en réserve', rir: 1.5 },
    3: { e: '😣', t: 'Difficile', s: 'à fond, 0 en réserve', rir: 0 },
  };
  const TARGET_RIR = 2;          // cible d'une série « de travail » : finir à ~2 reps de l'échec
  const BIG_MISS = 3;            // raté de 3 reps ou plus en étant à fond = charge trop lourde
  const EXTENDED_MAX = 20;       // saut de plaque trop gros : on prolonge la plage jusqu'à 20 reps avant de monter
  const TEMPS_STEP = 5;

  const rirOf = (feel) => (FEELS[feel] ? FEELS[feel].rir : TARGET_RIR);   // pas noté = on suppose une série « normale »
  /** 1RM estimé (Epley), corrigé des reps en réserve : 40 kg × 8 facile ≈ 40 kg × 11 à l'échec. */
  const e1rmFelt = (charge, reps, feel) => (typeof charge === 'number' && charge > 0 ? charge * (1 + (reps + rirOf(feel)) / 30) : null);
  /** Reps faisables à `charge` pour un 1RM donné, en gardant `rir` en réserve. */
  const repsAt = (e1rm, charge, rir) => 30 * (e1rm / charge - 1) - rir;

  /**
   * Cible de la prochaine séance pour UNE série.
   * @param e exercice { mode, repMin, repMax }
   * @param target cible de cette séance { charge, reps, fails }
   * @param r résultat { charge, reps, done, feel? }
   * @param ctx { nextCharge(c), prevCharge(c), autoDeload }
   * @returns { charge, reps, fails, up?, deload?, why }
   */
  function next(e, target, r, ctx) {
    const base = { charge: target.charge, reps: target.reps, fails: target.fails || 0 };
    if (!r || r.done !== true) return { ...base, why: 'pas faite : même cible' };
    const feel = r.feel;
    if (e.mode === 'temps') {
      if (r.reps < target.reps) return { ...base, fails: base.fails + 1, why: 'tenue ratée : on retente' };
      const add = feel === 3 ? 0 : feel === 1 ? 2 * TEMPS_STEP : TEMPS_STEP;
      return { charge: 'PDC', reps: Math.min(r.reps + add, e.repMax), fails: 0, why: add ? `+${add} s` : 'dur : on consolide la durée' };
    }
    if (r.reps < target.reps) {                                              // ratée
      const fails = base.fails + 1, down = ctx.prevCharge(r.charge);
      if (down !== null && feel === 3 && target.reps - r.reps >= BIG_MISS) return { charge: down, reps: target.reps, fails: 0, deload: true, why: `raté de ${target.reps - r.reps} reps à fond : charge trop lourde, on allège` };
      if (down !== null && ctx.autoDeload && fails >= 2) return { charge: down, reps: target.reps, fails: 0, deload: true, why: 'raté 2 fois : on allège' };
      return { charge: r.charge, reps: target.reps, fails, why: 'raté : on retente' };
    }
    // réussie : l'effort ressenti décide de la marche suivante
    if (feel === 3) return { charge: r.charge, reps: Math.max(r.reps, target.reps), fails: 0, why: 'réussie à fond : on consolide avant d’ajouter' };
    const add = feel === 1 ? 2 : 1;
    const reps = r.reps + add;
    if (typeof r.charge !== 'number' || r.charge <= 0) return { charge: r.charge, reps: Math.min(reps, e.repMax), fails: 0, why: `+${Math.min(reps, e.repMax) - r.reps} rep${feel === 1 ? ' (facile)' : ''}` };
    if (reps <= e.repMax) return { charge: r.charge, reps, fails: 0, why: feel === 1 ? '+2 reps : tu en avais 3 en réserve' : '+1 rep' };
    const up = ctx.nextCharge(r.charge);
    if (up === null) return { charge: r.charge, reps: Math.min(reps, EXTENDED_MAX), fails: 0, why: 'haut de la pile : on continue en reps' };
    // nouvelle charge : reps estimées depuis la force réelle, pour finir à ~2 reps de l'échec
    const est = Math.floor(repsAt(e1rmFelt(r.charge, r.reps, feel), up, TARGET_RIR));
    if (est < e.repMin - 1 && r.reps < EXTENDED_MAX) {
      const pct = Math.round((up - r.charge) / r.charge * 100);
      return { charge: r.charge, reps: Math.min(reps, EXTENDED_MAX), fails: 0, why: `plaque suivante trop loin (+${pct} %) : on monte les reps jusqu’à ${EXTENDED_MAX} d’abord` };
    }
    const newReps = Math.max(e.repMin - 1, Math.min(est, e.repMax - 2));   // jamais au-dessus de la plage (sinon le palier suivant arrive tout de suite)
    return { charge: up, reps: newReps, fails: 0, up: true, why: `palier : ${up} kg × ${newReps} (estimé depuis ta force du jour)` };
  }

  /** Résumé d'une série de ressentis : { n, easy, mid, hard, trend } — trend = la difficulté monte au fil des séries. */
  function feelStats(sets) {
    const f = (sets || []).filter((r) => r && r.done && FEELS[r.feel]).map((r) => r.feel);
    const n = f.length;
    const count = (k) => f.filter((x) => x === k).length;
    return { n, easy: count(1), mid: count(2), hard: count(3), trend: n >= 3 && f[0] < f[n - 1] && f[n - 1] === 3 && f[0] === 1 };
  }

  /**
   * Conseils de coach pour un exercice, d'après ses 3 dernières séances notées.
   * @param e exercice
   * @param recent tableau de listes de séries (les plus anciennes d'abord), séries = { charge, reps, done, feel }
   * @returns [{ level: 'good'|'warn'|'', title, text }]
   */
  function advise(e, recent) {
    const out = [];
    const rated = recent.map(feelStats).filter((s) => s.n);
    if (!rated.length) return out;
    const last = rated[rated.length - 1];
    const allEasy = (s) => s.easy === s.n;
    if (rated.length >= 2 && allEasy(last) && allEasy(rated[rated.length - 2])) {
      out.push({ level: 'warn', title: `${e.name} : trop facile 2 séances de suite`, text: 'Des séries finies à 3+ reps de l’échec stimulent peu le muscle. Le carnet accélère déjà (+2 reps) ; si tu le sens, monte directement la charge d’un cran.' });
    } else if (last.trend) {
      out.push({ level: '', title: `${e.name} : facile au début, à fond à la fin`, text: 'Ta fatigue s’accumule d’une série à l’autre : allonge le repos (2–3 min sur les mouvements lourds) plutôt que de baisser la charge.' });
    } else if (last.hard >= Math.ceil(last.n * 0.75)) {
      const prevHard = rated.length >= 2 && rated[rated.length - 2].hard >= Math.ceil(rated[rated.length - 2].n * 0.75);
      out.push(prevHard
        ? { level: 'warn', title: `${e.name} : à fond 2 séances de suite`, text: 'Tu n’as plus de marge : en déficit calorique, forcer ici use sans construire. Garde la cible (le carnet consolide) ; si ça ne bouge pas, allège d’un cran et remonte.' }
        : { level: '', title: `${e.name} : séance très dure`, text: 'Le carnet garde la même cible pour consolider. Dors bien et mange tes protéines avant la prochaine : c’est là que la force s’installe.' });
    } else if (last.mid >= Math.ceil(last.n / 2)) {
      out.push({ level: 'good', title: `${e.name} : dans la bonne zone`, text: 'Tu finis à 1–2 reps de l’échec : c’est l’intensité idéale pour garder et construire du muscle en perte de poids.' });
    }
    return out;
  }

  const api = { FEELS, TARGET_RIR, rirOf, e1rmFelt, repsAt, next, feelStats, advise };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Coach = api;
})(typeof window !== 'undefined' ? window : globalThis);
