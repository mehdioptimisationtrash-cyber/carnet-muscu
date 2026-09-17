/* Couche de sauvegarde Google Sheets (via une application web Apps Script).
 * - load()          : lit l'état complet depuis la feuille.
 * - scheduleSave(s) : regroupe les modifications et les envoie 1 s après la dernière.
 * - Hors-ligne ou échec : l'envoi est mis en attente (drapeau dans localStorage)
 *   et retenté au retour du réseau, en arrière-plan, ou au prochain lancement.
 */
window.Sync = (() => {
  'use strict';
  const cfg = window.CARNET_CONFIG || {};
  const OUTBOX_KEY = 'carnet-muscu-outbox';
  const TIMEOUT_MS = 20000;
  const RETRY_MS = 30000;
  const KEEPALIVE_MAX_BYTES = 60000;

  let timer = null;
  let inflight = null;
  let pendingState = null;
  let statusCb = () => {};

  const enabled = () => /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(cfg.SHEETS_URL || '');
  const status = (state, label, hint = '') => statusCb(state, label, hint);
  const hasOutbox = () => { try { return localStorage.getItem(OUTBOX_KEY) === '1'; } catch { return false; } };
  const setOutbox = (on) => { try { on ? localStorage.setItem(OUTBOX_KEY, '1') : localStorage.removeItem(OUTBOX_KEY); } catch {} };
  const hhmm = () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  async function request(method, payload) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const opts = { method, signal: ctrl.signal, redirect: 'follow' };
      let url = cfg.SHEETS_URL;
      if (method === 'GET') {
        url += `?token=${encodeURIComponent(cfg.TOKEN)}&t=${Date.now()}`;
      } else {
        const body = JSON.stringify({ token: cfg.TOKEN, ...payload });
        // text/plain évite la requête de pré-vérification CORS qu'Apps Script ne gère pas.
        Object.assign(opts, { body, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, keepalive: body.length < KEEPALIVE_MAX_BYTES });
      }
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || data.ok !== true) throw new Error(data?.error || 'réponse invalide');
      return data;
    } finally {
      clearTimeout(t);
    }
  }

  async function load() {
    status('saving', 'Lecture de Google Sheets…');
    const data = await request('GET');
    return data.state ?? null;
  }

  function scheduleSave(state, delay = 1000) {
    pendingState = state;
    setOutbox(true);
    status('pending', navigator.onLine ? 'Enregistrement…' : 'Hors-ligne — sera envoyé au retour du réseau');
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  }

  function flush() {
    clearTimeout(timer);
    if (inflight) return inflight;
    if (!pendingState) return Promise.resolve();
    const snapshot = pendingState;
    pendingState = null;
    inflight = request('POST', { state: snapshot })
      .then(() => {
        if (!pendingState) { setOutbox(false); status('ok', `Enregistré sur Google Sheets · ${hhmm()}`); }
      })
      .catch((err) => {
        console.warn('Sauvegarde Google Sheets échouée :', err);
        if (!pendingState) pendingState = snapshot;     // on garde la dernière version à envoyer
        status('err', navigator.onLine ? 'Échec d’enregistrement — nouvel essai dans 30 s' : 'Hors-ligne — sera envoyé au retour du réseau', navigator.onLine ? String(err.message || err) : '');
        timer = setTimeout(flush, RETRY_MS);
      })
      .finally(() => {
        inflight = null;
        if (pendingState && !timer) timer = setTimeout(flush, 1000);
      });
    return inflight;
  }

  window.addEventListener('online', () => { if (pendingState) flush(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && pendingState) flush(); });

  return { enabled, load, scheduleSave, flush, hasOutbox, onStatus: (cb) => { statusCb = cb; } };
})();
