"""Vérifie : séances Devant / Derrière (groupes, couleurs, alternance, bascule) et « + série » en pleine séance.
Usage : python3 -m http.server 8000 &  puis  python3 tools/e2e_categories.py
"""
import json
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8000/"
FAKE_URL = "https://script.google.com/macros/s/FAKE/exec"
TOKEN = "test"
mk = lambda i, n, c=None: {"id": i, "name": n, "mode": "reps", "step": 2, "repMin": 8, "repMax": 15, "sets": [{"charge": 20, "reps": 10}] * 3, "last": None, "best": None, "stalled": 0, **({"cat": c} if c else {})}
done = [{"charge": 20, "reps": 10, "done": True}]
store = {"state": {"v": 2, "rev": 1, "xp": 0, "settings": {}, "session": None, "weights": [],
    "exos": [mk("a", "Pecs"), mk("b", "Crunch"), mk("c", "Lat pulldown"), mk("d", "Poulie triceps")],
    # dernière séance : Pecs + Crunch (devant) → prochaine = derrière
    "history": [{"date": "2026-09-20", "at": 100, "min": 30, "volume": 0, "xp": 0, "setsDone": 2, "setsTotal": 2, "fails": 0, "prs": [], "paliers": [],
                 "exos": {"a": {"name": "Pecs", "sets": done}, "b": {"name": "Crunch", "sets": done}}}]}}
errors = []

def fake_sheets(route, request):
    if request.method == "GET": body = {"ok": True, "v": 5, "state": store["state"]}
    else:
        payload = json.loads(request.post_data); store["state"] = payload["state"]; body = {"ok": True, "v": 5}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

def synced(pg): pg.wait_for_function("document.querySelector('#status').dataset.state === 'ok'", timeout=15000)
def check(cond, msg):
    print(("OK   " if cond else "FAIL ") + msg)
    if not cond: raise SystemExit(1)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True)
    ctx.route("**/config.js", lambda r, q: r.fulfill(content_type="application/javascript", body=f"window.CARNET_CONFIG={{SHEETS_URL:'{FAKE_URL}',TOKEN:'{TOKEN}'}};"))
    ctx.route("https://script.google.com/**", fake_sheets)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(BASE); synced(pg)

    heads = pg.locator(".cat-head b").all_text_contents()
    check("Derrière" in heads[0] and "À faire" in heads[0], f"groupe à faire = Derrière ({heads})")
    check("Devant" in heads[1] and "En attente" in heads[1], "groupe en attente = Devant")
    check(pg.locator(".exo.cat-todo").count() == 2 and pg.locator(".exo.cat-wait").count() == 2, "2 exos par groupe")
    check("Derrière" in pg.text_content("#sessionTitle"), "titre : Prochaine séance : Derrière")

    # bascule manuelle
    pg.click(".cat-swap"); synced(pg)
    check("Devant" in pg.locator(".cat-head b").first.text_content(), "bascule → Devant à faire")
    pg.click(".cat-swap"); synced(pg)

    # « + série » hors séance
    pg.click("#add-c"); synced(pg)
    check(pg.locator("#x-c .set:not(.add-set)").count() == 4, "hors séance : + série → 4 séries")

    # en séance : + série apparaît tout de suite, en attente de validation
    pg.click("#btnStart"); pg.click("text=/^Démarrer$/")
    pg.click("#s-d-0"); pg.click("text=/Réussie/")
    pg.click("#add-d")
    check(pg.locator("#x-d .set:not(.add-set)").count() == 4, "en séance : + série → 4 pastilles sans terminer")
    check("pending" in pg.get_attribute("#s-d-3", "class"), "nouvelle pastille à valider")
    pg.click("#s-d-3"); pg.click("text=/Réussie/")
    check("done" in pg.get_attribute("#s-d-3", "class"), "nouvelle série validée")
    # via le menu ⋯ aussi
    pg.click("#x-d .exo-menu"); pg.click("text='+ une série'")
    check(pg.locator("#x-d .set:not(.add-set)").count() == 5, "menu ⋯ + une série en séance → 5")
    pg.click("#x-d .exo-menu"); pg.click("text='− dernière série'")
    check(pg.locator("#x-d .set:not(.add-set)").count() == 4, "menu ⋯ − dernière série en séance → 4")
    pg.click("#s-c-0"); pg.click("text=/Réussie/")
    pg.click("#btnFinish"); pg.click("text=/Non, terminer/"); synced(pg)
    st = pg.evaluate("JSON.parse(localStorage.getItem('carnet-muscu-v2'))")
    h = st["history"][-1]
    check(h["cat"] == "derriere", "séance enregistrée comme Derrière")
    check(len(h["exos"]["d"]["sets"]) == 4 and sum(r["done"] for r in h["exos"]["d"]["sets"]) == 2, "triceps : 4 séries dont 2 faites")
    pg.click(".veil", position={"x": 5, "y": 5}) if pg.locator(".veil").count() else None
    check("Devant" in pg.locator(".cat-head b").first.text_content(), "après une séance Derrière → Devant à faire")
    # nouvel exo rangé d'après son nom
    pg.fill("#addExo", "Leg curl"); pg.press("#addExo", "Enter"); synced(pg)
    check(pg.evaluate("JSON.parse(localStorage.getItem('carnet-muscu-v2')).exos.at(-1).cat") == "derriere", "Leg curl rangé dans Derrière")
    pg.screenshot(path="/tmp/carnet-categories.png", full_page=True)
    check(not errors, f"aucune erreur JS {errors}")
    b.close()
print("e2e categories OK")
