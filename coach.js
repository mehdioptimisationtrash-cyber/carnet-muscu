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

  /* ---------- temps de repos ----------
   * Repères scientifiques :
   *  - Schoenfeld et al. 2016 (J Strength Cond Res) : 3 min > 1 min pour l'hypertrophie et la force chez des pratiquants entraînés ;
   *  - Grgic et al. 2018 (Sports Med, revue systématique) : ≥ 60 s suffit pour l'hypertrophie, plus long utile sur les polyarticulaires lourds ;
   *  - Singer et al. 2024 (Front Sports Act Living, méta-analyse bayésienne) : léger avantage au-delà de 60 s, gain quasi nul au-delà de ~90 s.
   * D'où : polyarticulaires 2 min (90 s → 3 min), isolation 75 s (60 s → 2 min) ; jamais sous 60 s.
   * Auto-régulation : la série qu'on vient de finir règle le repos (facile −30 s, à fond +30 s), et chaque séance ajuste
   * un décalage par exercice (`e.restAdj`) selon le repos réellement pris et la réussite de la série suivante.
   */
  const REST = {
    poly: { base: 120, min: 90, max: 180, label: 'polyarticulaire' },
    iso: { base: 75, min: 60, max: 120, label: 'isolation' },
  };
  const REST_FEEL = { 1: -30, 2: 0, 3: 30 };
  const REST_ADJ = { step: 10, perSession: 20, min: -45, max: 60 };
  const POLY_RE = /couche|developpe|militaire|press|squat|souleve|deadlift|row|rowing|tirage|pulldown|traction|pull.?up|dips|fente|lunge|hip thrust|pompe|leg press|presse|chest|bench/;
  const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const restKind = (e) => (e.mode === 'temps' ? 'iso' : e.restKind || (POLY_RE.test(norm(e.name)) ? 'poly' : 'iso'));
  const clampRest = (e, sec) => { const k = REST[restKind(e)]; return Math.round(Math.min(k.max, Math.max(k.min, sec)) / 5) * 5; };
  /** Repos proposé après une série de `e`, selon le ressenti de cette série (non noté = moyen). */
  const restFor = (e, feel) => clampRest(e, REST[restKind(e)].base + (e.restAdj || 0) + (REST_FEEL[feel] || 0));
  /** Durée estimée d'une série (exécution + mise en place), pour isoler le vrai repos entre deux validations. */
  const setSeconds = (e, r) => (e.mode === 'temps' ? r.reps : r.reps * 3) + 15;
  const MIN_REAL_REST = 20, MAX_REAL_REST = 600;   // en dehors : série validée en retard ou pause → ignorée

  /**
   * Analyse des repos d'un exercice sur une séance.
   * @param sets résultats dans l'ordre { done, reps, at (ms à la validation), rest (s proposées après), feel }, cibles `targets`
   * @returns { pairs, prop, real, ratio, delta } — delta = correction proposée pour e.restAdj (s)
   */
  function analyzeRest(e, sets, targets) {
    const pairs = [];
    for (let i = 0; i + 1 < (sets || []).length; i++) {
      const a = sets[i], b = sets[i + 1];
      if (!a?.done || !b?.done || !a.at || !b.at || !a.rest) continue;
      const real = Math.round((b.at - a.at) / 1000 - setSeconds(e, b));
      if (real < MIN_REAL_REST || real > MAX_REAL_REST) continue;
      const hit = !targets?.[i + 1] || b.reps >= targets[i + 1].reps;
      pairs.push({ prop: a.rest, real, feel: b.feel, ok: hit && b.feel !== 3 });
    }
    if (!pairs.length) return null;
    const avg = (k) => Math.round(pairs.reduce((x, p) => x + p[k], 0) / pairs.length);
    let delta = 0;
    for (const p of pairs) {
      if (!p.ok && p.real <= p.prop * 1.1) delta += REST_ADJ.step;                 // repos proposé respecté, et série suivante à fond/ratée : trop court
      else if (p.ok && p.feel === 1 && p.real <= p.prop * 1.1) delta -= REST_ADJ.step; // série suivante facile avec le repos proposé (ou moins) : on peut raccourcir
      else if (p.ok && p.real < p.prop * 0.85) delta -= REST_ADJ.step / 2;          // tu repars avant la fin et ça passe : tu récupères vite
    }
    delta = Math.max(-REST_ADJ.perSession, Math.min(REST_ADJ.perSession, delta));
    return { pairs, prop: avg('prop'), real: avg('real'), ratio: Math.round(avg('real') / avg('prop') * 100) / 100, delta };
  }
  const nextRestAdj = (e, delta) => Math.max(REST_ADJ.min, Math.min(REST_ADJ.max, (e.restAdj || 0) + delta));

  const fmtSec = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  /** Conseil de repos à partir de l'analyse d'une séance (ou null). */
  function restAdvice(e, an) {
    if (!an || an.pairs.length < 2) return null;
    const k = REST[restKind(e)];
    const failsAfter = an.pairs.filter((p) => !p.ok).length;
    const head = `${e.name} : repos réel ${fmtSec(an.real)} pour ${fmtSec(an.prop)} proposé`;
    if (an.ratio >= 1.3 && !failsAfter) return { level: 'warn', title: head, text: `Tu dépasses de ${Math.round((an.ratio - 1) * 100)} % et tes séries suivantes passent : au-delà de ~${fmtSec(k.base)} sur un exercice d’${k.label}, le gain musculaire est quasi nul (méta-analyse Singer 2024). Repars au bip : même stimulus, séance plus courte.` };
    if (an.ratio >= 1.3) return { level: '', title: head, text: 'Tu prends plus que proposé et les séries suivantes restent dures : le carnet allonge le repos proposé sur cet exercice. Garde ce temps-là, il te sert.' };
    if (an.ratio <= 0.8 && failsAfter) return { level: 'warn', title: head, text: `Tu repars trop tôt : les séries qui suivent un repos écourté coincent. Respecte au moins ${fmtSec(Math.max(k.min, an.prop))} — un repos trop court fait perdre des reps, donc du volume utile.` };
    if (an.ratio <= 0.8) return { level: 'good', title: head, text: 'Tu récupères vite sur cet exercice : le carnet raccourcit le repos proposé.' };
    return { level: 'good', title: head, text: 'Repos bien calé : tu suis la proposition et les séries suivantes passent.' };
  }

  const api = { FEELS, TARGET_RIR, rirOf, e1rmFelt, repsAt, next, feelStats, advise, REST, restKind, restFor, analyzeRest, nextRestAdj, restAdvice, fmtSec };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Coach = api;
})(typeof window !== 'undefined' ? window : globalThis);
