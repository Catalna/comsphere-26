import re
import os
from pathlib import Path
from tempfile import gettempdir

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("DANATERANG_WEB_URL", "http://127.0.0.1:3000")
SCREENSHOT_DIR = Path(gettempdir()) / "dana-terang-playwright"


def main():
    errors = []
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.on("requestfailed", lambda request: errors.append(f"{request.method} {request.url}"))
        page.goto(BASE_URL, wait_until="domcontentloaded")
        page.get_by_role("heading", name="Renovasi SD Harapan", level=1).wait_for(state="visible")

        assert page.get_by_role("heading", name="Renovasi SD Harapan", level=1).is_visible()
        assert page.get_by_text("Contoh data demo", exact=False).is_visible()
        assert page.get_by_text("No configured flags detected", exact=False).is_visible()
        assert page.get_by_text("VERIFIED by human verifier", exact=False).is_visible()
        assert page.get_by_text("PAYMENT_REPORTED by funder", exact=False).is_visible()
        proof_section = page.locator("#proof")
        assert proof_section.get_by_text("PENDING").is_visible()
        assert proof_section.get_by_text("Ethereum Sepolia Testnet").is_visible()
        assert page.get_by_role("main").count() == 1
        assert page.get_by_role("navigation", name="Navigasi utama").count() == 1
        assert page.get_by_role("link", name="Lewati ke konten").count() == 1
        assert not re.search(r"\b[0-9a-f]{64}\b", page.locator("body").inner_text(), re.I)
        assert not errors, errors

        axe_path = Path(__file__).resolve().parents[3] / "node_modules" / "axe-core" / "axe.min.js"
        page.add_script_tag(path=str(axe_path))
        violations = page.evaluate("async () => (await axe.run()).violations")
        assert not violations, [
            {
                "id": item["id"],
                "impact": item["impact"],
                "nodes": [
                    {"target": node["target"], "failure": node["failureSummary"]}
                    for node in item["nodes"]
                ],
            }
            for item in violations
        ]

        page.screenshot(
            path=str(SCREENSHOT_DIR / "danaterang-desktop.png"),
            full_page=True,
        )
        page.set_viewport_size({"width": 390, "height": 844})
        overflow = page.evaluate(
            """() => [...document.querySelectorAll('*')]
                .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
                .slice(0, 5).map((element) => element.tagName + '.' + element.className)"""
        )
        assert not overflow, overflow
        page.screenshot(
            path=str(SCREENSHOT_DIR / "danaterang-mobile.png"),
            full_page=True,
        )
        page.keyboard.press("Tab")
        focused = page.evaluate(
            """() => ({
              href: document.activeElement.getAttribute('href'),
              outline: getComputedStyle(document.activeElement).outlineStyle,
              top: document.activeElement.getBoundingClientRect().top
            })"""
        )
        assert focused["href"] == "#main", focused
        assert focused["outline"] != "none" and focused["top"] >= 0, focused
        browser.close()


if __name__ == "__main__":
    main()
