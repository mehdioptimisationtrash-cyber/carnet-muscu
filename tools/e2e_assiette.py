"""Vérifie : macros d'Assiette (recopiées par Code.gs v6) affichées dans le Journal, jamais renvoyées à la feuille, relues au premier plan.
Usage : python3 -m http.server 8000 &  puis  python3 tools/e2e_assiette.py
"""
import json, datetime
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8000/"
FAKE_URL = "https://script.google.com/macros/s/FAKE/exec"
today = datetime.date.today().isoformat()
store = {"state": {"v": 2, "rev": 1, "xp": 0, "settings": {}, "session": None, "weights": [], "exos": [], "history": [],
                   "macros": {today: {"kcal": 1850, "p": 142, "c": 190, "f": 61, "fib": 22, "at": 1790000000000}}}}
posts, errors = [], []

def fake_sheets(route, request):
    if request.method == "GET": body = {"ok": True, "v": 6, "state": store["state"]}
    else:
        payload = json.loads(request.post_data); posts.append(payload)
        store["state"] = {**payload["state"], "macros": store["state"]["macros"]}; body = {"ok": True, "v": 6}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

def check(cond, msg):
    print(("OK   " if cond else "FAIL ") + msg)
    if not cond: raise SystemExit(1)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 800}, is_mobile=True)
    ctx.route("**/config.js", lambda r, q: r.fulfill(content_type="application/javascript", body=f"window.CARNET_CONFIG={{SHEETS_URL:'{FAKE_URL}',TOKEN:'t'}};"))
    ctx.route("https://script.google.com/**", fake_sheets)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(BASE); pg.wait_for_function("document.querySelector('#status').dataset.state === 'ok'", timeout=15000)
    pg.click("#tabJournal")
    txt = pg.text_content(".daycard")
    check("1850 /" in txt and "142 /" in txt, "jauges = calories et protéines d'Assiette")
    check("glucides 190 g" in pg.text_content(".assiette-line") and "lipides 61 g" in pg.text_content(".assiette-line"), "ligne glucides / lipides")
    # une saisie dans le carnet ne doit pas renvoyer les macros
    pg.click("#btnSettings"); pg.click(".sheet .btn.primary.big")
    pg.wait_for_timeout(1800)
    check(posts and all("macros" not in x["state"] for x in posts), f"macros jamais envoyées ({len(posts)} POST)")
    # le script a recopié une nouvelle valeur → relecture au retour au premier plan
    store["state"]["macros"][today] = {"kcal": 2210, "p": 160, "c": 230, "f": 70, "fib": 25}
    pg.evaluate("window.Steps.refresh(true)")
    check("2210 /" in pg.text_content(".daycard"), "nouvelle relève Assiette affichée sans recharger")
    pg.click("#tabStats")
    check("2210" in pg.text_content("#viewStats"), "stats nutrition alimentées par Assiette")
    check(not errors, f"aucune erreur JS {errors}")
    b.close()
print("e2e assiette OK")
