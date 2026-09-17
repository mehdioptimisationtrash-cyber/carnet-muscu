(() => {
  'use strict';
  const CACHE_KEY = 'carnet-muscu-v2';
  const HISTORY_MAX = 120;
  const XP = { set: 10, hit: 5, beat: 5, palier: 40, pr: 30, session: 50, streakPerWeek: 10, streakMax: 50 };
  const TITLES = ['Rookie', 'Régulier', 'Solide', 'Costaud', 'Machine', 'Bête de salle', 'Légende'];
  const BADGES = [
    { id: 'first', e: '🎯', n: 'Première séance', t: (s) => s.history.length >= 1 },
    { id: 's5', e: '🔥', n: '5 séances', t: (s) => s.history.length >= 5 },
    { id: 's10', e: '💎', n: '10 séances', t: (s) => s.history.length >= 10 },
    { id: 's25', e: '👑', n: '25 séances', t: (s) => s.history.length >= 25 },
    { id: 'palier', e: '⬆️', n: 'Premier palier', t: (s) => s.history.some(h => h.paliers.length) },
    { id: 'pr', e: '🏆', n: 'Premier record', t: (s) => s.history.some(h => h.prs.length) },
    { id: 'streak3', e: '📅', n: '3 semaines d’affilée', t: (s) => streakWeeks(s) >= 3 },
    { id: 'streak8', e: '🗓️', n: '8 semaines d’affilée', t: (s) => streakWeeks(s) >= 8 },
    { id: 'full', e: '✅', n: 'Séance 100 % réussie', t: (s) => s.history.some(h => h.setsDone > 0 && h.setsDone === h.setsTotal && h.fails === 0) },
    { id: 'ton10', e: '🚚', n: '10 tonnes en une séance', t: (s) => s.history.some(h => h.volume >= 10000) },
  ];

  /* ---------- utilitaires ---------- */
  const uid = () => Math.random().toString(36).slice(2, 9);
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '—';
  const round1 = (x) => Math.round(x * 2) / 2;
  const fmtKg = (c) => c === 'PDC' ? 'PDC' : `${c} kg`;
  const isTemps = (e) => e.mode === 'temps';
  const fmtReps = (e, r) => isTemps(e) ? `${r} s` : `${r}`;
  const e1rm = (c, r) => typeof c === 'number' && c > 0 ? Math.round(c * (1 + r / 30) * 10) / 10 : null;
  const weekKey = (iso) => { const d = new Date(iso + 'T12:00:00'); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d.toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else n.setAttribute(k, v);
    }
    n.append(...kids);
    return n;
  };
  const svgEl = (tag, attrs = {}) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

  /* ---------- état ---------- */
  let state = null;
  let tab = 'seance';
  let restTimer = null, restEnd = 0, clockTimer = null;

  const mkExo = (name, sets, opts = {}) => ({ id: uid(), name, mode: 'reps', step: 2, repMin: 10, repMax: 15, sets, last: null, best: null, stalled: 0, ...opts });
  const seed = () => ({ v: 2, rev: 0, xp: 0, settings: { rest: 90 }, exos: [], session: null, history: [] });
  const migrate = (d) => {
    if (!d || typeof d !== 'object') return null;
    if (d.v === 2) return { ...seed(), ...d, history: Array.isArray(d.history) ? d.history : [] };
    const exos = (d.seances || []).flatMap(s => s.exos.map(e => mkExo(e.name, Array.from({ length: e.series || 3 }, () => ({ charge: e.charge, reps: typeof e.reps === 'number' ? e.reps : parseInt(e.reps) || 30 })), typeof e.reps === 'string' ? { mode: 'temps', repMin: 20, repMax: 120 } : {})));
    return { ...seed(), rev: d.rev || 0, exos };
  };
  const readCache = () => { try { const s = localStorage.getItem(CACHE_KEY); return s ? JSON.parse(s) : null; } catch { return null; } };
  const writeCache = (s) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch {} };

  function commit(next) {
    state = { ...next, rev: Date.now() };
    writeCache(state);
    render();
    if (Sync.enabled()) Sync.scheduleSave(state);
  }
  const updExo = (id, fn) => ({ ...state, exos: state.exos.map(e => e.id === id ? fn(e) : e) });

  /* ---------- progression & gamification ---------- */
  const level = (xp) => Math.floor(Math.sqrt(xp / 150)) + 1;
  const xpForLevel = (l) => 150 * (l - 1) ** 2;
  const titleFor = (l) => TITLES[Math.min(TITLES.length - 1, l - 1)];
  function streakWeeks(s) {
    const weeks = new Set(s.history.map(h => weekKey(h.date)));
    if (!weeks.size) return 0;
    let w = weekKey(today()), n = 0;
    if (!weeks.has(w)) { const d = new Date(w + 'T12:00:00'); d.setDate(d.getDate() - 7); w = d.toISOString().slice(0, 10); if (!weeks.has(w)) return 0; }
    while (weeks.has(w)) { n++; const d = new Date(w + 'T12:00:00'); d.setDate(d.getDate() - 7); w = d.toISOString().slice(0, 10); }
    return n;
  }
  const setProgress = (e, s) => s.charge === 'PDC' && !isTemps(e) ? Math.min(1, s.reps / e.repMax) : Math.min(1, Math.max(0, (s.reps - e.repMin) / (e.repMax - e.repMin)));
  const exoProgress = (e) => e.sets.length ? e.sets.reduce((a, s) => a + setProgress(e, s), 0) / e.sets.length : 0;
  function nextTarget(e, target, r) {
    if (!r || r.done !== true) return { ...target };                          // pas faite : on retente
    if (isTemps(e)) return { charge: 'PDC', reps: r.reps >= target.reps ? Math.min(r.reps + 5, e.repMax) : target.reps };
    if (r.reps < target.reps) return { charge: r.charge, reps: target.reps }; // ratée : même cible
    if (r.reps >= e.repMax && r.charge !== 'PDC') return { charge: round1(r.charge + e.step), reps: e.repMin, up: true }; // palier
    return { charge: r.charge, reps: Math.min(r.reps + 1, e.repMax) };
  }
  function tipFor(e) {
    if (isTemps(e)) return `Tiens ${e.repMax} s pour valider le palier`;
    const near = e.sets.filter(s => s.charge !== 'PDC' && e.repMax - s.reps <= 1).length;
    if (near) return `${near} série${near > 1 ? 's' : ''} à 1 rep du palier (+${e.step} kg)`;
    if (e.stalled >= 2) return `Stagne depuis ${e.stalled} séances — essaie −${e.step} kg et remonte`;
    return '';
  }

  /* ---------- rendu ---------- */
  function render() {
    renderHeader();
    $('#viewSeance').hidden = tab !== 'seance';
    $('#viewStats').hidden = tab !== 'stats';
    $('#tabSeance').setAttribute('aria-selected', tab === 'seance');
    $('#tabStats').setAttribute('aria-selected', tab === 'stats');
    if (tab === 'seance') renderSeance(); else renderStats();
    renderDock();
  }
  function renderHeader() {
    const lvl = level(state.xp), lo = xpForLevel(lvl), hi = xpForLevel(lvl + 1);
    $('#lvlNum').textContent = lvl;
    $('#lvlTitle').textContent = titleFor(lvl);
    $('#lvlNext').textContent = `${hi - state.xp} XP avant le niveau ${lvl + 1}`;
    $('#xpNow').textContent = state.xp;
    $('#xpBar').style.width = `${Math.round(((state.xp - lo) / (hi - lo)) * 100)}%`;
    const last = state.history.at(-1);
    $('#sub').textContent = last ? `${state.history.length} séance${state.history.length > 1 ? 's' : ''} · dernière le ${fmtDate(last.date)}` : 'Aucune séance enregistrée — c’est le moment.';
    const streak = streakWeeks(state);
    const prs = state.history.reduce((a, h) => a + h.prs.length, 0);
    const paliers = state.history.reduce((a, h) => a + h.paliers.length, 0);
    const week = state.history.filter(h => weekKey(h.date) === weekKey(today())).length;
    $('#chipsTop').replaceChildren(
      el('span', { class: `chip${streak ? ' fire' : ''}`, html: `🔥 <b>${streak}</b> sem. d’affilée` }),
      el('span', { class: 'chip', html: `📅 <b>${week}</b> cette semaine` }),
      el('span', { class: `chip${paliers ? ' gold' : ''}`, html: `⬆️ <b>${paliers}</b> palier${paliers > 1 ? 's' : ''}` }),
      el('span', { class: `chip${prs ? ' gold' : ''}`, html: `🏆 <b>${prs}</b> record${prs > 1 ? 's' : ''}` }),
    );
  }
  function renderSeance() {
    const inS = !!state.session;
    $('#sessionTitle').textContent = inS ? 'Séance en cours' : 'Prochaine séance';
    const total = state.exos.reduce((a, e) => a + e.sets.length, 0);
    $('#sessionMeta').textContent = inS ? 'Touche une série pour la valider ou l’ajuster' : (state.exos.length ? `${state.exos.length} exercices · ${total} séries · cibles = point de départ` : 'Ajoute ton premier exercice ci-dessous.');
    $('#btnStart').hidden = inS || !state.exos.length;
    const root = $('#exos');
    root.replaceChildren();
    const currentId = inS ? state.exos.find(e => (state.session.results[e.id] || []).some(r => r.done === null))?.id : null;
    for (const e of state.exos) root.append(exoCard(e, inS, e.id === currentId));
  }
  function exoCard(e, inS, current) {
    const res = inS ? (state.session.results[e.id] || []) : [];
    const charges = [...new Set(e.sets.map(s => fmtKg(s.charge)))].join(' / ');
    const head = el('div', { class: 'exo-head' },
      el('div', { class: 'exo-name', contenteditable: 'true', spellcheck: 'false', id: `n-${e.id}`, text: e.name,
        onblur: (ev) => renameExo(e.id, ev.target.textContent), onkeydown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); } } }),
      el('span', { class: 'exo-charge', text: isTemps(e) ? 'temps' : charges }),
      el('button', { class: 'exo-menu', type: 'button', 'aria-label': 'Options', text: '⋯', onclick: () => openMenu(e.id) }),
    );
    const sets = el('div', { class: 'sets' });
    e.sets.forEach((t, i) => {
      const r = res[i];
      let cls = 'set', shown = t, label = '';
      if (inS) {
        if (!r || r.done === null) cls += ' pending';
        else if (r.done === false) { cls += ' skip'; label = 'sautée'; }
        else { shown = r; cls += r.reps < t.reps ? ' fail' : r.reps > t.reps ? ' beat' : ' done'; if (!isTemps(e) && r.charge !== 'PDC' && r.reps >= e.repMax) cls += ' up'; }
      }
      sets.append(el('button', { class: cls, type: 'button', id: `s-${e.id}-${i}`, onclick: () => openSet(e.id, i) },
        el('span', { class: 'reps', html: `${shown.reps}<small>${isTemps(e) ? ' s' : (inS && r?.done ? `/${t.reps}` : '')}</small>` }),
        el('span', { class: 'ch', text: label || (isTemps(e) ? `série ${i + 1}` : fmtKg(shown.charge)) })));
    });
    const foot = el('div', { class: 'exo-foot' });
    if (e.last) foot.append(el('span', { class: 'last', text: `dernière fois : ${e.last.map(r => r.done ? fmtReps(e, r.reps) : '–').join(' · ')}` }));
    if (!isTemps(e)) foot.append(el('span', { class: 'pbar', title: 'Progression vers le prochain palier' }, el('i', { style: `width:${Math.round(exoProgress(e) * 100)}%` })));
    if (e.best?.e1rm) foot.append(el('span', { text: `record ≈ ${e.best.e1rm} kg (1RM)` }));
    const tip = tipFor(e); if (tip) foot.append(el('span', { class: 'tip', text: tip }));
    return el('div', { class: `exo${current ? ' current' : ''}`, id: `x-${e.id}` }, head, sets, foot);
  }
  function renderDock() {
    const s = state.session;
    $('#dock').hidden = !s;
    if (!s) { clearInterval(clockTimer); clockTimer = null; return; }
    $('#dockDone').textContent = Object.values(s.results).flat().filter(r => r.done === true).length;
    if (!clockTimer) clockTimer = setInterval(tickClock, 1000);
    tickClock();
  }
  function tickClock() {
    if (!state.session) return;
    const sec = Math.floor((Date.now() - state.session.startedAt) / 1000);
    $('#dockTime').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  /* ---------- feuilles ---------- */
  function openSheet(...kids) {
    const veil = el('div', { class: 'veil', onclick: (ev) => { if (ev.target === veil) closeSheet(); } }, el('div', { class: 'sheet', role: 'dialog' }, ...kids));
    $('#overlay').replaceChildren(veil);
  }
  const closeSheet = () => $('#overlay').replaceChildren();
  const chargeOptions = (e, cur) => {
    const base = typeof cur === 'number' ? cur : 0;
    const vals = new Set(['PDC']);
    for (let k = -12; k <= 12; k++) { const v = round1(base + k * e.step); if (v >= 0) vals.add(v); }
    if (typeof cur === 'number') vals.add(cur);
    return [...vals].sort((a, b) => a === 'PDC' ? -1 : b === 'PDC' ? 1 : a - b);
  };
  const repOptions = (e) => isTemps(e) ? Array.from({ length: 35 }, (_, i) => 10 + i * 5) : Array.from({ length: 30 }, (_, i) => i + 1);
  const selectEl = (id, opts, cur, fmt) => {
    const s = el('select', { id });
    for (const o of opts) { const op = el('option', { value: String(o), text: fmt(o) }); if (String(o) === String(cur)) op.selected = true; s.append(op); }
    return s;
  };
  const parseCharge = (v) => v === 'PDC' ? 'PDC' : Number(v);

  function openSet(exoId, i) {
    const e = state.exos.find(x => x.id === exoId);
    const t = e.sets[i];
    const inS = !!state.session;
    const r = inS ? state.session.results[exoId][i] : null;
    const cur = r && r.done ? r : t;
    const selC = selectEl('fC', chargeOptions(e, cur.charge), cur.charge, (o) => o === 'PDC' ? 'Poids du corps' : `${o} kg`);
    const selR = selectEl('fR', repOptions(e), cur.reps, (o) => isTemps(e) ? `${o} s` : `${o} reps`);
    const fields = el('div', { class: 'fields' },
      isTemps(e) ? el('div') : el('div', { class: 'field' }, el('label', { for: 'fC', text: 'Charge' }), selC),
      el('div', { class: 'field' }, el('label', { for: 'fR', text: isTemps(e) ? 'Durée' : 'Reps' }), selR));
    const read = () => ({ charge: isTemps(e) ? 'PDC' : parseCharge(selC.value), reps: Number(selR.value) });
    const actions = el('div', { class: 'actions' });
    if (inS) {
      actions.append(
        el('button', { class: 'btn good big', type: 'button', text: `✓ Réussie (${fmtReps(e, t.reps)}${isTemps(e) ? '' : ' à ' + fmtKg(t.charge)})`, onclick: () => logSet(exoId, i, { ...t, done: true }) }),
        el('button', { class: 'btn primary', type: 'button', text: 'Valider ces valeurs', onclick: () => logSet(exoId, i, { ...read(), done: true }) }),
        el('button', { class: 'btn ghost', type: 'button', text: 'Pas faite', onclick: () => logSet(exoId, i, { ...t, done: false }) }),
      );
    } else {
      actions.append(
        el('button', { class: 'btn primary big', type: 'button', text: 'Enregistrer la cible', onclick: () => { commit(updExo(exoId, x => ({ ...x, sets: x.sets.map((s, k) => k === i ? read() : s) }))); closeSheet(); } }),
        el('button', { class: 'btn', type: 'button', text: 'Appliquer à toutes les séries', onclick: () => { const v = read(); commit(updExo(exoId, x => ({ ...x, sets: x.sets.map(() => ({ ...v })) }))); closeSheet(); } }),
      );
    }
    openSheet(
      el('h3', { text: `${e.name} — série ${i + 1}` }),
      el('div', { class: 'sub', text: inS ? `Cible : ${fmtReps(e, t.reps)}${isTemps(e) ? '' : ' à ' + fmtKg(t.charge)} · ${e.last?.[i]?.done ? 'dernière fois ' + fmtReps(e, e.last[i].reps) : 'pas d’historique'}` : `Cible pour la prochaine séance · palier à ${fmtReps(e, e.repMax)}` }),
      fields, actions);
  }
  function logSet(exoId, i, r) {
    const results = { ...state.session.results, [exoId]: state.session.results[exoId].map((x, k) => k === i ? r : x) };
    commit({ ...state, session: { ...state.session, results } });
    closeSheet();
    document.getElementById(`s-${exoId}-${i}`)?.classList.add('pop');
    if (r.done) startRest();
  }
  function openMenu(exoId) {
    const e = state.exos.find(x => x.id === exoId);
    const idx = state.exos.indexOf(e);
    const upd = (fn) => { commit(updExo(exoId, fn)); closeSheet(); };
    const selMin = selectEl('mMin', isTemps(e) ? [10, 15, 20, 30, 45, 60] : [5, 6, 8, 10, 12], e.repMin, (o) => isTemps(e) ? `${o} s` : `${o} reps`);
    const selMax = selectEl('mMax', isTemps(e) ? [45, 60, 90, 120, 180] : [10, 12, 15, 20], e.repMax, (o) => isTemps(e) ? `${o} s` : `${o} reps`);
    const selStep = selectEl('mStep', [0.5, 1, 2, 2.5, 5, 10], e.step, (o) => `+${o} kg`);
    const selMode = selectEl('mMode', ['reps', 'temps'], e.mode, (o) => o === 'reps' ? 'Répétitions' : 'Temps (secondes)');
    openSheet(
      el('h3', { text: e.name }),
      el('div', { class: 'sub', text: 'Réglages de progression' }),
      el('div', { class: 'fields' },
        el('div', { class: 'field' }, el('label', { for: 'mMin', text: 'Reps de départ (après palier)' }), selMin),
        el('div', { class: 'field' }, el('label', { for: 'mMax', text: 'Reps du palier' }), selMax),
        el('div', { class: 'field' }, el('label', { for: 'mStep', text: 'Cran de charge' }), selStep),
        el('div', { class: 'field' }, el('label', { for: 'mMode', text: 'Type' }), selMode)),
      el('div', { class: 'menu' },
        el('button', { class: 'btn primary', type: 'button', text: 'Enregistrer les réglages', onclick: () => upd(x => ({ ...x, repMin: Number(selMin.value), repMax: Math.max(Number(selMin.value) + 1, Number(selMax.value)), step: Number(selStep.value), mode: selMode.value })) }),
        el('div', { class: 'row2' },
          el('button', { class: 'btn', type: 'button', text: '+ une série', onclick: () => upd(x => ({ ...x, sets: [...x.sets, { ...(x.sets.at(-1) || { charge: 'PDC', reps: x.repMin }) }] })) }),
          el('button', { class: 'btn', type: 'button', text: '− dernière série', onclick: () => upd(x => ({ ...x, sets: x.sets.slice(0, -1) })) })),
        el('div', { class: 'row2' },
          el('button', { class: 'btn', type: 'button', text: '↑ Monter', onclick: () => moveExo(idx, -1) }),
          el('button', { class: 'btn', type: 'button', text: '↓ Descendre', onclick: () => moveExo(idx, 1) })),
        el('button', { class: 'btn ghost', type: 'button', text: 'Supprimer cet exercice', onclick: () => { if (confirm(`Supprimer « ${e.name} » ?`)) { commit({ ...state, exos: state.exos.filter(x => x.id !== exoId) }); closeSheet(); } } }),
      ));
  }
  function moveExo(i, d) {
    const j = i + d; if (j < 0 || j >= state.exos.length) return;
    const exos = [...state.exos]; [exos[i], exos[j]] = [exos[j], exos[i]];
    commit({ ...state, exos }); closeSheet();
  }
  function renameExo(id, text) {
    const name = text.trim(); const e = state.exos.find(x => x.id === id);
    if (!name || name === e.name) { render(); return; }
    commit(updExo(id, x => ({ ...x, name })));
  }
  $('#addExo').addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    const name = ev.target.value.trim(); if (!name) return;
    ev.target.value = '';
    commit({ ...state, exos: [...state.exos, mkExo(name, [{ charge: 10, reps: 10 }, { charge: 10, reps: 10 }, { charge: 10, reps: 10 }])] });
    $('#addExo').focus();
  });

  /* ---------- séance : démarrer / repos / terminer ---------- */
  $('#btnStart').addEventListener('click', () => {
    if (state.session) return;
    const results = Object.fromEntries(state.exos.map(e => [e.id, e.sets.map(t => ({ charge: t.charge, reps: t.reps, done: null }))]));
    commit({ ...state, session: { startedAt: Date.now(), results } });
    window.scrollTo({ top: $('#exos').offsetTop - 60, behavior: 'smooth' });
  });
  $('#btnCancel').addEventListener('click', () => { if (confirm('Annuler la séance en cours ? Rien ne sera enregistré.')) { stopRest(); commit({ ...state, session: null }); } });
  $('#btnFinish').addEventListener('click', () => {
    const any = Object.values(state.session.results).flat().some(r => r.done !== null);
    if (!any) { alert('Valide au moins une série avant de terminer (ou annule la séance).'); return; }
    finishSession();
  });
  function startRest() {
    stopRest();
    restEnd = Date.now() + state.settings.rest * 1000;
    $('#rest').hidden = false;
    restTimer = setInterval(() => {
      const left = Math.max(0, Math.ceil((restEnd - Date.now()) / 1000));
      $('#restTxt').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      $('#rest').querySelector('.ring').style.setProperty('--p', `${100 - Math.round((left / state.settings.rest) * 100)}%`);
      if (left <= 0) { stopRest(); $('#restTxt').textContent = 'Go !'; $('#rest').hidden = false; try { navigator.vibrate?.([200, 100, 200]); } catch {} setTimeout(() => { if (!restTimer) $('#rest').hidden = true; }, 4000); }
    }, 250);
  }
  function stopRest() { clearInterval(restTimer); restTimer = null; $('#rest').hidden = true; }
  $('#rest').addEventListener('click', stopRest);

  function finishSession() {
    stopRest();
    const s = state.session, date = today();
    let xp = XP.session, setsDone = 0, setsTotal = 0, fails = 0, volume = 0;
    const prs = [], paliers = [], changes = [], exosLog = {};
    const exos = state.exos.map(e => {
      const raw = s.results[e.id] || [];
      if (!raw.some(r => r.done !== null)) return e;   // exercice non touché : réservé à une autre séance, on n'y touche pas
      const res = raw.map(r => r.done === null ? { ...r, done: false } : r);
      const next = e.sets.map((t, i) => nextTarget(e, t, res[i]));
      let best = e.best, progressed = false;
      res.forEach((r, i) => {
        setsTotal++;
        if (!r.done) return;
        setsDone++; xp += XP.set;
        const t = e.sets[i];
        if (r.reps >= t.reps) xp += XP.hit; else fails++;
        if (r.reps > t.reps) xp += XP.beat;
        if (next[i].up) { xp += XP.palier; if (!paliers.includes(e.name)) paliers.push(e.name); }
        if (typeof r.charge === 'number') volume += r.charge * r.reps;
        const v = e1rm(r.charge, r.reps);
        if (v && (!best || v > best.e1rm)) { best = { e1rm: v, charge: r.charge, reps: r.reps, date }; if (!prs.includes(e.name)) prs.push(e.name); }
        if (next[i].reps !== t.reps || next[i].charge !== t.charge) progressed = true;
      });
      if (prs.includes(e.name)) xp += XP.pr;
      const before = e.sets.map(t => `${t.reps}${isTemps(e) ? 's' : '×' + fmtKg(t.charge)}`).join(' · ');
      const after = next.map(t => `${t.reps}${isTemps(e) ? 's' : '×' + fmtKg(t.charge)}`).join(' · ');
      if (before !== after) changes.push({ name: e.name, before, after, up: next.some(n => n.up) });
      exosLog[e.id] = { name: e.name, sets: res };
      const done = res.some(r => r.done);
      return { ...e, sets: next.map(({ up, ...t }) => t), last: res, best, stalled: done ? (progressed ? 0 : e.stalled + 1) : e.stalled };
    });
    const streak = streakWeeks({ history: [...state.history, { date }] });
    xp += Math.min(XP.streakMax, XP.streakPerWeek * Math.max(0, streak - 1));
    const entry = { date, at: Date.now(), min: Math.round((Date.now() - s.startedAt) / 60000), volume: Math.round(volume), xp, setsDone, setsTotal, fails, prs, paliers, exos: exosLog };
    const lvlBefore = level(state.xp);
    const nextState = { ...state, exos, session: null, xp: state.xp + xp, history: [...state.history, entry].slice(-HISTORY_MAX) };
    commit(nextState);
    showSummary(entry, changes, lvlBefore, level(nextState.xp), streak);
    confetti();
  }
  function showSummary(h, changes, l0, l1, streak) {
    const list = el('ul', { class: 'list' });
    if (l1 > l0) list.append(el('li', { class: 'gold', html: `🎉 <b>Niveau ${l1} — ${titleFor(l1)}</b><small>Tu passes un cap.</small>` }));
    for (const n of h.paliers) list.append(el('li', { class: 'gold', html: `⬆️ <b>Palier franchi</b> — ${n}<small>Charge augmentée pour la prochaine fois.</small>` }));
    for (const n of h.prs) list.append(el('li', { class: 'gold', html: `🏆 <b>Nouveau record</b> — ${n}` }));
    for (const c of changes) list.append(el('li', { class: c.up ? 'gold' : 'good', html: `<b>${c.name}</b><small>${c.before} → <b>${c.after}</b></small>` }));
    if (!changes.length) list.append(el('li', { text: 'Aucune cible n’a bougé — la prochaine fois, vise +1 rep sur une série.' }));
    openSheet(el('div', { class: 'summary' },
      el('h3', { text: 'Séance terminée 💪' }),
      el('div', { class: 'sub', text: `${h.setsDone}/${h.setsTotal} séries · ${h.min} min · ${(h.volume / 1000).toFixed(1)} t soulevées · 🔥 ${streak} sem. d’affilée` }),
      el('div', { class: 'xp-big', text: `+${h.xp} XP` }),
      list,
      el('div', { class: 'actions', style: 'margin-top:14px' }, el('button', { class: 'btn primary big', type: 'button', text: 'Super', onclick: closeSheet }))));
  }
  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = el('canvas', { class: 'confetti' }); document.body.append(c);
    const ctx = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
    const cols = ['#2383E2', '#6940A5', '#C9A227', '#448361', '#D44C47'];
    const ps = Array.from({ length: 140 }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * .5, vx: (Math.random() - .5) * 3, vy: 2 + Math.random() * 4, r: 4 + Math.random() * 5, a: Math.random() * 6, col: cols[Math.floor(Math.random() * cols.length)] }));
    const t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const p of ps) { p.x += p.vx; p.y += p.vy; p.a += .1; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.col; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * .6); ctx.restore(); }
      if (t - t0 < 2600) requestAnimationFrame(frame); else c.remove();
    })(t0);
  }

  /* ---------- stats ---------- */
  function renderStats() {
    const v = $('#viewStats'); v.replaceChildren();
    const H = state.history;
    const week = H.filter(h => weekKey(h.date) === weekKey(today())).length;
    const last = H.at(-1), prev = H.at(-2);
    v.append(el('div', { class: 'tiles' },
      tile('Séances', H.length, ''),
      tile('Cette semaine', week, ''),
      tile('Semaines d’affilée', streakWeeks(state), '🔥'),
      tile('Dernier volume', last ? (last.volume / 1000).toFixed(1) : '—', last ? `t${prev ? (last.volume >= prev.volume ? ' ▲' : ' ▼') : ''}` : ''),
    ));
    if (!H.length) { v.append(el('div', { class: 'empty', text: 'Termine ta première séance pour débloquer les statistiques, les tendances et les axes d’amélioration.' })); v.append(badgesBlock()); return; }
    v.append(el('h2', { class: 'sec', text: 'Volume par séance (kg soulevés)' }), volumeChart(H.slice(-12)));
    v.append(el('h2', { class: 'sec', text: 'Tendance par exercice (1RM estimé)' }));
    for (const e of state.exos) v.append(statRow(e));
    v.append(el('h2', { class: 'sec', text: 'Axes d’amélioration' }), axesBlock());
    v.append(badgesBlock());
  }
  const tile = (k, val, unit) => el('div', { class: 'tile' }, el('div', { class: 'k', text: k }), el('div', { class: 'v', html: `${val}<small>${unit}</small>` }));
  function volumeChart(H) {
    const W = 600, Hh = 160, pad = 24, max = Math.max(...H.map(h => h.volume), 1);
    const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${Hh}` });
    for (let g = 0; g <= 3; g++) { const y = pad + (Hh - 2 * pad) * g / 3; svg.append(svgEl('line', { class: 'grid', x1: 0, x2: W, y1: y, y2: y })); const t = svgEl('text', { x: 0, y: y - 3 }); t.textContent = `${Math.round(max * (1 - g / 3) / 100) / 10} t`; svg.append(t); }
    const bw = Math.min(64, (W - 40) / H.length);
    H.forEach((h, i) => {
      const bh = (Hh - 2 * pad) * h.volume / max, x = 40 + i * bw + bw * .15;
      svg.append(svgEl('rect', { class: `b${i === H.length - 1 ? ' last' : ''}`, x, y: Hh - pad - bh, width: bw * .7, height: bh, rx: 3 }));
      const t = svgEl('text', { x: x + bw * .35, y: Hh - 6, 'text-anchor': 'middle' }); t.textContent = fmtDate(h.date); svg.append(t);
    });
    return svg;
  }
  function statRow(e) {
    const vals = state.history.slice(-10).map(h => { const r = h.exos[e.id]?.sets.filter(x => x.done) || []; return r.length ? Math.max(...r.map(x => isTemps(e) ? x.reps : (e1rm(x.charge, x.reps) ?? x.reps))) : null; }).filter(x => x !== null);
    const spark = svgEl('svg', { class: 'spark', viewBox: '0 0 100 22', preserveAspectRatio: 'none' });
    if (vals.length >= 2) {
      const lo = Math.min(...vals), hi = Math.max(...vals), sp = hi - lo || 1;
      const pts = vals.map((v, i) => [i * 100 / (vals.length - 1), 19 - (v - lo) / sp * 16]);
      spark.append(svgEl('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') }));
      spark.append(svgEl('circle', { cx: pts.at(-1)[0], cy: pts.at(-1)[1], r: 2.2 }));
    }
    const d = vals.length >= 2 ? Math.round((vals.at(-1) - vals[0]) / vals[0] * 100) : null;
    const charge = isTemps(e) ? `${Math.max(...e.sets.map(s => s.reps))} s` : fmtKg(e.sets.reduce((m, s) => typeof s.charge === 'number' && s.charge > (typeof m === 'number' ? m : -1) ? s.charge : m, 'PDC'));
    return el('div', { class: 'stat-row' }, el('span', { class: 'n', text: e.name }), el('span', { class: 'tnum', text: charge }), spark,
      el('span', { class: `trend ${d === null ? 'flat' : d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}`, text: d === null ? '·' : `${d > 0 ? '+' : ''}${d} %` }));
  }
  function axesBlock() {
    const out = el('div', { class: 'axes' });
    const last = state.history.at(-1);
    const gap = daysBetween(last.date, today());
    if (gap >= 7) out.append(ax('warn', `Dernière séance il y a ${gap} jours`, 'La régularité pèse plus que l’intensité : cale une séance cette semaine pour garder la série.'));
    for (const e of state.exos) {
      if (e.stalled >= 2) out.append(ax('warn', `${e.name} stagne depuis ${e.stalled} séances`, `Essaie −${e.step} kg avec ${e.repMax} reps propres, puis remonte. Ou place-le plus tôt dans la séance.`));
      const p = exoProgress(e);
      if (!isTemps(e) && p >= .75 && e.stalled < 2) out.append(ax('good', `${e.name} : palier proche`, `Tu es à ${Math.round((1 - p) * (e.repMax - e.repMin))} rep en moyenne du passage à +${e.step} kg.`));
      const skipped = e.last ? e.last.filter(r => !r.done).length : 0;
      if (skipped) out.append(ax('', `${e.name} : ${skipped} série${skipped > 1 ? 's' : ''} sautée${skipped > 1 ? 's' : ''} la dernière fois`, 'Si c’est récurrent, réduis d’une série plutôt que de sauter — la cible reste atteignable.'));
    }
    if (last.fails >= 3) out.append(ax('warn', `${last.fails} séries ratées à la dernière séance`, 'Normal après une montée de charge. Si ça se répète 2 fois, garde la charge et vise 1 rep de plus par séance.'));
    if (!out.children.length) out.append(ax('good', 'Tout progresse', 'Continue comme ça : +1 rep par série, et la charge suit toute seule.'));
    return out;
  }
  const ax = (cls, t, s) => el('div', { class: `ax ${cls}` }, el('b', { text: t }), el('small', { text: s }));
  function badgesBlock() {
    const wrap = el('div');
    wrap.append(el('h2', { class: 'sec', text: 'Badges' }));
    const g = el('div', { class: 'badges' });
    for (const b of BADGES) { const ok = b.t(state); g.append(el('div', { class: `badge${ok ? '' : ' locked'}`, title: ok ? 'Débloqué' : 'À débloquer' }, el('div', { class: 'e', text: b.e }), el('div', { text: b.n }))); }
    wrap.append(g);
    return wrap;
  }
  $('#tabSeance').addEventListener('click', () => { tab = 'seance'; render(); });
  $('#tabStats').addEventListener('click', () => { tab = 'stats'; render(); });

  /* ---------- export / import (filet de sécurité) ---------- */
  $('#btnExport').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' }));
    const a = el('a', { href: url, download: `carnet-muscu-${today()}.json` }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  $('#fileImport').addEventListener('change', async (ev) => {
    const f = ev.target.files?.[0]; ev.target.value = '';
    if (!f) return;
    try {
      const data = migrate(JSON.parse(await f.text()));
      if (!data || !Array.isArray(data.exos)) throw new Error('format inattendu');
      if (!confirm(`Remplacer le carnet actuel par « ${f.name} » (${data.exos.length} exercices, ${data.history.length} séances) ?`)) return;
      commit(data);
    } catch (err) { alert(`Fichier illisible : ${err.message || err}`); }
  });

  /* ---------- démarrage ---------- */
  const setStatus = (st, label, hint = '') => { const n = $('#status'); n.dataset.state = st; n.textContent = label; $('#hint').textContent = hint; };
  async function boot() {
    state = migrate(readCache()) || seed();
    render();
    if (!Sync.enabled()) {
      setStatus('off', 'Google Sheets non branché — données gardées dans ce navigateur seulement', 'Renseigne SHEETS_URL dans config.js (voir README).');
      return;
    }
    Sync.onStatus(setStatus);
    let remote;
    try { remote = migrate(await Sync.load()); }
    catch (err) { setStatus('err', navigator.onLine ? 'Impossible de lire Google Sheets — données locales affichées' : 'Hors-ligne — données locales affichées', navigator.onLine ? String(err.message || err) : ''); if (Sync.hasOutbox()) Sync.scheduleSave(state, 5000); return; }
    if (remote && remote.rev > state.rev) { state = remote; writeCache(state); render(); setStatus('ok', 'Synchronisé avec Google Sheets'); }
    else if (state.rev > (remote?.rev ?? 0) || (Sync.hasOutbox() && state.rev)) Sync.scheduleSave(state, 0);
    else setStatus('ok', remote ? 'Synchronisé avec Google Sheets' : 'Google Sheets prêt — ajoute un exercice');
  }
  boot();
})();
