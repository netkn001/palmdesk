import 'highlight.js/styles/atom-one-dark.css';
import hljs from 'highlight.js';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false,
  xhtmlOut: false,
  breaks: true,
  langPrefix: 'language-',
  linkify: true,
  typographer: false,
  highlight(str: string, lang: string): string {
    const validLang = lang && hljs.getLanguage(lang) ? lang : '';
    let highlighted = '';
    try {
      if (validLang) {
        highlighted = hljs.highlight(str, {
          language: validLang,
          ignoreIllegals: true,
        }).value;
      } else {
        highlighted = hljs.highlightAuto(str).value;
      }
    } catch {
      highlighted = md.utils.escapeHtml(str);
    }

    const displayLang = validLang || 'code';
    const escapedRaw = encodeURIComponent(str);

    return (
      `<div class="code-block-container">` +
      `<div class="code-block-header">` +
      `<span class="code-lang-tag">${displayLang}</span>` +
      `<button type="button" class="code-copy-btn" data-clipboard-text="${escapedRaw}" aria-label="复制代码">复制</button>` +
      `</div>` +
      `<pre class="hljs"><code class="language-${displayLang}">${highlighted}</code></pre>` +
      `</div>`
    );
  },
});

// Safe link rule: restrict href to http, https, and mailto
const defaultRender =
  md.renderer.rules.link_open ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options);
  };

md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  const token = tokens[idx];
  const hrefIndex = token.attrIndex('href');
  if (hrefIndex >= 0) {
    const href = token.attrs ? String(token.attrs[hrefIndex][1]) : '';
    try {
      const url = new URL(href);
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) {
        token.attrs![hrefIndex][1] = '#';
      }
    } catch {
      token.attrs![hrefIndex][1] = '#';
    }
  }
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer');
  return defaultRender(tokens, idx, options, env, self);
};

export function renderMarkdown(content: string): string {
  if (!content) return '';
  return md.render(String(content));
}
