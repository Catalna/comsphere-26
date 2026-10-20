import os
import json
from pathlib import Path
from tempfile import gettempdir
from urllib.parse import urlparse

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, expect, sync_playwright


BASE_URL = os.environ.get("DANATERANG_WEB_URL", "http://127.0.0.1:3000")
ADMIN_EMAIL = os.environ.get("DANATERANG_TEST_ADMIN_EMAIL", "admin@example.test")
ADMIN_PASSWORD = os.environ.get("DANATERANG_TEST_ADMIN_PASSWORD", "")
FUNDER_EMAIL = os.environ.get("DANATERANG_TEST_FUNDER_EMAIL", "funder@example.test")
FUNDER_PASSWORD = os.environ.get("DANATERANG_TEST_FUNDER_PASSWORD", "")
VERIFIER_EMAIL = os.environ.get("DANATERANG_TEST_VERIFIER_EMAIL", "verifier-1@example.test")
VERIFIER_PASSWORD = os.environ.get("DANATERANG_TEST_VERIFIER_PASSWORD", "")
SECOND_VERIFIER_EMAIL = "verifier-2@example.test"
THIRD_VERIFIER_EMAIL = "verifier-3@example.test"
VERIFIER_ADDRESSES = [
    "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
    "0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF",
    "0x6813Eb9362372EEF6200f3b1dbC3f819671cBA69",
]
AXE_PATH = Path(__file__).resolve().parents[2] / "node_modules" / "axe-core" / "axe.min.js"
SCREENSHOT_DIR = Path(gettempdir()) / "dana-terang-playwright"


def assert_accessible(page):
    if page.evaluate("typeof axe === 'undefined'"):
        page.add_script_tag(path=str(AXE_PATH))
    violations = page.evaluate("async () => (await axe.run()).violations")
    assert not violations, [(item["id"], item["impact"], [
        {"target": node["target"], "fg": node["any"][0].get("data", {}).get("fgColor"), "bg": node["any"][0].get("data", {}).get("bgColor"), "ratio": node["any"][0].get("data", {}).get("contrastRatio")}
        for node in item["nodes"][:6]
    ]) for item in violations]


def assert_no_horizontal_overflow(page):
    overflow = page.evaluate("""() => ({
        document: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        elements: [...document.querySelectorAll('*')]
          .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
          .filter((element) => {
            let parent = element.parentElement;
            while (parent && parent !== document.documentElement) {
              const style = getComputedStyle(parent);
              if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && parent.scrollWidth > parent.clientWidth) return false;
              parent = parent.parentElement;
            }
            return true;
          })
          .slice(0, 8)
          .map((element) => `${element.tagName}.${String(element.className)}`),
      })""")
    assert not overflow["document"] and not overflow["elements"], f"The page overflows horizontally: {overflow}"


def record_request_failure(request, errors):
    failure = request.failure or "request_failed"
    # Next.js cancels speculative RSC prefetches when a user navigates away.
    if "ERR_ABORTED" in failure:
        return
    errors.append(f"{request.method} {request.url} — {failure}")


def assert_skip_link_focus(page):
    page.keyboard.press("Tab")
    focused = page.evaluate("() => ({ href: document.activeElement.getAttribute('href'), outline: getComputedStyle(document.activeElement).outlineStyle })")
    assert focused["href"] == "#main", focused
    assert focused["outline"] != "none", focused


def install_test_wallet(context, address):
    context.add_init_script(f"""(() => {{
      const address = {json.dumps(address)};
      const state = {{ chainId: "0x7a69", rejectSignature: false, rejectNetworkSwitch: false, lastTypedData: null }};
      window.__testWalletState = state;
      window.ethereum = {{
        async request({{ method, params = [] }}) {{
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
          if (method === "eth_chainId") return state.chainId;
          if (method === "wallet_switchEthereumChain") {{
            if (state.rejectNetworkSwitch) throw Object.assign(new Error("User rejected network switch"), {{ code: 4001 }});
            state.chainId = params[0]?.chainId ?? state.chainId;
            return null;
          }}
          if (method === "eth_signTypedData_v4") {{
            if (state.rejectSignature) throw Object.assign(new Error("User rejected signature"), {{ code: 4001 }});
            const [signerAddress, typedDataText] = params;
            const typedData = JSON.parse(typedDataText);
            state.lastTypedData = JSON.parse(JSON.stringify(typedData));
            if (!Array.isArray(typedData.types?.EIP712Domain)) {{
              throw Object.assign(new Error("EIP712Domain type is required by this wallet"), {{ code: -32602 }});
            }}
            delete typedData.types.EIP712Domain;
            const response = await fetch("/api/test/wallet/sign", {{
              method: "POST",
              credentials: "include",
              headers: {{ "Content-Type": "application/json" }},
              body: JSON.stringify({{ address: signerAddress, typedData }}),
            }});
            const payload = await response.json();
            if (!response.ok) throw Object.assign(new Error(payload.error || "wallet_signature_failed"), {{ code: payload.error }});
            return payload.signature;
          }}
          throw Object.assign(new Error("unsupported_wallet_method"), {{ code: -32601 }});
        }}
      }};
    }})();""")


def sign_in(page, email, password):
    if email == VERIFIER_EMAIL:
        install_test_wallet(page.context, VERIFIER_ADDRESSES[0])
    elif email == SECOND_VERIFIER_EMAIL:
        install_test_wallet(page.context, VERIFIER_ADDRESSES[1])
    elif email == THIRD_VERIFIER_EMAIL:
        install_test_wallet(page.context, VERIFIER_ADDRESSES[2])
    page.goto(f"{BASE_URL}/login", wait_until="networkidle")
    assert_accessible(page)
    page.screenshot(path=str(SCREENSHOT_DIR / "login-desktop.png"), full_page=True)
    assert_skip_link_focus(page)
    page.set_viewport_size({"width": 390, "height": 844})
    assert_no_horizontal_overflow(page)
    page.set_viewport_size({"width": 1440, "height": 900})
    page.get_by_label("Email").fill(email)
    page.get_by_role("textbox", name="Kata sandi").fill(password)
    # Hydration can exceed the 5s default on a loaded machine (parallel builds); tolerate 15s.
    expect(page.get_by_role("button", name="Masuk")).to_be_enabled(timeout=15_000)
    page.get_by_role("button", name="Masuk").click()
    # Landing mengikuti peran: VERIFIER -> Review saya, ADMIN -> Operasi Review, lainnya -> Dashboard.
    if email in {VERIFIER_EMAIL, SECOND_VERIFIER_EMAIL, THIRD_VERIFIER_EMAIL}:
        expected_heading = "Review saya"
    elif email == ADMIN_EMAIL:
        expected_heading = "Operasi Review"
    else:
        expected_heading = "Program Overview"
    page.get_by_role("heading", name=expected_heading).wait_for(state="visible")
    if email != ADMIN_EMAIL:
        assert page.get_by_role("link", name="Pengguna").count() == 0


def open_assigned_review(page, file_name):
    link = page.get_by_role("link", name=f"Tinjau evidence {file_name}")
    for _ in range(24):
        try:
            link.wait_for(state="visible", timeout=1000)
            link.click()
            return
        except PlaywrightTimeoutError:
            refresh = page.get_by_role("button", name="Perbarui antrian")
            if refresh.count():
                refresh.click()
            page.wait_for_timeout(250)
    queue = page.request.get(f"{BASE_URL}/api/verifier/reviews").json()
    raise AssertionError(
        f"Assigned review did not appear in the queue: {file_name}; "
        f"queue={queue}"
    )


def main():
    assert ADMIN_PASSWORD and FUNDER_PASSWORD and VERIFIER_PASSWORD, "browser-test credentials must come from the test runner"
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    errors = []
    expected_auth_denials = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        admin_context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = admin_context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        def capture_console(message):
            if message.type != "error":
                return
            if "401 (Unauthorized)" in message.text:
                expected_auth_denials.append(message.text)
            else:
                errors.append(message.text)

        page.on("console", capture_console)
        page.on("requestfailed", lambda request: record_request_failure(request, errors))

        sign_in(page, ADMIN_EMAIL, ADMIN_PASSWORD)
        page.get_by_role("link", name="Pengguna").click()
        page.get_by_role("heading", name="Pengguna dan role").wait_for(state="visible")
        assert_accessible(page)
        page.set_viewport_size({"width": 390, "height": 844})
        assert_no_horizontal_overflow(page)
        page.set_viewport_size({"width": 1440, "height": 900})
        funder_row = page.get_by_role("row").filter(has_text="Browser Test Funder")
        funder_row.first.wait_for(state="visible")
        assert funder_row.count() == 1, f"matching rows={funder_row.count()}\n{page.locator('body').inner_text()}"
        role_selector = funder_row.get_by_label("Role akun Browser Test Funder")
        assert role_selector.locator("option").all_text_contents() == ["ORGANIZER", "FUNDER", "VERIFIER"]
        role_selector.select_option("FUNDER")
        funder_row.get_by_role("button", name="Simpan role Browser Test Funder").click()
        page.get_by_role("status").get_by_text("Role berhasil diperbarui.").wait_for(state="visible")
        page.screenshot(path=str(SCREENSHOT_DIR / "admin-users-desktop.png"), full_page=True)
        page.get_by_role("link", name="Publikasi audit").click()
        page.get_by_role("heading", name="Publikasi audit publik").wait_for(state="visible")
        assert_accessible(page)
        published_row = page.get_by_role("row").filter(has_text="Renovasi SD Harapan")
        published_row.get_by_text("Tampil publik", exact=True).wait_for(state="visible")
        published_row.get_by_role("button", name="Tarik publikasi Renovasi SD Harapan").click()
        published_row.get_by_text("Privat", exact=True).wait_for(state="visible")
        public_response = page.request.get(f"{BASE_URL}/api/public/campaigns")
        assert public_response.status == 200 and public_response.json()["campaigns"] == []
        published_row.get_by_role("button", name="Publikasikan Renovasi SD Harapan").click()
        published_row.get_by_text("Tampil publik", exact=True).wait_for(state="visible")
        assert_accessible(page)
        page.get_by_role("link", name="Pengguna").click()
        page.get_by_role("heading", name="Pengguna dan role").wait_for(state="visible")
        page.get_by_role("button", name="Keluar").click()
        page.get_by_role("heading", name="Masuk ke akun Anda").wait_for(state="visible")
        page.goto(f"{BASE_URL}/admin/users", wait_until="networkidle")
        page.get_by_role("heading", name="Masuk ke akun Anda").wait_for(state="visible")
        assert expected_auth_denials, "the protected Admin page should deny requests without a session"

        organizer_context = browser.new_context(viewport={"width": 1440, "height": 900})
        organizer = organizer_context.new_page()
        organizer.goto(f"{BASE_URL}/register", wait_until="networkidle")
        assert_accessible(organizer)
        organizer.screenshot(path=str(SCREENSHOT_DIR / "register-desktop.png"), full_page=True)
        assert_skip_link_focus(organizer)
        organizer.set_viewport_size({"width": 390, "height": 844})
        assert_no_horizontal_overflow(organizer)
        organizer.set_viewport_size({"width": 1440, "height": 900})
        organizer.get_by_label("Nama lengkap").fill("Organizer Demo")
        organizer.get_by_label("Nama organisasi").fill("Komunitas Demo")
        organizer.get_by_label("Jenis organisasi").select_option("COMMUNITY")
        organizer.get_by_label("Email").fill("organizer@example.test")
        organizer.get_by_role("textbox", name="Kata sandi").fill("Organizer-Pass-123")
        organizer.get_by_label("Saya menyetujui Syarat & Ketentuan DanaTerang").check()
        organizer.get_by_role("button", name="Buat akun").click()
        organizer.get_by_role("heading", name="Campaign saya").wait_for(state="visible")
        assert_accessible(organizer)
        organizer.get_by_role("heading", name="Belum ada campaign").wait_for(state="visible")
        organizer.screenshot(path=str(SCREENSHOT_DIR / "campaigns-empty-desktop.png"), full_page=True)
        organizer.get_by_role("link", name="Buat campaign").last.click()
        organizer.get_by_role("heading", name="Buat campaign").wait_for(state="visible")
        assert_accessible(organizer)
        organizer.screenshot(path=str(SCREENSHOT_DIR / "campaign-create-desktop.png"), full_page=True)
        organizer.get_by_label("Judul campaign").fill("Renovasi SD Harapan")
        organizer.get_by_label("Deskripsi").fill("Renovasi ruang belajar")
        organizer.get_by_label("Anggaran total").fill("100000000.00")
        organizer.get_by_label("Mata uang").select_option("IDR")
        organizer.get_by_label("Funder").select_option(label="Browser Test Funder — Browser Test Foundation")
        organizer.get_by_role("button", name="Simpan draft").click()
        organizer.get_by_role("heading", name="Renovasi SD Harapan", level=1).wait_for(state="visible")
        assert_accessible(organizer)
        assert organizer.get_by_text("Rp 100.000.000", exact=False).is_visible()
        organizer.screenshot(path=str(SCREENSHOT_DIR / "campaign-detail-desktop.png"), full_page=True)
        campaign_url = organizer.url
        campaign_path = urlparse(campaign_url).path

        organizer.get_by_label("Judul milestone").fill("Pembelian material")
        organizer.get_by_label("Deskripsi milestone").fill("Material utama renovasi")
        organizer.get_by_label("Anggaran milestone").fill("60000000.00")
        organizer.get_by_role("button", name="Tambah milestone").click()
        organizer.get_by_text("PLANNED", exact=True).wait_for(state="visible")
        assert organizer.get_by_label("Ringkasan campaign").get_by_text("Rp 60.000.000", exact=False).is_visible()

        milestones_url = f"**/api/campaigns/{campaign_path.rsplit('/', 1)[-1]}/milestones"
        organizer.route(milestones_url, lambda route: route.fulfill(status=503, json={"error": "unavailable"}))
        organizer.goto(f"{BASE_URL}/dashboard", wait_until="networkidle")
        organizer.get_by_role("alert").get_by_text("Sebagian data belum dapat dimuat", exact=False).wait_for(state="visible")
        organizer.unroute(milestones_url)
        organizer.goto(campaign_url, wait_until="networkidle")
        organizer.get_by_role("heading", name="Renovasi SD Harapan", level=1).wait_for(state="visible")

        funder_context = browser.new_context(viewport={"width": 1440, "height": 900})
        funder = funder_context.new_page()
        sign_in(funder, FUNDER_EMAIL, FUNDER_PASSWORD)
        assert funder.get_by_role("link", name="Pengguna").count() == 0
        funder.goto(f"{BASE_URL}{campaign_path}", wait_until="networkidle")
        assert_accessible(funder)
        funder.get_by_role("button", name="Danai campaign").click()
        funder.get_by_text("Didanai", exact=True).wait_for(state="visible")

        organizer.reload(wait_until="networkidle")
        start_milestone = organizer.get_by_role("button", name="Mulai milestone Pembelian material")
        assert start_milestone.count() == 1, organizer.locator("body").inner_text()
        start_milestone.click()
        organizer.get_by_text("IN_PROGRESS", exact=True).wait_for(state="visible")

        verifier_context = browser.new_context(viewport={"width": 1440, "height": 900})
        verifier_page = verifier_context.new_page()
        verifier_page.on("pageerror", lambda error: errors.append(str(error)))
        sign_in(verifier_page, VERIFIER_EMAIL, VERIFIER_PASSWORD)
        connect_wallet = verifier_page.get_by_role("button", name="Hubungkan wallet verifier")
        verifier_page.evaluate("window.__testWalletState.chainId = '0x1'; window.__testWalletState.rejectNetworkSwitch = true")
        connect_wallet.click()
        verifier_page.get_by_role("alert").get_by_text("Pilih jaringan yang sama", exact=False).wait_for(state="visible")
        verifier_page.evaluate("window.__testWalletState.chainId = '0x7a69'; window.__testWalletState.rejectSignature = true")
        connect_wallet.click()
        verifier_page.get_by_role("alert").get_by_text("Permintaan tanda tangan dibatalkan", exact=False).wait_for(state="visible")
        verifier_page.evaluate("window.__testWalletState.rejectSignature = false")
        connect_wallet.click()
        verifier_page.get_by_text("Terhubung", exact=True).wait_for(state="visible")
        domain_types = verifier_page.evaluate("window.__testWalletState.lastTypedData.types.EIP712Domain")
        assert domain_types == [
            {"name": "name", "type": "string"},
            {"name": "version", "type": "string"},
            {"name": "chainId", "type": "uint256"},
            {"name": "verifyingContract", "type": "address"},
        ], domain_types
        verifier_page.get_by_role("heading", name="Semua review sudah ditangani").wait_for(state="visible")
        assert_accessible(verifier_page)
        verifier_page.screenshot(path=str(SCREENSHOT_DIR / "verifier-wallet-bound-desktop.png"), full_page=True)

        evidence_file = organizer.get_by_label("Pilih file bukti")
        evidence_file.set_input_files({
            "name": "too-large.pdf",
            "mimeType": "application/pdf",
            "buffer": b"%PDF-1.7\n" + b"x" * (10 * 1024 * 1024 + 1),
        })
        organizer.get_by_role("button", name="Unggah bukti").click()
        organizer.get_by_role("region", name="Evidence privat").get_by_role("alert").get_by_text("Ukuran file maksimal 10 MiB.", exact=True).wait_for(state="visible")
        assert evidence_file.evaluate("element => element.files[0]?.name") == "too-large.pdf"

        evidence_file.set_input_files({
            "name": "receipt.pdf",
            "mimeType": "application/pdf",
            "buffer": b"%PDF-1.7\nprivate receipt fixture",
        })
        organizer.get_by_label("Jenis bukti").select_option("RECEIPT")
        organizer.get_by_role("button", name="Unggah bukti").click()
        evidence_region = organizer.get_by_role("region", name="Evidence privat")
        receipt_row = evidence_region.get_by_role("listitem").filter(has_text="receipt.pdf")
        receipt_row.locator(".evidence-heading").get_by_text("Siap ditinjau", exact=True).wait_for(state="visible")
        receipt_row.locator(".evidence-screening-summary").get_by_text("Tidak ada flag otomatis", exact=False).wait_for(state="visible")
        organizer.get_by_text("Rincian teknis").click()
        assert organizer.locator("details").get_by_text("SHA-256").is_visible()

        funder.goto(f"{BASE_URL}{campaign_path}", wait_until="networkidle")
        funder_receipt = funder.get_by_role("region", name="Evidence privat").get_by_role("listitem").filter(has_text="Siap ditinjau").first
        assert funder_receipt.get_by_text("receipt.pdf", exact=True).count() == 0
        assert funder_receipt.locator(".evidence-screening-summary").get_by_text("Menunggu quorum verifier", exact=False).is_visible()
        assert funder_receipt.locator(".evidence-screening-summary").get_by_text("Tidak ada flag otomatis", exact=False).count() == 0
        assert funder.get_by_role("button", name="Lihat detail OCR").count() == 0
        assert "INTERNAL-OCR-TEST-CONTENT" not in funder.locator("body").inner_text()

        organizer.get_by_label("Pilih file bukti").set_input_files({
            "name": "over-budget.pdf",
            "mimeType": "application/pdf",
            "buffer": b"%PDF-1.7\nOCR-OVER-BUDGET",
        })
        organizer.get_by_role("button", name="Unggah bukti").click()
        over_budget_row = evidence_region.get_by_role("listitem").filter(has_text="over-budget.pdf")
        over_budget_row.locator(".evidence-screening-summary").get_by_text("Ada flag otomatis", exact=True).wait_for(state="visible")
        over_budget_row.get_by_text("melebihi anggaran milestone", exact=False).wait_for(state="visible")

        organizer.get_by_label("Pilih file bukti").set_input_files({
            "name": "retry-receipt.pdf",
            "mimeType": "application/pdf",
            "buffer": b"%PDF-1.7\nOCR-RETRY-FIXTURE",
        })
        organizer.get_by_role("button", name="Unggah bukti").click()
        retry_row = evidence_region.get_by_role("listitem").filter(has_text="retry-receipt.pdf")
        retry_row.locator(".evidence-heading").get_by_text("Pemrosesan gagal", exact=True).wait_for(state="visible")

        verifier_page.goto(f"{BASE_URL}/verifier/reviews", wait_until="networkidle")
        assert verifier_page.get_by_text("Terhubung", exact=True).is_visible(), verifier_page.locator("body").inner_text()
        assert_accessible(verifier_page)
        assert_no_horizontal_overflow(verifier_page)
        verifier_page.screenshot(path=str(SCREENSHOT_DIR / "verifier-queue-desktop.png"), full_page=True)
        open_assigned_review(verifier_page, "receipt.pdf")
        verifier_page.get_by_role("heading", name="Detail review").wait_for(state="visible")
        assert_accessible(verifier_page)
        verifier_page.set_viewport_size({"width": 390, "height": 844})
        assert_no_horizontal_overflow(verifier_page)
        verifier_page.screenshot(path=str(SCREENSHOT_DIR / "verifier-detail-mobile.png"), full_page=True)
        verifier_page.set_viewport_size({"width": 1440, "height": 900})
        verifier_page.get_by_text("Teks OCR lengkap versi 1", exact=True).click()
        assert verifier_page.get_by_text("INTERNAL-OCR-TEST-CONTENT", exact=False).is_visible()
        assert verifier_page.get_by_role("link", name="Unduh evidence asli receipt.pdf").is_visible()
        first_decision = verifier_page.locator('input[name="decision"][value="NEEDS_REVISION"]')
        first_decision.focus()
        verifier_page.keyboard.press("Space")
        expect(first_decision).to_be_checked()
        verifier_page.get_by_label("Instruksi untuk Organizer").fill("Tambahkan bukti tanggal transaksi pada receipt lengkap.")
        verifier_page.get_by_label("Catatan internal reviewer").fill("Tanggal belum tampak pada gambar yang diunggah.")
        verifier_page.get_by_label("Saya tidak memiliki konflik kepentingan terhadap Organizer atau Funder pada evidence ini.").check()
        verifier_page.get_by_label("Saya memahami vote yang ditandatangani tidak dapat diubah.").check()
        first_vote_button = verifier_page.get_by_role("button", name="Tanda tangani dan kirim NEEDS_REVISION")
        verifier_page.keyboard.press("Tab")
        assert first_vote_button.evaluate("element => element === document.activeElement")
        focus_style = verifier_page.evaluate("() => ({outlineStyle: getComputedStyle(document.activeElement).outlineStyle, outlineWidth: getComputedStyle(document.activeElement).outlineWidth})")
        assert focus_style["outlineStyle"] != "none" and float(focus_style["outlineWidth"].replace("px", "")) >= 2, focus_style
        verifier_page.keyboard.press("Enter")
        verifier_page.get_by_role("status").get_by_text("Vote tersimpan dan dikirim", exact=False).wait_for(state="visible")
        verifier_page.get_by_role("heading", name="Vote tersimpan: NEEDS_REVISION").wait_for(state="visible")

        second_verifier_context = browser.new_context(viewport={"width": 1440, "height": 900})
        second_verifier = second_verifier_context.new_page()
        second_verifier.on("pageerror", lambda error: errors.append(str(error)))
        sign_in(second_verifier, SECOND_VERIFIER_EMAIL, VERIFIER_PASSWORD)
        open_assigned_review(second_verifier, "receipt.pdf")
        second_verifier.get_by_role("heading", name="Detail review").wait_for(state="visible")
        second_verifier.locator('input[name="decision"][value="NEEDS_REVISION"]').check()
        second_verifier.get_by_label("Instruksi untuk Organizer").fill("Unggah ulang receipt lengkap dengan nama vendor.")
        second_verifier.get_by_label("Catatan internal reviewer").fill("Nama vendor tidak tampak jelas pada gambar.")
        second_verifier.get_by_label("Saya tidak memiliki konflik kepentingan terhadap Organizer atau Funder pada evidence ini.").check()
        second_verifier.get_by_label("Saya memahami vote yang ditandatangani tidak dapat diubah.").check()
        second_verifier.get_by_role("button", name="Tanda tangani dan kirim NEEDS_REVISION").click()
        second_verifier.get_by_text("Quorum dikonfirmasi: NEEDS_REVISION.", exact=True).wait_for(state="visible")
        assert_accessible(second_verifier)
        second_verifier.screenshot(path=str(SCREENSHOT_DIR / "verifier-quorum-desktop.png"), full_page=True)
        second_verifier.set_viewport_size({"width": 390, "height": 844})
        assert_accessible(second_verifier)
        assert_no_horizontal_overflow(second_verifier)
        second_verifier.screenshot(path=str(SCREENSHOT_DIR / "verifier-quorum-mobile.png"), full_page=True)
        second_verifier.set_viewport_size({"width": 1440, "height": 900})

        verifier_page.goto(f"{BASE_URL}/verifier/reviews", wait_until="networkidle")
        open_assigned_review(verifier_page, "over-budget.pdf")
        verifier_page.get_by_role("heading", name="Detail review").wait_for(state="visible")
        verifier_page.locator('input[name="decision"][value="VERIFIED"]').check()
        verifier_page.get_by_label("Saya tidak memiliki konflik kepentingan terhadap Organizer atau Funder pada evidence ini.").check()
        verifier_page.get_by_label("Saya memahami vote yang ditandatangani tidak dapat diubah.").check()
        verifier_page.get_by_role("button", name="Tanda tangani dan kirim VERIFIED").click()
        verifier_page.get_by_text("Vote tersimpan dan dikirim", exact=False).wait_for(state="visible")

        second_verifier.goto(f"{BASE_URL}/verifier/reviews", wait_until="networkidle")
        open_assigned_review(second_verifier, "over-budget.pdf")
        second_verifier.get_by_role("heading", name="Detail review").wait_for(state="visible")
        second_verifier.locator('input[name="decision"][value="NEEDS_REVISION"]').check()
        second_verifier.get_by_label("Instruksi untuk Organizer").fill("Lengkapi bukti jumlah dan tanggal transaksi.")
        second_verifier.get_by_label("Saya tidak memiliki konflik kepentingan terhadap Organizer atau Funder pada evidence ini.").check()
        second_verifier.get_by_label("Saya memahami vote yang ditandatangani tidak dapat diubah.").check()
        second_verifier.get_by_role("button", name="Tanda tangani dan kirim NEEDS_REVISION").click()
        second_verifier.get_by_text("Vote tersimpan dan dikirim", exact=False).wait_for(state="visible")

        third_verifier_context = browser.new_context(viewport={"width": 1440, "height": 900})
        third_verifier = third_verifier_context.new_page()
        third_verifier.on("pageerror", lambda error: errors.append(str(error)))
        sign_in(third_verifier, THIRD_VERIFIER_EMAIL, VERIFIER_PASSWORD)
        open_assigned_review(third_verifier, "over-budget.pdf")
        third_verifier.get_by_role("heading", name="Detail review").wait_for(state="visible")
        third_verifier.locator('input[name="decision"][value="REJECTED"]').check()
        third_verifier.get_by_label("Saya tidak memiliki konflik kepentingan terhadap Organizer atau Funder pada evidence ini.").check()
        third_verifier.get_by_label("Saya memahami vote yang ditandatangani tidak dapat diubah.").check()
        third_verifier.get_by_role("button", name="Tanda tangani dan kirim REJECTED").click()
        third_verifier.get_by_role("status").get_by_text("Semua vote berbeda. Quorum tidak tercapai", exact=False).wait_for(state="visible")
        third_verifier.get_by_text("Quorum belum tercapai — verifikasi tetap pending", exact=True).wait_for(state="visible")
        assert_accessible(third_verifier)
        third_verifier.set_viewport_size({"width": 390, "height": 844})
        assert_no_horizontal_overflow(third_verifier)
        third_verifier.screenshot(path=str(SCREENSHOT_DIR / "verifier-no-quorum-mobile.png"), full_page=True)
        third_verifier.set_viewport_size({"width": 1440, "height": 900})

        organizer.reload(wait_until="networkidle")
        organizer.get_by_text("Unggah ulang receipt lengkap dengan nama vendor.", exact=True).wait_for(state="visible")
        revision_input = organizer.get_by_label("File pengganti")
        revision_input.set_input_files({
            "name": "receipt-revised.pdf",
            "mimeType": "application/pdf",
            "buffer": b"%PDF-1.7\ncomplete revised receipt",
        })
        organizer.get_by_role("button", name="Kirim versi revisi").click()
        organizer.get_by_text("receipt-revised.pdf", exact=False).wait_for(state="visible")
        organizer.get_by_text("versi 2", exact=False).wait_for(state="visible")
        assert_accessible(organizer)
        organizer.set_viewport_size({"width": 390, "height": 844})
        assert_no_horizontal_overflow(organizer)
        organizer.screenshot(path=str(SCREENSHOT_DIR / "organizer-revision-mobile.png"), full_page=True)
        organizer.set_viewport_size({"width": 1440, "height": 900})

        funder.goto(f"{BASE_URL}{campaign_path}", wait_until="networkidle")
        funder.get_by_text("Perlu revisi oleh quorum", exact=True).wait_for(state="visible")
        assert "Unggah ulang receipt lengkap dengan nama vendor." not in funder.locator("body").inner_text()
        assert "receipt.pdf" not in funder.locator("body").inner_text()

        sign_in(page, ADMIN_EMAIL, ADMIN_PASSWORD)
        page.get_by_role("link", name="Operasi review").click()
        page.get_by_role("heading", name="Operasi review").wait_for(state="visible")
        admin_table = page.get_by_role("table", name="Round review · metadata operasional saja")
        expect(admin_table.get_by_text("Quorum tercapai", exact=True).first).to_be_visible()
        assert "receipt.pdf" not in page.locator("body").inner_text()
        assert "Unggah ulang receipt lengkap dengan nama vendor." not in page.locator("body").inner_text()
        assert page.get_by_role("button", name="Setujui").count() == 0
        assert_accessible(page)
        assert_no_horizontal_overflow(page)
        page.screenshot(path=str(SCREENSHOT_DIR / "admin-review-operations-desktop.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        assert_no_horizontal_overflow(page)
        assert admin_table.locator("code").first.evaluate("element => getComputedStyle(element).whiteSpace") == "nowrap"
        assert admin_table.evaluate("table => table.parentElement.scrollWidth > table.parentElement.clientWidth")
        page.screenshot(path=str(SCREENSHOT_DIR / "admin-review-operations-mobile.png"), full_page=True)
        page.set_viewport_size({"width": 1440, "height": 900})

        organizer.get_by_role("button", name="Selesaikan milestone Pembelian material").click()
        organizer.get_by_text("COMPLETED", exact=True).wait_for(state="visible")
        organizer.goto(f"{BASE_URL}/dashboard", wait_until="networkidle")
        assert organizer.get_by_text("Milestone selesai", exact=True).is_visible()
        assert organizer.get_by_text("Verified by peer quorum", exact=True).count() == 0
        organizer.goto(f"{BASE_URL}/milestones", wait_until="networkidle")
        completed_milestone_card = organizer.locator(".milestone-full-card", has_text="Pembelian material")
        assert completed_milestone_card.get_by_text("Selesai", exact=True).is_visible()
        organizer.goto(campaign_url, wait_until="networkidle")
        organizer.set_viewport_size({"width": 390, "height": 844})
        assert_accessible(organizer)
        assert_no_horizontal_overflow(organizer)
        organizer.screenshot(path=str(SCREENSHOT_DIR / "campaign-detail-mobile.png"), full_page=True)

        assert not errors, errors
        admin_context.close()
        organizer_context.close()
        funder_context.close()
        verifier_context.close()
        second_verifier_context.close()
        third_verifier_context.close()
        browser.close()


if __name__ == "__main__":
    main()
