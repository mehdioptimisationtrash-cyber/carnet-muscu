"""Vérifie les pas quotidiens : jauge du Journal, saisie manuelle (envoyée à part, jamais dans la cellule `state`),
pas envoyés par un « raccourci iOS » (POST sans state, date facultative) relus au retour au premier plan,
priorité des saisies locales non envoyées, tuile/axes/graphique des Stats, objectif dans les réglages,
retour après vidage du cache. Script Google v4 simulé.
Usage : python3 -m http.server 8000 &  puis  python3 tools/e2e_steps.py
"""
import json
import datetime as dt
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8000/"
FAKE_URL = "https://script.google.com/macros/s/FAKE/exec"
TOKEN = "c34f34c52f50ef6db3b1a960e44f8f66"
TODAY = dt.date.today().isoformat()
YESTERDAY = (dt.date.today() - dt.timedelta(days=1)).isoformat()
store = {"state": None, "days": {}, "steps": {}, "posts": [], "v": 4, "gets": 0}
errors = []


def normalize_steps(payload):
    """Même contrat que Code.gs v4 : { steps: {date: {n, src}} } (app) ou { steps: 8432, date? } (raccourci)."""
    steps = payload.get("steps")
    if isinstance(steps, dict):
        return {d: (v if isinstance(v, dict) else {"n": int(v), "src": "sante"}) for d, v in steps.items()}
    if steps is None:
        return None
    return {payload.get("date") or TODAY: {"n": int(steps), "src": "sante"}}


def fake_sheets(route, request):
    if request.method == "GET":
        store["gets"] += 1
        s = dict(store["state"], nutrition=store["days"], steps=store["steps"]) if store["state"] else None
        body = {"ok": True, "v": store["v"], "state": s}
    else:
        payload = json.loads(request.post_data)
        steps = normalize_steps(payload)
        store["posts"].append({"has_state": "state" in payload, "steps": steps, "steps_in_state": "steps" in (payload.get("state") or {})})
        if "state" in payload:
            store["state"] = payload["state"]
            store["days"].update(payload.get("days") or {})
        if steps:
            store["steps"].update(steps)
        body = {"ok": True, "v": store["v"], "steps": steps}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))


def shortcut_post(pg, n, date=None):
    """Simule le raccourci iOS : POST { token, steps, date? } sans passer par l'app."""
    payload = {"token": TOKEN, "steps": n}
    if date:
        payload["date"] = date
    return pg.evaluate("""async ([url, body]) => { const r = await fetch(url, { method: 'POST', body: JSON.stringify(body) }); return r.json(); }""", [FAKE_URL, payload])


def synced(pg):
    pg.wait_for_function("document.querySelector('#status').dataset.state === 'ok'", timeout=15000)


def gauge_text(pg):
    """(valeur, sous-titre) — l'espace fine insécable de toLocaleString('fr-FR') est ramenée à une espace normale."""
    return pg.text_content("#stepsGauge .gauge-top span").replace("\u202f", " "), pg.text_content("#stepsGauge small")


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True)
    ctx.route("**/config.js", lambda r, q: r.fulfill(content_type="application/javascript", body=f"window.CARNET_CONFIG={{SHEETS_URL:'{FAKE_URL}',TOKEN:'{TOKEN}'}};"))
    ctx.route("https://script.google.com/**", fake_sheets)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.goto(BASE); pg.wait_for_function("document.querySelector('#status').textContent.includes('Google Sheets')")
    pg.fill("#addExo", "Leg press"); pg.press("#addExo", "Enter"); synced(pg)   # crée un état dans la feuille

    pg.click("#tabJournal"); pg.wait_for_selector("#stepsGauge")
    empty = gauge_text(pg)

    # 1. saisie manuelle du jour
    pg.click("#stepsGauge"); pg.fill("#stepsIn", "6500"); pg.press("#stepsIn", "Enter"); synced(pg)
    manual = gauge_text(pg)
    manual_post = [x for x in store["posts"] if x["steps"]][-1]
    recap = pg.text_content(".recap").replace("\u202f", " ")

    # 2. le raccourci envoie le total du jour (sans date → aujourd'hui) et celui d'hier ; l'app le relit au retour au premier plan
    shortcut_today = shortcut_post(pg, 9120)
    shortcut_post(pg, 12000, YESTERDAY)
    pg.evaluate("window.App.absorb({})")   # rien : juste pour s'assurer que la passerelle existe
    refreshed = pg.evaluate("window.Steps.refresh(true)")
    pg.wait_for_function("document.querySelector('#stepsGauge .gauge-top span').textContent.includes('9')")
    auto = gauge_text(pg)
    marks = pg.locator(".wk-day .m").all_text_contents()
    posts_before = len(store["posts"])

    # 3. une saisie locale non encore envoyée gagne sur la feuille au démarrage
    pg.evaluate("localStorage.setItem('carnet-muscu-dirty-steps', JSON.stringify(['%s']))" % TODAY)
    pg.evaluate("""(t) => { const c = JSON.parse(localStorage.getItem('carnet-muscu-v2')); c.steps[t] = { n: 7777, src: 'manuel' }; localStorage.setItem('carnet-muscu-v2', JSON.stringify(c)); }""", TODAY)
    pg.reload(); synced(pg); pg.click("#tabJournal"); pg.wait_for_selector("#stepsGauge")
    local_wins = gauge_text(pg)
    sheet_after = store["steps"][TODAY]

    # 4. réglages : objectif 10 000
    pg.click("#btnSettings"); pg.select_option("#gSteps", "10000"); pg.click(".sheet >> text=Enregistrer"); synced(pg)
    goal_txt = gauge_text(pg)

    # 5. stats : tuile, axe, graphique
    pg.click("#tabStats")
    tiles = pg.locator("#viewStats .tiles").first.locator(".tile").all_text_contents()
    axes = [a for a in pg.locator(".axes .ax b").all_text_contents() if "Marche" in a or "Pas" in a]
    chart_bars = pg.locator("#viewStats .chart").last.locator("rect").count()
    secs = pg.locator("#viewStats h2.sec").all_text_contents()
    pg.screenshot(path="/private/tmp/claude-501/-Users-mehdiabdesslem-CLAUDE-carnet-muscu/e94f3c54-2fc1-45c0-894b-51480e5bb84e/scratchpad/stats-steps.png", full_page=True)

    # 6. cache vidé → tout revient de la feuille (onglet pas)
    pg.evaluate("localStorage.clear()"); pg.reload(); synced(pg); pg.click("#tabJournal"); pg.wait_for_selector("#stepsGauge")
    back = gauge_text(pg)
    pg.screenshot(path="/private/tmp/claude-501/-Users-mehdiabdesslem-CLAUDE-carnet-muscu/e94f3c54-2fc1-45c0-894b-51480e5bb84e/scratchpad/journal-steps.png", full_page=True)

    # 7. aide : boutons de copie présents
    pg.click("#stepsGauge"); pg.click("text=Remplissage automatique : comment ça marche ?")
    help_items = pg.locator(".steps-help li b").all_text_contents()
    b.close()

print("jauge vide :", empty)
print("saisie manuelle :", manual, "| POST :", manual_post, "| recap :", recap)
print("raccourci → réponse :", shortcut_today, "| relu ? ", refreshed, "| jauge :", auto, "| marques :", marks)
print("saisie locale non envoyée gagne au démarrage :", local_wins, "| feuille ensuite :", sheet_after)
print("objectif 10 000 :", goal_txt)
print("stats : tuile =", [t for t in tiles if "Pas" in t], "| axes =", axes, "| sections =", [s for s in secs if "Pas" in s], "| barres =", chart_bars)
print("après vidage du cache :", back)
print("aide :", len(help_items), "étapes")
print("steps jamais dans state ? ", not any(x["steps_in_state"] for x in store["posts"]), "| POST sans state (raccourci) acceptés ? ", any(not x["has_state"] and x["steps"] for x in store["posts"]))
print("erreurs JS :", errors or "aucune")

ok = (
    "0 / 8 000" in empty[0] and "6 500" in manual[0] and "main" in manual[1]
    and manual_post["steps"] == {TODAY: {"n": 6500, "src": "manuel"}} and "6 500 pas" in recap
    and refreshed and "9 120" in auto[0] and "Santé" in auto[1] and any("🚶" in m for m in marks)
    and "7 777" in local_wins[0] and sheet_after == {"n": 7777, "src": "manuel"}
    and "10 000" in goal_txt[0] and axes and chart_bars >= 2 and "7 777" in back[0]
    and len(help_items) == 5 and not any(x["steps_in_state"] for x in store["posts"]) and not errors
)
print("RÉSULTAT :", "OK" if ok else "ÉCHEC")
raise SystemExit(0 if ok else 1)
