import io
import threading
import zipfile
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from pdf_a_md.core.merger import merge_documents
from pdf_a_md.core.models import ConvertedDocument, PdfSource
from pdf_a_md.core.naming import safe_basename, unique_markdown_filenames
from pdf_a_md.core.ports import PdfConverter
from pdf_a_md.core.service import DEFAULT_MAX_BYTES, convert_batch

STATIC_DIR = Path(__file__).parent / "static"
MERGED_FILENAME = "combinado.md"
ZIP_FILENAME = "markdown.zip"
MAX_EXPORT_DOCUMENTS = 500
MAX_MARKDOWN_CHARS = 10_000_000


class ConvertResponse(BaseModel):
    name: str
    status: Literal["converted", "skipped", "error"]
    pdf_bytes: int
    markdown: str = ""
    pages: int = 0
    reason: str = ""
    code: str = ""


class ExportDocument(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    markdown: str = Field(max_length=MAX_MARKDOWN_CHARS)
    pages: int = Field(ge=0)


class ExportRequest(BaseModel):
    mode: Literal["single", "merged"]
    documents: list[ExportDocument] = Field(min_length=1, max_length=MAX_EXPORT_DOCUMENTS)


def _attachment(content: bytes, filename: str, media_type: str) -> Response:
    # filename* (RFC 5987) permite nombres con tildes o eñes; filename queda como respaldo ASCII.
    ascii_name = filename.encode("ascii", "replace").decode().replace("?", "_")
    disposition = f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"
    return Response(content, media_type=media_type, headers={"Content-Disposition": disposition})


def _build_zip(documents: list[ExportDocument]) -> bytes:
    buffer = io.BytesIO()
    names = unique_markdown_filenames([doc.name for doc in documents])
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for doc, name in zip(documents, names, strict=True):
            archive.writestr(name, doc.markdown)
    return buffer.getvalue()


def create_app(converter: PdfConverter, max_bytes: int = DEFAULT_MAX_BYTES) -> FastAPI:
    app = FastAPI(title="pdf-a-md", docs_url=None, redoc_url=None, openapi_url=None)
    # Protege contra DNS rebinding: solo se aceptan peticiones dirigidas a este equipo.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    # PyMuPDF no es seguro entre hilos y FastAPI ejecuta los endpoints síncronos en un pool.
    conversion_lock = threading.Lock()

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.post("/api/convert")
    def convert(file: Annotated[UploadFile, File()]) -> ConvertResponse:
        name = safe_basename(file.filename or "")
        content = file.file.read(max_bytes + 1)  # +1 para detectar el exceso sin leer todo

        with conversion_lock:
            result = convert_batch([PdfSource(filename=name, content=content)], converter, max_bytes)

        base = {"name": name, "pdf_bytes": len(content)}
        if result.documents:
            doc = result.documents[0]
            return ConvertResponse(
                **base, status="converted", markdown=doc.markdown, pages=doc.page_count
            )
        notice, status = (
            (result.skipped[0], "skipped") if result.skipped else (result.errors[0], "error")
        )
        return ConvertResponse(**base, status=status, reason=notice.reason, code=notice.code)

    @app.post("/api/export")
    def export(request: ExportRequest) -> Response:
        if request.mode == "merged":
            documents = [
                ConvertedDocument(source_name=d.name, markdown=d.markdown, page_count=d.pages)
                for d in request.documents
            ]
            content = merge_documents(documents).encode("utf-8")
            return _attachment(content, MERGED_FILENAME, "text/markdown; charset=utf-8")

        if len(request.documents) == 1:
            doc = request.documents[0]
            filename = unique_markdown_filenames([doc.name])[0]
            return _attachment(doc.markdown.encode("utf-8"), filename, "text/markdown; charset=utf-8")

        return _attachment(_build_zip(request.documents), ZIP_FILENAME, "application/zip")

    return app
