import { Marked } from 'marked';
import DOMPurify from 'dompurify';

// Safe rich text: markdown -> sanitized DOM -> mentions, search highlights and link chips.
// Nothing here loads remote resources: images are never rendered and links show only their domain.

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const md = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    // Raw HTML typed by a user is shown as text, never interpreted.
    html: ({ text }) => escapeHtml(text),
    // Remote images are never embedded (privacy); show the alt text as a plain link instead.
    image: ({ href, text }) => (href ? `<a href="${escapeHtml(href)}">${escapeHtml(text || href)}</a>` : escapeHtml(text || '')),
  },
});

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'hr', 'span', 'mark'];
const ALLOWED_ATTR = ['href', 'class', 'title'];
const SAFE_URL = /^(?:https?:|mailto:)/i;

export const isSafeUrl = (url) => SAFE_URL.test(String(url).trim());

export function domainOf(href) {
  try {
    return new URL(href).hostname.replace(/^www\./, '') || '';
  } catch {
    return '';
  }
}

// Mild word filter for the optional "family friendly" mode. Whole words only, case-insensitive.
const FILTER_WORDS = ['fuck', 'fucking', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'piss', 'cunt', 'whore', 'slut', 'damn'];
const FILTER_RE = new RegExp(`\\b(${FILTER_WORDS.join('|')})\\b`, 'gi');
export const maskProfanity = (text) => String(text).replace(FILTER_RE, (w) => '*'.repeat(w.length));

const MENTION_RE = /(^|[^\w@])@([A-Za-z0-9_.-]{2,24})/g;
export const mentionedNames = (text) => [...String(text).matchAll(MENTION_RE)].map((m) => m[2].replace(/[.-]+$/, '').toLowerCase());
export const mentions = (text, name) => Boolean(name) && mentionedNames(text).includes(String(name).toLowerCase());

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s*){1,3}$/u;
export const isJumbo = (text) => EMOJI_ONLY.test(String(text).trim());

let hooked = false;
function installHooks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      if (!isSafeUrl(href)) { node.removeAttribute('href'); return; }
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
    if (node.hasAttribute('class') && !(node.tagName === 'CODE' && /^language-[\w+#-]{1,20}$/.test(node.getAttribute('class')))) {
      node.removeAttribute('class');
    }
  });
}

function decorateText(root, { me, highlight, filter }) {
  const doc = root.ownerDocument;
  const needle = highlight ? highlight.toLowerCase() : '';
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  const nodes = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (!n.parentElement?.closest('pre, code, a')) nodes.push(n);
  }
  for (const node of nodes) {
    let text = node.nodeValue;
    if (filter) text = maskProfanity(text);
    const parts = []; // { text, kind, name }
    let last = 0;
    for (const m of text.matchAll(MENTION_RE)) {
      const start = m.index + m[1].length;
      if (start > last) parts.push({ text: text.slice(last, start) });
      const name = m[2].replace(/[.-]+$/, '');
      parts.push({ text: `@${name}`, kind: 'mention', name });
      last = start + 1 + name.length;
    }
    if (last < text.length) parts.push({ text: text.slice(last) });
    const out = [];
    for (const p of parts) {
      if (p.kind || !needle) { out.push(p); continue; }
      const lower = p.text.toLowerCase();
      let i = 0;
      for (;;) {
        const at = lower.indexOf(needle, i);
        if (at === -1) break;
        if (at > i) out.push({ text: p.text.slice(i, at) });
        out.push({ text: p.text.slice(at, at + needle.length), kind: 'mark' });
        i = at + needle.length;
      }
      if (i < p.text.length) out.push({ text: p.text.slice(i) });
    }
    if (out.length === 1 && !out[0].kind && out[0].text === node.nodeValue) continue;
    const frag = doc.createDocumentFragment();
    for (const p of out) {
      if (p.kind === 'mention') {
        const s = doc.createElement('span');
        s.className = me && p.name.toLowerCase() === me.toLowerCase() ? 'mention mention-me' : 'mention';
        s.textContent = p.text;
        frag.appendChild(s);
      } else if (p.kind === 'mark') {
        const s = doc.createElement('mark');
        s.textContent = p.text;
        frag.appendChild(s);
      } else {
        frag.appendChild(doc.createTextNode(p.text));
      }
    }
    node.replaceWith(frag);
  }
}

function chipLinks(root) {
  for (const a of root.querySelectorAll('a')) {
    const href = a.getAttribute('href');
    if (!href) { a.replaceWith(...a.childNodes); continue; }
    const host = href.startsWith('mailto:') ? href.slice(7).split('@').pop() : domainOf(href);
    const label = a.textContent.trim();
    a.className = 'link-chip';
    a.setAttribute('title', href);
    const looksLikeUrl = /^(https?:\/\/|www\.)/i.test(label);
    a.textContent = looksLikeUrl || !label ? host || href : `${label} (${host})`;
  }
}

function addCodeLabels(root) {
  for (const pre of root.querySelectorAll('pre')) {
    pre.setAttribute('data-code', 'true');
    const lang = (pre.querySelector('code')?.className || '').replace('language-', '');
    if (lang) pre.setAttribute('data-lang', lang);
    const btn = pre.ownerDocument.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-code';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy code');
    pre.appendChild(btn);
  }
}

// opts: { me, highlight, filter }
export function renderMarkdown(text, opts = {}) {
  installHooks();
  const src = String(text ?? '');
  let raw;
  try {
    raw = md.parse(src);
  } catch {
    raw = `<p>${escapeHtml(src)}</p>`;
  }
  const frag = DOMPurify.sanitize(raw, { ALLOWED_TAGS, ALLOWED_ATTR, RETURN_DOM_FRAGMENT: true, ALLOWED_URI_REGEXP: SAFE_URL });
  const holder = frag.ownerDocument.createElement('div');
  holder.appendChild(frag);
  decorateText(holder, opts);
  chipLinks(holder);
  addCodeLabels(holder);
  return holder.innerHTML;
}

// Plain-text preview for notifications, sidebars and reply quotes (markdown markers removed).
export function plainPreview(text, max = 90) {
  const t = String(text ?? '').replace(/```[\s\S]*?```/g, ' [code] ').replace(/[*_~`>#]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
