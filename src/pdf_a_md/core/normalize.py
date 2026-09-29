import re

_FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})")


def normalize_markdown(markdown: str) -> str:
    """Quita espacios finales y colapsa líneas vacías repetidas para reducir tokens.

    El contenido de bloques de código se deja intacto.
    """
    result: list[str] = []
    in_fence = False
    blank_run = 0

    for line in markdown.splitlines():
        if _FENCE_RE.match(line):
            in_fence = not in_fence
            blank_run = 0
            result.append(line.rstrip())
            continue
        if in_fence:
            result.append(line)
            continue

        line = line.rstrip()
        if not line:
            blank_run += 1
            if blank_run > 1:
                continue
        else:
            blank_run = 0
        result.append(line)

    return "\n".join(result).strip() + "\n"
