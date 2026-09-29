# pdf-a-md

Convierte documentos PDF a Markdown limpio y estructurado, listo para usarse como contexto en
herramientas de inteligencia artificial con un consumo de tokens mucho menor que el PDF original.

> **Proyecto personal (hobby).** Se desarrolla en tiempo libre, sin garantías ni soporte formal.
> Los issues y sugerencias son bienvenidos, pero las respuestas pueden demorar.

## Características

- **Uno o varios archivos** en una sola ejecución.
- **Dos modos de salida:**
  - `single`: un archivo `.md` por cada PDF (relación 1:1).
  - `merged`: un único `.md` con índice, donde cada PDF es una sección identificada por su
    nombre de archivo, en el orden indicado.
- **Respeta la estructura:** títulos, listas, negritas y diseños a varias columnas, gracias al
  análisis de layout de [PyMuPDF4LLM](https://github.com/pymupdf/pymupdf4llm).
- **Tolerante a fallos:** si un archivo está dañado o protegido con contraseña, se informa y el
  resto del lote se procesa igual.
- **Procesamiento 100 % local:** ningún documento sale de tu equipo.

## Alcance

Está pensado para **PDF digitales**, es decir, generados desde Word, Excel, PowerPoint o cualquier
sistema. Los PDF escaneados (imágenes sin texto) **se omiten** y se informan como tales; no se
aplica OCR.

## Requisitos

- Python 3.12 o superior
- [uv](https://docs.astral.sh/uv/) (recomendado)

## Instalación

```bash
git clone https://github.com/gyescasg/Pdf-a-md.git
cd Pdf-a-md
uv sync
```

## Uso

### Interfaz gráfica

En Windows, haz doble clic en `iniciar.bat`. En cualquier sistema operativo:

```bash
uv run pdf-a-md-web
```

Se abre el navegador en `http://127.0.0.1:8765`. Desde ahí puedes:

- Arrastrar uno o varios PDF (o elegirlos con el explorador de archivos).
- Reordenarlos arrastrando, con los botones ↑ ↓ o con `Alt + ↑ / ↓`.
- Ver el resultado como Markdown resaltado o como vista de lectura, con el peso y los tokens
  estimados de cada documento.
- Elegir **Un archivo por PDF** (descarga un `.md` o un `.zip`) o **Todo en uno** (un único
  `.md` combinado, con vista previa en vivo).
- Copiar el resultado al portapapeles para pegarlo directamente en una herramienta de IA.

El servidor solo escucha en `127.0.0.1`, así que no es accesible desde otros equipos de la red.
Opciones: `--port`, `--engine` y `--no-browser`.

### Línea de comandos

```bash
# Un .md por cada PDF
uv run pdf-a-md informe.pdf propuesta.pdf --out salida

# Todo en un único .md (el orden de los argumentos define el orden del documento)
uv run pdf-a-md informe.pdf propuesta.pdf --mode merged --out salida

# También acepta carpetas y comodines (funciona igual en PowerShell, cmd y bash)
uv run pdf-a-md documentos --mode merged --out salida
uv run pdf-a-md "documentos/*.pdf" --out salida
```

Si no se encuentra ningún PDF, el comando termina con código `2`.

| Opción | Descripción | Valor por defecto |
|---|---|---|
| `--mode` | `single` o `merged` | `single` |
| `--out` | Carpeta de salida | `output` |
| `--merged-name` | Nombre del archivo en modo `merged` | `merged.md` |
| `--engine` | `layout` (análisis de layout) o `classic` (heurística de fuentes) | `layout` |
| `--force` | Sobrescribe archivos de salida existentes | desactivado |

El comando termina con código `1` si algún archivo falló. Los PDF omitidos por no tener texto no
cuentan como error.

### Formato del modo `merged`

```markdown
# Índice

1. informe.pdf
2. propuesta.pdf

---

# informe.pdf
<!-- source: informe.pdf | pages: 3 -->

## Título original del documento
...
```

Los títulos de cada documento bajan un nivel para que la jerarquía quede subordinada al nombre del
archivo de origen.

## Arquitectura

Arquitectura hexagonal: el dominio no depende del motor de conversión, por lo que puede
reemplazarse sin modificar el resto de la aplicación.

```
src/pdf_a_md/
├── core/        # Dominio: modelos, puerto del conversor, validación, normalización y combinación
├── adapters/    # Implementación del conversor sobre PyMuPDF4LLM
├── web/         # API local (FastAPI) e interfaz web sin dependencias de frontend
└── cli.py       # Interfaz de línea de comandos
```

La interfaz web no usa frameworks ni CDN: funciona sin conexión a internet.

## Hoja de ruta

- [x] Núcleo de conversión y línea de comandos
- [x] Interfaz web local con carga múltiple y orden por arrastre
- [ ] Ejecutable para Windows

## Privacidad

Los documentos se procesan en tu equipo y no se guardan: la aplicación no conserva copias de los
PDF ni del Markdown generado, salvo los archivos que tú descargues. El repositorio ignora por defecto los
archivos `.pdf` y `.md` generados, para evitar publicar información sensible por accidente.

## Licencia

Distribuido bajo la licencia [GNU AGPL-3.0](LICENSE), la misma que utilizan sus dependencias
principales.

## Agradecimientos

Construido sobre [PyMuPDF](https://github.com/pymupdf/PyMuPDF) y
[PyMuPDF4LLM](https://github.com/pymupdf/pymupdf4llm), distribuidos por Artifex bajo licencia
AGPL-3.0 o licencia comercial.
