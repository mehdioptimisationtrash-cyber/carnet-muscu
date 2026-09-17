"""Génère les icônes PNG (192, 512, apple-touch 180) à partir de l'emoji 🏋️.
Usage : python3 tools/make-icons.py   (nécessite playwright + chromium)
"""
import os
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "icons")
SIZES = {"icon-512.png": 512, "icon-192.png": 192, "apple-touch-icon.png": 180}

HTML = """<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;width:{S}px;height:{S}px;overflow:hidden}
  body{display:grid;place-items:center;background:linear-gradient(135deg,#6940A5,#2383E2)}
  span{font-size:{F}px;line-height:1;font-family:"Apple Color Emoji","Segoe UI Emoji",sans-serif}
</style><body><span>🏋️</span>"""

os.makedirs(OUT, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, size in SIZES.items():
        pg = b.new_page(viewport={"width": size, "height": size}, device_scale_factor=1)
        pg.set_content(HTML.replace("{S}", str(size)).replace("{F}", str(int(size * 0.62))))
        pg.screenshot(path=os.path.join(OUT, name), omit_background=False)
        pg.close()
        print("ok", name)
    b.close()
