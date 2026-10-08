// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderMarkdown, maskProfanity, mentions, isJumbo, plainPreview, domainOf } from './sanitize.js';
import { createRateLimiter } from './ratelimit.js';

const render = (t, o) => renderMarkdown(t, o);
// Lists anything executable in the produced HTML: event handler attributes, script-ish urls, active elements.
function dangerous(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const found = [];
  for (const el of doc.body.querySelectorAll('*')) {
    if (['SCRIPT', 'IMG', 'SVG', 'IFRAME', 'OBJECT', 'EMBED', 'STYLE', 'FORM', 'INPUT'].includes(el.tagName.toUpperCase())) found.push(el.tagName);
    for (const attr of el.attributes) {
      if (/^on/i.test(attr.name)) found.push(attr.name);
      if (/^(href|src|xlink:href|action)$/i.test(attr.name) && !/^(https?:|mailto:)/i.test(attr.value.trim())) found.push(`${attr.name}=${attr.value}`);
    }
  }
  return found;
}

describe('markdown sanitizer', () => {
  it('renders basic formatting', () => {
    const html = render('**bold** _it_ ~~gone~~ `code`');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>it</em>');
    expect(html).toContain('<del>gone</del>');
    expect(html).toContain('<code>code</code>');
  });
  it('shows raw html as text', () => {
    const html = render('<img src=x onerror=alert(1)> <script>alert(1)</script>');
    expect(dangerous(html)).toEqual([]);
    expect(html).toContain('&lt;');
  });
  it('blocks dangerous urls and event handlers', () => {
    const cases = ['[x](javascript:alert(1))', '[x](data:text/html;base64,AAAA)', '[x](vbscript:msgbox)', '<a href="javascript:alert(1)" onclick="alert(1)">x</a>', '[x](  javascript:alert(1))', '<svg onload=alert(1)>', '[x](JaVaScRiPt:alert(1))'];
    for (const c of cases) expect(dangerous(render(c))).toEqual([]);
  });
  it('never embeds remote images', () => {
    const html = render('![pic](https://tracker.example/p.png)');
    expect(html).not.toContain('<img');
  });
  it('turns links into domain-only chips that open safely', () => {
    const html = render('see https://www.example.com/a/very/long/path?token=secret ok');
    expect(html).toContain('class="link-chip"');
    expect(html).toContain('>example.com<');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
  });
  it('wraps mentions and highlights search terms but not inside code', () => {
    const html = render('hi @alex and `@alex` find me', { me: 'alex', highlight: 'find' });
    expect(html).toContain('<span class="mention mention-me">@alex</span>');
    expect(html).toContain('<mark>find</mark>');
    expect(html.match(/mention/g).length).toBe(2); // class="mention mention-me" only once
  });
  it('is safe against attribute injection through mention names', () => {
    expect(dangerous(render('@a"onmouseover="alert(1)'))).toEqual([]);
    expect(dangerous(render('@a<img src=x onerror=alert(1)>'))).toEqual([]);
  });
  it('keeps code blocks', () => {
    const html = render('```js\nconst a = 1 < 2;\n```');
    expect(html).toContain('<pre');
    expect(html).toContain('&lt;');
  });
  it('masks mild profanity only when asked', () => {
    expect(render('well damn', { filter: true })).toContain('****');
    expect(render('well damn')).toContain('damn');
    expect(maskProfanity('Shit happens, classic')).toBe('**** happens, classic');
  });
});

describe('text helpers', () => {
  it('detects mentions case-insensitively', () => {
    expect(mentions('hey @Alex!', 'alex')).toBe(true);
    expect(mentions('mail me@alex.com', 'alex')).toBe(false);
  });
  it('detects jumbo emoji messages', () => {
    expect(isJumbo('🎉')).toBe(true);
    expect(isJumbo('🎉🎉 ')).toBe(true);
    expect(isJumbo('hello 🎉')).toBe(false);
  });
  it('builds short previews', () => {
    expect(plainPreview('**hi** [link](http://x.y) there')).toBe('hi link there');
    expect(plainPreview('a'.repeat(200), 20).length).toBe(20);
  });
  it('extracts domains', () => {
    expect(domainOf('https://www.example.com/x')).toBe('example.com');
    expect(domainOf('nope')).toBe('');
  });
});

describe('rate limiter', () => {
  it('allows a burst, then refills over time', () => {
    let t = 0;
    const rl = createRateLimiter({ capacity: 3, refillPerSec: 1 }, () => t);
    expect([1, 2, 3, 4].map(() => rl.take('p'))).toEqual([true, true, true, false]);
    t = 1500;
    expect(rl.take('p')).toBe(true);
    expect(rl.take('p')).toBe(false);
  });
  it('tracks senders independently', () => {
    const rl = createRateLimiter({ capacity: 1, refillPerSec: 0 }, () => 0);
    expect(rl.take('a')).toBe(true);
    expect(rl.take('a')).toBe(false);
    expect(rl.take('b')).toBe(true);
  });
});
