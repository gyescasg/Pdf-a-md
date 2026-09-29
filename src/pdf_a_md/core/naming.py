import re
from collections.abc import Sequence
from pathlib import PurePath

# Caracteres no válidos en nombres de archivo de Windows, más controles.
_INVALID_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_FALLBACK_STEM = "document"


def safe_basename(filename: str) -> str:
    """Nombre base seguro: sin rutas (evita path traversal en ZIP) ni caracteres inválidos."""
    # Se normalizan ambos separadores: PurePath en Windows no trata "/" y "\" igual que en Linux.
    name = PurePath(filename.replace("\\", "/")).name
    name = _INVALID_CHARS_RE.sub("_", name).strip(" .")
    return name or _FALLBACK_STEM


def markdown_filename(source_name: str) -> str:
    stem = PurePath(safe_basename(source_name)).stem.strip(" .")
    return f"{stem or _FALLBACK_STEM}.md"


def unique_markdown_filenames(source_names: Sequence[str]) -> list[str]:
    """Nombres .md únicos (sin distinguir mayúsculas, como Windows), conservando el orden."""
    used: set[str] = set()
    result: list[str] = []
    for source_name in source_names:
        candidate = markdown_filename(source_name)
        stem = candidate[:-3]
        counter = 2
        while candidate.lower() in used:
            candidate = f"{stem} ({counter}).md"
            counter += 1
        used.add(candidate.lower())
        result.append(candidate)
    return result
