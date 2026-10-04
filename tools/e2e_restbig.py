"""Vérifie : gros chrono en haut (visible pendant le repos, le reste reste cliquable), ▶ « série suivante » dans le chrono,
dépassement compté en vert, échec net → cible recalée sur la force du jour (cas de la poulie triceps du 02/10).
Usage : python3 -m http.server 8000 &  puis  python3 tools/e2e_restbig.py
"""
import json
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8000/"
FAKE_URL = "https://script.google.com/macros/s/FAKE/exec"
tri = {"id": "tr", "name": "Poulie triceps", "cat": "derriere", "mode": "reps", "step": 2, "repMin": 8, "repMax": 15, "stack": [14, 18, 23, 30],
       "sets": [{"charge": 18, "reps": 14}, {"charge": 18, "reps": 14}, {"charge": 18, "reps": 13}, {"charge": 18, "reps": 13}], "last": None, "best": None, "stalled": 0}
store = {"state": {"v": 2, "rev": 1, "xp": 0, "settings": {}, "session": None, "weights": [], "exos": [tri], "history": []}}
errors = []
def fake(route, req):
    if req.method == "GET": body = {"ok": True, "v": 6, "state": store["state"]}
    else: store["state"] = json.loads(req.post_data)["state"]; body = {"ok": True, "v": 6}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
def check(c, m):
    print(("OK   " if c else "FAIL ") + m)
    if not c: raise SystemExit(1)

with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True)
    ctx.route("**/config.js", lambda r, q: r.fulfill(content_type="application/javascript", body=f"window.CARNET_CONFIG={{SHEETS_URL:'{FAKE_URL}',TOKEN:'t'}};"))
    ctx.route("https://script.google.com/**", fake)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e))); pg.clock.install()
    pg.goto(BASE); pg.wait_for_function("document.querySelector('#status').dataset.state === 'ok'", timeout=15000)
    pg.click("#btnStart"); pg.click("text=/^Démarrer$/")
    # série 1 : 18×10 🙂
    pg.click("#go-tr-0"); pg.click("#s-tr-0"); pg.select_option("#fR", "10"); pg.click("text=Valider ces valeurs"); pg.click("#feel-2")
    box = pg.locator("#restBig .rb-card").bounding_box()
    check(pg.is_visible("#restBig") and box["y"] < 60 and box["height"] > 70, f"gros chrono en haut de l'écran ({int(box['y'])} px, {int(box['height'])} px de haut)")
    check(pg.evaluate("getComputedStyle(document.querySelector('#restBig')).pointerEvents") == "none", "le chrono ne bloque pas les clics autour")
    check("Poulie triceps · S2" in pg.text_content("#restBigNext"), "le chrono propose la série suivante")
    pg.clock.run_for(200_000)
    check(pg.text_content("#restBigTxt").startswith("+") and "over" in pg.get_attribute("#restBig", "class"), f"dépassement compté ({pg.text_content('#restBigTxt')})")
    pg.click("#restBigGo")
    check(not pg.is_visible("#restBig") and "running" in pg.get_attribute("#s-tr-1", "class"), "▶ du chrono lance la série suivante")
    # séries 2–4 : 18×10 😣, 18×7 🥵, 14×10 😣
    for i, (c, r, f) in enumerate([(18, 10, 3), (18, 7, 4), (14, 10, 3)], start=1):
        if i > 1: pg.click("#restBigGo")
        pg.click(f"#s-tr-{i}"); pg.select_option("#fC", str(c)); pg.select_option("#fR", str(r)); pg.click("text=Valider ces valeurs"); pg.click(f"#feel-{f}")
    pg.click("#btnFinish"); pg.click("text=/Non, terminer/"); pg.wait_for_selector(".summary")
    sets = pg.evaluate("window.App.state.exos[0].sets")
    check(all(s["charge"] == 14 and 8 <= s["reps"] <= 13 for s in sets) and len({(s['charge'], s['reps']) for s in sets}) == 1, f"échec net → recalé sur la force du jour : {[(s['charge'], s['reps']) for s in sets]}")
    check("échec net" in pg.text_content(".summary"), "le bilan explique le recalage")
    check(not errors, f"aucune erreur JS {errors}")
    b.close()
print("e2e chrono OK")
