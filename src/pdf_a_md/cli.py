import argparse
import glob
import logging
import sys
from pathlib import Path

from pdf_a_md.adapters.pymupdf_converter import PyMuPdfConverter
from pdf_a_md.core.merger import merge_documents
from pdf_a_md.core.models import PdfSource
from pdf_a_md.core.naming import unique_markdown_filenames
from pdf_a_md.core.service import convert_batch


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="pdf-a-md", description="Convert PDF files to Markdown.")
    parser.add_argument("files", nargs="+", type=Path, help="PDF files, folders or wildcards, in the desired order")
    parser.add_argument("--mode", choices=("single", "merged"), default="single")
    parser.add_argument("--out", type=Path, default=Path("output"), help="output directory")
    parser.add_argument("--merged-name", default="merged.md", help="file name for merged mode")
    parser.add_argument("--force", action="store_true", help="overwrite existing output files")
    parser.add_argument(
        "--engine",
        choices=("classic", "layout"),
        default="layout",
        help="layout: ML layout analysis (recommended); classic: font/position heuristics",
    )
    return parser.parse_args(argv)


def _expand_inputs(inputs: list[Path]) -> list[Path]:
    """Expande carpetas y comodines. PowerShell/cmd no expanden `*.pdf` como lo hace bash.

    Se respeta el orden de los argumentos; dentro de una carpeta o comodín se ordena por nombre.
    """
    files: list[Path] = []
    for item in inputs:
        if item.is_dir():
            matches = [p for p in item.iterdir() if p.is_file() and p.suffix.lower() == ".pdf"]
        elif glob.has_magic(str(item)):
            matches = [Path(p) for p in glob.glob(str(item))]
            if not matches:
                print(f"WARNING: no files match {item}", file=sys.stderr)
        else:
            files.append(item)
            continue
        files.extend(sorted(matches, key=lambda p: p.name.lower()))
    return files


def _write(path: Path, content: str, force: bool) -> bool:
    if path.exists() and not force:
        print(f"NOT WRITTEN (already exists, use --force): {path}", file=sys.stderr)
        return False
    path.write_text(content, encoding="utf-8")
    print(f"OK: {path}")
    return True


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    args = _parse_args(argv)

    files = _expand_inputs(args.files)
    if not files:
        print("ERROR: no PDF files to process", file=sys.stderr)
        return 2

    sources: list[PdfSource] = []
    read_failures = 0
    for file in files:
        try:
            sources.append(PdfSource(filename=file.name, content=file.read_bytes()))
        except OSError as error:
            print(f"ERROR: {file}: {error.strerror}", file=sys.stderr)
            read_failures += 1

    converter = PyMuPdfConverter(use_layout=args.engine == "layout")
    result = convert_batch(sources, converter)
    for notice in result.skipped:
        print(f"SKIPPED: {notice}", file=sys.stderr)
    for error in result.errors:
        print(f"ERROR: {error}", file=sys.stderr)

    if result.documents:
        args.out.mkdir(parents=True, exist_ok=True)
        if args.mode == "merged":
            _write(args.out / args.merged_name, merge_documents(result.documents), args.force)
        else:
            names = unique_markdown_filenames([doc.source_name for doc in result.documents])
            for doc, name in zip(result.documents, names, strict=True):
                _write(args.out / name, doc.markdown, args.force)

    return 1 if (result.errors or read_failures) else 0


if __name__ == "__main__":
    raise SystemExit(main())
