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
REPO_ROOT = WEB_DIR.parents[1]
NEXT_BIN = REPO_ROOT / "node_modules" / "next" / "dist" / "bin" / "next"


def reserve_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_for_server(process, url, timeout_seconds=90):
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Next dev server exited with code {process.returncode}")
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

    port = reserve_port()
    base_url = f"http://127.0.0.1:{port}"
    env = os.environ.copy()
    env["DANATERANG_WEB_URL"] = base_url
    server = subprocess.Popen(
        [node, str(NEXT_BIN), "dev", "--hostname", "127.0.0.1", "--port", str(port)],
        cwd=WEB_DIR,
        env=env,
    )
    try:
        wait_for_server(server, base_url)
        sys.path.insert(0, str(WEB_DIR / "tests"))
        from test_public_audit import main as run_browser_checks

        run_browser_checks()
    finally:
        stop_server(server)


if __name__ == "__main__":
    main()
