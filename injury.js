/* Blessures : déclaration (bouton 🚑), protocole de reprise et adaptation des séances (demande de Mehdi, 2026-10-01).
 * Repères (claquage / élongation musculaire) :
 *  - grade 1 (léger) : retour en ~2–3 semaines ; grade 2 (modéré, déchirure partielle) : 4–6 semaines (jusqu'à 8) ;
 *    grade 3 (rupture) : plusieurs mois → avis médical obligatoire ;
 *  - PEACE & LOVE (Dubois & Esculier, BJSM 2020) : Protéger 1 à 3 jours, puis Charger tôt et progressivement, guidé par la douleur ;
 *  - douleur tolérée pendant l'exercice : ≤ 3/10, et elle doit être revenue à la normale le lendemain ;
 *  - réintégration complète : ~1 semaine d'entraînement normal par tranche de 2 semaines d'arrêt.
 * Données : state.injuries = [{ id, date, zone, severity, exos: { exoId: 'stop'|'reduce' }, pains: [dates], note, clearedAt?, healed? }]
 * Les cibles de l'exercice (e.sets) ne sont jamais modifiées : la séance applique une version allégée, et tout revient à la fin.
 */
(function (root) {
  'use strict';
  const ZONES = { epaule: 'Épaule', pec: 'Pectoraux', milieu_dos: 'Milieu du dos (rhomboïdes, trapèze moyen)', dos: 'Bas du dos', ischio: 'Ischios', quadri: 'Quadriceps / genou', coude: 'Coude / bras', poignet: 'Poignet', mollet: 'Mollet', nuque: 'Nuque / trapèzes', autre: 'Autre' };
  const SEVERITY = {
    leger: { t: 'Léger (grade 1)', s: 'Gêne ou douleur supportable, force à peu près normale, pas de bleu', ends: [3, 10, 21] },
    modere: { t: 'Modéré (grade 2)', s: 'Douleur nette, perte de force, gonflement ou bleu', ends: [7, 21, 42] },
    severe: { t: 'Sévère (grade 3)', s: 'Douleur vive, impossible de contracter, creux ou déformation → médecin', ends: null },
  };
  const PAIN_EXTRA_DAYS = 3;   // une douleur pendant la reprise = la phase en cours repart pour 3 jours
  // exercices touchés par zone : « stop » = sollicite directement la zone, « reduce » = indirectement
  const MAP = {
    epaule: { stop: /elevation|frontal|lateral|exterieur|mill?itaire|extension epaule|arnold|upright|rowing menton/, reduce: /developpe|couche|pecs|ecarte|butterfly|dips|pompe|oiseau|tirage|pulldown|traction|row|tricep/ },
    pec: { stop: /pecs|couche|ecarte|butterfly|developpe|dips|pompe|chest|bench/, reduce: /mill?itaire|elevation|frontal|tricep/ },
    // entre les omoplates : tout ce qui rapproche les omoplates (tirages horizontaux, oiseau) ou les fixe sous charge (élévations)
    milieu_dos: { stop: /row|rowing|tirage horizontal|oiseau|face pull|reverse fly|shrug|trapeze|frontal/, reduce: /pulldown|tirage|traction|pull.?up|renverse|lomb|bas du dos|souleve|deadlift|elevation|lateral|exterieur|mill?itaire/ },
    dos: { stop: /renverse|lomb|souleve|deadlift|squat|good morning|bas du dos/, reduce: /row|rowing|tirage|leg press|presse|gainage|fente/ },
    ischio: { stop: /leg curl|ischio|souleve|deadlift|renverse|hip thrust/, reduce: /leg press|presse|squat|fente/ },
    quadri: { stop: /leg extension|squat|fente|leg press|presse|lunge/, reduce: /leg curl|mollet/ },
    coude: { stop: /tricep|bicep|curl|barre au front|kickback/, reduce: /developpe|tirage|row|pulldown|traction|dips|pompe/ },
    poignet: { stop: /curl|bicep|pompe/, reduce: /developpe|row|tirage|haltere|couche/ },
    mollet: { stop: /mollet|calf/, reduce: /leg press|presse|squat|fente/ },
    nuque: { stop: /shrug|trapeze|mill?itaire|upright/, reduce: /tirage|row|elevation|oiseau/ },
    autre: { stop: /$^/, reduce: /$^/ },
  };
  const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const days = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);

  /** Exercices concernés proposés pour une zone (modifiables ensuite). */
  function suggest(zone, exos) {
    const m = MAP[zone] || MAP.autre, out = {};
    for (const e of exos) {
      const n = zone === 'coude' || zone === 'poignet' ? norm(e.name).replace(/leg curl/g, '') : norm(e.name);   // « curl » des bras ≠ leg curl
      if (m.stop.test(n)) out[e.id] = 'stop';
      else if (m.reduce.test(n)) out[e.id] = 'reduce';
    }
    return out;
  }

  const PHASES = ['Protection', 'Reprise douce', 'Renforcement', 'Retour progressif'];
  /** Où en est la blessure aujourd'hui : { n (1–4, 5 = fini), name, day, left (jours avant la phase suivante), total } */
  function phaseOf(inj, today) {
    const extra = new Set(inj.pains || []).size * PAIN_EXTRA_DAYS;
    let ends = SEVERITY[inj.severity]?.ends, d = days(inj.date, today) - extra;
    if (!ends) {
      if (!inj.clearedAt) return { n: 1, name: 'Avis médical', day: days(inj.date, today), left: null, total: null };
      ends = SEVERITY.modere.ends; d = days(inj.clearedAt, today) + ends[0] - extra;   // feu vert du médecin : on reprend en phase 2 d'un grade 2
    }
    const back = ends[2] + Math.ceil(ends[2] / 2);   // ~1 semaine de retour par 2 semaines d'arrêt
    const bounds = [...ends, back];
    const n = bounds.findIndex((b) => d < b) + 1 || 5;
    return { n, name: PHASES[n - 1] || 'Terminé', day: Math.max(0, d), left: n <= 4 ? bounds[n - 1] - d : 0, total: back };
  }
  const active = (state) => (state.injuries || []).filter((i) => !i.healed);

  // règles par phase : facteur de charge, reps visées, séries max, consigne
  const RULES = {
    stop: [null,
      { pause: true, txt: 'en pause : on protège la zone (1 à 3 jours sans la solliciter)' },
      { f: 0.4, reps: 15, sets: 2, txt: '40 % de la charge, 15 reps, 2 séries — 😄 obligatoire, douleur ≤ 3/10' },
      { f: 0.6, reps: 12, sets: 3, txt: '60 % de la charge, 12 reps — douleur ≤ 3/10, rien le lendemain' },
      { f: 0.85, reps: null, sets: null, txt: '85 % de la charge : on réhabitue avant de reprendre les défis' }],
    reduce: [null,
      { f: 0.6, reps: null, sets: null, txt: '60 % de la charge (la zone travaille indirectement), sans douleur' },
      { f: 0.7, reps: null, sets: null, txt: '70 % de la charge, sans douleur' },
      { f: 0.85, reps: null, sets: null, txt: '85 % de la charge' },
      null],
  };
  /** Statut d'un exercice pour aujourd'hui, ou null s'il n'est pas concerné. */
  function forExo(state, e, today) {
    let best = null;
    for (const inj of active(state)) {
      const lvl = inj.exos?.[e.id]; if (!lvl) continue;
      const ph = phaseOf(inj, today);
      if (ph.n >= 5) continue;
      const rule = ph.name === 'Avis médical' ? { pause: true, txt: 'en pause jusqu’à l’avis d’un médecin ou kiné' } : RULES[lvl][ph.n];
      if (!rule) continue;
      const st = { inj, lvl, phase: ph, ...rule, zone: ZONES[inj.zone] || inj.zone };
      if (!best || st.pause || (!best.pause && (st.f || 1) < (best.f || 1))) best = st;   // la règle la plus prudente gagne
    }
    return best;
  }
  /** Cibles allégées pour la séance (charge arrondie vers le bas sur la pile ou au cran). */
  function adaptTargets(e, sets, st) {
    const floorCharge = (c) => {
      if (typeof c !== 'number' || c <= 0) return c;
      const x = c * st.f;
      if (Array.isArray(e.stack) && e.stack.length > 1) return [...e.stack].reverse().find((v) => v <= x + 0.01) ?? e.stack[0];
      const step = e.step || 1;
      return Math.max(0, Math.floor(x / step) * step);
    };
    const list = st.sets ? sets.slice(0, st.sets) : sets;
    return list.map((t) => ({ ...t, charge: floorCharge(t.charge), reps: st.reps && e.mode !== 'temps' ? st.reps : t.reps }));
  }

  const api = { ZONES, SEVERITY, PAIN_EXTRA_DAYS, suggest, phaseOf, forExo, adaptTargets, active };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* ---------- interface (navigateur) ---------- */
  const A = () => root.App;
  const uid = () => Math.random().toString(36).slice(2, 9);
  function save(list) { A().commit({ ...A().state, injuries: list }); }
  function update(id, fn) { save((A().state.injuries || []).map((i) => (i.id === id ? fn(i) : i))); }

  function openDeclare(exoId, editId) {
    const { el, openSheet, closeSheet, selectEl, today, fmtDate, state } = A();
    const cur = editId ? state.injuries.find((i) => i.id === editId) : null;
    const lastSession = state.history.at(-1)?.date;
    const dateOpts = [...new Set([today(), ...(lastSession ? [lastSession] : []), ...(cur ? [cur.date] : [])])];
    const exo0 = state.exos.find((e) => e.id === exoId);
    const guessZone = cur?.zone || (exo0 ? (Object.keys(MAP).find((z) => z !== 'autre' && MAP[z].stop.test(norm(exo0.name))) || 'autre') : 'epaule');
    const selDate = selectEl('ijDate', dateOpts, cur?.date || today(), (d) => d === today() ? 'Aujourd’hui' : d === lastSession ? `À la dernière séance (${fmtDate(d)})` : fmtDate(d));
    const selZone = selectEl('ijZone', Object.keys(ZONES), guessZone, (z) => ZONES[z]);
    const selSev = selectEl('ijSev', Object.keys(SEVERITY), cur?.severity || 'leger', (k) => SEVERITY[k].t);
    const sevHint = el('p', { class: 'hint' });
    const list = el('div', { class: 'ij-exos' });
    let picks = cur ? { ...cur.exos } : {};
    const drawList = () => {
      list.replaceChildren(...state.exos.map((e) => {
        const s = selectEl(`ij-${e.id}`, ['', 'reduce', 'stop'], picks[e.id] || '', (o) => (o === 'stop' ? '⛔ Touché (pause puis reprise)' : o === 'reduce' ? '⚠️ Indirect (allégé)' : 'Non concerné'));
        s.addEventListener('change', () => { picks = { ...picks }; if (s.value) picks[e.id] = s.value; else delete picks[e.id]; });
        return el('div', { class: 'ij-row' }, el('span', { text: e.name }), s);
      }));
    };
    const refresh = (resetPicks) => {
      sevHint.textContent = SEVERITY[selSev.value].s + (selSev.value === 'severe' ? ' — tout est mis en pause tant que tu n’as pas l’avis d’un médecin ou d’un kiné.' : '');
      if (resetPicks) { picks = suggest(selZone.value, state.exos); if (exo0) picks[exo0.id] = 'stop'; }
      drawList();
    };
    selZone.addEventListener('change', () => refresh(true));
    selSev.addEventListener('change', () => refresh(false));
    if (!cur) picks = { ...suggest(guessZone, state.exos), ...(exo0 ? { [exo0.id]: 'stop' } : {}) };
    refresh(false);
    const note = el('input', { type: 'text', id: 'ijNote', class: 'note', placeholder: 'Ce qui s’est passé (exercice, geste, sensation)', value: cur?.note || '' });
    openSheet(
      el('h3', { text: cur ? 'Modifier la blessure' : '🚑 Blessure' }),
      el('div', { class: 'sub', text: 'Le carnet met en pause ou allège les exercices concernés, puis les fait remonter par phases. Tes cibles d’avant sont gardées et reviennent à la fin.' }),
      el('div', { class: 'fields' },
        el('div', { class: 'field' }, el('label', { for: 'ijDate', text: 'Quand' }), selDate),
        el('div', { class: 'field' }, el('label', { for: 'ijZone', text: 'Zone' }), selZone),
        el('div', { class: 'field wide' }, el('label', { for: 'ijSev', text: 'Gravité' }), selSev, sevHint),
        el('div', { class: 'field wide' }, el('label', { text: 'Exercices concernés' }), list),
        el('div', { class: 'field wide' }, note)),
      el('p', { class: 'hint warn-txt', text: 'Consulte sans attendre si : bras impossible à lever, bleu ou gonflement important, déformation, douleur la nuit ou au repos, fourmillements, ou douleur d’épaule avec oppression dans la poitrine (15).' }),
      el('div', { class: 'actions' },
        el('button', { class: 'btn primary big', type: 'button', id: 'ijSave', text: 'Enregistrer', onclick: () => {
          const inj = { ...(cur || { id: uid(), pains: [] }), date: selDate.value, zone: selZone.value, severity: selSev.value, exos: picks, note: note.value.trim() };
          save(cur ? state.injuries.map((i) => (i.id === cur.id ? inj : i)) : [...(state.injuries || []), inj]);
          closeSheet();
        } }),
        ...(cur ? [el('button', { class: 'btn ghost', type: 'button', text: 'Supprimer (déclarée par erreur)', onclick: () => { if (confirm('Supprimer cette blessure ?')) { save(state.injuries.filter((i) => i.id !== cur.id)); closeSheet(); } } })] : [])));
  }

  /** Bandeau en haut de l'onglet Séance pour chaque blessure en cours. */
  function banners() {
    const { el, state, today, plural } = A();
    return active(state).map((inj) => {
      const ph = phaseOf(inj, today());
      const n = Object.keys(inj.exos || {}).length;
      const done = ph.n >= 5;
      const box = el('div', { class: `injury${done ? ' done' : ''}` },
        el('b', { text: done ? `🩹 ${ZONES[inj.zone]} : protocole terminé` : `🩹 ${ZONES[inj.zone]} · ${SEVERITY[inj.severity].t} · J${ph.day}` }),
        el('small', { text: done ? 'Plus de douleur ? Marque-la guérie : les défis reprennent normalement.'
          : ph.name === 'Avis médical' ? 'Tout est en pause tant qu’un médecin ou un kiné ne t’a pas donné le feu vert.'
          : `Phase ${ph.n}/4 · ${ph.name} — encore ${plural(ph.left, 'jour')} · ${plural(n, 'exercice')} adapté${n > 1 ? 's' : ''}. Douleur tolérée ≤ 3/10, et rien le lendemain.` }));
      const row = el('div', { class: 'row3' });
      if (ph.name === 'Avis médical') row.append(el('button', { class: 'btn', type: 'button', text: '✓ Feu vert du médecin', onclick: () => update(inj.id, (i) => ({ ...i, clearedAt: today() })) }));
      else if (!done) row.append(el('button', { class: 'btn', type: 'button', text: '⚠️ Douleur aujourd’hui', onclick: () => { addPain(inj.id); A().toast('Phase prolongée de 3 jours', 'On ne force pas : la douleur doit redescendre avant de recharger.'); } }));
      row.append(el('button', { class: 'btn', type: 'button', text: 'Modifier', onclick: () => openDeclare(null, inj.id) }),
        el('button', { class: 'btn good', type: 'button', text: 'Guérie ✓', onclick: () => { if (done || confirm('Plus aucune douleur, même en chargeant ? Les exercices reprennent leurs cibles normales.')) update(inj.id, (i) => ({ ...i, healed: today() })); } }));
      box.append(row);
      return box;
    });
  }
  function addPain(id) { const t = A().today(); update(id, (i) => ({ ...i, pains: [...new Set([...(i.pains || []), t])] })); }

  function axes(out) {
    const { ax, state, today, plural } = A();
    for (const inj of active(state)) {
      const ph = phaseOf(inj, today());
      if (ph.n >= 5) { out.append(ax('good', `🩹 ${ZONES[inj.zone]} : fin du protocole`, 'Si tu ne sens plus rien en chargeant, marque la blessure guérie (onglet Séance) : les défis repartent de tes cibles d’avant.')); continue; }
      out.append(ax('warn', `🩹 ${ZONES[inj.zone]} — phase ${ph.n}/4 : ${ph.name}`,
        ph.name === 'Avis médical' ? 'Grade 3 suspecté : pas de charge sur la zone avant un avis médical.'
          : `${ph.left !== null ? `Encore ${plural(ph.left, 'jour')} avant la phase suivante. ` : ''}Le muscle cicatrise mieux s’il travaille tôt mais sans douleur (≤ 3/10, rien le lendemain). Évite les anti-inflammatoires les premiers jours, garde le cardio qui ne fait pas mal, et consulte un kiné si la gêne dure au-delà de 2–3 semaines.`));
    }
  }

  root.Injury = { ...api, openDeclare, banners, axes, addPain, update };
})(typeof window !== 'undefined' ? window : globalThis);
