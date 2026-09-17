"""Test de bout en bout en local : PWA + synchro Google Sheets simulée.
Usage : python3 -m http.server 8000 &  puis  python3 tools/e2e_local.py
"""
import json, sys, time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8000/"
FAKE_URL = "https://script.google.com/macros/s/FAKE/exec"
TOKEN = "c34f34c52f50ef6db3b1a960e44f8f66"
store = {"state": None, "posts": 0, "gets": 0, "bad": 0}
errors = []

def fake_sheets(route, request):
    if request.method == "GET":
        store["gets"] += 1
        ok = f"token={TOKEN}" in request.url
        body = {"ok": True, "state": store["state"]} if ok else {"ok": False, "error": "unauthorized"}
    else:
        payload = json.loads(request.post_data)
        if payload.get("token") != TOKEN:
            store["bad"] += 1; body = {"ok": False, "error": "unauthorized"}
        else:
            store["posts"] += 1; store["state"] = payload["state"]; body = {"ok": True, "rev": payload["state"]["rev"]}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True)
    ctx.route("**/config.js", lambda r, q: r.fulfill(content_type="application/javascript",
        body=f"window.CARNET_CONFIG={{SHEETS_URL:'{FAKE_URL}',TOKEN:'{TOKEN}'}};"))
    ctx.route("https://script.google.com/**", fake_sheets)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    # 1. premier lancement : feuille vide
    pg.goto(BASE); pg.wait_for_selector("#status")
    pg.wait_for_function("document.querySelector('#status').textContent.includes('Google Sheets')")
    st0 = pg.text_content("#status")
    sw = pg.evaluate("navigator.serviceWorker.getRegistration().then(r => !!r)")
    manifest = pg.evaluate("fetch('./manifest.webmanifest').then(r => r.json()).then(m => m.display)")

    # 2. ajouter un exercice → doit être poussé vers la feuille
    pg.fill("#addExo", "Développé couché"); pg.press("#addExo", "Enter")
    pg.wait_for_function("document.querySelector('#status').dataset.state === 'ok'", timeout=10000)
    posted1 = store["state"]["exos"][0]["name"] if store["state"] else None

    # 3. séance complète
    pg.click("#btnStart")
    for i in range(3):
        pg.click(".exo >> nth=0 >> .set >> nth=%d" % i); pg.click("text=/Réussie/")
    pg.click("#btnFinish"); pg.wait_for_selector(".summary"); xp = pg.text_content(".xp-big"); pg.click("text=Super")
    pg.wait_for_function("document.querySelector('#status').dataset.state === 'ok'", timeout=10000)
    hist_remote = len(store["state"]["history"])

    # 4. cache vidé → rechargement : tout revient de la feuille
    pg.evaluate("localStorage.clear()")
    pg.reload(); pg.wait_for_function("document.querySelector('#status').dataset.state === 'ok'", timeout=10000)
    after_clear = pg.locator(".exo").count(), pg.text_content("#sub")

    # 5. hors-ligne : modification mise en attente, puis envoyée au retour du réseau
    ctx.set_offline(True)
    pg.click(".exo >> nth=0 >> .set >> nth=0"); pg.select_option("#fR", "12"); pg.click("text=Enregistrer la cible")
    time.sleep(1.5); st_off = pg.text_content("#status"); posts_before = store["posts"]
    ctx.set_offline(False); pg.evaluate("window.dispatchEvent(new Event('online'))")
    pg.wait_for_function("document.querySelector('#status').dataset.state === 'ok'", timeout=40000)
    synced_reps = store["state"]["exos"][0]["sets"][0]["reps"]

    pg.screenshot(path="/private/tmp/claude-501/-Users-mehdiabdesslem-CLAUDE/e8b545d5-1cc2-40c9-875c-49dbbd9ef42e/scratchpad/pwa.png")
    b.close()

print("statut initial :", st0)
print("service worker enregistré :", sw, "· manifest display :", manifest)
print("exo poussé vers la feuille :", posted1)
print("séance :", xp, "· séances dans la feuille :", hist_remote)
print("après vidage du cache : exos =", after_clear[0], "·", after_clear[1])
print("hors-ligne :", st_off, "· posts avant retour réseau :", posts_before, "· après :", store["posts"], "· reps synchronisées :", synced_reps)
print("appels refusés (mauvais jeton) :", store["bad"])
print("erreurs JS :", errors or "aucune")
