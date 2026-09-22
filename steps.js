/* Pas quotidiens : jauge dans le Journal, saisie manuelle, remplissage automatique depuis Santé (via un raccourci iOS
 * qui écrit directement dans la feuille Google), tuile/axes/graphique dans les Stats.
 * Données : state.steps = { 'AAAA-MM-JJ': { n, src: 'sante' | 'manuel' } } — ne voyage pas dans la cellule `state`
 * (onglet « pas » de la feuille, cf. sync.js markSteps et apps-script/Code.gs v4).
 * Dépend de window.App (passerelle exposée par app.js) et de window.Sync.
 */
window.Steps = (() => {
  'use strict';
  const A = () => window.App;
  const DEFAULT_GOAL = 8000;           // repère perte de poids : 8 000–10 000 pas/jour
  const GOALS = [5000, 6000, 7000, 8000, 10000, 12000];
  const SCRIPT_VERSION_MIN = 4;   // v5 ajoute iphone/montre côté raccourci, sans changement pour l'app
  const REFRESH_MIN_MS = 60000;       // au retour au premier plan, on relit la feuille au plus une fois par minute
  const CHART_DAYS = 14;
  const SHORTCUT_NAME = 'Muscu Pas';

  let lastRefresh = 0;
  const st = () => A().state;
  const goal = () => Number(st().settings.stepsGoal) || DEFAULT_GOAL;
  const entry = (date) => st().steps?.[date] || null;
  const count = (date) => entry(date)?.n ?? null;
  const fmt = (n) => n.toLocaleString('fr-FR');
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const addDays = (date, n) => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
  const reached = (date) => (count(date) ?? -1) >= goal();

  /* ---------- écriture ---------- */
  function save(date, n) {
    window.Sync.markSteps(date);
    A().commit({ ...st(), steps: { ...(st().steps || {}), [date]: { n, src: 'manuel' } } });
  }

  /* ---------- relecture au retour au premier plan (les pas envoyés par le raccourci arrivent dans la feuille) ---------- */
  async function refresh(force = false) {
    const S = window.Sync;
    if (!S.enabled() || !navigator.onLine || !st()) return false;
    if (!force && Date.now() - lastRefresh < REFRESH_MIN_MS) return false;
    lastRefresh = Date.now();
    try {
      const got = await S.load(true);
      const remote = got.state?.steps;
      if (!remote || typeof remote !== 'object') return false;
      const dirty = new Set(S.dirtySteps());
      const merged = { ...(st().steps || {}), ...Object.fromEntries(Object.entries(remote).filter(([d]) => !dirty.has(d))) };
      if (JSON.stringify(merged) === JSON.stringify(st().steps || {})) return false;
      A().absorb({ steps: merged });
      return true;
    } catch (err) {
      console.warn('Relecture des pas impossible :', err);
      return false;
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  /* ---------- journal ---------- */
  function gauge(date) {
    const { el } = A();
    const e = entry(date), n = e?.n ?? 0, g = goal();
    const pct = Math.min(100, Math.round(n / g * 100));
    const src = !e ? 'Touche pour saisir · ou automatique depuis Santé' : e.src === 'sante' ? 'via Santé (automatique)' : 'saisi à la main';
    return el('button', { class: 'gauge gauge-btn', type: 'button', id: 'stepsGauge', 'aria-label': `Pas du jour : ${fmt(n)} sur ${fmt(g)}`, onclick: () => openEntry(date) },
      el('div', { class: 'gauge-top' }, el('b', { text: '🚶 Pas' }), el('span', { class: 'tnum', text: `${fmt(n)} / ${fmt(g)}` })),
      el('div', { class: `gbar${n >= g ? ' ok' : ''}` }, el('i', { style: `width:${pct}%` })),
      el('small', { text: n >= g ? `objectif atteint ✓ · ${src}` : e ? `reste ${fmt(g - n)} · ${src}` : src }));
  }

  function openEntry(date) {
    const { el, openSheet, closeSheet, fmtDate, today } = A();
    const e = entry(date);
    const input = el('input', { type: 'number', inputmode: 'numeric', min: '0', max: '200000', step: '1', id: 'stepsIn', value: e ? String(e.n) : '', placeholder: 'ex. 8 400', 'aria-label': 'Nombre de pas' });
    const doSave = () => { const n = Math.round(Number(input.value)); if (!(n >= 0) || n > 200000 || input.value === '') { alert('Indique un nombre de pas (0 à 200 000).'); return; } save(date, n); closeSheet(); };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') doSave(); });
    const old = A().scriptVersion && A().scriptVersion < SCRIPT_VERSION_MIN;
    openSheet(
      el('h3', { text: `🚶 Pas · ${date === today() ? 'aujourd’hui' : fmtDate(date)}` }),
      el('div', { class: 'sub', text: e ? `${fmt(e.n)} pas enregistrés ${e.src === 'sante' ? 'automatiquement depuis Santé' : 'à la main'}. Corrige si besoin.` : 'Le total du jour, tel que l’app Santé ou Pedometer++ l’affiche.' }),
      ...(old ? [el('div', { class: 'ax warn' }, el('b', { text: 'Script Google à mettre à jour (v4)' }), el('small', { text: 'Les pas sont gardés sur ce téléphone, mais pas encore dans la feuille. Recolle apps-script/Code.gs puis Déployer → Gérer les déploiements → ✏️ → Nouvelle version.' }))] : []),
      el('div', { class: 'wrow' }, input, el('button', { class: 'btn primary', type: 'button', text: 'Enregistrer', onclick: doSave })),
      el('div', { class: 'menu' },
        el('button', { class: 'btn', type: 'button', text: '↻ Relire la feuille (pas envoyés par le raccourci)', onclick: async () => { const ok = await refresh(true); closeSheet(); A().toast(ok ? '🚶 Pas mis à jour depuis la feuille' : 'Rien de nouveau dans la feuille', ok ? '' : 'Le raccourci n’a pas encore envoyé ce jour, ou la lecture a échoué.'); } }),
        el('button', { class: 'btn ghost', type: 'button', text: '⚙︎ Remplissage automatique : comment ça marche ?', onclick: openHelp }),
        ...(e ? [el('button', { class: 'btn ghost', type: 'button', text: 'Remettre à zéro', onclick: () => { save(date, 0); closeSheet(); } })] : [])));
  }

  /* ---------- aide : raccourci iOS qui lit Santé et écrit dans la feuille ---------- */
  function openHelp() {
    const { el, openSheet, closeSheet } = A();
    const cfg = window.CARNET_CONFIG || {};
    const copy = (label, value) => el('button', { class: 'btn', type: 'button', text: label, onclick: async () => { try { await navigator.clipboard.writeText(value); A().toast('Copié ✓', value.length > 60 ? value.slice(0, 57) + '…' : value); } catch { prompt('Copie cette valeur :', value); } } });
    const steps = [
      ['Ouvre l’app Raccourcis → + → nomme-le « ' + SHORTCUT_NAME + ' »', ''],
      ['« Rechercher des échantillons de santé » ×2 : iPhone, puis montre', 'Type : Pas · Date de début : est aujourd’hui · Grouper par : Jour · filtre Source = « iPhone de … » pour la première, Source = « Apple Watch de … » pour la seconde. Sans filtre, iPhone + montre s’additionnent.'],
      ['« Calculer des statistiques » ×2 : Somme', 'Une après chaque recherche. Deux totaux : iPhone et montre.'],
      ['Action « Obtenir le contenu de l’URL »', 'URL : celle du script (bouton ci-dessous) · Méthode : POST · Corps : JSON · trois champs : token (texte, bouton ci-dessous), iphone (nombre = 1re Somme), montre (nombre = 2e Somme). Le script garde le plus grand : montre portée → montre, sinon iPhone. Facultatif : date (texte AAAA-MM-JJ).'],
      ['Automatisation', 'Raccourcis → Automatisation → + → Heure de la journée → 12:00, 18:00 et 23:50 → « Exécuter immédiatement » → ce raccourci. Chaque envoi remplace le total du jour ; le carnet le relit quand tu l’ouvres.'],
    ];
    const list = el('ol', { class: 'list steps-help' });
    for (const [t, sub] of steps) list.append(el('li', {}, el('b', { text: t }), ...(sub ? [el('small', { text: sub })] : [])));
    openSheet(
      el('h3', { text: '🚶 Pas automatiques depuis Santé' }),
      el('div', { class: 'sub', text: 'Une app web n’a pas accès à Santé. Un raccourci iOS lit tes pas dans Santé (où Pedometer++ et ta montre les déposent) et les envoie dans ta feuille Google ; le carnet les affiche ensuite.' }),
      list,
      el('div', { class: 'menu', style: 'margin-top:10px' }, copy('Copier l’URL du script', cfg.SHEETS_URL || ''), copy('Copier le jeton (token)', cfg.TOKEN || '')),
      el('p', { class: 'hint', text: 'Test : lance le raccourci à la main, puis ici « ↻ Relire la feuille ». Si le total est le double de celui de Santé, ajoute le filtre Source (étape 2).' }),
      el('div', { class: 'actions', style: 'margin-top:12px' }, el('button', { class: 'btn primary', type: 'button', text: 'Fermer', onclick: closeSheet })));
  }

  /* ---------- stats ---------- */
  function lastDays(n) { const t = A().today(); return Array.from({ length: n }, (_, i) => addDays(t, -i)); }
  function weekAvg() {
    const days = lastDays(7).filter(d => count(d) !== null);
    if (!days.length) return null;
    return { n: days.length, avg: Math.round(days.reduce((a, d) => a + count(d), 0) / days.length), ok: days.filter(reached).length };
  }
  function tile() {
    const w = weekAvg();
    return A().tile('Pas / jour (7 j)', w ? fmt(w.avg) : '—', ` / ${fmt(goal())}`);
  }
  function statsBlock() {
    const { el, svgEl } = A();
    const t = A().today(), days = Array.from({ length: CHART_DAYS }, (_, i) => addDays(t, i - CHART_DAYS + 1));
    if (!days.some(d => count(d) !== null)) return el('div');
    const wrap = el('div'); wrap.append(el('h2', { class: 'sec', text: `Pas — ${CHART_DAYS} derniers jours` }));
    const g = goal(), W = 600, H = 120, pad = 18, max = Math.max(g * 1.3, ...days.map(d => count(d) || 0));
    const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}` });
    const yT = H - pad - (H - 2 * pad) * g / max;
    days.forEach((d, i) => { const k = count(d) || 0, bw = (W - 20) / CHART_DAYS, bh = (H - 2 * pad) * k / max; if (k) svg.append(svgEl('rect', { class: `b${k >= g ? ' won' : ''}`, x: 10 + i * bw + bw * .15, y: H - pad - bh, width: bw * .7, height: bh, rx: 3 })); });
    svg.append(svgEl('line', { class: 'target', x1: 0, x2: W, y1: yT, y2: yT }));
    const lbl = svgEl('text', { x: W - 4, y: yT - 4, 'text-anchor': 'end' }); lbl.textContent = `objectif ${fmt(g)} pas`; svg.append(lbl);
    wrap.append(svg);
    return wrap;
  }
  function axes(out) {
    const { ax } = A();
    const w = weekAvg(), g = goal();
    if (!w) { out.append(ax('', 'Pas : aucun jour enregistré', 'Onglet Journal → jauge 🚶, ou remplissage automatique depuis Santé (⚙︎ Réglages). La marche du quotidien est la dépense la plus facile à augmenter sans fatiguer la muscu.')); return; }
    if (w.avg < g * 0.7) out.append(ax('warn', `Marche : ${fmt(w.avg)} pas/jour en moyenne (objectif ${fmt(g)})`, `${w.ok}/${w.n} jours à l’objectif. Chaque 1 000 pas ≈ 40–50 kcal : deux marches de 15 min (trajet, pause déjeuner, appel téléphonique) comblent l’écart sans entamer la récupération.`));
    else if (w.avg < g) out.append(ax('', `Marche : ${fmt(w.avg)} pas/jour, presque à l’objectif`, `${w.ok}/${w.n} jours à ${fmt(g)}. Il manque ~${fmt(g - w.avg)} pas : 10 minutes de marche de plus par jour.`));
    else out.append(ax('good', `Marche : ${fmt(w.avg)} pas/jour — objectif atteint`, `${w.ok}/${w.n} jours à l’objectif. C’est la dépense « gratuite » qui fait la différence sur la semaine. Inutile d’aller bien au-delà de 10–12 000.`));
  }

  return { gauge, openEntry, openHelp, refresh, tile, statsBlock, axes, weekAvg, reached, count, goal, GOALS, DEFAULT_GOAL };
})();
