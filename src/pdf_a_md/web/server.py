import argparse
import socket
import sys
import threading
import webbrowser

import uvicorn

from pdf_a_md.adapters.pymupdf_converter import PyMuPdfConverter
from pdf_a_md.web.app import create_app

HOST = "127.0.0.1"
DEFAULT_PORT = 8765


def _port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind((HOST, port))
        except OSError:
            return False
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pdf-a-md-web", description="Local web UI for pdf-a-md.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--engine", choices=("classic", "layout"), default="layout")
    parser.add_argument("--no-browser", action="store_true", help="do not open the browser")
    args = parser.parse_args(argv)

    if not _port_is_free(args.port):
        print(
            f"ERROR: port {args.port} is already in use. "
            f"Is pdf-a-md already running? Try another one with --port.",
            file=sys.stderr,
        )
        return 1

    app = create_app(PyMuPdfConverter(use_layout=args.engine == "layout"))
    url = f"http://{HOST}:{args.port}/"
    print(f"pdf-a-md running at {url}  (Ctrl+C to stop)")

    if not args.no_browser:
        # Pequeña espera para que el servidor acepte conexiones antes de abrir la pestaña.
        threading.Timer(1.0, webbrowser.open, args=(url,)).start()

    uvicorn.run(app, host=HOST, port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
