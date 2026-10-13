"""一级分组折叠验证：菜单超阈值时的紧凑表现，以及「折叠后必须能再展开」。

检查：
1. 分组标题是可折叠控件（带 aria-expanded）
2. 默认展开策略：菜单未超阈值时全展开；超阈值时只收起靠后的分组
3. 折叠确有收益（收紧后侧栏高度明显小于全展开）
4. **核心回归**：点击收起 → 再点击必须展开（曾出现「点了没反应」）
5. 折叠列表与展开列表互斥，不会同一 key 同时出现在两边
6. 全部收起后刷新，分组仍收起，且逐个点击都能展开（用户被困场景）
7. 手动状态刷新后保留
8. 搜索态强制全展开，且搜索期间点击不写偏好
9. 当前页所在分组保持可见
10. 全程无前端运行时错误

用法：
    python scripts/verify-group-collapse.py [base_url]
默认 base_url 为 http://127.0.0.1:5180，需后端 8080 与前端 dev server 已启动。
"""
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5180"
PASSWORD = "admin123"
TIMEOUT = 15000
COLLAPSED_KEY = "keystone.navCollapsed"
EXPANDED_KEY = "keystone.navExpanded"

results: list[tuple[bool, str]] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    results.append((ok, label))
    print(f"[{'PASS' if ok else 'FAIL'}] {label}" + (f"  -> {detail}" if detail and not ok else ""))


def login(page) -> None:
    page.goto(f"{BASE}/login", wait_until="domcontentloaded", timeout=TIMEOUT)
    page.wait_for_selector("input[placeholder='请输入账号']", timeout=TIMEOUT)
    page.fill("input[placeholder='请输入账号']", "admin")
    page.fill("input[placeholder='请输入密码']", PASSWORD)
    page.wait_for_selector(".captcha-code", timeout=TIMEOUT)
    page.wait_for_function(
        "() => document.querySelector('.captcha-code')?.textContent.trim().length >= 4", timeout=TIMEOUT
    )
    code = page.evaluate("() => document.querySelector('.captcha-code').textContent.replace(/\\s+/g, '')")
    page.fill("input[placeholder='请输入右侧字符']", code)
    page.locator("button[type='submit']").first.click()
    page.wait_for_selector(".rail .nav-item", timeout=TIMEOUT)
    page.wait_for_timeout(1200)


def settle(page, ms: int = 700) -> None:
    page.wait_for_timeout(ms)


def group_state(page):
    """返回 [{label, keyed, open, items, visibleItems, active}] 描述每个分组

    - open        控件自述状态（aria-expanded）
    - items       分组内菜单项总数（折叠时仍在 DOM 中）
    - visibleItems 真正可见的菜单项数，用于识别「aria 变了但内容没动」
    """
    return page.evaluate(
        """
        () => [...document.querySelectorAll('.rail .nav-group')].map(g => {
          const head = g.querySelector('.nav-group-toggle')
          const body = g.querySelector('.nav-group-body')
          const all = body ? [...body.querySelectorAll('.nav-item')] : []
          return {
            label: head ? head.textContent.replace(/\\s+/g, ' ').trim() : '(无标题)',
            keyed: Boolean(head),
            open: head ? head.getAttribute('aria-expanded') === 'true' : true,
            items: all.length,
            visibleItems: all.filter(el => el.offsetParent !== null).length,
            active: Boolean(g.querySelector('.nav-item[aria-current="page"]')),
          }
        })
        """
    )


def by_label(page, label: str):
    return next((g for g in group_state(page) if g["label"] == label), None)


def toggle_labels(page) -> list[str]:
    return [g["label"] for g in group_state(page) if g["keyed"]]


def click_group(page, label: str) -> None:
    page.locator(".rail .nav-group-toggle", has_text=label).first.click()
    settle(page)


def storage(page) -> dict:
    return page.evaluate(
        """
        () => ({
          collapsed: JSON.parse(sessionStorage.getItem('keystone.navCollapsed') || '[]'),
          expanded: JSON.parse(sessionStorage.getItem('keystone.navExpanded') || '[]'),
        })
        """
    )


def rail_height(page) -> int:
    """侧栏可见内容高度：只累加可见项，收起分组不应计入"""
    return page.evaluate(
        """
        () => {
          let h = 0
          document.querySelectorAll('.rail-nav .nav-item, .rail-nav .nav-group-toggle')
            .forEach(el => { if (el.offsetParent !== null) h += el.offsetHeight + 2 })
          return h
        }
        """
    )


def reload(page, wait: int = 1200) -> None:
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector(".rail .nav-item", timeout=TIMEOUT)
    settle(page, wait)


def reset_storage(page) -> None:
    page.evaluate(
        "() => { sessionStorage.removeItem('keystone.navCollapsed');"
        " sessionStorage.removeItem('keystone.navExpanded') }"
    )
    reload(page)


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        login(page)
        reset_storage(page)

        groups = group_state(page)
        total_pages = sum(g["items"] for g in groups)
        labeled = [g for g in groups if g["keyed"]]
        print(f"分组 = {[g['label'] for g in labeled]}，菜单项总数 = {total_pages}")

        # 1) 分组标题可折叠
        check(len(labeled) >= 1, "分组标题是可折叠控件", f"count={len(labeled)}")

        # 2) 默认展开策略（阈值见 navCollapse.ts 的 AUTO_COLLAPSE_THRESHOLD / KEEP_OPEN_GROUPS）
        if total_pages > 20:
            collapsed = [g["label"] for g in labeled if not g["open"]]
            check(len(collapsed) > 0, "紧凑模式下部分分组自动收起", f"collapsed={collapsed}")
            check(len(labeled) - len(collapsed) >= 2, "紧凑模式下仍保留前 2 个分组展开", str(len(labeled)))
        else:
            check(
                all(g["open"] for g in labeled),
                "菜单未超阈值时分组默认全部展开",
                str([g["label"] for g in labeled if not g["open"]]),
            )

        # 3) 折叠收益：全展开高度应明显大于收起靠后分组后的高度
        compact_height = rail_height(page)
        opened = []
        for g in labeled:
            if not g["open"]:
                click_group(page, g["label"])
                opened.append(g["label"])
        full_height = rail_height(page)
        if opened:
            check(
                compact_height < full_height,
                "折叠后侧栏明显变短",
                f"collapsed={compact_height} expanded={full_height}",
            )
        # 测量污染了偏好，回到干净状态
        reset_storage(page)

        # 4) 核心回归：收起 → 再展开（曾经的缺陷：第二次点击毫无反应）
        label = toggle_labels(page)[0]
        click_group(page, label)
        after_first = by_label(page, label)
        check(
            after_first["open"] is False and after_first["visibleItems"] == 0,
            "点击收起：状态与内容同步隐藏",
            str(after_first),
        )
        click_group(page, label)
        after_second = by_label(page, label)
        check(
            after_second["open"] is True and after_second["visibleItems"] > 0,
            "再次点击可展开（回归项：折叠后必须能再展开）",
            str(after_second),
        )

        # 5) 两个状态列表互斥
        st = storage(page)
        overlap = sorted(set(st["collapsed"]) & set(st["expanded"]))
        check(not overlap, "折叠列表与展开列表互斥", f"overlap={overlap}")
        check(len(st["expanded"]) > 0, "手动展开已写入持久化", str(st))

        # 6) 用户被困场景：全部分组收起 → 刷新 → 逐个点击都能展开
        page.goto(f"{BASE}/", wait_until="domcontentloaded", timeout=TIMEOUT)
        page.wait_for_selector(".rail .nav-item", timeout=TIMEOUT)
        settle(page, 1200)
        labels = toggle_labels(page)
        for name in labels:
            current = by_label(page, name)
            if current and current["open"]:
                click_group(page, name)
        stuck = {g["label"]: g["open"] for g in group_state(page) if g["keyed"]}
        check(
            all(state is False for state in stuck.values()),
            "全部分组可收起（当前页不在任何折叠分组内）",
            str(stuck),
        )
        reload(page)
        restored = {g["label"]: g["open"] for g in group_state(page) if g["keyed"]}
        check(restored == stuck, "刷新后收起状态保留", str(restored))
        for name in labels:
            click_group(page, name)
        recovered = {g["label"]: g["open"] for g in group_state(page) if g["keyed"]}
        check(
            all(state is True for state in recovered.values()),
            "逐个点击后全部分组都能重新展开",
            str(recovered),
        )

        # 7) 折叠 → 刷新 → 再展开
        click_group(page, labels[0])
        reload(page)
        check(by_label(page, labels[0])["open"] is False, "刷新后手动折叠状态保留", str(by_label(page, labels[0])))
        click_group(page, labels[0])
        check(by_label(page, labels[0])["open"] is True, "折叠后再次展开成功（二次回归）", str(by_label(page, labels[0])))

        # 8) 搜索态：命中的分组强制展开，且搜索期间点击不写偏好
        before_search = storage(page)
        page.fill(".nav-search-input", "用户")
        settle(page)
        searching = [g["label"] for g in group_state(page) if g["keyed"] and not g["open"]]
        check(not searching, "搜索时匹配到的分组自动展开", str(searching))
        page.locator(".rail .nav-group-toggle").first.click()
        settle(page, 400)
        page.fill(".nav-search-input", "")
        settle(page, 500)
        after_search = storage(page)
        check(
            before_search["collapsed"] == after_search["collapsed"],
            "搜索期间点击不写入折叠偏好",
            f"before={before_search['collapsed']} after={after_search['collapsed']}",
        )

        # 9) 当前页所在分组保持可见（工作台为无标题分组，不参与折叠）
        active_group = next((g for g in group_state(page) if g["active"]), None)
        check(
            active_group is None or active_group["open"] is True,
            "当前页所在分组保持展开",
            f"active={active_group}",
        )

        check(not errors, "无前端运行时错误", "; ".join(errors[:3]))

        page.screenshot(path="scripts/verify-group-collapse.png", full_page=True)
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
