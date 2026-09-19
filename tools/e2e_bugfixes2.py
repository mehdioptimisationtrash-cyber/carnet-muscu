"""Vérifie : édition d'une cible hors séance = 1 seule série + affichage doré + reps reset à repMin.
Usage : python3 -m http.server 8000 &  puis  python3 tools/e2e_bugfixes2.py
"""
import json
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8000/"
FAKE_URL = "https://script.google.com/macros/s/FAKE/exec"
TOKEN = "c34f34c52f50ef6db3b1a960e44f8f66"
store = {"state": None}
errors = []

def fake_sheets(route, request):
    if request.method == "GET":
        body = {"ok": True, "state": store["state"]}
    else:
        payload = json.loads(request.post_data); store["state"] = payload["state"]; body = {"ok": True, "rev": payload["state"]["rev"]}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

def synced(pg): pg.wait_for_function("document.querySelector('#status').dataset.state === 'ok'", timeout=15000)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True)
    ctx.route("**/config.js", lambda r, q: r.fulfill(content_type="application/javascript", body=f"window.CARNET_CONFIG={{SHEETS_URL:'{FAKE_URL}',TOKEN:'{TOKEN}'}};"))
    ctx.route("https://script.google.com/**", fake_sheets)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.goto(BASE); pg.wait_for_function("document.querySelector('#status').textContent.includes('Google Sheets')")

    # base : exo à 4 séries, toutes 10kg x10, on simule un historique "last" pour activer les défis
    pg.fill("#addExo", "Développé assis"); pg.press("#addExo", "Enter"); synced(pg)
    default_repmin = pg.evaluate("JSON.parse(document.getElementById('data')?.textContent||'null')")  # noop, garde pour debug

    # ouvre la série 1 (hors séance) : un seul bouton, pas de "toutes les séries"
    pg.click(".exo >> nth=0 >> .set >> nth=0")
    btn_texts = pg.locator(".sheet .actions .btn").all_text_contents()

    # augmente la charge de la série 1 uniquement → reps doivent auto-repartir à repMin (8)
    pg.select_option("#fC", "16")
    reps_after_bump = pg.input_value("#fR")
    hint = pg.text_content(".sheet .hint")
    pg.click("text=/Enregistrer la cible/")
    synced(pg)
    s1 = pg.locator(".exo >> nth=0 >> .set >> nth=0")
    s2 = pg.locator(".exo >> nth=0 >> .set >> nth=1")
    charges = pg.locator(".exo >> nth=0 >> .set .ch").all_text_contents()

    # pas de défi affiché tant qu'il n'y a pas d'historique "last" -> on le vérifie autrement :
    # on force un "last" en base pour simuler une séance précédente, puis on relève encore la charge
    pg.evaluate("""() => {
        const raw = JSON.parse(localStorage.getItem('carnet-muscu-v2'));
        const e = raw.exos[0];
        e.last = e.sets.map(s => ({ charge: 10, reps: 10, done: true }));  // dernière fois : 10kg partout
        localStorage.setItem('carnet-muscu-v2', JSON.stringify(raw));
        location.reload();
    }""")
    pg.wait_for_function("document.querySelector('#status').dataset.state === 'ok'", timeout=15000)
    chal_class_s1 = pg.get_attribute(".exo >> nth=0 >> .set >> nth=0", "class")   # série 1 = 16kg > last 10kg → doit être .chal
    chal_class_s2 = pg.get_attribute(".exo >> nth=0 >> .set >> nth=1", "class")   # série 2 = 10kg = last → pas de défi
    zap = pg.locator(".exo >> nth=0 >> .set >> nth=0 >> .zap").count()
    bg = pg.eval_on_selector(".exo >> nth=0 >> .set >> nth=0", "el => getComputedStyle(el).backgroundColor")

    b.close()

print("boutons dans la feuille d'édition (hors séance) :", btn_texts)
print("après avoir choisi 16 kg → reps auto :", reps_after_bump, "| indice affiché :", hint)
print("charges après édition (série 2+ inchangées) :", charges)
print("classe série 1 (doit contenir 'chal') :", chal_class_s1)
print("classe série 2 (ne doit PAS contenir 'chal') :", chal_class_s2)
print("badge ⚡ présent :", zap, "| couleur de fond série 1 :", bg)
print("erreurs JS :", errors or "aucune")
