"""Test de bout en bout en local : PWA + synchro Google Sheets simulée + défis / échecs / séance légère.
Usage : python3 -m http.server 8000 &  puis  python3 tools/e2e_local.py
"""
import json, time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8000/"
FAKE_URL = "https://script.google.com/macros/s/FAKE/exec"
TOKEN = "c34f34c52f50ef6db3b1a960e44f8f66"
store = {"state": None, "posts": 0, "bad": 0}
errors = []

def fake_sheets(route, request):
    if request.method == "GET":
        ok = f"token={TOKEN}" in request.url
        body = {"ok": True, "state": store["state"]} if ok else {"ok": False, "error": "unauthorized"}
    else:
        payload = json.loads(request.post_data)
        if payload.get("token") != TOKEN: store["bad"] += 1; body = {"ok": False, "error": "unauthorized"}
        else: store["posts"] += 1; store["state"] = payload["state"]; body = {"ok": True, "rev": payload["state"]["rev"]}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

def synced(pg): pg.wait_for_function("document.querySelector('#status').dataset.state === 'ok'", timeout=15000)
def start(pg, light=False):
    pg.click("#btnStart"); pg.wait_for_selector(".sheet")
    pg.click("text=Séance légère" if light else "text=Séance normale"); pg.wait_for_selector("#dock:not([hidden])")
def finish(pg):
    pg.click("#btnFinish"); pg.wait_for_selector(".summary")
    out = {"xp": pg.text_content(".xp-big"), "items": pg.locator(".summary .list li").all_text_contents(), "choices": pg.locator(".choice b").all_text_contents()}
    return out

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True)
    ctx.route("**/config.js", lambda r, q: r.fulfill(content_type="application/javascript", body=f"window.CARNET_CONFIG={{SHEETS_URL:'{FAKE_URL}',TOKEN:'{TOKEN}'}};"))
    ctx.route("https://script.google.com/**", fake_sheets)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    pg.goto(BASE); pg.wait_for_function("document.querySelector('#status').textContent.includes('Google Sheets')")
    sw = pg.evaluate("navigator.serviceWorker.getRegistration().then(r => !!r)")

    # séance 1 : base (3 séries réussies)
    pg.fill("#addExo", "Développé couché"); pg.press("#addExo", "Enter"); synced(pg)
    start(pg)
    for i in range(3): pg.click(".exo >> nth=0 >> .set >> nth=%d" % i); pg.click("text=/Réussie/")
    s1 = finish(pg); pg.click(".summary .actions .btn"); synced(pg)
    tip1 = pg.text_content(".exo >> nth=0 >> .tip"); meta1 = pg.text_content("#sessionMeta"); btn1 = pg.text_content("#btnStart")
    zaps = pg.locator(".set.chal").count()

    # séance 2 : défi S1 raté (9 reps), S2 "trop lourd → alléger la suite", S3 réussie à la charge allégée
    start(pg)
    pg.click(".exo >> nth=0 >> .set >> nth=0"); pg.select_option("#fR", "9"); pg.click("text=Valider ces valeurs")
    pg.click(".exo >> nth=0 >> .set >> nth=1"); pg.click("text=/Trop lourd/")
    s3_target = pg.text_content(".exo >> nth=0 >> .set >> nth=2 >> .ch")
    pg.click(".exo >> nth=0 >> .set >> nth=2"); pg.click("text=/Réussie/")
    s2 = finish(pg)
    # choix : garder ce que j'ai fait
    pg.click(".choice .row3 >> text=Garder ce que j’ai fait"); picked = pg.text_content(".choice .picked")
    pg.click(".summary .actions .btn"); synced(pg)
    sets_after = pg.locator(".exo >> nth=0 >> .set .reps").all_text_contents(), pg.locator(".exo >> nth=0 >> .set .ch").all_text_contents()

    # séance 3 : légère → cibles inchangées, XP ÷ 2
    start(pg, light=True)
    light_charge = pg.text_content(".exo >> nth=0 >> .set >> nth=0 >> .ch")
    pg.click(".exo >> nth=0 >> .set >> nth=0"); pg.click("text=/Réussie/")
    s3 = finish(pg); pg.click(".summary .actions .btn"); synced(pg)
    sets_after_light = pg.locator(".exo >> nth=0 >> .set .ch").all_text_contents()

    # pile de plaques (machine) : options de charge = plaques, palier = plaque suivante
    pg.click(".exo >> nth=0 >> .exo-menu"); pg.fill("#mStack", "9, 16, 23, 30, 36, 43, 50"); hint = pg.text_content(".field.wide .hint")
    pg.click("text=Enregistrer les réglages"); synced(pg)
    pg.click(".exo >> nth=0 >> .set >> nth=0"); opts = pg.locator("#fC option").all_text_contents(); pg.click(".veil", position={"x": 5, "y": 5})
    tip_stack = pg.text_content(".exo >> nth=0 >> .tip")

    # réglages + poids
    pg.click("#btnSettings"); pg.select_option("#gRest", "120"); pg.select_option("#gGoal", "4"); pg.click("text=Enregistrer"); synced(pg)
    chip = pg.locator(".chips-top .chip").first.text_content()
    pg.click("#tabJournal"); pg.fill("#wIn", "112.4"); pg.press("#wIn", "Enter"); synced(pg); pg.click("#tabStats")
    weight_tiles = pg.locator("#viewStats .tiles").nth(1).locator(".tile .v").all_text_contents()
    axes = pg.locator(".axes .ax b").all_text_contents()
    pg.screenshot(path="/private/tmp/claude-501/-Users-mehdiabdesslem-CLAUDE/e8b545d5-1cc2-40c9-875c-49dbbd9ef42e/scratchpad/stats2.png", full_page=True)

    # cache vidé → tout revient
    pg.evaluate("localStorage.clear()"); pg.reload(); synced(pg)
    back = pg.locator(".exo").count(), pg.text_content("#sub"), json.dumps(store["state"]["settings"]), len(store["state"]["weights"])
    b.close()

print("SW :", sw)
print("S1 :", s1["xp"], "| tip après :", tip1, "| meta :", meta1, "| bouton :", btn1, "| pastilles défi :", zaps)
print("S2 : cible S3 après allègement :", s3_target, "|", s2["xp"], "| choix proposés :", s2["choices"], "| choisi :", picked)
print("     items :", s2["items"])
print("     cibles après 'garder' :", sets_after)
print("S3 légère : charge affichée :", light_charge, "|", s3["xp"], "| cibles après :", sets_after_light)
print("pile : hint :", hint, "| options charge :", opts, "| tip :", tip_stack)
print("réglages → chip :", chip, "| poids tuiles :", weight_tiles)
print("axes :", axes)
print("après vidage cache :", back)
print("erreurs JS :", errors or "aucune")
