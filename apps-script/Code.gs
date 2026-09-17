/**
 * Carnet Muscu — script Google Apps Script à coller dans la feuille
 * (Extensions → Apps Script), puis à déployer en « Application web ».
 *
 * Onglets créés automatiquement :
 *  - state       : la sauvegarde (hors historique) en une cellule — ne pas modifier à la main
 *  - historique  : une ligne par séance, lisible + colonne « données brutes »
 *  - exercices   : cibles actuelles, lisibles
 *
 * TOKEN doit être identique à celui de config.js sur le site.
 */
const TOKEN = 'c34f34c52f50ef6db3b1a960e44f8f66';

function doGet(e) {
  const token = e && e.parameter ? e.parameter.token : '';
  if (token !== TOKEN) return out({ ok: false, error: 'unauthorized' });
  try {
    return out({ ok: true, state: readState(SpreadsheetApp.getActiveSpreadsheet()) });
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
    writeState(SpreadsheetApp.getActiveSpreadsheet(), body.state);
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
  return out({ ok: true, rev: body.state.rev || 0 });
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
  return state;
}

function writeState(ss, state) {
  const history = Array.isArray(state.history) ? state.history : [];
  const rest = Object.assign({}, state);
  delete rest.history;

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
      }).join(' | '),
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
      x.best ? x.best.e1rm : '', x.step, x.repMin + ' → ' + x.repMax,
    ]));
  }
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
