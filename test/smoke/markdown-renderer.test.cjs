const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./load-source.cjs');
const { renderMarkdown } = load('src/utils/markdown-renderer.ts');

test('renderMarkdown converts basic markdown syntax to HTML', () => {
  const html = renderMarkdown('# Hello World\n\nThis is **bold** and *italic*.');
  assert.ok(html.includes('<h1>Hello World</h1>'));
  assert.ok(html.includes('<strong>bold</strong>'));
  assert.ok(html.includes('<em>italic</em>'));
});

test('renderMarkdown highlights code blocks with copy button and language tag', () => {
  const code = '```js\nconst x = 42;\n```';
  const html = renderMarkdown(code);
  assert.ok(html.includes('class="code-block-container"'));
  assert.ok(html.includes('class="code-lang-tag"'));
  assert.ok(html.includes('js'));
  assert.ok(html.includes('class="code-copy-btn"'));
  assert.ok(html.includes('data-clipboard-text='));
  assert.ok(html.includes('<pre class="hljs">'));
});

test('renderMarkdown escapes raw HTML tags', () => {
  const html = renderMarkdown('<script>alert("xss")</script>');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('renderMarkdown allows safe links and neutralizes unsafe schemes', () => {
  const safe = renderMarkdown('[PalmDesk](https://github.com/Abreto/palmdesk)');
  assert.ok(safe.includes('href="https://github.com/Abreto/palmdesk"'));
  assert.ok(safe.includes('target="_blank"'));
  assert.ok(safe.includes('rel="noopener noreferrer"'));

  const unsafeJs = renderMarkdown('[Malicious](javascript:alert(1))');
  assert.ok(!unsafeJs.includes('href'));

  const unsafeFtp = renderMarkdown('[FTP](ftp://example.com/test)');
  assert.ok(unsafeFtp.includes('href="#"'));
});
