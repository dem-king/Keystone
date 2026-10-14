import sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width":1440,"height":900})
    pg.goto(f"{BASE}/login", wait_until="domcontentloaded", timeout=15000)
    pg.wait_for_selector("input[placeholder='请输入账号']", timeout=15000)
    pg.fill("input[placeholder='请输入账号']","admin")
    pg.fill("input[placeholder='请输入密码']","admin123")
    pg.wait_for_selector(".captcha-code", timeout=15000)
    pg.wait_for_function("() => document.querySelector('.captcha-code')?.textContent.trim().length >= 4")
    code = pg.evaluate("() => document.querySelector('.captcha-code').textContent.replace(/\\s+/g,'')")
    pg.fill("input[placeholder='请输入右侧字符']", code)
    pg.locator("button[type='submit']").first.click()
    pg.wait_for_selector(".rail .nav-item", timeout=15000)
    pg.wait_for_timeout(1500)
    print("GROUPS:", pg.evaluate("""() => [...document.querySelectorAll('.rail .nav-group')].map(g => {
      const h = g.querySelector('.nav-group-toggle');
      const b = g.querySelector('.nav-group-body');
      return {
        label: h ? h.textContent.trim() : '(single)',
        expanded: h ? h.getAttribute('aria-expanded') : 'n/a',
        bodyDisplay: b ? getComputedStyle(b).display : 'none',
        visibleItems: b ? [...b.querySelectorAll('.nav-item')].filter(e=>e.offsetParent!==null).length : 0,
        bodyH: b ? b.offsetHeight : 0
      };
    })"""))
    b.close()
