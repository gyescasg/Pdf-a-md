from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class PdfSource:
    filename: str
    content: bytes


@dataclass(frozen=True, slots=True)
class ConvertedDocument:
    source_name: str
    markdown: str
    page_count: int


class ConversionError(Exception):
    """Fallo al convertir un archivo concreto; no debe abortar el lote completo.

    `code` es un identificador estable para que las interfaces muestren su propio mensaje
    sin depender del texto de `reason`.
    """

    def __init__(self, source_name: str, reason: str, code: str = "conversion_failed") -> None:
        super().__init__(f"{source_name}: {reason}")
        self.source_name = source_name
        self.reason = reason
        self.code = code


class NoExtractableTextError(ConversionError):
    """El PDF no tiene texto (p. ej. escaneado). Se omite; no cuenta como fallo."""


@dataclass(frozen=True, slots=True)
class BatchResult:
    documents: tuple[ConvertedDocument, ...]
    errors: tuple[ConversionError, ...]
    skipped: tuple[NoExtractableTextError, ...] = ()
