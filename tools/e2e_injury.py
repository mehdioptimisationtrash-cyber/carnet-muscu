"""Vérifie : ▶ avant chaque série (coupe le repos, repos réel mesuré), 🥵 très difficile, blessure (pause, allègement, douleur),
moyennes de repos dans Stats, relecture d'une feuille plus récente (app restée ouverte).
Usage : python3 -m http.server 8000 &  puis  python3 tools/e2e_injury.py
"""
import json, datetime
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8000/"
FAKE_URL = "https://script.google.com/macros/s/FAKE/exec"
d = lambda n: (datetime.date.today() - datetime.timedelta(days=n)).isoformat()
mk = lambda i, n, c, cat, stack=None: {"id": i, "name": n, "cat": cat, "mode": "reps", "step": 2, "repMin": 8, "repMax": 15, **({"stack": stack} if stack else {}),
                                     "sets": [{"charge": c, "reps": 10}] * 3, "last": None, "best": None, "stalled": 0}
exos = [mk("ef", "Élévation frontale poulie", 30, "devant", [23, 30, 36]), mk("dc", "Développé couché", 40, "devant", [30, 35, 40, 45]), mk("lp", "Leg press", 170, "devant")]
store = {"state": {"v": 2, "rev": 1, "xp": 0, "settings": {}, "session": None, "weights": [], "exos": exos, "history": [], "injuries": []}}
errors = []
def fake(route, req):
    if req.method == "GET": body = {"ok": True, "v": 6, "state": store["state"]}
    else: store["state"] = json.loads(req.post_data)["state"]; body = {"ok": True, "v": 6}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
def check(c, m):
    print(("OK   " if c else "FAIL ") + m)
    if not c: raise SystemExit(1)
def synced(pg): pg.wait_for_function("document.querySelector('#status').dataset.state === 'ok'", timeout=15000)

with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True)
    ctx.route("**/config.js", lambda r, q: r.fulfill(content_type="application/javascript", body=f"window.CARNET_CONFIG={{SHEETS_URL:'{FAKE_URL}',TOKEN:'t'}};"))
    ctx.route("https://script.google.com/**", fake)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e))); pg.clock.install()
    pg.goto(BASE); synced(pg)

    # --- déclaration : claquage épaule léger il y a 5 jours (phase 2)
    pg.click("#btnInjury")
    pg.select_option("#ijZone", "epaule")
    check(pg.input_value("#ij-ef") == "stop" and pg.input_value("#ij-dc") == "reduce" and pg.input_value("#ij-lp") == "", "exercices concernés proposés selon la zone")
    pg.click("#ijSave"); synced(pg)
    pg.evaluate(f"""() => {{ const s = window.App.state; window.App.commit({{ ...s, injuries: s.injuries.map(i => ({{ ...i, date: '{d(1)}' }})) }}); }}""")
    check(pg.locator("#x-ef.paused").count() == 1, "phase 1 : élévation frontale en pause")
    check("Phase 1/4" in pg.text_content(".injury"), "bandeau blessure phase 1")
    pg.evaluate(f"""() => {{ const s = window.App.state; window.App.commit({{ ...s, injuries: s.injuries.map(i => ({{ ...i, date: '{d(5)}' }})) }}); }}""")
    check(pg.locator("#x-ef .set:not(.add-set)").count() == 2 and "23 kg" in pg.text_content("#x-ef .sets") and "15" in pg.text_content("#x-ef .sets"), "phase 2 : 2 séries × 15 à la plus petite plaque")

    # --- séance : ▶ coupe le repos et mesure le vrai repos
    pg.click("#btnStart"); pg.click("text=/^Démarrer$/")
    check(pg.locator("#go-dc-0").count() == 1, "▶ devant la première série")
    pg.click("#go-dc-0")
    check("running" in pg.get_attribute("#s-dc-0", "class"), "série en cours")
    pg.clock.run_for(40_000); pg.click("#s-dc-0"); pg.click("text=/Réussie/"); pg.click("#feel-4")
    check(pg.is_visible("#rest"), "repos lancé après validation")
    pg.clock.run_for(100_000)
    pg.click("#go-dc-1")
    check(not pg.is_visible("#rest"), "▶ coupe le repos")
    pg.clock.run_for(40_000); pg.click("#s-dc-1"); pg.click("text=/Réussie/"); pg.click("#feel-2")
    st = pg.evaluate("window.App.state.session.results.dc")
    check(round((st[1]["start"] - st[0]["at"]) / 1000) == 100, "repos réel chronométré = 100 s")
    check(st[0]["rest"] == 180, f"repos proposé après 🥵 sur polyarticulaire = 3:00 ({st[0]['rest']})")
    check(st[0]["charge"] == 30, "développé couché allégé (indirect) : 70 % de 40 → 30 kg")
    # douleur sur l'exercice blessé
    pg.click("#go-ef-0"); pg.click("#s-ef-0"); pg.click("text=/Réussie/")
    pg.click("#feel-pain")
    st = pg.evaluate("window.App.state")
    check(st["session"]["results"]["ef"][1]["done"] is False and len(st["injuries"][0]["pains"]) == 1, "douleur : exercice arrêté, phase prolongée")
    pg.click("#btnFinish"); pg.click("text=/Non, terminer/"); pg.wait_for_selector(".summary")
    st = pg.evaluate("window.App.state")
    ef = next(e for e in st["exos"] if e["id"] == "ef"); dc = next(e for e in st["exos"] if e["id"] == "dc")
    check(ef["sets"][0]["charge"] == 30 and dc["sets"][0]["charge"] == 40, "cibles d'avant blessure conservées")
    pg.click(".summary .btn.primary.big")
    pg.click("#tabStats")
    stats = pg.text_content("#viewStats")
    check("Temps de repos" in stats and "1:40" in stats and "Chronométrés" in stats, "Stats : moyennes de repos")
    check("phase" in stats.lower() and "Épaule" in stats, "Stats : axe blessure")

    # --- app restée ouverte : la feuille a été corrigée ailleurs → relue au retour au premier plan
    pg.clock.run_for(3000); synced(pg)   # dernière sauvegarde partie
    remote = dict(store["state"]); remote["rev"] = st["rev"] + 1000
    remote["exos"] = [dict(e, name="Développé couché corrigé") if e["id"] == "dc" else e for e in remote["exos"]]
    store["state"] = remote
    pg.evaluate("window.Steps.refresh(true)"); pg.wait_for_timeout(300)
    check(any(e["name"] == "Développé couché corrigé" for e in pg.evaluate("window.App.state.exos")), "version plus récente de la feuille reprise (pas d'écrasement)")
    check(not errors, f"aucune erreur JS {errors}")
    b.close()
print("e2e blessure OK")
