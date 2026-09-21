"""Vérifie le cardio chronométré (avant/après) et le pont Apple (Raccourcis iOS, simulé).
Usage : python3 -m http.server 8000 &  puis  python3 tools/e2e_cardio.py
"""
import json, time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8000/"
FAKE_URL = "https://script.google.com/macros/s/FAKE/exec"
TOKEN = "c34f34c52f50ef6db3b1a960e44f8f66"
store = {"state": None}
errors = []

def fake_sheets(route, request):
    if request.method == "GET": body = {"ok": True, "state": store["state"]}
    else:
        payload = json.loads(request.post_data); store["state"] = payload["state"]; body = {"ok": True, "rev": payload["state"]["rev"]}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

def synced(pg): pg.wait_for_function("document.querySelector('#status').dataset.state === 'ok'", timeout=15000)
def log(pg): return pg.evaluate("window.__shortcutLog.slice()")
def toast(pg):
    t = pg.locator(".toast"); txt = t.text_content() if t.count() else None
    if t.count(): t.click()
    return txt

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True)
    ctx.add_init_script("window.__shortcutLog = [];")
    ctx.route("**/config.js", lambda r, q: r.fulfill(content_type="application/javascript", body=f"window.CARNET_CONFIG={{SHEETS_URL:'{FAKE_URL}',TOKEN:'{TOKEN}'}};"))
    ctx.route("https://script.google.com/**", fake_sheets)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.goto(BASE); pg.wait_for_function("document.querySelector('#status').textContent.includes('Google Sheets')")

    pg.fill("#addExo", "Développé assis"); pg.press("#addExo", "Enter"); synced(pg)
    # active le pont Apple
    pg.click("#btnSettings"); pg.select_option("#gApple", "oui")
    pg.click("text=Comment ça marche"); help_items = pg.locator(".sheet .list li b").all_text_contents()
    pg.click(".sheet .actions >> text=Retour"); pg.select_option("#gApple", "oui"); pg.click(".sheet .actions >> text=Enregistrer"); synced(pg)

    # séance avec cardio avant (marche) + après (elliptique)
    pg.click("#btnStart"); pg.select_option("#scAvant", "marche")
    pg.click(".sheet .actions .btn.primary"); pg.wait_for_selector("#dock:not([hidden])")
    at_start = log(pg)                                   # rien : le cardio avant lancera la montre
    pg.click("#cardio-avant >> text=Démarrer"); toast1 = toast(pg); time.sleep(2.2)
    running_time = pg.text_content("#cardio-avant .cardio-time")
    pg.click("#cardio-avant >> text=Arrêter"); toast2 = toast(pg)
    after_warmup = log(pg)                               # Muscu Marche puis Muscu Renfo
    pg.click(".exo >> nth=0 >> .set >> nth=0"); pg.click("text=/Réussie/")
    pg.click("#btnFinish"); end_q = pg.text_content(".sheet h3"); pg.select_option("#ecType", "elliptique"); pg.click("text=Oui, lancer le cardio"); toast(pg); time.sleep(1.2)
    running_end = "running" in pg.get_attribute("#cardio-apres", "class"); pg.click("#cardio-apres >> text=Arrêter")
    pg.click("#cardio-apres >> text=Corriger"); pg.select_option("#cfMin", "12"); pg.click(".sheet >> text=Enregistrer")
    fixed_time = pg.text_content("#cardio-apres .cardio-time")
    pg.click("#btnFinish"); pg.wait_for_selector(".summary"); toast3 = toast(pg)
    cardio_line = pg.locator(".summary .list li").filter(has_text="Cardio").all_text_contents()
    xp = pg.text_content(".xp-big")
    final_log = log(pg)
    pg.click(".summary .actions .btn"); synced(pg)
    hist = store["state"]["history"][-1]
    pg.click("#tabStats")
    tiles = pg.locator("#viewStats .tiles").first.locator(".tile").all_text_contents()
    axes = pg.locator(".axes .ax b").all_text_contents()

    # mémoire du choix + séance cardio seul
    pg.click("#tabSeance"); pg.click("#btnStart")
    remembered = pg.input_value("#scAvant")
    pg.select_option("#scAvant", "none"); pg.click(".sheet .actions .btn.primary"); pg.wait_for_selector("#dock:not([hidden])"); toast(pg)
    no_warmup_log = log(pg)[len(final_log):]             # sans cardio avant : Renfo lancé dès le départ
    # annuler la séance : rien n'est enregistré
    pg.click(".exo >> nth=0 >> .set >> nth=0"); pg.click("text=/Réussie/")
    before = pg.text_content("#xpNow"), pg.text_content("#sub")
    pg.once("dialog", lambda d: d.accept()); pg.click("#btnCancelTop"); toast(pg)
    cancelled = pg.locator("#dock").is_hidden(), pg.locator("#btnStart").is_visible(), (pg.text_content("#xpNow"), pg.text_content("#sub")) == before
    pg.screenshot(path="/private/tmp/claude-501/-Users-mehdiabdesslem-CLAUDE/e8b545d5-1cc2-40c9-875c-49dbbd9ef42e/scratchpad/cardio.png")
    b.close()

print("aide raccourcis :", help_items)
print("au démarrage (cardio avant prévu) :", at_start, "| chrono en marche :", running_time)
print("après l'échauffement :", after_warmup)
print("rappels affichés :", toast1, "|", toast2, "|", toast3)
print("question de fin :", end_q, "| chrono lancé direct :", running_end)
print("durée corrigée :", fixed_time, "| résumé :", cardio_line, "|", xp)
print("raccourcis lancés sur toute la séance :", final_log)
print("historique.cardio :", hist.get("cardio"))
print("tuiles :", tiles)
print("axes :", axes)
print("choix mémorisé :", remembered, "| séance sans cardio avant → ", no_warmup_log)
print("annulation (barre masquée, bouton Démarrer revenu, XP/historique inchangés) :", cancelled)
print("erreurs JS :", errors or "aucune")
