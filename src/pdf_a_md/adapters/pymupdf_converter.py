import pymupdf
import pymupdf4llm

from pdf_a_md.core.models import (
    ConversionError,
    ConvertedDocument,
    NoExtractableTextError,
    PdfSource,
)

_NO_TEXT_REASON = "no extractable text found (likely a scanned PDF); skipped"


class PyMuPdfConverter:
    """Adaptador sobre pymupdf4llm para PDF digitales (sin OCR en esta versión).

    `use_layout` activa el motor de análisis de layout (ML). Es un estado global de
    pymupdf4llm, por eso se fija una sola vez al construir y no por llamada: alternarlo
    por petición provocaría condiciones de carrera con solicitudes concurrentes.
    """

    def __init__(self, use_layout: bool = True) -> None:
        pymupdf4llm.use_layout(use_layout)
        # El motor clásico no soporta OCR y advierte si recibe `use_ocr`.
        self._options: dict[str, bool] = {"show_progress": False}
        if use_layout:
            self._options["use_ocr"] = False

    def convert(self, source: PdfSource) -> ConvertedDocument:
        try:
            doc = pymupdf.open(stream=source.content, filetype="pdf")
        except (pymupdf.FileDataError, pymupdf.EmptyFileError) as error:
            raise ConversionError(
                source.filename, "the PDF is corrupted or unreadable", "corrupted_pdf"
            ) from error

        with doc:
            if doc.needs_pass:
                raise ConversionError(
                    source.filename, "the PDF is password protected", "password_protected"
                )
            if doc.page_count == 0:
                raise ConversionError(source.filename, "the PDF has no pages", "no_pages")
            # Chequeo barato antes del motor: un escaneo puro se omite sin pasar por el modelo.
            if not any(page.get_text().strip() for page in doc):
                raise NoExtractableTextError(source.filename, _NO_TEXT_REASON, "no_text")

            markdown = pymupdf4llm.to_markdown(doc, **self._options)
            page_count = doc.page_count

        if not markdown.strip():
            raise NoExtractableTextError(source.filename, _NO_TEXT_REASON, "no_text")

        return ConvertedDocument(
            source_name=source.filename, markdown=markdown, page_count=page_count
        )
