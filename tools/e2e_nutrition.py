"""Vérifie le journal nutrition : saisie rapide (taille/protéines), collations, alcool, favoris, libre, objectifs,
calendrier, synchro par jour (script Google v2 simulé) et retour après vidage du cache.
Usage : python3 -m http.server 8000 &  puis  python3 tools/e2e_nutrition.py
"""
import json
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8000/"
FAKE_URL = "https://script.google.com/macros/s/FAKE/exec"
TOKEN = "c34f34c52f50ef6db3b1a960e44f8f66"
store = {"state": None, "days": {}, "posts": [], "v": 2}
errors = []

def fake_sheets(route, request):
    if request.method == "GET":
        s = dict(store["state"], nutrition=store["days"]) if store["state"] else None
        body = {"ok": True, "v": store["v"], "state": s}
    else:
        payload = json.loads(request.post_data)
        store["posts"].append({"bytes": len(request.post_data), "days": list((payload.get("days") or {}).keys()), "has_nutrition_in_state": "nutrition" in payload["state"]})
        store["state"] = payload["state"]
        if store["v"] >= 2: store["days"].update(payload.get("days") or {})
        body = {"ok": True, "v": store["v"], "rev": payload["state"]["rev"]}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

def fake_off(route, request):
    route.fulfill(status=200, content_type="application/json", body=json.dumps({"products": [
        {"product_name": "Skyr nature", "brands": "Siggi's", "serving_quantity": 150, "nutriments": {"energy-kcal_100g": 63, "proteins_100g": 11}}]}))

def synced(pg): pg.wait_for_function("document.querySelector('#status').dataset.state === 'ok'", timeout=15000)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True)
    ctx.route("**/config.js", lambda r, q: r.fulfill(content_type="application/javascript", body=f"window.CARNET_CONFIG={{SHEETS_URL:'{FAKE_URL}',TOKEN:'{TOKEN}'}};"))
    ctx.route("https://script.google.com/**", fake_sheets)
    ctx.route("https://world.openfoodfacts.org/**", fake_off)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.goto(BASE); pg.wait_for_function("document.querySelector('#status').textContent.includes('Google Sheets')")
    pg.click("#tabJournal"); pg.wait_for_selector(".week")

    # objectifs depuis le profil : 36 ans, 187 cm, 112 kg, légèrement actif
    pg.click("text=Calculer mes objectifs"); pg.fill("#pAge", "36"); pg.fill("#pH", "187"); pg.fill("#pW", "112"); pg.select_option("#pAct", "1.4")
    pg.click(".sheet >> text=Calculer mes objectifs"); targets = pg.input_value("#tKcal"), pg.input_value("#tProt"); why = pg.text_content(".sheet .hint")
    pg.click(".sheet >> text=Enregistrer"); synced(pg)

    # déjeuner copieux + bonne portion de protéines (saisie rapide)
    pg.click("#add-dej"); pg.select_option("#qSize", "copieux"); pg.select_option("#qProt", "bonne"); est = pg.text_content(".estimate")
    pg.fill("#qLabel", "Resto burger"); pg.click(".sheet >> text=Ajouter"); synced(pg)
    # collation + 2 bières + soda
    pg.click("#add-col"); pg.click(".pick >> text=Skyr"); synced(pg)
    for _ in range(2): pg.click("#add-boi"); pg.click(".pick >> text=Pinte 50 cl"); synced(pg)
    # recherche Open Food Facts → quantité
    pg.click("#add-pdj"); pg.click(".mode >> text=Recherche"); pg.fill("#sQ", "skyr"); pg.click(".sheet >> text=Chercher")
    pg.click(".pick >> text=Skyr nature"); pg.fill("#sG", "300"); off_est = pg.text_content(".estimate"); pg.click(".sheet >> text=Ajouter"); synced(pg)
    # libre + favori
    pg.click("#add-din"); pg.click(".mode >> text=Libre"); pg.fill("#fLabel", "Poulet riz maison"); pg.fill("#fKcal", "720"); pg.fill("#fProt", "52"); pg.click(".sheet >> text=Ajouter"); synced(pg)
    pg.click(".meal >> text=Poulet riz maison"); pg.click("text=Ajouter aux favoris"); synced(pg)
    pg.click("#add-din"); pg.click(".mode >> text=Favoris"); favs = pg.locator(".pick span").all_text_contents(); pg.click(".veil", position={"x": 5, "y": 5})

    gauges = pg.locator(".gauge-top span").all_text_contents(); chips = pg.locator(".daycard .chip").all_text_contents()
    today_cell = pg.get_attribute(".wk-day.sel", "class"), pg.text_content(".wk-day.sel .m")
    xp = pg.text_content("#xpNow")
    pg.fill("#dayNote", "Resto le midi"); pg.press("#dayNote", "Enter"); pg.locator("#dayNote").blur(); synced(pg)

    # veille : naviguer dans le calendrier et saisir un repas
    pg.locator(".wk-day:not(:disabled)").first.click() if pg.locator(".wk-day:not(:disabled)").count() > 1 else None
    pg.click("#tabStats"); tiles = pg.locator("#viewStats .tiles").last.locator(".tile").all_text_contents(); axes = pg.locator(".axes .ax b").all_text_contents()
    pg.screenshot(path="/private/tmp/claude-501/-Users-mehdiabdesslem-CLAUDE/e8b545d5-1cc2-40c9-875c-49dbbd9ef42e/scratchpad/stats-nutri.png", full_page=True)
    pg.click("#tabJournal")
    pg.screenshot(path="/private/tmp/claude-501/-Users-mehdiabdesslem-CLAUDE/e8b545d5-1cc2-40c9-875c-49dbbd9ef42e/scratchpad/journal.png", full_page=True)

    # cache vidé → tout revient de la feuille (onglet nutrition)
    pg.evaluate("localStorage.clear()"); pg.reload(); synced(pg); pg.click("#tabJournal"); pg.wait_for_selector(".week")
    pg.locator(".wk-day.today").click()
    back = pg.locator(".meal").count(), pg.locator(".gauge-top span").first.text_content(), pg.input_value("#dayNote")
    b.close()

day = list(store["days"].values())[-1]
print("objectifs calculés (kcal, prot) :", targets, "|", why[:90], "…")
print("estimation rapide :", est, "| OFF 300 g :", off_est)
print("jauges :", gauges, "| chips :", chips, "| cellule du jour :", today_cell, "| XP :", xp)
print("favoris :", favs)
print("stats nutrition :", tiles)
print("axes :", axes)
print("feuille : jours =", list(store["days"].keys()), "| repas =", len(day["meals"]), "| note =", day.get("note"), "| xp flags =", day.get("xp"))
print("POST : nb =", len(store["posts"]), "| taille max =", max(x["bytes"] for x in store["posts"]), "octets | nutrition dans state ? ", any(x["has_nutrition_in_state"] for x in store["posts"]))
print("après vidage du cache : repas =", back[0], "| calories =", back[1], "| note =", back[2])
print("erreurs JS :", errors or "aucune")
