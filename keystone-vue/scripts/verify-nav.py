"""侧边栏多级菜单端到端验证。

用真实浏览器登录后台，检查：
1. 三级商城菜单是否完整渲染（目录 → 子目录 → 页面）
2. 分组折叠是否可用，且状态写入 sessionStorage
3. 菜单搜索是否能跨层级命中
4. 当前页所在分支是否自动展开、能否正常跳转

前置：后端 8080 与前端 dev server 已启动，且菜单表已写入商城演示数据。
用法：
    python scripts/verify-nav.py [base_url]
默认 base_url 为 http://127.0.0.1:5174
"""
import re
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5174"
PASSWORD = "admin123"
TIMEOUT = 15000

results: list[tuple[bool, str]] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    results.append((ok, label))
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {label}" + (f"  -> {detail}" if detail and not ok else ""))


def labels(page):
    """菜单项可见文本；只取真正可见的项（折叠的子树虽在 DOM 中但不可见），并归一化空白"""
    return page.evaluate(
        """
        () => [...document.querySelectorAll('.rail .nav-item')]
          .filter(el => el.offsetParent !== null)
          .map(el => el.textContent.replace(/\\s+/g, ' ').trim())
        """
    )


def login(page) -> None:
    # 登录页有持续动画与背景网络，networkidle 永不触发
    page.goto(f"{BASE}/login", wait_until="domcontentloaded", timeout=TIMEOUT)
    page.wait_for_selector("input[placeholder='请输入账号']", timeout=TIMEOUT)
    page.fill("input[placeholder='请输入账号']", "admin")
    page.fill("input[placeholder='请输入密码']", PASSWORD)
    page.wait_for_selector(".captcha-code", timeout=TIMEOUT)
    page.wait_for_function(
        "() => document.querySelector('.captcha-code')?.textContent.trim().length >= 4", timeout=TIMEOUT
    )
    # 验证码每个字符包在独立 span 中，innerText 会带换行，必须用 textContent 并去掉内部空白
    code = page.evaluate(
        "() => document.querySelector('.captcha-code').textContent.replace(/\\s+/g, '')"
    )
    page.fill("input[placeholder='请输入右侧字符']", code)
    page.locator("button[type='submit']").first.click()
    # SPA 内部路由跳转不会被 wait_for_url 捕获，改为等侧边栏出现
    page.wait_for_selector(".rail .nav-item", timeout=TIMEOUT)


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        login(page)
        page.wait_for_timeout(1200)

        # 1) 三级商城菜单是否出现
        text = page.locator(".rail").inner_text()
        for name in ["商城", "商品中心"]:
            check(name in text, f"分组/目录已渲染：{name}")

        all_text = labels(page)
        check("商品列表" in all_text, "三级页面已渲染（商品列表）", str(all_text))
        check("分类管理" in all_text, "同级页面已渲染（分类管理）")
        check("订单列表" in all_text, "另一分支页面已渲染（订单列表）")

        # 2) 折叠：点击目录应收起子树
        page.locator(".rail .nav-item", has_text="商品中心").first.click()
        page.wait_for_timeout(600)
        after = labels(page)
        check("商品列表" not in after, "点击目录后子树收起", str(after))
        check("订单列表" in after, "收起只影响该分支，其他分支不受影响", str(after))

        # 3) 折叠状态持久化（存的是分组 key，不是显示名）
        stored = page.evaluate("() => sessionStorage.getItem('keystone.navCollapsed')")
        check(bool(stored) and len(stored.strip("[]")) > 0, "折叠状态写入 sessionStorage", str(stored))

        # 4) 再次点击应展开
        page.locator(".rail .nav-item", has_text="商品中心").first.click()
        page.wait_for_timeout(600)
        check("商品列表" in labels(page), "再次点击后子树重新展开", str(labels(page)))

        # 5) 搜索跨层级命中
        page.fill(".nav-search-input", "品牌")
        page.wait_for_timeout(600)
        found = labels(page)
        check("品牌管理" in found, "搜索命中三级深层菜单", str(found))
        count_el = page.locator(".nav-search-count")
        count_text = count_el.inner_text() if count_el.count() else ""
        check("1" in count_text, "搜索结果计数正确", count_text)

        # 6) 无匹配空态
        page.fill(".nav-search-input", "zzz不存在菜单")
        page.wait_for_timeout(500)
        check(page.locator(".nav-empty").count() > 0, "无匹配时显示空态提示")
        page.fill(".nav-search-input", "")
        page.wait_for_timeout(400)

        # 7) 点击深层页面能跳转（验证递归路由注册成功）
        page.locator(".rail .nav-item", has_text="商品列表").first.click()
        page.wait_for_timeout(1500)
        check("/shop/product/list" in page.url, "深层页面路由跳转成功", page.url)
        # 祖先分支也会带 is-active（提示「你在里面」），取叶子节点的 aria-current
        active = page.evaluate(
            """
            () => {
              const cur = document.querySelector('.rail .nav-item[aria-current="page"]')
              return cur ? cur.textContent.replace(/\\s+/g, ' ').trim() : ''
            }
            """
        )
        check("商品列表" in active, "当前页高亮正确", active)

        # 8) 跳转后祖先分支仍可见
        check(
            page.locator(".rail .nav-item", has_text="商品列表").first.is_visible(),
            "跳转后所在分支保持展开可见",
        )

        # 9) 刷新后折叠状态应恢复
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector(".rail .nav-item", timeout=TIMEOUT)
        page.wait_for_timeout(1500)
        check("商品列表" in labels(page), "刷新后深层菜单仍可见", str(labels(page)))

        # 10) 无运行时错误
        check(not errors, "无前端运行时错误", "; ".join(errors[:3]))

        page.screenshot(path="scripts/verify-nav.png", full_page=True)
        browser.close()

    failed = [r for r in results if not r[0]]
    print("\n" + "=" * 46)
    print(f"通过 {len(results) - len(failed)}/{len(results)}")
    if failed:
        print("失败项：")
        for _, label in failed:
            print(f"  - {label}")
    print("=" * 46)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())