import logging
from collections.abc import Iterable
from dataclasses import replace

from pdf_a_md.core.models import (
    BatchResult,
    ConversionError,
    ConvertedDocument,
    NoExtractableTextError,
    PdfSource,
)
from pdf_a_md.core.normalize import normalize_markdown
from pdf_a_md.core.ports import PdfConverter

logger = logging.getLogger(__name__)

DEFAULT_MAX_BYTES = 50 * 1024 * 1024
PDF_MAGIC = b"%PDF"
# La especificación permite basura antes de la firma; los lectores buscan en el primer KB.
MAGIC_SEARCH_WINDOW = 1024


def validate_source(source: PdfSource, max_bytes: int = DEFAULT_MAX_BYTES) -> None:
    if not source.filename.lower().endswith(".pdf"):
        raise ConversionError(
            source.filename, "the file extension is not .pdf", "invalid_extension"
        )
    if not source.content:
        raise ConversionError(source.filename, "the file is empty", "empty_file")
    if len(source.content) > max_bytes:
        raise ConversionError(
            source.filename,
            f"the file exceeds the {max_bytes // (1024 * 1024)} MB limit",
            "file_too_large",
        )
    if PDF_MAGIC not in source.content[:MAGIC_SEARCH_WINDOW]:
        raise ConversionError(source.filename, "the content is not a valid PDF", "not_a_pdf")


def convert_batch(
    sources: Iterable[PdfSource],
    converter: PdfConverter,
    max_bytes: int = DEFAULT_MAX_BYTES,
) -> BatchResult:
    """Convierte cada archivo de forma aislada: un fallo no detiene el resto. Conserva el orden.

    Los PDF sin texto extraíble (escaneados) se omiten sin contarse como error.
    """
    documents: list[ConvertedDocument] = []
    errors: list[ConversionError] = []
    skipped: list[NoExtractableTextError] = []

    for source in sources:
        try:
            validate_source(source, max_bytes)
            document = converter.convert(source)
            documents.append(replace(document, markdown=normalize_markdown(document.markdown)))
        except NoExtractableTextError as notice:
            skipped.append(notice)
        except ConversionError as error:
            errors.append(error)
        except Exception:
            # Red de seguridad: un error inesperado del motor no debe tumbar el lote.
            logger.exception("Unexpected error while converting %s", source.filename)
            errors.append(
                ConversionError(
                    source.filename, "unexpected error during conversion", "unexpected_error"
                )
            )

    return BatchResult(
        documents=tuple(documents), errors=tuple(errors), skipped=tuple(skipped)
    )
