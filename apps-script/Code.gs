/**
 * Carnet Muscu — script Google Apps Script (VERSION 2 : ajoute le journal nutrition).
 * À coller dans la feuille (Extensions → Apps Script), puis :
 *   Déployer → Gérer les déploiements → ✏️ → Version : Nouvelle version → Déployer  (l'URL ne change pas).
 *
 * Onglets créés automatiquement :
 *  - state       : la sauvegarde (hors historique et nutrition) en une cellule — ne pas modifier à la main
 *  - historique  : une ligne par séance, lisible + colonne « données brutes »
 *  - exercices   : cibles actuelles, lisibles
 *  - nutrition   : une ligne par jour (kcal, protéines, alcool, collations, repas copieux, note) + données brutes
 *
 * TOKEN doit être identique à celui de config.js sur le site.
 */
const TOKEN = 'c34f34c52f50ef6db3b1a960e44f8f66';
const VERSION = 2;
const NUTRITION_DAYS_SENT = 120;   // l'app reçoit les 120 derniers jours ; tout reste dans la feuille

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
  if (!body.state || typeof body.state !== 'object') return out({ ok: false, error: 'missing state' });
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    writeState(ss, body.state);
    if (body.days && typeof body.days === 'object') upsertDays(ss, body.days);
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
  return out({ ok: true, v: VERSION, rev: body.state.rev || 0 });
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
  return state;
}

function writeState(ss, state) {
  const history = Array.isArray(state.history) ? state.history : [];
  const rest = Object.assign({}, state);
  delete rest.history;
  delete rest.nutrition;

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

function dateKey(v) {
  return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v);
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
  rows.forEach((r) => { if (r[7]) { try { outDays[dateKey(r[0])] = JSON.parse(r[7]); } catch (err) { /* ligne abîmée : ignorée */ } } });
  return outDays;
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
