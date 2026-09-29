// Resaltado y renderizado de Markdown sin dependencias externas (la app funciona sin internet).
// Seguridad: todo el texto se escapa ANTES de aplicar cualquier formato, y el HTML crudo del
// documento nunca se interpreta. Los enlaces solo se aceptan con esquemas http, https o mailto.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING_RE = /^ {0,3}(#{1,6})(\s+|$)(.*)$/;
const RULE_RE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const COMMENT_RE = /^\s*<!--.*-->\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

// ---------- Resaltado del código fuente ----------

function highlightInline(escaped) {
  return escaped
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '<span class="md-mark">$1</span><span class="md-strong">$2</span><span class="md-mark">$1</span>')
    .replace(/(^|[^*_])([*_])(?=\S)([^*_]+?)(?<=\S)\2(?![*_])/g, '$1<span class="md-mark">$2</span><span class="md-em">$3</span><span class="md-mark">$2</span>')
    .replace(/(`+)([^`]+?)\1/g, '<span class="md-code">$1$2$1</span>');
}

export function highlightMarkdown(markdown) {
  let inFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      const escaped = escapeHtml(line);
      if (FENCE_RE.test(line)) {
        inFence = !inFence;
        return `<span class="md-code">${escaped}</span>`;
      }
      if (inFence) return `<span class="md-code">${escaped}</span>`;
      if (COMMENT_RE.test(line)) return `<span class="md-comment">${escaped}</span>`;
      if (RULE_RE.test(line)) return `<span class="md-rule">${escaped}</span>`;

      const heading = line.match(HEADING_RE);
      if (heading) {
        const level = heading[1].length;
        const cls = level === 1 ? "md-h md-h1" : "md-h";
        return `<span class="${cls}"><span class="md-mark">${heading[1]}</span>${escapeHtml(heading[2])}${highlightInline(escapeHtml(heading[3]))}</span>`;
      }
      const item = line.match(LIST_RE);
      if (item) {
        return `${escapeHtml(item[1])}<span class="md-mark">${escapeHtml(item[2])}</span> ${highlightInline(escapeHtml(item[3]))}`;
      }
      return highlightInline(escaped);
    })
    .join("\n");
}

// ---------- Renderizado para lectura ----------

function safeUrl(url) {
  return /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : null;
}

function renderInline(text) {
  // Se protegen los fragmentos de código para que no reciban otros formatos.
  const codes = [];
  let out = escapeHtml(text).replace(/(`+)([^`]+?)\1/g, (_, __, code) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });

  out = out
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // Imágenes: solo el texto alternativo
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
      // `url` ya viene escapada; se desescapa &amp; solo para validar el esquema.
      const safe = safeUrl(url.replace(/&amp;/g, "&"));
      return safe ? `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    })
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "<strong>$2</strong>")
    .replace(/(^|[^*_\w])([*_])(?=\S)([^*_]+?)(?<=\S)\2(?![*_\w])/g, "$1<em>$3</em>")
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "<del>$1</del>")
    .replace(/<br\s*\/?>/gi, "<br>");

  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function renderTable(lines) {
  const [head, , ...body] = lines;
  const th = splitRow(head).map((c) => `<th>${renderInline(c)}</th>`).join("");
  const rows = body
    .map((row) => `<tr>${splitRow(row).map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderList(items) {
  // items: [{ indent, ordered, text }] — anidación por sangría.
  let html = "";
  const stack = [];
  for (const item of items) {
    while (stack.length && item.indent < stack.at(-1).indent) {
      html += `</li></${stack.pop().tag}>`;
    }
    const top = stack.at(-1);
    if (!top || item.indent > top.indent) {
      const tag = item.ordered ? "ol" : "ul";
      stack.push({ indent: item.indent, tag });
      html += `<${tag}><li>`;
    } else {
      html += "</li><li>";
    }
    html += renderInline(item.text);
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return html;
}

export function renderMarkdown(markdown) {
  const lines = markdown.split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim() || COMMENT_RE.test(line)) {
      i += 1;
      continue;
    }

    const fence = line.match(FENCE_RE);
    if (fence) {
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[3].replace(/\s#+\s*$/, ""))}</h${level}>`);
      i += 1;
      continue;
    }

    if (RULE_RE.test(line)) {
      out.push("<hr>");
      i += 1;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const table = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        table.push(lines[i]);
        i += 1;
      }
      out.push(renderTable(table));
      continue;
    }

    if (LIST_RE.test(line)) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST_RE);
        if (m) {
          items.push({ indent: m[1].replace(/\t/g, "    ").length, ordered: /\d/.test(m[2]), text: m[3] });
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          items.at(-1).text += ` ${lines[i].trim()}`; // continuación del ítem
        } else if (!lines[i].trim() && LIST_RE.test(lines[i + 1] ?? "")) {
          // línea en blanco entre ítems de la misma lista
        } else {
          break;
        }
        i += 1;
      }
      out.push(renderList(items));
      continue;
    }

    const paragraph = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !HEADING_RE.test(lines[i]) &&
      !FENCE_RE.test(lines[i]) &&
      !RULE_RE.test(lines[i]) &&
      !LIST_RE.test(lines[i]) &&
      !COMMENT_RE.test(lines[i])
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    out.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return out.join("\n");
}
