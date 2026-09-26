"""Vérifie les 3 corrections : exo ajouté en séance, pile de plaques, fusion des séances du même jour.
Usage : python3 -m http.server 8000 &  puis  python3 tools/e2e_bugfixes.py
"""
import json
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8000/"
FAKE_URL = "https://script.google.com/macros/s/FAKE/exec"
TOKEN = "c34f34c52f50ef6db3b1a960e44f8f66"
store = {"state": None, "posts": 0}
errors = []

def fake_sheets(route, request):
    if request.method == "GET":
        ok = f"token={TOKEN}" in request.url
        body = {"ok": True, "state": store["state"]} if ok else {"ok": False, "error": "unauthorized"}
    else:
        payload = json.loads(request.post_data)
        store["posts"] += 1; store["state"] = payload["state"]; body = {"ok": True, "rev": payload["state"]["rev"]}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

def synced(pg): pg.wait_for_function("document.querySelector('#status').dataset.state === 'ok'", timeout=15000)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True)
    # pop-up de ressenti (coach.js) : ce test ne s'y intéresse pas → réponse « Moyen » automatique
    ctx.add_init_script("new MutationObserver(() => document.getElementById('feel-2')?.click()).observe(document, { childList: true, subtree: true });")
    ctx.route("**/config.js", lambda r, q: r.fulfill(content_type="application/javascript", body=f"window.CARNET_CONFIG={{SHEETS_URL:'{FAKE_URL}',TOKEN:'{TOKEN}'}};"))
    ctx.route("https://script.google.com/**", fake_sheets)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.goto(BASE); pg.wait_for_function("document.querySelector('#status').textContent.includes('Google Sheets')")

    # --- Bug 1 : ajouter un exercice pendant une séance en cours ---
    pg.fill("#addExo", "Développé assis"); pg.press("#addExo", "Enter"); synced(pg)
    pg.click("#btnStart"); pg.click(".sheet .actions .btn.primary"); pg.wait_for_selector("#dock:not([hidden])")
    pg.fill("#addExo", "Lat pulldown"); pg.press("#addExo", "Enter"); synced(pg)   # ajouté EN COURS de séance
    before_crash = len(errors)
    pg.click(".exo >> nth=1 >> .set >> nth=0")   # doit ouvrir la feuille, pas planter
    opened = pg.locator(".sheet").count()
    pg.select_option("#fC", "12"); pg.select_option("#fR", "8"); pg.click("text=Valider ces valeurs")
    reps_after = pg.text_content(".exo >> nth=1 >> .set >> nth=0 >> .reps")
    bug1_errors = len(errors) - before_crash

    # --- Bug 2 : pile de plaques, snap immédiat des charges existantes ---
    pg.click(".exo >> nth=0 >> .exo-menu")
    charge_before = pg.text_content(".exo >> nth=0 >> .set >> nth=0 >> .ch")   # 10 kg par défaut
    pg.fill("#mStack", "9, 16, 23, 30, 36, 43, 50")
    pg.click("text=Enregistrer les réglages"); synced(pg)
    charge_after = pg.text_content(".exo >> nth=0 >> .set >> nth=0 >> .ch")    # doit être snappé (9 kg, plaque la + proche de 10)
    pg.click(".exo >> nth=0 >> .set >> nth=0")
    opts = pg.locator("#fC option").all_text_contents()
    pg.click(".veil", position={"x": 5, "y": 5})

    # finir la séance
    for i in range(2): pg.click(f".exo >> nth={i} >> .set >> nth=1"); pg.click("text=/Réussie|Valider ces valeurs/")
    pg.click("#btnFinish"); pg.click("text=Non, terminer la séance"); pg.wait_for_selector(".summary")
    week1 = pg.text_content(".summary .sub")
    pg.click(".summary .actions .btn"); synced(pg)
    chip1 = pg.locator(".chips-top .chip").first.text_content()

    # --- Bug 3 : séance coupée puis reprise le même jour → fusion, pas de doublon ---
    pg.click("#btnStart"); pg.click(".sheet .actions .btn.primary"); pg.wait_for_selector("#dock:not([hidden])")
    pg.click(".exo >> nth=0 >> .set >> nth=2"); pg.click("text=/Réussie/")
    pg.click("#btnFinish"); pg.click("text=Non, terminer la séance"); pg.wait_for_selector(".summary")
    continuation_notice = pg.locator(".summary .hint").first.text_content()
    pg.click(".summary .actions .btn"); synced(pg)
    chip2 = pg.locator(".chips-top .chip").first.text_content()
    n_history_days = len(set(h["date"] for h in store["state"]["history"]))
    n_history_entries = len(store["state"]["history"])

    b.close()

print("Bug 1 — exo ajouté en séance : sheet ouverte :", opened, "| erreurs JS pendant le clic :", bug1_errors, "| reps validées :", reps_after)
print("Bug 2 — pile de plaques : charge avant :", charge_before, "→ après saisie :", charge_after, "| options dropdown :", opts)
print("chip semaine (1re séance) :", chip1)
print("Bug 3 — reprise même jour : bandeau :", continuation_notice)
print("chip semaine (après reprise) :", chip2, "| jours distincts dans l'historique :", n_history_days, "| entrées historique :", n_history_entries)
print("erreurs JS au total :", errors or "aucune")
