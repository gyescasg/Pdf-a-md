from typing import Protocol

from pdf_a_md.core.models import ConvertedDocument, PdfSource


class PdfConverter(Protocol):
    """Puerto del motor de conversión. Debe lanzar ConversionError ante fallos esperables."""

    def convert(self, source: PdfSource) -> ConvertedDocument: ...
