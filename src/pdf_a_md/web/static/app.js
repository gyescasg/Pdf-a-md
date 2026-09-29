import { highlightMarkdown, renderMarkdown } from "./markdown.js";

// ---------- Estado ----------

const state = {
  items: [], // { id, file, name, pdfBytes, status, markdown, mdBytes, pages, code, animated }
  mode: "single",
  view: "source",
  selectedId: null,
  merged: { key: null, text: "" },
};

let nextId = 1;
let queueRunning = false;
let mergedRequestSeq = 0;
let mergedPendingKey = null;
let dragId = null;

const ERROR_MESSAGES = {
  invalid_extension: "No es un archivo .pdf.",
  empty_file: "El archivo está vacío.",
  file_too_large: "Supera el límite de 50 MB.",
  not_a_pdf: "El contenido no es un PDF válido.",
  corrupted_pdf: "El PDF está dañado o no se puede leer.",
  password_protected: "El PDF está protegido con contraseña.",
  no_pages: "El PDF no tiene páginas.",
  no_text: "No tiene texto (parece escaneado), así que se omite.",
  unexpected_error: "No se pudo convertir por un error inesperado.",
  network: "No hay conexión con la aplicación. Revisa que la ventana del servidor siga abierta.",
};

// ---------- Utilidades ----------

const $ = (selector) => document.querySelector(selector);
const numberFmt = new Intl.NumberFormat("es");
const encoder = new TextEncoder();

function formatBytes(bytes) {
  if (bytes < 1024) return `${numberFmt.format(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${numberFmt.format(Number(kb.toFixed(kb < 10 ? 1 : 0)))} KB`;
  return `${numberFmt.format(Number((kb / 1024).toFixed(1)))} MB`;
}

// Estimación orientativa (~4 caracteres por token); cada modelo tokeniza distinto.
const estimateTokens = (text) => Math.ceil(text.length / 4);
const plural = (n, one, many) => `${numberFmt.format(n)} ${n === 1 ? one : many}`;

// Hacia abajo a propósito: 99,6 % no debe mostrarse como "100 %" si queda contenido.
const savingPercent = (before, after) => Math.max(0, Math.floor((1 - after / before) * 100));
const NBSP = " ";

const converted = () => state.items.filter((item) => item.status === "converted");
const findItem = (id) => state.items.find((item) => item.id === id);

let toastTimer;
function toast(message, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("is-error", isError);
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), isError ? 5000 : 2600);
}

// ---------- Carga y conversión ----------

function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  for (const file of files) {
    state.items.push({
      id: nextId++,
      file,
      name: file.name,
      pdfBytes: file.size,
      status: "pending",
      markdown: "",
      mdBytes: 0,
      pages: 0,
      code: "",
      animated: false,
    });
  }
  state.selectedId ??= state.items[0]?.id ?? null;
  render();
  processQueue();
}

async function convertItem(item) {
  const form = new FormData();
  form.append("file", item.file, item.name);
  try {
    const response = await fetch("/api/convert", { method: "POST", body: form });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    item.status = data.status;
    item.code = data.code;
    if (data.status === "converted") {
      item.markdown = data.markdown;
      item.mdBytes = encoder.encode(data.markdown).length;
      item.pages = data.pages;
    }
  } catch (error) {
    console.error(`Conversion failed for ${item.name}`, error);
    item.status = "error";
    item.code = error instanceof TypeError ? "network" : "unexpected_error";
  } finally {
    item.file = null; // Se libera el PDF: ya no se necesita en memoria.
  }
}

// Secuencial a propósito: el servidor serializa las conversiones y así el progreso se ve en orden.
async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    let item;
    while ((item = state.items.find((i) => i.status === "pending"))) {
      item.status = "converting";
      render();
      await convertItem(item);
      if (!findItem(item.id)) continue; // Se quitó mientras se convertía.
      if (item.status === "converted" && !findItem(state.selectedId)?.markdown) {
        state.selectedId = item.id;
      }
      render();
    }
  } finally {
    queueRunning = false;
  }
}

// ---------- Orden y eliminación ----------

function moveItem(id, targetIndex) {
  const from = state.items.findIndex((item) => item.id === id);
  if (from < 0) return;
  const [item] = state.items.splice(from, 1);
  const to = Math.max(0, Math.min(targetIndex, state.items.length));
  state.items.splice(to, 0, item);
  render({ focusId: id });
}

function removeItem(id) {
  const index = state.items.findIndex((item) => item.id === id);
  if (index < 0) return;
  state.items.splice(index, 1);
  if (state.selectedId === id) {
    state.selectedId = (state.items[index] ?? state.items[index - 1])?.id ?? null;
  }
  render({ focusId: state.selectedId });
}

// ---------- Exportación ----------

async function requestExport(mode, items) {
  const response = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode,
      documents: items.map(({ name, markdown, pages }) => ({ name, markdown, pages })),
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

function filenameFromResponse(response, fallback) {
  const header = response.headers.get("Content-Disposition") ?? "";
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded) return decodeURIComponent(encoded[1]);
  return header.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}

async function download() {
  const items = converted();
  if (!items.length) return;
  try {
    const response = await requestExport(state.mode, items);
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filenameFromResponse(response, "markdown");
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    toast(`Descargado: ${link.download}`);
  } catch (error) {
    console.error("Export failed", error);
    toast("No se pudo descargar. Revisa que la ventana del servidor siga abierta.", true);
  }
}

async function copyPreview() {
  const text = currentPreviewText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copiado al portapapeles (unos ${numberFmt.format(estimateTokens(text))} tokens)`);
  } catch (error) {
    console.error("Clipboard failed", error);
    toast("El navegador no permitió copiar. Usa Descargar.", true);
  }
}

// ---------- Vista previa ----------

const mergedKey = (items) => items.map((i) => i.id).join(",");

function currentPreviewText() {
  if (state.mode === "merged") {
    return state.merged.key === mergedKey(converted()) ? state.merged.text : "";
  }
  return findItem(state.selectedId)?.markdown ?? "";
}

async function refreshMerged() {
  const items = converted();
  const key = mergedKey(items);
  if (!items.length || key === state.merged.key || key === mergedPendingKey) return;
  const seq = ++mergedRequestSeq;
  mergedPendingKey = key;
  try {
    const text = await (await requestExport("merged", items)).text();
    if (seq !== mergedRequestSeq) return; // Llegó una respuesta más nueva.
    state.merged = { key, text };
    renderPreview();
  } catch (error) {
    console.error("Merged preview failed", error);
    toast("No se pudo generar la vista combinada.", true);
  } finally {
    if (mergedPendingKey === key) mergedPendingKey = null;
  }
}

function renderPreview() {
  const empty = $("#preview-empty");
  const source = $("#preview-body");
  const rendered = $("#preview-rendered");
  const title = $("#preview-title");
  const meta = $("#preview-meta");
  const items = converted();

  let text = "";
  if (state.mode === "merged") {
    title.textContent = "Documento combinado";
    if (items.length) {
      text = currentPreviewText();
      if (!text) refreshMerged();
      meta.textContent = text
        ? `${plural(items.length, "documento", "documentos")}, ${formatBytes(encoder.encode(text).length)}, unos ${numberFmt.format(estimateTokens(text))} tokens`
        : "Generando…";
    } else {
      meta.textContent = "";
    }
  } else {
    const item = findItem(state.selectedId);
    title.textContent = item ? item.name : "Vista previa";
    text = item?.markdown ?? "";
    meta.textContent = text
      ? `${plural(item.pages, "página", "páginas")}, ${formatBytes(item.mdBytes)}, unos ${numberFmt.format(estimateTokens(text))} tokens`
      : item
        ? statusText(item)
        : "";
  }

  const hasText = Boolean(text);
  empty.hidden = hasText;
  source.hidden = !hasText || state.view !== "source";
  rendered.hidden = !hasText || state.view !== "rendered";

  // Solo se vuelve a generar el HTML de la vista visible, y solo si el texto cambió.
  const target = state.view === "source" ? source : rendered;
  if (hasText && target.dataset.text !== text) {
    target.innerHTML = state.view === "source" ? highlightMarkdown(text) : renderMarkdown(text);
    target.dataset.text = text;
    target.scrollTop = 0;
  }

  for (const button of document.querySelectorAll(".view-toggle button")) {
    button.setAttribute("aria-pressed", String(button.dataset.view === state.view));
  }
  $("#copy-btn").disabled = !hasText;
}

// En modo combinado, elegir un documento lleva a su sección dentro de la vista previa.
function scrollMergedTo(item) {
  if (state.mode !== "merged") return;
  const container = state.view === "source" ? $("#preview-body") : $("#preview-rendered");
  const selector = state.view === "source" ? ".md-h1" : "h1";
  const wanted = state.view === "source" ? `# ${item.name}` : item.name;
  const heading = [...container.querySelectorAll(selector)].find((el) => el.textContent.trim() === wanted);
  heading?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

// ---------- Lista ----------

function statusText(item) {
  switch (item.status) {
    case "pending":
      return "En espera";
    case "converting":
      return "Convirtiendo…";
    case "converted":
      return `${plural(item.pages, "página", "páginas")}, de ${formatBytes(item.pdfBytes)} a ${formatBytes(item.mdBytes)}`;
    default:
      return ERROR_MESSAGES[item.code] ?? ERROR_MESSAGES.unexpected_error;
  }
}

function weightPercent(item) {
  return Math.max(0.8, Math.min(100, (item.mdBytes / item.pdfBytes) * 100));
}

function renderList(focusId) {
  const list = $("#file-list");
  const template = $("#file-item-template");
  const fragment = document.createDocumentFragment();

  state.items.forEach((item, index) => {
    const li = template.content.firstElementChild.cloneNode(true);
    li.dataset.id = item.id;
    li.dataset.status = item.status;
    li.classList.toggle("is-selected", item.id === state.selectedId);
    li.setAttribute("aria-current", item.id === state.selectedId ? "true" : "false");
    li.setAttribute("aria-label", `${index + 1}. ${item.name}. ${statusText(item)}`);
    li.querySelector(".file-name").textContent = item.name;
    li.querySelector(".file-status").textContent = statusText(item);
    li.querySelector('[data-action="up"]').disabled = index === 0;
    li.querySelector('[data-action="down"]').disabled = index === state.items.length - 1;
    for (const button of li.querySelectorAll("[data-action]")) {
      button.setAttribute("aria-label", `${button.getAttribute("aria-label")} ${item.name}`);
    }

    const bar = li.querySelector(".weight-bar-md");
    if (item.status === "converted") {
      li.querySelector(".weight-saving").textContent = `−${savingPercent(item.pdfBytes, item.mdBytes)}${NBSP}%`;
      if (item.animated) {
        bar.style.width = `${weightPercent(item)}%`;
      } else {
        // La barra arranca llena y se encoge: muestra cuánto "adelgazó" el documento.
        item.animated = true;
        requestAnimationFrame(() => requestAnimationFrame(() => (bar.style.width = `${weightPercent(item)}%`)));
      }
    }
    fragment.append(li);
  });

  list.replaceChildren(fragment);
  if (focusId != null) list.querySelector(`[data-id="${focusId}"]`)?.focus();
}

function renderScale() {
  const items = converted();
  const scale = $("#scale");
  scale.hidden = !items.length;
  if (!items.length) return;

  const pdf = items.reduce((sum, i) => sum + i.pdfBytes, 0);
  const md = items.reduce((sum, i) => sum + i.mdBytes, 0);
  const tokens = items.reduce((sum, i) => sum + estimateTokens(i.markdown), 0);
  const saving = savingPercent(pdf, md);

  $("#scale-pdf").style.width = "100%";
  $("#scale-md").style.width = `${Math.max(0.8, (md / pdf) * 100)}%`;
  $("#scale-pdf-value").textContent = formatBytes(pdf);
  $("#scale-md-value").textContent = formatBytes(md);
  $("#scale-summary").innerHTML = "";
  $("#scale-summary").append(
    `${saving}${NBSP}% más liviano`,
    Object.assign(document.createElement("small"), {
      textContent: `${plural(items.length, "documento convertido", "documentos convertidos")}, unos ${numberFmt.format(tokens)} tokens en total`,
    }),
  );
}

function render({ focusId } = {}) {
  const hasItems = state.items.length > 0;
  document.body.classList.toggle("has-files", hasItems);
  $("#list-head").hidden = !hasItems;
  renderList(focusId);
  renderScale();
  renderPreview();
  $("#download-btn").disabled = !converted().length;
  $("#download-btn").textContent =
    state.mode === "single" && converted().length > 1 ? "Descargar ZIP" : "Descargar";
}

// ---------- Eventos ----------

$("#file-input").addEventListener("change", (event) => {
  addFiles(event.target.files);
  event.target.value = ""; // Permite volver a elegir los mismos archivos.
});

$("#clear-btn").addEventListener("click", () => {
  if (!confirm("¿Quitar todos los documentos de la lista?")) return;
  state.items = [];
  state.selectedId = null;
  state.merged = { key: null, text: "" };
  render();
});

for (const radio of document.querySelectorAll('input[name="mode"]')) {
  radio.addEventListener("change", () => {
    state.mode = radio.value;
    render();
  });
}

for (const button of document.querySelectorAll(".view-toggle button")) {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    renderPreview();
  });
}

$("#copy-btn").addEventListener("click", copyPreview);
$("#download-btn").addEventListener("click", download);

const list = $("#file-list");

list.addEventListener("click", (event) => {
  const li = event.target.closest(".file");
  if (!li) return;
  const id = Number(li.dataset.id);
  const action = event.target.closest("[data-action]")?.dataset.action;
  const index = state.items.findIndex((item) => item.id === id);

  if (action === "remove") return removeItem(id);
  if (action === "up") return moveItem(id, index - 1);
  if (action === "down") return moveItem(id, index + 1);

  state.selectedId = id;
  render({ focusId: id });
  const item = findItem(id);
  if (item) requestAnimationFrame(() => scrollMergedTo(item));
});

list.addEventListener("keydown", (event) => {
  const li = event.target.closest(".file");
  if (!li || event.target !== li) return;
  const id = Number(li.dataset.id);
  const index = state.items.findIndex((item) => item.id === id);

  if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    event.preventDefault();
    moveItem(id, index + (event.key === "ArrowUp" ? -1 : 1));
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    const next = state.items[index + (event.key === "ArrowUp" ? -1 : 1)];
    if (next) list.querySelector(`[data-id="${next.id}"]`)?.focus();
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    li.click();
  } else if (event.key === "Delete") {
    event.preventDefault();
    removeItem(id);
  }
});

// Reordenar arrastrando (dentro de la lista)
list.addEventListener("dragstart", (event) => {
  const li = event.target.closest(".file");
  if (!li) return;
  dragId = Number(li.dataset.id);
  li.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(dragId));
});

function clearDropMarks() {
  for (const el of list.querySelectorAll(".drop-before, .drop-after")) {
    el.classList.remove("drop-before", "drop-after");
  }
}

list.addEventListener("dragover", (event) => {
  if (dragId == null) return;
  const li = event.target.closest(".file");
  if (!li) return;
  event.preventDefault();
  const after = event.clientY > li.getBoundingClientRect().top + li.offsetHeight / 2;
  clearDropMarks();
  li.classList.add(after ? "drop-after" : "drop-before");
});

list.addEventListener("drop", (event) => {
  if (dragId == null) return;
  event.preventDefault();
  event.stopPropagation();
  const li = event.target.closest(".file");
  if (li) {
    const targetId = Number(li.dataset.id);
    const after = li.classList.contains("drop-after");
    const withoutDragged = state.items.filter((item) => item.id !== dragId);
    const targetIndex = withoutDragged.findIndex((item) => item.id === targetId) + (after ? 1 : 0);
    moveItem(dragId, targetIndex);
  }
  clearDropMarks();
});

list.addEventListener("dragend", () => {
  dragId = null;
  clearDropMarks();
  list.querySelector(".is-dragging")?.classList.remove("is-dragging");
});

// Soltar archivos en cualquier parte de la ventana
const overlay = $("#drop-overlay");
let dragDepth = 0;
const carriesFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes("Files");

window.addEventListener("dragenter", (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  dragDepth += 1;
  overlay.hidden = false;
});

window.addEventListener("dragover", (event) => {
  if (carriesFiles(event)) event.preventDefault();
});

window.addEventListener("dragleave", (event) => {
  if (!carriesFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) overlay.hidden = true;
});

window.addEventListener("drop", (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault(); // Evita que el navegador abra el PDF y se pierda la lista.
  dragDepth = 0;
  overlay.hidden = true;
  addFiles(event.dataTransfer.files);
});

// Evita perder el trabajo por cerrar la pestaña sin querer.
window.addEventListener("beforeunload", (event) => {
  if (!converted().length) return;
  event.preventDefault();
  event.returnValue = ""; // Requerido por algunos navegadores para mostrar el aviso.
});

render();
