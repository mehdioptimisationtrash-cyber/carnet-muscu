(() => {
  'use strict';
  const CACHE_KEY = 'carnet-muscu-v2';
  const HISTORY_MAX = 120;
  const WEIGHTS_MAX = 400;
  const LIGHT_FACTOR = 0.9;          // séance légère : charges × 0,9
  const XP = { set: 10, hit: 5, beat: 5, challenge: 10, palier: 40, pr: 30, session: 50, streakPerWeek: 10, streakMax: 50, light: 0.5 };
  const TITLES = ['Rookie', 'Régulier', 'Solide', 'Costaud', 'Machine', 'Bête de salle', 'Légende'];
  const BADGES = [
    { id: 'first', e: '🎯', n: 'Première séance', t: (s) => s.history.length >= 1 },
    { id: 's5', e: '🔥', n: '5 séances', t: (s) => s.history.length >= 5 },
    { id: 's10', e: '💎', n: '10 séances', t: (s) => s.history.length >= 10 },
    { id: 's25', e: '👑', n: '25 séances', t: (s) => s.history.length >= 25 },
    { id: 'palier', e: '⬆️', n: 'Premier palier', t: (s) => s.history.some(h => h.paliers.length) },
    { id: 'pr', e: '🏆', n: 'Premier record', t: (s) => s.history.some(h => h.prs.length) },
    { id: 'chal5', e: '⚡', n: '5 défis en une séance', t: (s) => s.history.some(h => (h.challenges?.won || 0) >= 5) },
    { id: 'streak3', e: '📅', n: '3 semaines d’affilée', t: (s) => streakWeeks(s) >= 3 },
    { id: 'streak8', e: '🗓️', n: '8 semaines d’affilée', t: (s) => streakWeeks(s) >= 8 },
    { id: 'full', e: '✅', n: 'Séance 100 % réussie', t: (s) => s.history.some(h => h.setsDone > 0 && h.setsDone === h.setsTotal && h.fails === 0 && !h.light) },
    { id: 'ton10', e: '🚚', n: '10 tonnes en une séance', t: (s) => s.history.some(h => h.volume >= 10000) },
    { id: 'weight', e: '⚖️', n: '14 jours de pesée', t: (s) => (s.weights || []).length >= 14 },
  ];

  /* ---------- utilitaires ---------- */
  const uid = () => Math.random().toString(36).slice(2, 9);
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '—';
  const round1 = (x) => Math.round(x * 2) / 2;
  const roundStep = (x, step) => round1(Math.round(x / step) * step);
  const fmtKg = (c) => c === 'PDC' ? 'PDC' : `${c} kg`;
  const isTemps = (e) => e.mode === 'temps';
  const fmtReps = (e, r) => isTemps(e) ? `${r} s` : `${r}`;
  const e1rm = (c, r) => typeof c === 'number' && c > 0 ? Math.round(c * (1 + r / 30) * 10) / 10 : null;
  const weekKey = (iso) => { const d = new Date(iso + 'T12:00:00'); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d.toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
  const plural = (n, s) => `${n} ${s}${n > 1 ? 's' : ''}`;
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

  const defaultSettings = () => ({ rest: 90, weeklyGoal: 3, autoDeload: true });
  const mkExo = (name, sets, opts = {}) => ({ id: uid(), name, mode: 'reps', step: 2, repMin: 8, repMax: 15, sets, last: null, best: null, stalled: 0, ...opts });
  const seed = () => ({ v: 2, rev: 0, xp: 0, settings: defaultSettings(), exos: [], session: null, history: [], weights: [] });
  const migrate = (d) => {
    if (!d || typeof d !== 'object') return null;
    if (d.v === 2) return { ...seed(), ...d, settings: { ...defaultSettings(), ...(d.settings || {}) }, history: Array.isArray(d.history) ? d.history : [], weights: Array.isArray(d.weights) ? d.weights : [] };
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
  const targetsOf = (e) => (state.session?.targets?.[e.id]) || e.sets;

  /* ---------- crans de charge : pile de plaques (machine) ou pas fixe (haltères) ---------- */
  const hasStack = (e) => Array.isArray(e.stack) && e.stack.length > 1;
  const nextCharge = (e, c) => typeof c !== 'number' ? null : hasStack(e) ? (e.stack.find(v => v > c + 0.01) ?? null) : round1(c + e.step);
  const prevCharge = (e, c) => typeof c !== 'number' ? null : hasStack(e) ? ([...e.stack].reverse().find(v => v < c - 0.01) ?? null) : (c - e.step >= 0 ? round1(c - e.step) : null);
  const upLabel = (e, c) => { const n = nextCharge(e, c); return n === null ? 'haut de la pile' : `+${round1(n - c)} kg`; };
  const downLabel = (e) => hasStack(e) ? 'une plaque' : `${e.step} kg`;
  // ramène une charge à la plaque réelle la plus proche (utile quand on vient de saisir la pile)
  const snapToStack = (e, c) => (hasStack(e) && typeof c === 'number') ? e.stack.reduce((best, v) => Math.abs(v - c) < Math.abs(best - c) ? v : best, e.stack[0]) : c;
  // « 9, 16, 23 » ou « 12,5 » (virgule décimale = un seul chiffre après, collé)
  const parseStack = (txt) => [...new Set(String(txt).replace(/(\d),(\d)(?!\d)/g, '$1.$2').split(/[^\d.]+/).map(Number).filter(v => v > 0 && v < 1000))].sort((a, b) => a - b);

  /* ---------- progression, défis & gamification ---------- */
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

  // Un défi = une série qui demande plus que ce qui a été fait la dernière fois (ou un défi raté à retenter).
  function challengesOf(e, targets = e.sets) {
    if (!e.last) return [];
    const out = [];
    targets.forEach((t, i) => {
      const l = e.last[i];
      if (!l || !l.done) return;
      if (typeof t.charge === 'number' && typeof l.charge === 'number' && t.charge > l.charge) out.push({ i, kind: 'charge', delta: round1(t.charge - l.charge) });
      else if (t.reps > l.reps && !(typeof t.charge === 'number' && typeof l.charge === 'number' && t.charge < l.charge)) out.push({ i, kind: 'reps', delta: t.reps - l.reps });
    });
    return out;
  }
  const challengeText = (e, cs) => cs.map(c => `S${c.i + 1} +${c.kind === 'charge' ? c.delta + ' kg' : plural(c.delta, isTemps(e) ? 's' : 'rep').replace(/^(\d+) s(s)?$/, '$1 s')}`).join(' · ');
  const allChallenges = () => state.exos.map(e => ({ e, cs: challengesOf(e) })).filter(x => x.cs.length);
  const potentialXp = () => XP.session + state.exos.reduce((a, e) => a + e.sets.length * (XP.set + XP.hit), 0) + allChallenges().reduce((a, x) => a + x.cs.length * XP.challenge, 0);

  function nextTarget(e, target, r) {
    const base = { charge: target.charge, reps: target.reps, fails: target.fails || 0 };
    if (!r || r.done !== true) return base;                                   // pas faite : on retente
    if (isTemps(e)) return r.reps >= target.reps ? { charge: 'PDC', reps: Math.min(r.reps + 5, e.repMax), fails: 0 } : { ...base, fails: base.fails + 1 };
    if (r.reps < target.reps) {                                                // ratée
      const fails = base.fails + 1;
      const down = prevCharge(e, r.charge);
      if (state.settings.autoDeload && fails >= 2 && down !== null) return { charge: down, reps: target.reps, fails: 0, deload: true };
      return { charge: r.charge, reps: target.reps, fails };
    }
    const up = nextCharge(e, r.charge);
    if (r.reps >= e.repMax && up !== null) return { charge: up, reps: e.repMin, fails: 0, up: true }; // palier : plaque suivante
    return { charge: r.charge, reps: Math.min(r.reps + 1, e.repMax), fails: 0 };
  }
  function tipFor(e) {
    const cs = challengesOf(e);
    if (cs.length) return `Défi : ${challengeText(e, cs)}`;
    if (isTemps(e)) return `Tiens ${e.repMax} s pour valider le palier`;
    if (e.sets.some(s => (s.fails || 0) >= 1)) return 'Défi raté la dernière fois — même cible, on retente';
    if (e.sets.every(s => s.charge === 'PDC') && e.sets.every(s => s.reps >= e.repMax)) return 'Au max en poids du corps : ajoute du lest ou une série';
    if (hasStack(e) && e.sets.some(s => typeof s.charge === 'number' && nextCharge(e, s.charge) === null && s.reps >= e.repMax)) return 'Haut de la pile : monte le palier à 20 reps ou ajoute une série';
    if (e.stalled >= 2) return `Stagne depuis ${e.stalled} séances — essaie ${downLabel(e)} de moins et remonte`;
    if (!e.last) return 'Première fois : fixe ta base, le défi arrive la fois suivante';
    return 'Réussis tout → +1 rep sur chaque série la prochaine fois';
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
  const weekCount = () => state.history.filter(h => weekKey(h.date) === weekKey(today())).length;
  function renderHeader() {
    const lvl = level(state.xp), lo = xpForLevel(lvl), hi = xpForLevel(lvl + 1);
    $('#lvlNum').textContent = lvl;
    $('#lvlTitle').textContent = titleFor(lvl);
    $('#lvlNext').textContent = `${hi - state.xp} XP avant le niveau ${lvl + 1}`;
    $('#xpNow').textContent = state.xp;
    $('#xpBar').style.width = `${Math.round(((state.xp - lo) / (hi - lo)) * 100)}%`;
    const last = state.history.at(-1);
    $('#sub').textContent = last ? `${plural(state.history.length, 'séance')} · dernière le ${fmtDate(last.date)}` : 'Aucune séance enregistrée — c’est le moment.';
    const streak = streakWeeks(state);
    const prs = state.history.reduce((a, h) => a + h.prs.length, 0);
    const paliers = state.history.reduce((a, h) => a + h.paliers.length, 0);
    const week = weekCount(), goal = state.settings.weeklyGoal;
    $('#chipsTop').replaceChildren(
      el('span', { class: `chip${week >= goal ? ' fire' : ''}`, html: `📅 <b>${week}/${goal}</b> cette semaine` }),
      el('span', { class: `chip${streak ? ' fire' : ''}`, html: `🔥 <b>${streak}</b> sem. d’affilée` }),
      el('span', { class: `chip${paliers ? ' gold' : ''}`, html: `⬆️ <b>${paliers}</b> palier${paliers > 1 ? 's' : ''}` }),
      el('span', { class: `chip${prs ? ' gold' : ''}`, html: `🏆 <b>${prs}</b> record${prs > 1 ? 's' : ''}` }),
    );
  }
  function renderSeance() {
    const inS = !!state.session;
    const chal = allChallenges();
    const nChal = chal.reduce((a, x) => a + x.cs.length, 0);
    $('#sessionTitle').textContent = inS ? (state.session.light ? 'Séance légère en cours' : 'Séance en cours') : 'Prochaine séance';
    if (inS) $('#sessionMeta').textContent = state.session.light ? 'Charges −10 %, aucun défi : on maintient.' : 'Touche une série pour la valider ou l’ajuster';
    else if (!state.exos.length) $('#sessionMeta').textContent = 'Ajoute ton premier exercice ci-dessous.';
    else {
      const reps = chal.reduce((a, x) => a + x.cs.filter(c => c.kind === 'reps').length, 0), ch = nChal - reps;
      $('#sessionMeta').textContent = nChal ? `⚡ ${plural(nChal, 'défi')} aujourd’hui : ${[reps && `+1 rep ×${reps}`, ch && `+charge ×${ch}`].filter(Boolean).join(', ')} · jusqu’à +${potentialXp()} XP` : `${plural(state.exos.length, 'exercice')} · réussis tout pour débloquer les défis`;
    }
    $('#btnStart').hidden = inS || !state.exos.length;
    $('#btnStart').textContent = nChal ? `Relever ${plural(nChal, 'défi')}` : 'Démarrer la séance';
    const root = $('#exos');
    root.replaceChildren();
    const currentId = inS ? state.exos.find(e => (state.session.results[e.id] || []).some(r => r.done === null))?.id : null;
    for (const e of state.exos) root.append(exoCard(e, inS, e.id === currentId));
  }
  function exoCard(e, inS, current) {
    const res = inS ? (state.session.results[e.id] || []) : [];
    const T = targetsOf(e);
    const chalIdx = new Set((inS && state.session.light) ? [] : challengesOf(e, T).map(c => c.i));
    const charges = [...new Set(T.map(s => fmtKg(s.charge)))].join(' / ');
    const head = el('div', { class: 'exo-head' },
      el('div', { class: 'exo-name', contenteditable: 'true', spellcheck: 'false', id: `n-${e.id}`, text: e.name,
        onblur: (ev) => renameExo(e.id, ev.target.textContent), onkeydown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); } } }),
      el('span', { class: 'exo-charge', text: isTemps(e) ? 'temps' : charges }),
      el('button', { class: 'exo-menu', type: 'button', 'aria-label': 'Options', text: '⋯', onclick: () => openMenu(e.id) }),
    );
    const sets = el('div', { class: 'sets' });
    T.forEach((t, i) => {
      const r = res[i];
      let cls = 'set', shown = t, label = '';
      if (inS) {
        if (!r || r.done === null) cls += ' pending';
        else if (r.done === false) { cls += ' skip'; label = 'sautée'; }
        else { shown = r; cls += r.reps < t.reps ? ' fail' : r.reps > t.reps ? ' beat' : ' done'; if (!isTemps(e) && r.charge !== 'PDC' && r.reps >= e.repMax) cls += ' up'; }
      }
      const isChal = chalIdx.has(i) && (!inS || !r || r.done === null);
      sets.append(el('button', { class: cls + (isChal ? ' chal' : ''), type: 'button', id: `s-${e.id}-${i}`, onclick: () => openSet(e.id, i) },
        ...(isChal ? [el('span', { class: 'zap', text: '⚡' })] : []),
        el('span', { class: 'reps', html: `${shown.reps}<small>${isTemps(e) ? ' s' : (inS && r?.done ? `/${t.reps}` : '')}</small>` }),
        el('span', { class: 'ch', text: label || (isTemps(e) ? `série ${i + 1}` : fmtKg(shown.charge)) })));
    });
    const foot = el('div', { class: 'exo-foot' });
    if (e.last) foot.append(el('span', { class: 'last', text: `dernière fois : ${e.last.map(r => r.done ? fmtReps(e, r.reps) : '–').join(' · ')}` }));
    if (!isTemps(e)) foot.append(el('span', { class: 'pbar', title: 'Progression vers le prochain palier' }, el('i', { style: `width:${Math.round(exoProgress(e) * 100)}%` })));
    if (e.best?.e1rm) foot.append(el('span', { text: `record ≈ ${e.best.e1rm} kg (1RM)` }));
    const tip = tipFor(e); if (tip) foot.append(el('span', { class: `tip${chalIdx.size ? ' strong' : ''}`, text: tip }));
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
    const vals = new Set(['PDC']);
    if (hasStack(e)) e.stack.forEach(v => vals.add(v));
    else { const base = typeof cur === 'number' ? cur : 0; for (let k = -12; k <= 12; k++) { const v = round1(base + k * e.step); if (v >= 0) vals.add(v); } }
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
    const T = targetsOf(e), t = T[i];
    const inS = !!state.session;
    const r = inS ? state.session.results[exoId][i] : null;
    const cur = r && r.done ? r : t;
    const chal = !inS || !state.session.light ? challengesOf(e, T).find(c => c.i === i) : null;
    const selC = selectEl('fC', chargeOptions(e, cur.charge), cur.charge, (o) => o === 'PDC' ? 'Poids du corps' : `${o} kg`);
    const selR = selectEl('fR', repOptions(e), cur.reps, (o) => isTemps(e) ? `${o} s` : `${o} reps`);
    const resetHint = el('p', { class: 'hint' });
    if (!inS && !isTemps(e)) {
      // charge cible relevée à la main → on repart d'une base de reps (comme un vrai palier), modifiable ensuite
      selC.addEventListener('change', () => {
        const v = parseCharge(selC.value);
        if (typeof v === 'number' && typeof t.charge === 'number' && v > t.charge) {
          selR.value = String(e.repMin);
          resetHint.textContent = `Charge relevée : reps repartent à ${e.repMin} (palier), ajustable ci-dessus.`;
        } else resetHint.textContent = '';
      });
    }
    const fields = el('div', { class: 'fields' },
      isTemps(e) ? el('div') : el('div', { class: 'field' }, el('label', { for: 'fC', text: 'Charge' }), selC),
      el('div', { class: 'field' }, el('label', { for: 'fR', text: isTemps(e) ? 'Durée' : 'Reps' }), selR));
    const read = () => ({ charge: isTemps(e) ? 'PDC' : parseCharge(selC.value), reps: Number(selR.value) });
    const actions = el('div', { class: 'actions' });
    const remaining = inS ? T.filter((_, k) => k > i && state.session.results[exoId][k].done === null).length : 0;
    if (inS) {
      actions.append(
        el('button', { class: 'btn good big', type: 'button', text: `✓ Réussie (${fmtReps(e, t.reps)}${isTemps(e) ? '' : ' à ' + fmtKg(t.charge)})`, onclick: () => logSet(exoId, i, { ...t, done: true }) }),
        el('button', { class: 'btn primary', type: 'button', text: 'Valider ces valeurs', onclick: () => logSet(exoId, i, { ...read(), done: true }) }),
      );
      if (!isTemps(e) && typeof t.charge === 'number' && remaining && prevCharge(e, t.charge) !== null) actions.append(
        el('button', { class: 'btn warn', type: 'button', text: `Trop lourd : valider et alléger la suite (→ ${fmtKg(prevCharge(e, t.charge))})`, onclick: () => logSet(exoId, i, { ...read(), done: true }, true) }));
      actions.append(el('button', { class: 'btn ghost', type: 'button', text: 'Pas faite', onclick: () => logSet(exoId, i, { ...t, done: false }) }));
    } else {
      // toujours une seule série à la fois — jamais toutes les séries d'un coup
      actions.append(el('button', { class: 'btn primary big', type: 'button', text: `Enregistrer la cible de la série ${i + 1}`, onclick: () => { commit(updExo(exoId, x => ({ ...x, sets: x.sets.map((s, k) => k === i ? { ...read(), fails: 0 } : s) }))); closeSheet(); } }));
    }
    const sub = inS
      ? `Cible : ${fmtReps(e, t.reps)}${isTemps(e) ? '' : ' à ' + fmtKg(t.charge)}${chal ? ` · ⚡ défi (${chal.kind === 'charge' ? '+' + chal.delta + ' kg' : '+' + chal.delta + (isTemps(e) ? ' s' : ' rep')})` : ''}${e.last?.[i]?.done ? ' · dernière fois ' + fmtReps(e, e.last[i].reps) + (isTemps(e) ? '' : ' à ' + fmtKg(e.last[i].charge)) : ''}`
      : `Cible pour la prochaine séance · palier à ${fmtReps(e, e.repMax)}${(t.fails || 0) ? ` · ratée ${t.fails}× de suite` : ''}`;
    openSheet(el('h3', { text: `${e.name} — série ${i + 1}` }), el('div', { class: 'sub', text: sub }), fields, resetHint, actions);
  }
  function logSet(exoId, i, r, deloadRest = false) {
    const s = state.session;
    const results = { ...s.results, [exoId]: s.results[exoId].map((x, k) => k === i ? r : x) };
    let targets = s.targets || {};
    if (deloadRest) {
      const e = state.exos.find(x => x.id === exoId);
      const T = targetsOf(e);
      targets = { ...targets, [exoId]: T.map((t, k) => k > i && results[exoId][k].done === null && prevCharge(e, t.charge) !== null ? { ...t, charge: prevCharge(e, t.charge) } : t) };
    }
    commit({ ...state, session: { ...s, results, targets } });
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
    const selStep = selectEl('mStep', [0.5, 1, 2, 2.5, 3, 4, 5, 7, 10], e.step, (o) => `+${o} kg`);
    const selMode = selectEl('mMode', ['reps', 'temps'], e.mode, (o) => o === 'reps' ? 'Répétitions' : 'Temps (secondes)');
    const inStack = el('input', { type: 'text', id: 'mStack', inputmode: 'decimal', placeholder: 'ex. 9, 16, 23, 30, 36, 43, 50', value: hasStack(e) ? e.stack.join(', ') : '', 'aria-label': 'Plaques de la machine' });
    const stackHint = el('p', { class: 'hint' });
    const refreshHint = () => {
      const st = parseStack(inStack.value);
      if (st.length < 2) { stackHint.textContent = 'Machine à pile de plaques : tape les valeurs gravées, dans l’ordre. Vide = haltères/barre, on utilise le cran ci-dessus.'; return; }
      const c = e.sets.find(s => typeof s.charge === 'number')?.charge;
      const n = c !== undefined ? st.find(v => v > c + 0.01) : undefined;
      const pct = c && n ? Math.round((n - c) / c * 100) : null;
      stackHint.textContent = `${st.length} plaques (${st[0]} → ${st.at(-1)} kg)` + (pct !== null ? ` · prochain cran : ${c} → ${n} kg (+${pct} %)` + (pct > 10 ? ' — gros saut : mets le palier à 20 reps' : '') : n === undefined && c ? ` · ${c} kg est en haut de la pile` : '');
    };
    inStack.addEventListener('input', refreshHint); refreshHint();
    openSheet(
      el('h3', { text: e.name }),
      el('div', { class: 'sub', text: 'Réglages de progression' }),
      el('div', { class: 'fields' },
        el('div', { class: 'field' }, el('label', { for: 'mMin', text: 'Reps de départ (après palier)' }), selMin),
        el('div', { class: 'field' }, el('label', { for: 'mMax', text: 'Reps du palier' }), selMax),
        el('div', { class: 'field' }, el('label', { for: 'mStep', text: 'Cran (haltères / barre)' }), selStep),
        el('div', { class: 'field' }, el('label', { for: 'mMode', text: 'Type' }), selMode),
        el('div', { class: 'field wide' }, el('label', { for: 'mStack', text: 'Plaques de la machine (kg, séparées par des virgules)' }), inStack, stackHint)),
      el('div', { class: 'menu' },
        el('button', {
          class: 'btn primary', type: 'button', text: 'Enregistrer les réglages', onclick: () => {
            const stackVals = parseStack(inStack.value);
            const stack = stackVals.length > 1 ? stackVals : undefined;
            const repMin = Number(selMin.value), repMax = Math.max(repMin + 1, Number(selMax.value)), step = Number(selStep.value), mode = selMode.value;
            const patch = { repMin, repMax, step, mode, stack };
            // la pile vient d'être saisie/modifiée : on recale tout de suite les charges affichées sur les vraies plaques
            const snap = (t) => stack && typeof t.charge === 'number' ? { ...t, charge: snapToStack({ stack }, t.charge) } : t;
            let next = { ...state, exos: state.exos.map(x => x.id === exoId ? { ...x, ...patch, sets: x.sets.map(snap) } : x) };
            const T = state.session?.targets?.[exoId];
            if (T) next = { ...next, session: { ...next.session, targets: { ...next.session.targets, [exoId]: T.map(snap) } } };
            commit(next); closeSheet();
          },
        }),
        el('div', { class: 'row2' },
          el('button', { class: 'btn', type: 'button', text: '+ une série', onclick: () => upd(x => ({ ...x, sets: [...x.sets, { ...(x.sets.at(-1) || { charge: 'PDC', reps: x.repMin }), fails: 0 }] })) }),
          el('button', { class: 'btn', type: 'button', text: '− dernière série', onclick: () => upd(x => ({ ...x, sets: x.sets.slice(0, -1) })) })),
        el('div', { class: 'row2' },
          el('button', { class: 'btn', type: 'button', text: '↑ Monter', onclick: () => moveExo(idx, -1) }),
          el('button', { class: 'btn', type: 'button', text: '↓ Descendre', onclick: () => moveExo(idx, 1) })),
        el('button', { class: 'btn ghost', type: 'button', text: 'Supprimer cet exercice', onclick: () => { if (confirm(`Supprimer « ${e.name} » ?`)) { commit({ ...state, exos: state.exos.filter(x => x.id !== exoId) }); closeSheet(); } } }),
      ));
  }
  function openSettings() {
    const st = state.settings;
    const selRest = selectEl('gRest', [45, 60, 90, 120, 150, 180], st.rest, (o) => `${o} s`);
    const selGoal = selectEl('gGoal', [1, 2, 3, 4, 5, 6], st.weeklyGoal, (o) => plural(o, 'séance'));
    const selAuto = selectEl('gAuto', ['oui', 'non'], st.autoDeload ? 'oui' : 'non', (o) => o === 'oui' ? 'Oui — après 2 échecs, −1 cran' : 'Non — je décide moi-même');
    openSheet(
      el('h3', { text: 'Réglages' }),
      el('div', { class: 'sub', text: 'Repos, objectif hebdo, recalibrage automatique' }),
      el('div', { class: 'fields' },
        el('div', { class: 'field' }, el('label', { for: 'gRest', text: 'Repos entre séries' }), selRest),
        el('div', { class: 'field' }, el('label', { for: 'gGoal', text: 'Objectif par semaine' }), selGoal),
        el('div', { class: 'field wide' }, el('label', { for: 'gAuto', text: 'Recalibrage auto d’un défi raté 2 fois' }), selAuto)),
      el('div', { class: 'actions' }, el('button', { class: 'btn primary big', type: 'button', text: 'Enregistrer', onclick: () => { commit({ ...state, settings: { ...st, rest: Number(selRest.value), weeklyGoal: Number(selGoal.value), autoDeload: selAuto.value === 'oui' } }); closeSheet(); } })));
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
    const exo = mkExo(name, [{ charge: 10, reps: 10 }, { charge: 10, reps: 10 }, { charge: 10, reps: 10 }]);
    let next = { ...state, exos: [...state.exos, exo] };
    if (next.session) {
      // ajouté en pleine séance : on lui crée tout de suite ses cibles/résultats, sinon ses pastilles restent muettes
      next = { ...next, session: { ...next.session, results: { ...next.session.results, [exo.id]: exo.sets.map(t => ({ charge: t.charge, reps: t.reps, done: null })) }, targets: { ...next.session.targets, [exo.id]: exo.sets.map(t => ({ ...t })) } } };
    }
    commit(next);
    $('#addExo').focus();
  });
  $('#btnSettings').addEventListener('click', openSettings);

  /* ---------- séance : démarrer / repos / terminer ---------- */
  $('#btnStart').addEventListener('click', () => {
    if (state.session) return;
    const chal = allChallenges(), n = chal.reduce((a, x) => a + x.cs.length, 0);
    const list = el('ul', { class: 'list' });
    for (const x of chal) list.append(el('li', { class: 'good', html: `<b>${x.e.name}</b><small>${challengeText(x.e, x.cs)}</small>` }));
    if (!n) list.append(el('li', { text: state.history.length ? 'Pas de défi chiffré aujourd’hui : réussis toutes tes cibles et ils apparaîtront.' : 'Première séance : fixe ta base, les défis arrivent dès la suivante.' }));
    openSheet(
      el('h3', { text: n ? `⚡ ${plural(n, 'défi')} aujourd’hui` : 'C’est parti' }),
      el('div', { class: 'sub', text: `Jusqu’à +${potentialXp()} XP · ${weekCount()}/${state.settings.weeklyGoal} séances cette semaine` }),
      list,
      el('div', { class: 'actions', style: 'margin-top:14px' },
        el('button', { class: 'btn primary big', type: 'button', text: 'Séance normale', onclick: () => startSession(false) }),
        el('button', { class: 'btn', type: 'button', text: 'Séance légère (−10 %)', onclick: () => startSession(true) })),
      el('p', { class: 'hint', style: 'margin-top:8px', text: 'Séance légère = fatigue, peu de sommeil, grosse journée : charges −10 %, aucun défi, cibles inchangées, XP ÷ 2. On maintient, on ne casse pas la série.' }));
  });
  function startSession(light) {
    // légère : −10 % arrondi au cran, et au minimum un cran de moins ; sur une pile de plaques : la plaque du dessous
    const lighten = (e, c) => hasStack(e) ? (prevCharge(e, c) ?? c) : Math.max(0, Math.min(roundStep(c * LIGHT_FACTOR, e.step), round1(c - e.step)));
    const targets = Object.fromEntries(state.exos.map(e => [e.id, e.sets.map(t => light && typeof t.charge === 'number' && t.charge > 0 ? { ...t, charge: lighten(e, t.charge) } : { ...t })]));
    const results = Object.fromEntries(state.exos.map(e => [e.id, targets[e.id].map(t => ({ charge: t.charge, reps: t.reps, done: null }))]));
    commit({ ...state, session: { startedAt: Date.now(), results, targets, light } });
    closeSheet();
    window.scrollTo({ top: $('#exos').offsetTop - 60, behavior: 'smooth' });
  }
  $('#btnCancel').addEventListener('click', () => { if (confirm('Annuler la séance en cours ? Rien ne sera enregistré.')) { stopRest(); commit({ ...state, session: null }); } });
  $('#btnFinish').addEventListener('click', () => {
    const any = Object.values(state.session.results).flat().some(r => r.done !== null);
    if (!any) { alert('Valide au moins une série avant de terminer (ou annule la séance).'); return; }
    finishSession();
  });
  function startRest() {
    stopRest();
    const total = state.settings.rest;
    restEnd = Date.now() + total * 1000;
    $('#rest').hidden = false;
    restTimer = setInterval(() => {
      const left = Math.max(0, Math.ceil((restEnd - Date.now()) / 1000));
      $('#restTxt').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      $('#rest').querySelector('.ring').style.setProperty('--p', `${100 - Math.round((left / total) * 100)}%`);
      if (left <= 0) { stopRest(); $('#restTxt').textContent = 'Go !'; $('#rest').hidden = false; try { navigator.vibrate?.([200, 100, 200]); } catch {} setTimeout(() => { if (!restTimer) $('#rest').hidden = true; }, 4000); }
    }, 250);
  }
  function stopRest() { clearInterval(restTimer); restTimer = null; $('#rest').hidden = true; }
  $('#rest').addEventListener('click', stopRest);

  function finishSession() {
    stopRest();
    const s = state.session, date = today(), light = !!s.light;
    // reprise d'une séance coupée le même jour : on fusionne plutôt que de compter une 2e séance
    const prevEntry = state.history.at(-1);
    const continuation = !!(prevEntry && prevEntry.date === date);
    let xp = continuation ? 0 : XP.session, setsDone = 0, setsTotal = 0, fails = 0, volume = 0, chalTotal = 0, chalWon = 0;
    const prs = [], paliers = [], changes = [], failed = [], exosLog = {};
    const exos = state.exos.map(e => {
      const raw = s.results[e.id] || [];
      if (!raw.some(r => r.done !== null)) return e;   // exercice non touché : réservé à une autre séance
      const T = targetsOf(e);
      const res = raw.map(r => r.done === null ? { ...r, done: false } : r);
      const chal = light ? [] : challengesOf(e, T);
      const next = light ? e.sets.map(t => ({ ...t })) : e.sets.map((t, i) => nextTarget(e, T[i] || t, res[i]));
      let best = e.best, progressed = false;
      const failedIdx = [];
      res.forEach((r, i) => {
        setsTotal++;
        if (!r.done) return;
        const t = T[i] || e.sets[i];
        setsDone++; xp += XP.set;
        if (r.reps >= t.reps) xp += XP.hit; else if (!light) { fails++; failedIdx.push(i); }
        if (r.reps > t.reps) xp += XP.beat;
        const c = chal.find(x => x.i === i);
        if (c) { chalTotal++; if (r.reps >= t.reps && (typeof t.charge !== 'number' || r.charge >= t.charge)) { chalWon++; xp += XP.challenge; } }
        if (next[i]?.up) { xp += XP.palier; if (!paliers.includes(e.name)) paliers.push(e.name); }
        if (typeof r.charge === 'number') volume += r.charge * r.reps;
        const v = e1rm(r.charge, r.reps);
        if (v && (!best || v > best.e1rm)) { best = { e1rm: v, charge: r.charge, reps: r.reps, date }; if (!prs.includes(e.name)) prs.push(e.name); }
        if (next[i] && (next[i].reps !== t.reps || next[i].charge !== t.charge)) progressed = true;
      });
      if (prs.includes(e.name)) xp += XP.pr;
      const fmtSets = (arr) => arr.map(t => `${t.reps}${isTemps(e) ? 's' : '×' + fmtKg(t.charge)}`).join(' · ');
      const before = fmtSets(e.sets), after = fmtSets(next);
      if (before !== after) changes.push({ name: e.name, before, after, up: next.some(n => n.up), deload: next.some(n => n.deload) });
      if (failedIdx.length) failed.push({ id: e.id, name: e.name, idx: failedIdx, res, T, retry: next.map(({ up, deload, ...t }) => t), auto: next.some(n => n.deload), down: downLabel(e), prev: (c) => prevCharge(e, c), temps: isTemps(e) });
      exosLog[e.id] = { name: e.name, sets: res };
      const done = res.some(r => r.done);
      if (light) return { ...e };
      return { ...e, sets: next.map(({ up, deload, ...t }) => t), last: res, best, stalled: done ? (progressed ? 0 : e.stalled + 1) : e.stalled };
    });
    if (light) xp = Math.round(xp * XP.light);
    const streak = streakWeeks({ history: continuation ? state.history : [...state.history, { date }] });
    if (!continuation) xp += Math.min(XP.streakMax, XP.streakPerWeek * Math.max(0, streak - 1));
    let entry = { date, at: Date.now(), min: Math.round((Date.now() - s.startedAt) / 60000), volume: Math.round(volume), xp, setsDone, setsTotal, fails, prs, paliers, light, challenges: { total: chalTotal, won: chalWon }, exos: exosLog };
    let history;
    if (continuation) {
      entry = mergeEntries(prevEntry, entry);
      history = [...state.history.slice(0, -1), entry];
    } else {
      history = [...state.history, entry].slice(-HISTORY_MAX);
    }
    const lvlBefore = level(state.xp);
    const nextState = { ...state, exos, session: null, xp: state.xp + xp, history };
    commit(nextState);
    showSummary(entry, changes, failed, lvlBefore, level(nextState.xp), streak, continuation);
    if (!light) confetti();
  }
  // Fusionne une reprise de séance (même jour) avec l'entrée déjà enregistrée : additionne les compteurs,
  // remplace les cibles/records (déjà à jour dans `state.exos`), garde le détail le plus récent par exercice.
  function mergeEntries(a, b) {
    return {
      date: a.date, at: b.at, min: (a.min || 0) + (b.min || 0), volume: Math.round((a.volume || 0) + (b.volume || 0)),
      xp: (a.xp || 0) + (b.xp || 0), setsDone: a.setsDone + b.setsDone, setsTotal: a.setsTotal + b.setsTotal, fails: a.fails + b.fails,
      prs: [...new Set([...a.prs, ...b.prs])], paliers: [...new Set([...a.paliers, ...b.paliers])], light: a.light && b.light,
      challenges: { total: (a.challenges?.total || 0) + (b.challenges?.total || 0), won: (a.challenges?.won || 0) + (b.challenges?.won || 0) },
      exos: { ...a.exos, ...b.exos },
    };
  }
  function showSummary(h, changes, failed, l0, l1, streak, continuation) {
    const list = el('ul', { class: 'list' });
    if (l1 > l0) list.append(el('li', { class: 'gold', html: `🎉 <b>Niveau ${l1} — ${titleFor(l1)}</b><small>Tu passes un cap.</small>` }));
    if (h.challenges.total) list.append(el('li', { class: h.challenges.won === h.challenges.total ? 'gold' : 'good', html: `⚡ <b>Défis : ${h.challenges.won}/${h.challenges.total} réussis</b><small>${h.challenges.won === h.challenges.total ? 'Carton plein — les cibles montent.' : 'Les défis ratés restent en place : on les retente.'}</small>` }));
    for (const n of h.paliers) list.append(el('li', { class: 'gold', html: `⬆️ <b>Palier franchi</b> — ${n}<small>Charge augmentée pour la prochaine fois.</small>` }));
    for (const n of h.prs) list.append(el('li', { class: 'gold', html: `🏆 <b>Nouveau record</b> — ${n}` }));
    for (const c of changes) list.append(el('li', { class: c.up ? 'gold' : c.deload ? 'warn' : 'good', html: `<b>${c.name}</b>${c.deload ? ' <small style="display:inline">· recalibrage −1 cran (raté 2×)</small>' : ''}<small>${c.before} → <b>${c.after}</b></small>` }));
    if (h.light) list.append(el('li', { text: 'Séance légère : cibles inchangées, série de semaines préservée. Bien joué d’être venu.' }));
    else if (!changes.length && !failed.length) list.append(el('li', { text: 'Aucune cible n’a bougé — la prochaine fois, vise +1 rep sur une série.' }));
    // défis ratés : la décision t'appartient
    const adj = el('div');
    if (failed.length) {
      adj.append(el('h4', { class: 'sec', text: 'Défis ratés — que fait-on la prochaine fois ?' }));
      for (const f of failed) {
        const detail = f.idx.map(i => `S${i + 1} ${f.res[i].reps}/${f.T[i].reps}`).join(', ');
        const block = el('div', { class: 'choice' }, el('b', { text: f.name }), el('small', { text: `${detail}${f.auto ? ' · recalibrage automatique appliqué (' + f.down + ' de moins)' : ''}` }));
        const row = el('div', { class: 'row3' });
        const pick = (label, fn) => el('button', { class: 'btn', type: 'button', text: label, onclick: () => { commit(updExo(f.id, x => ({ ...x, sets: fn(x) }))); row.replaceChildren(el('span', { class: 'picked', text: `✓ ${label}` })); } });
        row.append(
          pick(f.auto ? 'Non, je retente à la même charge' : 'Retenter (même cible)', (x) => f.auto ? f.T.map((t, i) => ({ charge: t.charge, reps: t.reps, fails: f.idx.includes(i) ? (t.fails || 0) + 1 : 0 })) : f.retry),
          ...(f.temps ? [] : [pick(`Alléger d’${f.down === 'une plaque' ? 'une plaque' : 'un cran (−' + f.down + ')'}`, (x) => f.T.map(t => ({ charge: f.prev(t.charge) ?? t.charge, reps: t.reps, fails: 0 })))]),
          pick('Garder ce que j’ai fait', (x) => f.T.map((t, i) => f.res[i].done ? { charge: f.res[i].charge, reps: f.res[i].reps, fails: 0 } : { charge: t.charge, reps: t.reps, fails: 0 })),
        );
        block.append(row); adj.append(block);
      }
      adj.append(el('p', { class: 'hint', text: 'Conseil : rater un défi 1 fois est normal, surtout en déficit calorique. Retente d’abord ; allège seulement si ça coince 2 fois.' }));
    }
    const wk = weekCount(), goal = state.settings.weeklyGoal;
    openSheet(el('div', { class: 'summary' },
      el('h3', { text: h.light ? 'Séance légère terminée 👍' : 'Séance terminée 💪' }),
      ...(continuation ? [el('p', { class: 'hint', text: 'Reprise de la séance de tout à l’heure : fusionnée avec celle du jour, ça ne compte que pour une séance.' })] : []),
      el('div', { class: 'sub', text: `${h.setsDone}/${h.setsTotal} séries · ${h.min} min · ${(h.volume / 1000).toFixed(1)} t soulevées · 📅 ${wk}/${goal} cette semaine · 🔥 ${streak} sem.` }),
      el('div', { class: 'xp-big', text: `+${h.xp} XP` }),
      list, adj,
      el('div', { class: 'actions', style: 'margin-top:14px' }, el('button', { class: 'btn primary big', type: 'button', text: wk < goal ? `Super — encore ${plural(goal - wk, 'séance')} cette semaine` : 'Objectif de la semaine atteint 🎯', onclick: closeSheet }))));
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

  /* ---------- poids corporel ---------- */
  const weightAvg = (arr) => arr.length ? Math.round(arr.reduce((a, w) => a + w.kg, 0) / arr.length * 10) / 10 : null;
  function weightStats() {
    const W = [...(state.weights || [])].sort((a, b) => a.date.localeCompare(b.date));
    if (!W.length) return null;
    const t = today();
    const last7 = W.filter(w => daysBetween(w.date, t) < 7), prev7 = W.filter(w => daysBetween(w.date, t) >= 7 && daysBetween(w.date, t) < 14);
    const a7 = weightAvg(last7), p7 = weightAvg(prev7);
    const rate = a7 && p7 ? Math.round((a7 - p7) / p7 * 1000) / 10 : null;   // %/semaine
    return { W, latest: W.at(-1), a7, p7, rate, since: Math.round((W.at(-1).kg - W[0].kg) * 10) / 10, days: daysBetween(W[0].date, W.at(-1).date) };
  }
  function weightBlock() {
    const wrap = el('div');
    wrap.append(el('h2', { class: 'sec', text: 'Poids corporel' }));
    const ws = weightStats();
    const input = el('input', { type: 'number', inputmode: 'decimal', step: '0.1', min: '30', max: '300', id: 'wIn', placeholder: ws ? String(ws.latest.kg) : 'kg', 'aria-label': 'Poids du jour' });
    const save = () => {
      const kg = Math.round(Number(input.value) * 10) / 10; if (!kg || kg < 30 || kg > 300) return;
      const d = today();
      commit({ ...state, weights: [...(state.weights || []).filter(w => w.date !== d), { date: d, kg }].slice(-WEIGHTS_MAX) });
    };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') save(); });
    wrap.append(el('div', { class: 'wrow' }, input, el('button', { class: 'btn primary', type: 'button', text: ws?.latest.date === today() ? 'Corriger le poids du jour' : 'Enregistrer le poids du jour', onclick: save })));
    if (!ws) { wrap.append(el('p', { class: 'hint', text: 'Pèse-toi le matin à jeun, 3 à 7 fois par semaine : c’est la moyenne sur 7 jours qui compte, pas le chiffre du jour.' })); return wrap; }
    const tiles = el('div', { class: 'tiles' },
      tile('Dernier', ws.latest.kg, ` kg · ${fmtDate(ws.latest.date)}`),
      tile('Moyenne 7 j', ws.a7 ?? '—', ' kg'),
      tile('Rythme', ws.rate === null ? '—' : `${ws.rate > 0 ? '+' : ''}${ws.rate}`, ws.rate === null ? '' : ' %/sem'),
      tile('Depuis le début', `${ws.since > 0 ? '+' : ''}${ws.since}`, ` kg · ${ws.days} j`));
    wrap.append(tiles);
    if (ws.W.length >= 2) {
      const pts = ws.W.slice(-30);
      const lo = Math.min(...pts.map(w => w.kg)), hi = Math.max(...pts.map(w => w.kg)), sp = hi - lo || 1;
      const svg = svgEl('svg', { class: 'spark big', viewBox: '0 0 100 30', preserveAspectRatio: 'none' });
      const P = pts.map((w, i) => [i * 100 / (pts.length - 1), 27 - (w.kg - lo) / sp * 24]);
      svg.append(svgEl('path', { d: P.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') }));
      svg.append(svgEl('circle', { cx: P.at(-1)[0], cy: P.at(-1)[1], r: 2 }));
      wrap.append(svg);
    }
    if (ws.rate !== null) {
      const msg = ws.rate <= -1.2 ? ['warn', `Tu perds vite (${ws.rate} %/sem, soit ≈ ${Math.abs(Math.round(ws.a7 * ws.rate / 100 * 10) / 10)} kg/sem)`, 'Au-delà de −1 %/semaine on risque de perdre du muscle : garde tes charges, vise 1,6–2 g de protéines par kg de poids cible, et n’hésite pas à passer en séance légère si les défis coincent.']
        : ws.rate < -0.25 ? ['good', `Rythme idéal (${ws.rate} %/sem)`, 'Entre −0,5 et −1 %/semaine, la force qui se maintient = le muscle qui reste. Continue.']
        : ws.rate <= 0.25 ? ['', 'Poids stable sur 2 semaines', 'Normal en recomposition si les charges montent. Si l’objectif est la perte, réduis légèrement les apports ou ajoute de la marche.']
        : ['warn', `Poids en hausse (+${ws.rate} %/sem)`, 'Sur 2 semaines ce n’est pas du muscle : vérifie les apports. Les charges qui montent, elles, sont acquises.'];
      wrap.append(el('div', { class: 'axes', style: 'margin-top:8px' }, ax(msg[0], msg[1], msg[2])));
    }
    return wrap;
  }

  /* ---------- stats ---------- */
  function renderStats() {
    const v = $('#viewStats'); v.replaceChildren();
    const H = state.history;
    const week = weekCount();
    const last = H.at(-1), prev = H.at(-2);
    v.append(el('div', { class: 'tiles' },
      tile('Séances', H.length, ''),
      tile('Cette semaine', `${week}/${state.settings.weeklyGoal}`, ''),
      tile('Semaines d’affilée', streakWeeks(state), '🔥'),
      tile('Dernier volume', last ? (last.volume / 1000).toFixed(1) : '—', last ? `t${prev ? (last.volume >= prev.volume ? ' ▲' : ' ▼') : ''}` : ''),
    ));
    v.append(el('h2', { class: 'sec', text: 'Axes d’amélioration' }), axesBlock());
    v.append(weightBlock());
    if (!H.length) { v.append(el('div', { class: 'empty', style: 'margin-top:14px', text: 'Termine ta première séance pour débloquer les tendances.' })); v.append(badgesBlock()); return; }
    v.append(el('h2', { class: 'sec', text: 'Défis réussis par séance' }), challengeChart(H.slice(-12)));
    v.append(el('h2', { class: 'sec', text: 'Volume par séance (kg soulevés)' }), volumeChart(H.slice(-12)));
    v.append(el('h2', { class: 'sec', text: 'Tendance par exercice (1RM estimé)' }));
    for (const e of state.exos) v.append(statRow(e));
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
      svg.append(svgEl('rect', { class: `b${i === H.length - 1 ? ' last' : ''}${h.light ? ' light' : ''}`, x, y: Hh - pad - bh, width: bw * .7, height: bh, rx: 3 }));
      const t = svgEl('text', { x: x + bw * .35, y: Hh - 6, 'text-anchor': 'middle' }); t.textContent = fmtDate(h.date); svg.append(t);
    });
    return svg;
  }
  function challengeChart(H) {
    const W = 600, Hh = 110, pad = 22;
    const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${Hh}` });
    const bw = Math.min(64, (W - 40) / H.length);
    const max = Math.max(...H.map(h => h.challenges?.total || 0), 1);
    H.forEach((h, i) => {
      const tot = h.challenges?.total || 0, won = h.challenges?.won || 0, x = 40 + i * bw + bw * .15;
      const hT = (Hh - 2 * pad) * tot / max, hW = (Hh - 2 * pad) * won / max;
      svg.append(svgEl('rect', { class: 'b ghost', x, y: Hh - pad - hT, width: bw * .7, height: hT, rx: 3 }));
      svg.append(svgEl('rect', { class: 'b won', x, y: Hh - pad - hW, width: bw * .7, height: hW, rx: 3 }));
      const t = svgEl('text', { x: x + bw * .35, y: Hh - 6, 'text-anchor': 'middle' }); t.textContent = tot ? `${won}/${tot}` : (h.light ? 'léger' : '–'); svg.append(t);
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
    const H = state.history, last = H.at(-1);
    if (!last) { out.append(ax('good', 'Commence par une séance', 'Elle fixe ta base. Dès la suivante, chaque série réussie devient un défi : +1 rep, puis +1 cran de charge à 15 reps.')); return out; }
    const gap = daysBetween(last.date, today());
    if (gap >= 7) out.append(ax('warn', `Dernière séance il y a ${gap} jours`, 'La régularité pèse plus que l’intensité : cale une séance cette semaine pour garder la série.'));
    const wk = weekCount(), goal = state.settings.weeklyGoal;
    if (wk < goal && gap < 7) out.append(ax('', `${wk}/${goal} séances cette semaine`, `Encore ${plural(goal - wk, 'séance')} pour l’objectif. En perte de poids, 3 séances complètes par semaine suffisent largement si chaque série est un défi.`));
    const chal = allChallenges(), n = chal.reduce((a, x) => a + x.cs.length, 0);
    if (n) out.append(ax('good', `⚡ ${plural(n, 'défi')} t’attendent à la prochaine séance`, chal.map(x => `${x.e.name} : ${challengeText(x.e, x.cs)}`).join(' · ')));
    const rec = H.slice(-3).filter(h => !h.light && h.challenges?.total);
    const won = rec.reduce((a, h) => a + h.challenges.won, 0), tot = rec.reduce((a, h) => a + h.challenges.total, 0);
    if (tot >= 4 && won / tot < .5) out.append(ax('warn', `Défis réussis : ${won}/${tot} sur les 3 dernières séances`, 'Moins d’un sur deux : le corps ne suit pas le rythme (déficit, sommeil, repos trop court). Allonge le repos à 120 s, ou allège d’un cran les exos qui coincent — on remonte ensuite plus vite.'));
    const stalled = state.exos.filter(e => e.stalled >= 2);
    if (stalled.length >= 3) out.append(ax('warn', 'Semaine de décharge conseillée', `${stalled.length} exercices stagnent (${stalled.map(e => e.name).join(', ')}). Fais une semaine de séances légères (−10 %) : la fatigue accumulée retombe, les défis repassent ensuite.`));
    for (const e of state.exos) {
      if (e.stalled >= 2 && stalled.length < 3) out.append(ax('warn', `${e.name} stagne depuis ${e.stalled} séances`, `Essaie ${downLabel(e)} de moins avec ${e.repMax} reps propres, puis remonte. Ou place-le plus tôt dans la séance.`));
      const p = exoProgress(e);
      const c0 = e.sets.find(s => typeof s.charge === 'number')?.charge;
      if (!isTemps(e) && p >= .75 && e.stalled < 2) out.append(ax('good', `${e.name} : palier proche`, `Tu es à ${Math.round((1 - p) * (e.repMax - e.repMin))} rep en moyenne du passage à la charge suivante${c0 !== undefined ? ' (' + upLabel(e, c0) + ')' : ''}.`));
      const jump = c0 !== undefined && nextCharge(e, c0) !== null ? (nextCharge(e, c0) - c0) / c0 : 0;
      if (hasStack(e) && jump > .10 && e.repMax < 20) out.append(ax('', `${e.name} : plaque suivante = +${Math.round(jump * 100)} %`, `Gros saut pour une machine. Mets le palier à 20 reps (⋯ → Reps du palier) : tu accumules plus de reps avant de monter, et la progression série par série lisse le passage.`));
      const skipped = e.last ? e.last.filter(r => !r.done).length : 0;
      if (skipped && skipped < e.last.length) out.append(ax('', `${e.name} : ${plural(skipped, 'série')} sautée${skipped > 1 ? 's' : ''} la dernière fois`, 'Si c’est récurrent, réduis d’une série plutôt que de sauter — la cible reste atteignable.'));
    }
    if (last.fails >= 3 && !last.light) out.append(ax('warn', `${last.fails} séries ratées à la dernière séance`, 'Normal après une montée de charge. Si ça se répète 2 fois, le recalibrage automatique baisse d’un cran ; garde la charge et vise 1 rep de plus par séance.'));
    if (out.children.length <= 1) out.append(ax('good', 'Tout progresse', 'En déficit calorique, maintenir ou gagner 1 rep par série = tu gardes ton muscle. Continue, la charge suit toute seule.'));
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
