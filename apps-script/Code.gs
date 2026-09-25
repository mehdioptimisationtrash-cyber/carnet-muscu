/**
 * Carnet Muscu — script Google Apps Script (VERSION 6 : nutrition + pas quotidiens iPhone/montre + macros d'Assiette).
 * À coller dans la feuille (Extensions → Apps Script), puis :
 *   Déployer → Gérer les déploiements → ✏️ → Version : Nouvelle version → Déployer  (l'URL ne change pas).
 *
 * Onglets créés automatiquement :
 *  - state       : la sauvegarde (hors historique et nutrition) en une cellule — ne pas modifier à la main
 *  - historique  : une ligne par séance, lisible + colonne « données brutes »
 *  - exercices   : cibles actuelles, lisibles
 *  - nutrition   : une ligne par jour (kcal, protéines, alcool, collations, repas copieux, note) + données brutes
 *  - pas         : une ligne par jour (nombre de pas, source, dernière mise à jour). Rempli par l'app (saisie manuelle)
 *                  OU par un raccourci iOS qui lit Santé et envoie { token, iphone: 961, montre: 1520 } — le script garde
 *                  le plus grand des deux (montre portée → montre ; sinon iPhone). { token, steps: 8432 } reste accepté.
 *                  Date facultative (= aujourd'hui dans le fuseau de la feuille), cf. README §6.
 *  - macros      : une ligne par jour (kcal, protéines, glucides, lipides, fibres) recopiée de la feuille de l'app
 *                  Assiette toutes les 3 h par un déclencheur Google (aucun téléphone nécessaire). Mise en place, une fois :
 *                  colle l'adresse de la feuille Assiette dans ASSIETTE_SHEET_URL, enregistre, choisis la fonction
 *                  « installerAssiette » en haut de l'éditeur → Exécuter → autorise l'accès. Cf. README §7.
 *
 * TOKEN doit être identique à celui de config.js sur le site.
 */
const TOKEN = 'c34f34c52f50ef6db3b1a960e44f8f66';
const VERSION = 6;
// Adresse de la feuille Google de l'app Assiette (https://docs.google.com/spreadsheets/d/…/edit). Vide = pas de macros.
const ASSIETTE_SHEET_URL = '';
const ASSIETTE_EVERY_HOURS = 3;
const MACROS_DAYS_SENT = 120;
const NUTRITION_DAYS_SENT = 120;   // l'app reçoit les 120 derniers jours ; tout reste dans la feuille
const STEPS_DAYS_SENT = 120;
const STEPS_MAX = 200000;

function doGet(e) {
  const token = e && e.parameter ? e.parameter.token : '';
  if (token !== TOKEN) return out({ ok: false, error: 'unauthorized' });
  try {
    return out({ ok: true, v: VERSION, state: readState(SpreadsheetApp.getActiveSpreadsheet()) });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad json' }); }
  if (!body || body.token !== TOKEN) return out({ ok: false, error: 'unauthorized' });
  const hasState = body.state && typeof body.state === 'object';
  const steps = normalizeSteps(body);
  if (!hasState && !steps) return out({ ok: false, error: 'missing state or steps' });
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (hasState) writeState(ss, body.state);
    if (hasState && body.days && typeof body.days === 'object') upsertDays(ss, body.days);
    if (steps) upsertSteps(ss, steps);
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
  return out({ ok: true, v: VERSION, rev: hasState ? (body.state.rev || 0) : 0, steps: steps || undefined });
}

function readState(ss) {
  const sh = ss.getSheetByName('state');
  if (!sh) return null;
  const raw = sh.getRange('A2').getValue();
  if (!raw) return null;
  const state = JSON.parse(raw);
  const hs = ss.getSheetByName('historique');
  const n = hs ? hs.getLastRow() - 1 : 0;
  const rows = n > 0 ? hs.getRange(2, 1, n, 10).getValues() : [];
  state.history = rows.filter((r) => r[9]).map((r) => JSON.parse(r[9]));
  state.nutrition = readDays(ss);
  state.steps = readSteps(ss);
  state.macros = readMacros(ss);
  return state;
}

function writeState(ss, state) {
  const history = Array.isArray(state.history) ? state.history : [];
  const rest = Object.assign({}, state);
  delete rest.history;
  delete rest.nutrition;
  delete rest.steps;
  delete rest.macros;

  const sh = sheet(ss, 'state', ['sauvegarde — ne pas modifier']);
  sh.getRange('A2').setValue(JSON.stringify(rest));

  const hs = sheet(ss, 'historique', ['date', 'durée (min)', 'volume (kg)', 'XP', 'séries validées', 'séries ratées', 'records', 'paliers', 'détail', 'données brutes']);
  const old = hs.getLastRow() - 1;
  if (old > 0) hs.getRange(2, 1, old, 10).clearContent();
  if (history.length) {
    hs.getRange(2, 1, history.length, 10).setValues(history.map((h) => [
      h.date, h.min, h.volume, h.xp, h.setsDone, h.fails,
      (h.prs || []).join(', '), (h.paliers || []).join(', '),
      Object.keys(h.exos || {}).map((id) => {
        const x = h.exos[id];
        return x.name + ' : ' + x.sets.map((s) => (s.done ? (s.charge === 'PDC' ? '' : s.charge + '×') + s.reps : '–')).join(' ');
      }).concat((h.cardio || []).map((c) => 'cardio ' + c.type + ' ' + Math.round(c.sec / 60) + ' min')).join(' | '),
      JSON.stringify(h),
    ]));
  }

  const es = sheet(ss, 'exercices', ['exercice', 'type', 'cible (prochaine séance)', 'dernière fois', 'record 1RM estimé', 'cran de charge', 'reps départ → palier']);
  const oldE = es.getLastRow() - 1;
  if (oldE > 0) es.getRange(2, 1, oldE, 7).clearContent();
  const exos = Array.isArray(rest.exos) ? rest.exos : [];
  if (exos.length) {
    es.getRange(2, 1, exos.length, 7).setValues(exos.map((x) => [
      x.name, x.mode === 'temps' ? 'temps (s)' : 'reps',
      x.sets.map((s) => (x.mode === 'temps' ? s.reps + 's' : (s.charge === 'PDC' ? 'PDC' : s.charge + 'kg') + '×' + s.reps)).join(' · '),
      x.last ? x.last.map((s) => (s.done ? s.reps : '–')).join(' · ') : '',
      x.best ? x.best.e1rm : '', x.stack ? x.stack.join(' / ') : x.step, x.repMin + ' → ' + x.repMax,
    ]));
  }
}

/* ---------- journal nutrition : une ligne par jour ---------- */
const NUT_HEADER = ['date', 'kcal', 'protéines (g)', 'alcool (verres)', 'collations', 'repas copieux', 'note', 'données brutes'];

function nutritionSheet(ss) {
  const sh = sheet(ss, 'nutrition', NUT_HEADER);
  sh.getRange('A:A').setNumberFormat('@');   // dates gardées en texte (sinon Sheets les convertit)
  return sh;
}

// Google Sheets convertit « 2026-09-21 » en vraie date : on la ramène toujours au texte AAAA-MM-JJ.
// (`instanceof Date` n'est pas fiable dans Apps Script : on teste la présence de getTime.)
function dateKey(v) {
  if (v && typeof v.getTime === 'function') return Utilities.formatDate(v, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  return String(v);
}

function upsertDays(ss, days) {
  const dates = Object.keys(days);
  if (!dates.length) return;
  const sh = nutritionSheet(ss);
  const n = sh.getLastRow() - 1;
  const existing = n > 0 ? sh.getRange(2, 1, n, 1).getValues().map((r) => dateKey(r[0])) : [];
  dates.forEach((date) => {
    const d = days[date] || {};
    const meals = Array.isArray(d.meals) ? d.meals : [];
    const sum = (f) => meals.reduce((a, m) => a + (Number(f(m)) || 0), 0);
    const row = [
      date, Math.round(sum((m) => m.kcal)), Math.round(sum((m) => m.p)), Math.round(sum((m) => m.alc) * 10) / 10,
      meals.filter((m) => m.slot === 'col').length, meals.filter((m) => m.size === 'copieux' || m.size === 'tres').length,
      d.note || '', JSON.stringify(d),
    ];
    const i = existing.indexOf(date);
    if (i >= 0) sh.getRange(i + 2, 1, 1, 8).setValues([row]);
    else { sh.appendRow(row); existing.push(date); }
  });
  const total = sh.getLastRow() - 1;
  if (total > 1) sh.getRange(2, 1, total, 8).sort(1);
}

function readDays(ss) {
  const sh = ss.getSheetByName('nutrition');
  const n = sh ? sh.getLastRow() - 1 : 0;
  if (n <= 0) return {};
  const start = Math.max(2, n + 2 - NUTRITION_DAYS_SENT);
  const rows = sh.getRange(start, 1, n + 2 - start, 8).getValues();
  const outDays = {};
  // la clé vient des données du jour elles-mêmes (fiable), la colonne A ne sert que de secours
  rows.forEach((r) => { if (r[7]) { try { const d = JSON.parse(r[7]); outDays[d.date || dateKey(r[0])] = d; } catch (err) { /* ligne abîmée : ignorée */ } } });
  return outDays;
}

/* ---------- pas quotidiens : une ligne par jour ---------- */
const STEPS_HEADER = ['date', 'pas', 'source', 'mis à jour'];

function stepsSheet(ss) {
  const sh = sheet(ss, 'pas', STEPS_HEADER);
  sh.getRange('A:A').setNumberFormat('@');
  return sh;
}

function todayKey() {
  return Utilities.formatDate(new Date(), SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
}

// Accepte trois formes :
//  - app                : { steps: { '2026-09-22': { n: 8432, src: 'manuel' }, ... } }
//  - raccourci (2 src.) : { iphone: 961, montre: 1520, date? }  → n = le plus grand (Santé privilégie la montre quand
//                         elle est portée ; sans montre, elle est à 0 et l'iPhone gagne). Raccourcis ne sait pas refaire
//                         la fusion de Santé : ce maximum en est l'approximation la plus proche jour après jour.
//  - raccourci (1 src.) : { steps: 8432, date? }
// Date facultative = aujourd'hui dans le fuseau de la feuille. Renvoie { date: { n, src, detail? } } ou null.
function normalizeSteps(body) {
  const outSteps = {};
  const num = (v) => { const t = String(v === undefined || v === null ? '' : v).replace(/[^0-9.]/g, ''); if (!t) return NaN; const x = Math.round(Number(t)); return x >= 0 ? x : NaN; };
  const put = (date, n, src, detail) => {
    const key = String(date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !(n >= 0) || n > STEPS_MAX) return;
    outSteps[key] = { n, src: src === 'manuel' ? 'manuel' : 'sante', detail: detail || '' };
  };
  if (body.steps && typeof body.steps === 'object') {
    Object.keys(body.steps).forEach((date) => {
      const v = body.steps[date];
      if (v && typeof v === 'object') put(date, num(v.n), v.src);
      else put(date, num(v), body.source);
    });
  } else if (body.iphone !== undefined || body.montre !== undefined) {
    const ip = num(body.iphone), mo = num(body.montre);
    const both = [ip, mo].filter((x) => x >= 0);
    if (both.length) put(body.date || todayKey(), Math.max.apply(null, both), 'sante', (mo >= ip ? 'montre' : 'iphone') + ' (montre ' + (mo >= 0 ? mo : '–') + ' · iphone ' + (ip >= 0 ? ip : '–') + ')');
  } else if (body.steps !== undefined && body.steps !== null && body.steps !== '') {
    put(body.date || todayKey(), num(body.steps), body.source);
  }
  return Object.keys(outSteps).length ? outSteps : null;
}

function upsertSteps(ss, steps) {
  const sh = stepsSheet(ss);
  const n = sh.getLastRow() - 1;
  const cur = n > 0 ? sh.getRange(2, 1, n, 2).getValues() : [];
  const existing = cur.map((r) => dateKey(r[0]));
  const now = new Date();
  Object.keys(steps).forEach((date) => {
    const i = existing.indexOf(date);
    // envoi du raccourci (Santé) : les pas d'une journée ne font que monter. Un total plus petit = Santé illisible
    // (iPhone verrouillé à l'heure de l'automatisation) → on garde l'ancien. La saisie manuelle, elle, peut corriger à la baisse.
    if (i >= 0 && steps[date].src === 'sante' && Number(cur[i][1]) > steps[date].n) return;
    const row = [date, steps[date].n, steps[date].src + (steps[date].detail ? ' · ' + steps[date].detail : ''), now];
    if (i >= 0) sh.getRange(i + 2, 1, 1, 4).setValues([row]);
    else { sh.appendRow(row); existing.push(date); }
  });
  const total = sh.getLastRow() - 1;
  if (total > 1) sh.getRange(2, 1, total, 4).sort(1);
}

function readSteps(ss) {
  const sh = ss.getSheetByName('pas');
  const n = sh ? sh.getLastRow() - 1 : 0;
  if (n <= 0) return {};
  const start = Math.max(2, n + 2 - STEPS_DAYS_SENT);
  const rows = sh.getRange(start, 1, n + 2 - start, 3).getValues();
  const outSteps = {};
  rows.forEach((r) => { const v = Math.round(Number(r[1])); if (r[0] && v >= 0) outSteps[dateKey(r[0])] = { n: v, src: String(r[2]).indexOf('manuel') === 0 ? 'manuel' : 'sante' }; });
  return outSteps;
}

/* ---------- macros recopiées de la feuille Assiette (onglet « jours ») ---------- */
const MACROS_HEADER = ['date', 'kcal', 'protéines (g)', 'glucides (g)', 'lipides (g)', 'fibres (g)', 'mis à jour'];

// À exécuter une fois depuis l'éditeur : installe le déclencheur toutes les 3 h (sans doublon) et fait une première copie.
function installerAssiette() {
  if (!ASSIETTE_SHEET_URL) throw new Error('Colle d’abord l’adresse de la feuille Assiette dans ASSIETTE_SHEET_URL, puis enregistre.');
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'syncAssiette').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncAssiette').timeBased().everyHours(ASSIETTE_EVERY_HOURS).create();
  const n = syncAssiette();
  Logger.log('Déclencheur installé (toutes les ' + ASSIETTE_EVERY_HOURS + ' h) — ' + n + ' jours recopiés depuis Assiette.');
}

function syncAssiette() {
  if (!ASSIETTE_SHEET_URL) return 0;
  const src = SpreadsheetApp.openByUrl(ASSIETTE_SHEET_URL).getSheetByName('jours');
  const n = src ? src.getLastRow() - 1 : 0;
  if (n <= 0) return 0;
  const macros = macrosFromRows(src.getRange(2, 1, n, 6).getValues(), dateKey);
  const dates = Object.keys(macros).sort();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = sheet(ss, 'macros', MACROS_HEADER);
  sh.getRange('A:A').setNumberFormat('@');
  const old = sh.getLastRow() - 1;
  if (old > 0) sh.getRange(2, 1, old, MACROS_HEADER.length).clearContent();
  const now = new Date();
  if (dates.length) sh.getRange(2, 1, dates.length, MACROS_HEADER.length).setValues(dates.map((d) => { const m = macros[d]; return [d, m.kcal, m.p, m.c, m.f, m.fib, now]; }));
  return dates.length;
}

// Lignes de l'onglet « jours » d'Assiette (date, kcal, protéines, glucides, lipides, fibres) → { date: { kcal, p, c, f, fib } }.
// Les jours vides (0 kcal) sont ignorés : rien n'a été saisi dans Assiette ce jour-là.
function macrosFromRows(rows, toKey) {
  const outM = {};
  const num = (v) => { const x = Number(v); return isFinite(x) && x > 0 ? Math.round(x) : 0; };
  rows.forEach((r) => {
    const date = toKey(r[0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(num(r[1]) > 0)) return;
    outM[date] = { kcal: num(r[1]), p: num(r[2]), c: num(r[3]), f: num(r[4]), fib: num(r[5]) };
  });
  return outM;
}

function readMacros(ss) {
  const sh = ss.getSheetByName('macros');
  const n = sh ? sh.getLastRow() - 1 : 0;
  if (n <= 0) return {};
  const start = Math.max(2, n + 2 - MACROS_DAYS_SENT);
  const rows = sh.getRange(start, 1, n + 2 - start, 7).getValues();
  const macros = macrosFromRows(rows, dateKey);
  rows.forEach((r) => { const d = dateKey(r[0]); if (macros[d] && r[6] && typeof r[6].getTime === 'function') macros[d].at = r[6].getTime(); });
  return macros;
}

function sheet(ss, name, header) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  return sh;
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
