"""Vérifie : pop-up de ressenti après chaque série, progression adaptée (facile +2, moyen +1, à fond = on garde),
« dernière fois » avec la charge, explications du coach dans le bilan et les stats.
Usage : python3 -m http.server 8000 &  puis  python3 tools/e2e_coach.py
"""
import json
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8000/"
FAKE_URL = "https://script.google.com/macros/s/FAKE/exec"
last = [{"charge": 40, "reps": 8, "done": True}] * 3
exo = {"id": "dc", "name": "Développé couché", "cat": "devant", "mode": "reps", "step": 2, "repMin": 8, "repMax": 15, "stack": [30, 35, 40, 45],
       "sets": [{"charge": 40, "reps": 9}] * 3, "last": last, "best": None, "stalled": 0}
store = {"state": {"v": 2, "rev": 1, "xp": 0, "settings": {}, "session": None, "weights": [], "exos": [exo],
                   "history": [{"date": "2026-09-20", "at": 1, "cat": "derriere", "min": 30, "volume": 0, "xp": 0, "setsDone": 3, "setsTotal": 3, "fails": 0, "prs": [], "paliers": [], "exos": {"dc": {"name": "Développé couché", "sets": last}}}]}}
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
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(BASE); pg.wait_for_function("document.querySelector('#status').dataset.state === 'ok'", timeout=15000)
    check("40 kg × 8 · 8 · 8" in pg.text_content("#x-dc .last"), "dernière fois affiche la charge")
    pg.click("#btnStart"); pg.click("text=/^Démarrer$/")
    for i, feel in enumerate([1, 2, 3]):
        pg.click(f"#s-dc-{i}"); pg.click("text=/Réussie/")
        check(pg.locator(".feel-ask").count() == 1, f"série {i+1} : pop-up de ressenti")
        pg.click(f"#feel-{feel}")
        check(pg.locator(".feel-ask").count() == 0, "pop-up fermée après le choix")
    check(pg.locator("#x-dc .set .feel").count() == 3, "ressenti affiché sur les pastilles")
    pg.click("#btnFinish"); pg.click("text=/Non, terminer/")
    pg.wait_for_selector(".summary")
    summ = pg.text_content(".summary")
    check("🧠" in summ and "+2 reps" in summ and "consolide" in summ, "bilan : explications du coach")
    st = pg.evaluate("JSON.parse(localStorage.getItem('carnet-muscu-v2'))")
    reps = [s["reps"] for s in st["exos"][0]["sets"]]
    check(reps == [11, 10, 9], f"cibles adaptées facile/moyen/dur = {reps}")
    check(all("why" not in s for s in st["exos"][0]["sets"]), "pas de champ technique enregistré")
    check([r.get("feel") for r in st["history"][-1]["exos"]["dc"]["sets"]] == [1, 2, 3], "ressentis gardés dans l'historique")
    pg.click(".summary .btn.primary.big")
    check("😄" in pg.text_content("#x-dc .last"), "dernière fois affiche le ressenti")
    pg.click("#tabStats")
    check("🧠" in pg.text_content("#viewStats"), "stats : conseil du coach")
    check(not errors, f"aucune erreur JS {errors}")
    b.close()
print("e2e coach OK")
