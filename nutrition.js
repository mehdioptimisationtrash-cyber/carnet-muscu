/* Journal : calendrier de la semaine, repas (saisie rapide ou précise), poids corporel, conseils nutrition.
 * Dépend de window.App (passerelle exposée par app.js) et de window.Sync. Rien n'est lu avant le premier rendu.
 */
window.Nutrition = (() => {
  'use strict';
  const A = () => window.App;
  const WEIGHTS_MAX = 400;
  const OFF_URL = 'https://world.openfoodfacts.org/cgi/search.pl';
  const XP_DAY_LOGGED = 15, XP_DAY_PROTEIN = 15;

  const SLOTS = { pdj: 'Petit-déjeuner', dej: 'Déjeuner', din: 'Dîner', col: 'Collations', boi: 'Boissons & alcool' };
  const MEAL_SLOTS = ['pdj', 'dej', 'din'];
  const SIZES = { leger: ['Léger', 0.6], normal: ['Normal', 1], copieux: ['Copieux', 1.4], tres: ['Très copieux', 1.9] };
  const PROTS = { none: ['Aucune', 0], peu: ['Un peu (œuf, fromage, légumineuses)', 12], bonne: ['Bonne portion (viande, poisson ≈ 120 g)', 30], grosse: ['Grosse portion (≈ 200 g)', 45] };
  // [libellé, kcal, protéines g]
  const SNACKS = [['Fruit', 80, 1], ['Yaourt / laitage', 100, 5], ['Skyr / fromage blanc', 120, 18], ['Œufs (2)', 150, 13], ['Poignée d’oléagineux', 180, 6],
    ['Barre protéinée', 200, 20], ['Shaker whey', 120, 24], ['Biscuits / barre sucrée', 200, 3], ['Viennoiserie', 300, 5], ['Chips / apéro salé', 250, 3],
    ['Glace / dessert', 250, 4], ['Fromage + pain', 250, 10]];
  // [libellé, kcal, protéines g, verres standard d'alcool]
  const DRINKS = [['Bière 25 cl', 110, 0, 1], ['Pinte 50 cl', 220, 0, 2], ['Verre de vin', 100, 0, 1], ['Spiritueux 4 cl', 95, 0, 1], ['Cocktail', 220, 0, 1.5],
    ['Soda 33 cl', 140, 0, 0], ['Jus de fruits 25 cl', 110, 0, 0], ['Café au lait / latte sucré', 120, 4, 0]];
  const ACTIVITY = { 1.2: 'Sédentaire (bureau, peu de marche)', 1.4: 'Légèrement actif (debout, 2–3 séances/sem)', 1.55: 'Actif (4–5 séances/sem)', 1.7: 'Très actif (métier physique)' };
  const DEFAULTS = { kcal: 2200, prot: 150, base: { pdj: 450, dej: 750, din: 750 }, profile: null, favs: [] };

  let sel = null;                       // jour affiché (AAAA-MM-JJ)
  const st = () => A().state;
  const cfg = () => ({ ...DEFAULTS, ...(st().settings.nutri || {}) });
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const addDays = (date, n) => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
  const dayOf = (date) => st().nutrition?.[date] || { date, meals: [], note: '' };
  // Assiette (autre app, recopiée par le script toutes les 3 h) fait foi pour les calories et protéines du jour ; l'alcool reste celui du carnet
  const assietteOf = (date) => { const a = st().macros?.[date]; return a && a.kcal > 0 ? a : null; };
  const totals = (day) => {
    const own = day.meals.reduce((a, m) => ({ kcal: a.kcal + m.kcal, p: a.p + m.p, alc: a.alc + (m.alc || 0) }), { kcal: 0, p: 0, alc: 0 });
    const a = assietteOf(day.date);
    return a ? { ...own, kcal: a.kcal, p: a.p, c: a.c, f: a.f, src: 'assiette' } : own;
  };
  const hasFood = (day) => day.meals.length > 0 || !!assietteOf(day.date);
  const round5 = (x) => Math.round(x / 5) * 5;
  const uid = () => Math.random().toString(36).slice(2, 9);
  const latestWeight = () => [...(st().weights || [])].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.kg;

  function dayStatus(day) {
    if (!hasFood(day)) return 'empty';
    const t = totals(day), c = cfg();
    if (t.kcal > c.kcal * 1.15) return 'over';
    return t.kcal <= c.kcal * 1.05 && t.p >= c.prot * 0.9 ? 'good' : 'mid';
  }

  /* ---------- objectifs depuis le profil (Mifflin-St Jeor, déficit 20 %) ---------- */
  function computeTargets(p, weight) {
    const bmr = 10 * weight + 6.25 * p.height - 5 * p.age + (p.sex === 'f' ? -161 : 5);
    const tdee = bmr * p.activity;
    const kcal = Math.round((tdee * 0.8) / 50) * 50;
    const ref = 25 * (p.height / 100) ** 2;                         // poids à IMC 25 : base plus juste que le poids actuel quand on a du gras à perdre
    const prot = round5(Math.min(Math.max(2 * ref, 1.2 * weight), 2.2 * ref));
    const base = { pdj: Math.round(kcal * 0.19 / 50) * 50, dej: Math.round(kcal * 0.34 / 50) * 50, din: Math.round(kcal * 0.34 / 50) * 50 };
    return { kcal, prot, base, bmr: Math.round(bmr), tdee: Math.round(tdee) };
  }

  /* ---------- écriture ---------- */
  function saveDay(day) {
    const c = cfg(), t = totals(day), flags = { ...(day.xp || {}) };
    let xp = 0;
    if (!flags.logged && new Set(day.meals.filter(m => MEAL_SLOTS.includes(m.slot)).map(m => m.slot)).size >= 3) { flags.logged = true; xp += XP_DAY_LOGGED; }
    if (!flags.prot && t.p >= c.prot * 0.9) { flags.prot = true; xp += XP_DAY_PROTEIN; }
    const next = { ...day, xp: flags };
    window.Sync.markDay(next.date);
    A().commit({ ...st(), xp: st().xp + xp, nutrition: { ...(st().nutrition || {}), [next.date]: next } });
  }
  const addMeal = (slot, m) => { const d = dayOf(sel); saveDay({ ...d, meals: [...d.meals, { id: uid(), slot, at: Date.now(), alc: 0, ...m, kcal: Math.round(m.kcal), p: Math.round(m.p) }] }); };
  const saveSettings = (patch) => A().commit({ ...st(), settings: { ...st().settings, nutri: { ...cfg(), ...patch } } });

  /* ---------- rendu du journal ---------- */
  function render(root) {
    const { el } = A();
    if (!sel) sel = A().today();
    const day = dayOf(sel), c = cfg();
    root.replaceChildren(weekStrip(), gauges(day, c));
    if (A().scriptVersion === 1) root.append(el('div', { class: 'ax warn', style: 'margin-bottom:10px' }, el('b', { text: 'Script Google à mettre à jour' }), el('small', { text: 'Tes repas sont gardés sur ce téléphone, mais pas encore dans la feuille. Recolle apps-script/Code.gs puis Déployer → Gérer les déploiements → ✏️ → Nouvelle version. Ils partiront tout seuls ensuite.' })));
    if (!c.profile) root.append(el('div', { class: 'ax', style: 'margin-bottom:10px' }, el('b', { text: 'Objectifs par défaut' }), el('small', { text: 'Renseigne ton profil pour des objectifs calculés pour toi.' }), el('button', { class: 'btn primary', type: 'button', style: 'margin-top:6px', text: 'Calculer mes objectifs', onclick: openTargets })));
    for (const slot of Object.keys(SLOTS)) root.append(slotBlock(slot, day));
    const note = el('input', { class: 'note', type: 'text', id: 'dayNote', placeholder: 'Note du jour (faim, écart, resto, sommeil…)', value: day.note || '', enterkeyhint: 'done' });
    note.addEventListener('change', () => saveDay({ ...dayOf(sel), note: note.value.trim() }));
    root.append(note, recap(), weightInput(), el('button', { class: 'btn ghost', type: 'button', style: 'margin-top:10px', text: '⚙︎ Objectifs & profil nutrition', onclick: openTargets }));
  }

  function weekStrip() {
    const { el, today, weekKey } = A();
    const t = today(), monday = weekKey(sel);
    const hist = new Set(st().history.map(h => h.date));
    const strip = el('div', { class: 'week' });
    strip.append(el('button', { class: 'wk-nav', type: 'button', 'aria-label': 'Semaine précédente', text: '‹', onclick: () => { sel = addDays(sel, -7); A().render(); } }));
    ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach((letter, i) => {
      const date = addDays(monday, i), future = date > t, day = dayOf(date);
      const marks = `${hist.has(date) ? '🏋️' : ''}${window.Steps?.reached(date) ? '🚶' : ''}${totals(day).alc > 0 ? '🍺' : ''}`;
      const b = el('button', { class: `wk-day st-${dayStatus(day)}${date === sel ? ' sel' : ''}${date === t ? ' today' : ''}`, type: 'button', 'aria-label': date, onclick: () => { sel = date; A().render(); } },
        el('span', { class: 'l', text: letter }), el('span', { class: 'n', text: String(Number(date.slice(8))) }), el('span', { class: 'm', text: marks || '·' }));
      if (future) b.disabled = true;
      strip.append(b);
    });
    const nextBtn = el('button', { class: 'wk-nav', type: 'button', 'aria-label': 'Semaine suivante', text: '›', onclick: () => { sel = addDays(sel, 7) > t ? t : addDays(sel, 7); A().render(); } });
    if (weekKey(sel) === weekKey(t)) nextBtn.disabled = true;
    strip.append(nextBtn);
    return strip;
  }

  function gauges(day, c) {
    const { el, fmtDate, today } = A();
    const t = totals(day);
    const bar = (label, val, target, unit, overIsBad) => {
      const pct = Math.min(100, Math.round(val / target * 100)), over = val > target * 1.05;
      const left = target - val;
      return el('div', { class: 'gauge' },
        el('div', { class: 'gauge-top' }, el('b', { text: label }), el('span', { class: 'tnum', text: `${val} / ${target} ${unit}` })),
        el('div', { class: `gbar${over && overIsBad ? ' over' : val >= target * 0.9 && !overIsBad ? ' ok' : ''}` }, el('i', { style: `width:${pct}%` })),
        el('small', { text: left > 0 ? `reste ${left} ${unit}` : overIsBad ? `dépassé de ${-left} ${unit}` : 'objectif atteint ✓' }));
    };
    const copieux = day.meals.filter(m => m.size === 'copieux' || m.size === 'tres').length;
    const snacks = day.meals.filter(m => m.slot === 'col').length;
    return el('div', { class: 'daycard' },
      el('div', { class: 'daycard-title', text: sel === today() ? 'Aujourd’hui' : new Date(sel + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) }),
      bar('Calories', t.kcal, c.kcal, 'kcal', true), bar('Protéines', t.p, c.prot, 'g', false),
      ...(t.src === 'assiette' ? [el('div', { class: 'assiette-line', text: `🍽️ Depuis Assiette · glucides ${t.c} g · lipides ${t.f} g${st().macros[sel].fib ? ` · fibres ${st().macros[sel].fib} g` : ''}${st().macros[sel].at ? ` · relevé à ${new Date(st().macros[sel].at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}` })] : []),
      ...(window.Steps ? [window.Steps.gauge(sel)] : []),
      el('div', { class: 'chips-top', style: 'margin:8px 0 0' },
        el('span', { class: `chip${copieux ? ' fire' : ''}`, html: `🍽️ <b>${copieux}</b> copieux` }),
        el('span', { class: 'chip', html: `🍪 <b>${snacks}</b> collation${snacks > 1 ? 's' : ''}` }),
        el('span', { class: `chip${t.alc ? ' fire' : ''}`, html: `🍺 <b>${t.alc}</b> verre${t.alc > 1 ? 's' : ''}` })));
  }

  function slotBlock(slot, day) {
    const { el } = A();
    const meals = day.meals.filter(m => m.slot === slot);
    const sub = meals.reduce((a, m) => a + m.kcal, 0);
    const box = el('div', { class: 'slot' }, el('div', { class: 'slot-head' }, el('b', { text: SLOTS[slot] }), el('span', { class: 'tnum', text: meals.length ? `${sub} kcal` : '' })));
    for (const m of meals) box.append(el('button', { class: 'meal', type: 'button', onclick: () => openMeal(m) },
      el('span', { class: 'meal-name', text: m.label }), el('span', { class: 'meal-val tnum', text: `${m.est ? '≈ ' : ''}${m.kcal} kcal · ${m.p} g` })));
    box.append(el('button', { class: 'meal-add', type: 'button', id: `add-${slot}`, text: '+ Ajouter', onclick: () => openAdd(slot) }));
    return box;
  }

  function recap() {
    const { el, cardioMinutes } = A();
    const h = st().history.find(x => x.date === sel), w = (st().weights || []).find(x => x.date === sel);
    const items = [];
    if (h) items.push(`🏋️ Séance : ${h.setsDone}/${h.setsTotal} séries · ${h.min} min · ${(h.volume / 1000).toFixed(1)} t${cardioMinutes(h) ? ` · cardio ${cardioMinutes(h)} min` : ''}`);
    if (w) items.push(`⚖️ ${w.kg} kg`);
    const steps = window.Steps?.count(sel); if (steps) items.push(`🚶 ${steps.toLocaleString('fr-FR')} pas`);
    return el('div', { class: 'recap', text: items.length ? items.join('   ') : 'Pas de séance ni de pesée ce jour-là.' });
  }

  /* ---------- ajout d'un repas ---------- */
  function openAdd(slot, mode = 'rapide') {
    const { el, openSheet } = A();
    const tabs = el('div', { class: 'modes' }, ...[['rapide', 'Rapide'], ['favoris', 'Favoris'], ['recherche', 'Recherche'], ['libre', 'Libre']].map(([k, label]) =>
      el('button', { class: `mode${k === mode ? ' on' : ''}`, type: 'button', text: label, onclick: () => openAdd(slot, k) })));
    const body = mode === 'rapide' ? quickForm(slot) : mode === 'favoris' ? favForm(slot) : mode === 'recherche' ? searchForm(slot) : freeForm(slot);
    openSheet(el('h3', { text: SLOTS[slot] }), tabs, body);
  }

  function quickForm(slot) {
    const { el, selectEl, closeSheet } = A();
    if (!MEAL_SLOTS.includes(slot)) {
      const items = slot === 'col' ? SNACKS : DRINKS;
      const list = el('div', { class: 'picks' });
      for (const [label, kcal, p, alc = 0] of items) list.append(el('button', { class: 'pick', type: 'button', onclick: () => { addMeal(slot, { label, kcal, p, alc, est: true }); closeSheet(); } },
        el('span', { text: label }), el('small', { class: 'tnum', text: `${kcal} kcal${p ? ` · ${p} g` : ''}${alc ? ` · ${alc} verre${alc > 1 ? 's' : ''}` : ''}` })));
      return el('div', {}, el('p', { class: 'hint', text: 'Un tap = un ajout. Deux bières ? Tape deux fois.' }), list);
    }
    const c = cfg();
    const selSize = selectEl('qSize', Object.keys(SIZES), 'normal', (k) => SIZES[k][0]);
    const selProt = selectEl('qProt', Object.keys(PROTS), 'bonne', (k) => PROTS[k][0]);
    const label = el('input', { type: 'text', id: 'qLabel', placeholder: 'Quoi ? (facultatif : pâtes bolo, resto…)', enterkeyhint: 'done' });
    const est = el('div', { class: 'estimate tnum' });
    const calc = () => ({ kcal: c.base[slot] * SIZES[selSize.value][1], p: PROTS[selProt.value][1] * (selSize.value === 'leger' ? 0.8 : selSize.value === 'tres' ? 1.2 : 1) });
    const refresh = () => { const v = calc(); est.textContent = `≈ ${Math.round(v.kcal)} kcal · ${Math.round(v.p)} g de protéines`; };
    selSize.addEventListener('change', refresh); selProt.addEventListener('change', refresh); refresh();
    return el('div', {},
      el('div', { class: 'fields' },
        el('div', { class: 'field' }, el('label', { for: 'qSize', text: 'Taille du repas' }), selSize),
        el('div', { class: 'field' }, el('label', { for: 'qProt', text: 'Protéines' }), selProt),
        el('div', { class: 'field wide' }, el('label', { for: 'qLabel', text: 'Libellé' }), label)),
      est,
      el('div', { class: 'actions' }, el('button', { class: 'btn primary big', type: 'button', text: 'Ajouter', onclick: () => { const v = calc(); addMeal(slot, { label: label.value.trim() || `${SLOTS[slot]} ${SIZES[selSize.value][0].toLowerCase()}`, ...v, size: selSize.value, prot: selProt.value, est: true }); closeSheet(); } })));
  }

  function favForm(slot) {
    const { el, closeSheet } = A();
    const favs = cfg().favs;
    if (!favs.length) return el('p', { class: 'hint', text: 'Aucun favori. Ajoute un repas (Rapide, Recherche ou Libre), touche-le dans la liste, puis « ⭐ Ajouter aux favoris ».' });
    const list = el('div', { class: 'picks' });
    for (const f of favs) list.append(el('button', { class: 'pick', type: 'button', onclick: () => { addMeal(slot, { label: f.label, kcal: f.kcal, p: f.p, alc: f.alc || 0, size: f.size }); closeSheet(); } },
      el('span', { text: f.label }), el('small', { class: 'tnum', text: `${f.kcal} kcal · ${f.p} g` })));
    return list;
  }

  function freeForm(slot) {
    const { el, closeSheet } = A();
    const label = el('input', { type: 'text', id: 'fLabel', placeholder: 'Nom' });
    const kcal = el('input', { type: 'number', id: 'fKcal', inputmode: 'numeric', min: '0', max: '5000', placeholder: 'kcal' });
    const prot = el('input', { type: 'number', id: 'fProt', inputmode: 'numeric', min: '0', max: '300', placeholder: 'g' });
    return el('div', {},
      el('div', { class: 'fields' },
        el('div', { class: 'field wide' }, el('label', { for: 'fLabel', text: 'Libellé' }), label),
        el('div', { class: 'field' }, el('label', { for: 'fKcal', text: 'Calories' }), kcal),
        el('div', { class: 'field' }, el('label', { for: 'fProt', text: 'Protéines (g)' }), prot)),
      el('div', { class: 'actions' }, el('button', { class: 'btn primary big', type: 'button', text: 'Ajouter', onclick: () => {
        const k = Number(kcal.value); if (!label.value.trim() || !(k >= 0) || kcal.value === '') { alert('Indique au moins un nom et des calories.'); return; }
        addMeal(slot, { label: label.value.trim(), kcal: k, p: Number(prot.value) || 0 }); closeSheet();
      } })));
  }

  function searchForm(slot) {
    const { el, closeSheet } = A();
    const q = el('input', { type: 'search', id: 'sQ', placeholder: 'ex. skyr nature, pain complet…', enterkeyhint: 'search' });
    const results = el('div', { class: 'picks' });
    const run = async () => {
      const term = q.value.trim(); if (term.length < 2) return;
      results.replaceChildren(el('p', { class: 'hint', text: 'Recherche dans Open Food Facts…' }));
      try {
        const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 12000);
        const res = await fetch(`${OFF_URL}?search_terms=${encodeURIComponent(term)}&search_simple=1&action=process&json=1&page_size=12&lc=fr&cc=fr&fields=product_name,brands,nutriments,serving_quantity`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const products = ((await res.json()).products || []).filter(p => p.product_name && p.nutriments && p.nutriments['energy-kcal_100g'] !== undefined);
        if (!products.length) { results.replaceChildren(el('p', { class: 'hint', text: 'Rien trouvé. Essaie un autre mot, ou passe par « Libre ».' })); return; }
        results.replaceChildren(...products.map(p => {
          const k100 = Number(p.nutriments['energy-kcal_100g']) || 0, p100 = Number(p.nutriments.proteins_100g) || 0;
          return el('button', { class: 'pick', type: 'button', onclick: () => askQty(slot, `${p.product_name}${p.brands ? ' · ' + p.brands.split(',')[0] : ''}`, k100, p100, Number(p.serving_quantity) || 100) },
            el('span', { text: `${p.product_name}${p.brands ? ' · ' + p.brands.split(',')[0] : ''}` }), el('small', { class: 'tnum', text: `${Math.round(k100)} kcal · ${Math.round(p100)} g / 100 g` }));
        }));
      } catch (err) {
        results.replaceChildren(el('p', { class: 'hint', text: `Recherche impossible (${navigator.onLine ? 'service indisponible' : 'hors-ligne'}). Utilise « Rapide » ou « Libre ».` }));
      }
    };
    q.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') run(); });
    return el('div', {}, el('div', { class: 'wrow' }, q, el('button', { class: 'btn primary', type: 'button', text: 'Chercher', onclick: run })), results);
    function askQty(s, label, k100, p100, dflt) {
      const { openSheet } = A();
      const g = el('input', { type: 'number', id: 'sG', inputmode: 'numeric', min: '1', max: '2000', value: String(Math.round(dflt)) });
      const est = el('div', { class: 'estimate tnum' });
      const refresh = () => { const n = Number(g.value) || 0; est.textContent = `${Math.round(k100 * n / 100)} kcal · ${Math.round(p100 * n / 100)} g de protéines`; };
      g.addEventListener('input', refresh); refresh();
      openSheet(el('h3', { text: label }), el('div', { class: 'fields' }, el('div', { class: 'field wide' }, el('label', { for: 'sG', text: 'Quantité (g ou ml)' }), g)), est,
        el('div', { class: 'actions' }, el('button', { class: 'btn primary big', type: 'button', text: 'Ajouter', onclick: () => { const n = Number(g.value) || 0; if (!n) return; addMeal(s, { label: `${label} (${n} g)`, kcal: k100 * n / 100, p: p100 * n / 100 }); closeSheet(); } })));
    }
  }

  function openMeal(m) {
    const { el, openSheet, closeSheet } = A();
    const isFav = cfg().favs.some(f => f.label === m.label);
    openSheet(el('h3', { text: m.label }), el('div', { class: 'sub', text: `${m.est ? 'Estimation : ' : ''}${m.kcal} kcal · ${m.p} g de protéines${m.alc ? ` · ${m.alc} verre(s)` : ''}` }),
      el('div', { class: 'menu' },
        el('button', { class: 'btn', type: 'button', text: 'Dupliquer (j’en ai repris)', onclick: () => { addMeal(m.slot, { label: m.label, kcal: m.kcal, p: m.p, alc: m.alc || 0, size: m.size, est: m.est }); closeSheet(); } }),
        ...(isFav ? [] : [el('button', { class: 'btn', type: 'button', text: '⭐ Ajouter aux favoris', onclick: () => { saveSettings({ favs: [...cfg().favs, { label: m.label, kcal: m.kcal, p: m.p, alc: m.alc || 0, size: m.size }] }); closeSheet(); } })]),
        el('button', { class: 'btn ghost', type: 'button', text: 'Supprimer', onclick: () => { const d = dayOf(sel); saveDay({ ...d, meals: d.meals.filter(x => x.id !== m.id) }); closeSheet(); } })));
  }

  /* ---------- objectifs & profil ---------- */
  function openTargets() {
    const { el, openSheet, closeSheet, selectEl } = A();
    const c = cfg(), p = c.profile || { sex: 'h', age: 35, height: 175, activity: 1.4 };
    const num = (id, val, min, max) => el('input', { type: 'number', id, inputmode: 'decimal', min: String(min), max: String(max), value: val === undefined ? '' : String(val) });
    const sex = selectEl('pSex', ['h', 'f'], p.sex, (o) => o === 'h' ? 'Homme' : 'Femme');
    const age = num('pAge', p.age, 14, 99), height = num('pH', p.height, 120, 230), weight = num('pW', latestWeight() ?? p.weight, 35, 300);
    const act = selectEl('pAct', Object.keys(ACTIVITY), String(p.activity), (o) => ACTIVITY[o]);
    const kcal = num('tKcal', c.kcal, 1000, 6000), prot = num('tProt', c.prot, 40, 350);
    const why = el('p', { class: 'hint' });
    let base = c.base;
    const profile = () => ({ sex: sex.value, age: Number(age.value), height: Number(height.value), activity: Number(act.value), weight: Number(weight.value) });
    const compute = () => {
      const pr = profile(); if (!pr.age || !pr.height || !pr.weight) { why.textContent = 'Renseigne âge, taille et poids.'; return; }
      const t = computeTargets(pr, pr.weight); kcal.value = String(t.kcal); prot.value = String(t.prot); base = t.base;
      why.textContent = `Métabolisme de base ≈ ${t.bmr} kcal, dépense totale ≈ ${t.tdee} kcal. Objectif = −20 % (≈ −${t.tdee - t.kcal} kcal/jour, soit ~${(Math.round((t.tdee - t.kcal) * 7 / 7700 * 10) / 10)} kg/semaine). Protéines = 2 g par kg de poids de référence. Ce sont des estimations : c’est ta courbe de poids sur 2–3 semaines qui tranche.`;
    };
    openSheet(el('h3', { text: 'Objectifs & profil' }), el('div', { class: 'sub', text: 'Le profil reste dans ta feuille privée.' }),
      el('div', { class: 'fields' },
        el('div', { class: 'field' }, el('label', { for: 'pSex', text: 'Sexe' }), sex), el('div', { class: 'field' }, el('label', { for: 'pAge', text: 'Âge' }), age),
        el('div', { class: 'field' }, el('label', { for: 'pH', text: 'Taille (cm)' }), height), el('div', { class: 'field' }, el('label', { for: 'pW', text: 'Poids (kg)' }), weight),
        el('div', { class: 'field wide' }, el('label', { for: 'pAct', text: 'Activité' }), act)),
      el('button', { class: 'btn', type: 'button', text: 'Calculer mes objectifs', onclick: compute }), why,
      el('div', { class: 'fields', style: 'margin-top:10px' },
        el('div', { class: 'field' }, el('label', { for: 'tKcal', text: 'Calories / jour' }), kcal), el('div', { class: 'field' }, el('label', { for: 'tProt', text: 'Protéines / jour (g)' }), prot)),
      el('div', { class: 'actions' }, el('button', { class: 'btn primary big', type: 'button', text: 'Enregistrer', onclick: () => {
        const k = Number(kcal.value), g = Number(prot.value); if (!(k >= 1000) || !(g >= 40)) { alert('Objectifs invalides.'); return; }
        const pr = profile(); saveSettings({ kcal: k, prot: g, base, profile: pr.age && pr.height ? pr : c.profile }); closeSheet();
      } })));
  }

  /* ---------- poids corporel ---------- */
  function weightStats() {
    const { today, daysBetween } = A();
    const W = [...(st().weights || [])].sort((a, b) => a.date.localeCompare(b.date));
    if (!W.length) return null;
    const avg = (arr) => arr.length ? Math.round(arr.reduce((a, w) => a + w.kg, 0) / arr.length * 10) / 10 : null;
    const t = today();
    const a7 = avg(W.filter(w => daysBetween(w.date, t) < 7)), p7 = avg(W.filter(w => daysBetween(w.date, t) >= 7 && daysBetween(w.date, t) < 14));
    const rate = a7 && p7 ? Math.round((a7 - p7) / p7 * 1000) / 10 : null;   // %/semaine
    return { W, latest: W.at(-1), a7, p7, rate, since: Math.round((W.at(-1).kg - W[0].kg) * 10) / 10, days: daysBetween(W[0].date, W.at(-1).date) };
  }
  function weightInput() {
    const { el, commit } = A();
    const cur = (st().weights || []).find(w => w.date === sel);
    const input = el('input', { type: 'number', inputmode: 'decimal', step: '0.1', min: '30', max: '300', id: 'wIn', placeholder: cur ? String(cur.kg) : (latestWeight() ? String(latestWeight()) : 'kg'), 'aria-label': 'Poids du jour' });
    const save = () => {
      const kg = Math.round(Number(input.value) * 10) / 10; if (!kg || kg < 30 || kg > 300) return;
      commit({ ...st(), weights: [...(st().weights || []).filter(w => w.date !== sel), { date: sel, kg }].sort((a, b) => a.date.localeCompare(b.date)).slice(-WEIGHTS_MAX) });
    };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') save(); });
    return el('div', {}, el('h2', { class: 'sec', text: 'Pesée' }), el('div', { class: 'wrow' }, input, el('button', { class: 'btn primary', type: 'button', text: cur ? 'Corriger la pesée' : 'Enregistrer la pesée', onclick: save })),
      el('p', { class: 'hint', text: 'Le matin à jeun, 3 à 7 fois par semaine : c’est la moyenne sur 7 jours qui compte.' }));
  }
  function weightSummary() {
    const { el, svgEl, tile, ax, fmtDate } = A();
    const wrap = el('div'); wrap.append(el('h2', { class: 'sec', text: 'Poids corporel' }));
    const ws = weightStats();
    if (!ws) { wrap.append(el('div', { class: 'empty', text: 'Enregistre ta pesée dans l’onglet Journal pour voir ta tendance.' })); return wrap; }
    wrap.append(el('div', { class: 'tiles' }, tile('Dernier', ws.latest.kg, ` kg · ${fmtDate(ws.latest.date)}`), tile('Moyenne 7 j', ws.a7 ?? '—', ' kg'),
      tile('Rythme', ws.rate === null ? '—' : `${ws.rate > 0 ? '+' : ''}${ws.rate}`, ws.rate === null ? '' : ' %/sem'), tile('Depuis le début', `${ws.since > 0 ? '+' : ''}${ws.since}`, ` kg · ${ws.days} j`)));
    if (ws.W.length >= 2) {
      const pts = ws.W.slice(-30), lo = Math.min(...pts.map(w => w.kg)), hi = Math.max(...pts.map(w => w.kg)), sp = hi - lo || 1;
      const svg = svgEl('svg', { class: 'spark big', viewBox: '0 0 100 30', preserveAspectRatio: 'none' });
      const P = pts.map((w, i) => [i * 100 / (pts.length - 1), 27 - (w.kg - lo) / sp * 24]);
      svg.append(svgEl('path', { d: P.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') }), svgEl('circle', { cx: P.at(-1)[0], cy: P.at(-1)[1], r: 2 }));
      wrap.append(svg);
    }
    return wrap;
  }

  /* ---------- stats & conseils ---------- */
  const lastDays = (n) => { const t = A().today(); return Array.from({ length: n }, (_, i) => dayOf(addDays(t, -i))).filter(hasFood); };
  function weekFacts() {
    const days = lastDays(7); if (!days.length) return null;
    const T = days.map(totals), c = cfg();
    return { n: days.length, kcal: Math.round(T.reduce((a, t) => a + t.kcal, 0) / days.length), prot: Math.round(T.reduce((a, t) => a + t.p, 0) / days.length),
      protOk: T.filter(t => t.p >= c.prot * 0.9).length, alc: Math.round(T.reduce((a, t) => a + t.alc, 0) * 10) / 10,
      copieux: days.reduce((a, d) => a + d.meals.filter(m => m.size === 'copieux' || m.size === 'tres').length, 0),
      alcKcal: days.reduce((a, d) => a + d.meals.filter(m => m.alc > 0).reduce((x, m) => x + m.kcal, 0), 0) };
  }
  function statsBlock() {
    const { el, svgEl, tile, today } = A();
    const wrap = el('div'); wrap.append(weightSummary(), el('h2', { class: 'sec', text: 'Nutrition — 7 derniers jours' }));
    const f = weekFacts(), c = cfg();
    if (!f) { wrap.append(el('div', { class: 'empty', text: 'Saisis tes repas dans l’onglet Journal : moyenne de calories, protéines, alcool et repas copieux apparaîtront ici.' })); return wrap; }
    wrap.append(el('div', { class: 'tiles' }, tile('Calories (moy.)', f.kcal, ` / ${c.kcal}`), tile('Protéines (moy.)', f.prot, ` / ${c.prot} g`),
      tile('Jours protéines OK', `${f.protOk}/${f.n}`, ''), tile('Alcool', f.alc, ` verre${f.alc > 1 ? 's' : ''}`), tile('Repas copieux', f.copieux, '')));
    const t = today(), days = Array.from({ length: 14 }, (_, i) => dayOf(addDays(t, i - 13)));
    const W = 600, H = 120, pad = 18, max = Math.max(c.kcal * 1.3, ...days.map(d => totals(d).kcal));
    const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}` });
    const yT = H - pad - (H - 2 * pad) * c.kcal / max;
    days.forEach((d, i) => { const k = totals(d).kcal, bw = (W - 20) / 14, bh = (H - 2 * pad) * k / max; if (k) svg.append(svgEl('rect', { class: `b nut-${dayStatus(d)}`, x: 10 + i * bw + bw * .15, y: H - pad - bh, width: bw * .7, height: bh, rx: 3 })); });
    svg.append(svgEl('line', { class: 'target', x1: 0, x2: W, y1: yT, y2: yT }));
    const lbl = svgEl('text', { x: W - 4, y: yT - 4, 'text-anchor': 'end' }); lbl.textContent = `objectif ${c.kcal} kcal`; svg.append(lbl);
    wrap.append(svg);
    return wrap;
  }
  function axes(out) {
    const { ax } = A();
    const f = weekFacts(), c = cfg(), ws = weightStats();
    if (!f || f.n < 3) { out.append(ax('', 'Nutrition : saisis 3 jours pour débloquer les conseils', 'Onglet Journal → taille du repas + part de protéines, 10 secondes par repas. L’entraînement construit le muscle, l’assiette décide du gras.')); return; }
    if (f.prot < c.prot * 0.85) out.append(ax('warn', `Protéines : ${f.prot} g/jour en moyenne (objectif ${c.prot} g)`, 'En déficit, c’est la priorité n°1 pour garder le muscle. Ajoute une source à chaque repas : œufs ou skyr le matin, 150 g de viande/poisson midi et soir, un shaker en collation.'));
    else out.append(ax('good', `Protéines : ${f.prot} g/jour — ${f.protOk}/${f.n} jours dans la cible`, 'C’est ce qui protège ton muscle pendant la perte de poids. Continue.'));
    if (f.alc >= 4) out.append(ax('warn', `Alcool : ${f.alc} verres cette semaine (≈ ${f.alcKcal} kcal)`, 'Au-delà des calories, l’alcool freine la récupération et la synthèse musculaire pendant 24–48 h. Évite-le surtout les soirs de séance ; vise ≤ 3 verres par semaine.'));
    if (f.copieux >= 4) out.append(ax('', `${f.copieux} repas copieux cette semaine`, 'Garde-en 1 ou 2 « plaisir » assumés, et rends les autres normaux : c’est souvent là que part le déficit de la semaine.'));
    if (ws && ws.rate !== null && f.n >= 5) {
      if (ws.rate > -0.25 && f.kcal <= c.kcal * 1.05) out.append(ax('warn', 'Poids stable alors que tes calories saisies sont dans la cible', `Le plus probable : des oublis ou des portions sous-estimées (huile, sauces, grignotage, boissons). Sinon, baisse l’objectif de 150 kcal pendant 2 semaines.`));
      else if (ws.rate <= -1.2) out.append(ax('warn', `Tu perds vite (${ws.rate} %/sem)`, 'Au-delà de −1 %/semaine le muscle trinque : remonte de 150–200 kcal (féculents autour de la séance) et garde tes protéines.'));
      else if (ws.rate < -0.25) out.append(ax('good', `Rythme de perte idéal (${ws.rate} %/sem)`, 'Entre −0,5 et −1 %/semaine avec des charges qui tiennent : tu perds du gras, pas du muscle.'));
    }
    if (f.n < 5) out.append(ax('', `Journal rempli ${f.n}/7 jours`, 'Les jours non saisis sont souvent les plus chargés. Même une saisie approximative (« très copieux ») vaut mieux qu’un trou.'));
  }

  return { render, statsBlock, axes, computeTargets };
})();
