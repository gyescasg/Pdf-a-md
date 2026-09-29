import re
from collections.abc import Sequence

from pdf_a_md.core.models import ConvertedDocument

MAX_HEADING_LEVEL = 6
_HEADING_RE = re.compile(r"^(?P<indent> {0,3})(?P<hashes>#{1,6})(?=\s|$)")
_FENCE_RE = re.compile(r"^ {0,3}(?P<fence>`{3,}|~{3,})")


def demote_headings(markdown: str, levels: int = 1) -> str:
    """Baja los títulos ATX `levels` niveles (tope h6), sin tocar bloques de código."""
    if levels <= 0:
        return markdown

    result: list[str] = []
    open_fence: str | None = None

    for line in markdown.splitlines(keepends=True):
        fence_match = _FENCE_RE.match(line)
        if fence_match:
            fence = fence_match.group("fence")
            if open_fence is None:
                open_fence = fence
            elif fence[0] == open_fence[0] and len(fence) >= len(open_fence):
                open_fence = None
            result.append(line)
            continue

        if open_fence is None:
            heading = _HEADING_RE.match(line)
            if heading:
                new_level = min(MAX_HEADING_LEVEL, len(heading.group("hashes")) + levels)
                line = heading.group("indent") + "#" * new_level + line[heading.end():]
        result.append(line)

    return "".join(result)


def _safe_comment_text(text: str) -> str:
    # "--" no es válido dentro de un comentario HTML y podría cerrarlo antes de tiempo.
    return text.replace("--", "- -")


def merge_documents(
    documents: Sequence[ConvertedDocument], toc_title: str = "Índice"
) -> str:
    """Une los documentos en el orden recibido, con índice y una sección h1 por archivo."""
    if not documents:
        return ""

    toc_lines = [f"{i}. {doc.source_name}" for i, doc in enumerate(documents, start=1)]
    parts = [f"# {toc_title}\n\n" + "\n".join(toc_lines) + "\n"]

    for doc in documents:
        body = demote_headings(doc.markdown).strip()
        comment = _safe_comment_text(f"source: {doc.source_name} | pages: {doc.page_count}")
        parts.append(f"# {doc.source_name}\n<!-- {comment} -->\n\n{body}\n")

    return "\n---\n\n".join(parts)
