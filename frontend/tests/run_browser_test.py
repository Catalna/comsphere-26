import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen


WEB_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = WEB_DIR.parent
NEXT_BIN = REPO_ROOT / "node_modules" / "next" / "dist" / "bin" / "next"
TEST_API_SCRIPT = REPO_ROOT / "backend" / "scripts" / "browser-test-server.js"


def reserve_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_for_server(process, url, timeout_seconds=90):
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Test server exited with code {process.returncode}")
        try:
            with urlopen(url, timeout=1):
                return
        except (URLError, TimeoutError, OSError):
            time.sleep(0.25)
    raise TimeoutError("Next dev server did not become ready within 90 seconds")


def stop_server(process):
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()


def main():
    node = shutil.which("node")
    if not node or not NEXT_BIN.exists():
        raise RuntimeError("Run npm install before the web browser tests")

    api_port = reserve_port()
    web_port = reserve_port()
    api_url = f"http://127.0.0.1:{api_port}"
    base_url = f"http://127.0.0.1:{web_port}"
    admin_email = "admin@example.test"
    admin_password = "Test-Admin-Password-123"
    funder_email = "funder@example.test"
    funder_password = "Test-Funder-Password-123"
    verifier_email = "verifier-1@example.test"
    verifier_password = "Test-Verifier-Password-123"
    api_env = os.environ.copy()
    api_env.update({
        "NODE_ENV": "test",
        "HOST": "127.0.0.1",
        "PORT": str(api_port),
        "WEB_ORIGIN": base_url,
        "DANATERANG_TEST_ADMIN_EMAIL": admin_email,
        "DANATERANG_TEST_ADMIN_PASSWORD": admin_password,
        "DANATERANG_TEST_FUNDER_EMAIL": funder_email,
        "DANATERANG_TEST_FUNDER_PASSWORD": funder_password,
        "DANATERANG_TEST_VERIFIER_EMAIL": verifier_email,
        "DANATERANG_TEST_VERIFIER_PASSWORD": verifier_password,
    })
    os.environ["DANATERANG_WEB_URL"] = base_url
    os.environ["DANATERANG_TEST_ADMIN_EMAIL"] = admin_email
    os.environ["DANATERANG_TEST_ADMIN_PASSWORD"] = admin_password
    os.environ["DANATERANG_TEST_FUNDER_EMAIL"] = funder_email
    os.environ["DANATERANG_TEST_FUNDER_PASSWORD"] = funder_password
    os.environ["DANATERANG_TEST_VERIFIER_EMAIL"] = verifier_email
    os.environ["DANATERANG_TEST_VERIFIER_PASSWORD"] = verifier_password

    api_server = None
    web_server = None
    try:
        api_server = subprocess.Popen([node, str(TEST_API_SCRIPT)], cwd=REPO_ROOT, env=api_env)
        wait_for_server(api_server, f"{api_url}/api/health")

        web_env = os.environ.copy()
        web_env["API_INTERNAL_URL"] = api_url
        web_env["NEXT_PUBLIC_REVIEW_CHAIN_ID"] = "0x7a69"
        build_result = subprocess.run(
            [node, str(NEXT_BIN), "build"],
            cwd=WEB_DIR,
            env=web_env,
            check=False,
        )
        if build_result.returncode != 0:
            raise RuntimeError(f"Next production build failed with exit code {build_result.returncode}")

        web_server = subprocess.Popen(
            [node, str(NEXT_BIN), "start", "--hostname", "127.0.0.1", "--port", str(web_port)],
            cwd=WEB_DIR,
            env=web_env,
        )
        wait_for_server(web_server, base_url)
        sys.path.insert(0, str(WEB_DIR / "tests"))
        from test_public_audit import main as run_browser_checks
        from test_authenticated_flow import main as run_authenticated_checks

        run_browser_checks()
        run_authenticated_checks()
    finally:
        if web_server:
            stop_server(web_server)
        if api_server:
            stop_server(api_server)


if __name__ == "__main__":
    main()
