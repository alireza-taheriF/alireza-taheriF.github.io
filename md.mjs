// Tiny, dependency-free Markdown renderer. Everything is escaped first, so raw HTML in a post can never run.
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function inline(src) {
  const codes = [];
  let s = src.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|\/[^\s)]*|#[^\s)]*)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
  return s;
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const isBlank = (l) => /^\s*$/.test(l);
const isHr = (l) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('-');
const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const startsBlock = (l, next) => /^```/.test(l) || /^#{1,6}\s/.test(l) || /^\s*>/.test(l) || LIST_RE.test(l) || isHr(l) || (l.includes('|') && next !== undefined && isTableSep(next));

export function render(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { const lvl = Math.min(4, Math.max(2, h[1].length)); out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); i++; continue; }

    if (isHr(line)) { out.push('<hr>'); i++; continue; }

    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${render(buf.join('\n'))}</blockquote>`);
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line); i += 2;
      const rows = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) rows.push(cells(lines[i++]));
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    const lm = line.match(LIST_RE);
    if (lm) {
      const ordered = /\d/.test(lm[2]);
      const base = lm[1].length;
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST_RE);
        if (m && m[1].length === base && /\d/.test(m[2]) === ordered) { items.push([m[3]]); i++; continue; }
        if (!isBlank(lines[i]) && items.length && (lines[i].match(/^\s*/)[0].length > base)) { items[items.length - 1].push(lines[i].slice(Math.min(lines[i].match(/^\s*/)[0].length, base + 2))); i++; continue; }
        if (isBlank(lines[i]) && i + 1 < lines.length && (LIST_RE.test(lines[i + 1]) && lines[i + 1].match(LIST_RE)[1].length === base)) { i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => {
        const nested = it.findIndex((x, k) => k > 0 && LIST_RE.test(x));
        const text = (nested === -1 ? it : it.slice(0, nested)).join(' ');
        const sub = nested === -1 ? '' : render(it.slice(nested).join('\n'));
        return `<li>${inline(text)}${sub}</li>`;
      }).join('')}</${tag}>`);
      continue;
    }

    const buf = [];
    while (i < lines.length && !isBlank(lines[i]) && (buf.length === 0 || !startsBlock(lines[i], lines[i + 1]))) buf.push(lines[i++]);
    const html = buf.map((l, k) => {
      const hard = /( {2,}|\\)$/.test(l) && k < buf.length - 1;
      return inline(l.replace(/( {2,}|\\)$/, '').trim()) + (hard ? '<br>' : (k < buf.length - 1 ? ' ' : ''));
    }).join('');
    out.push(`<p>${html}</p>`);
  }
  return out.join('\n');
}
