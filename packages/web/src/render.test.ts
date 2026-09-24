import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  computeStatusCounts,
  renderNav,
  renderSetupHtml,
  renderSetupSuccessHtml,
  renderSetupErrorHtml,
  render404Html,
} from './render.js';

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#x27;s');
  });
});

describe('computeStatusCounts', () => {
  it('counts each status correctly', () => {
    const counts = computeStatusCounts([
      'done',
      'done',
      'to_revisit',
      'did_not_understand',
      'none',
      'none',
      'none',
    ]);
    expect(counts).toEqual({
      done: 2,
      to_revisit: 1,
      did_not_understand: 1,
      none: 3,
    });
  });

  it('returns all-zero for empty input', () => {
    expect(computeStatusCounts([])).toEqual({
      done: 0,
      to_revisit: 0,
      did_not_understand: 0,
      none: 0,
    });
  });
});

describe('renderNav (M6: wordmark only, links to the SPA root)', () => {
  it('carries the InterviewBudAI wordmark linking to /', () => {
    const nav = renderNav();
    expect(nav).toContain('nav-wordmark');
    expect(nav).toContain('InterviewBudAI');
    expect(nav).toContain('href="/"');
  });

  it('no longer carries retired product links', () => {
    const nav = renderNav();
    expect(nav).not.toContain('/coach');
    expect(nav).not.toContain('/catalog');
    expect(nav).not.toContain('/analytics');
  });
});

describe('renderSetupHtml', () => {
  it('renders the create-database form posting to /setup', () => {
    const html = renderSetupHtml('/home/me/.ibai');
    expect(html).toContain('<form method="POST" action="/setup">');
    expect(html).toContain('name="dataDir"');
    expect(html).toContain('/home/me/.ibai');
    expect(html).toContain('Create Database');
  });

  it('escapes the default path (XSS-safe)', () => {
    const html = renderSetupHtml('<script>x</script>');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
  });
});

describe('renderSetupSuccessHtml', () => {
  it('shows the created path and links back to the SPA root', () => {
    const html = renderSetupSuccessHtml('/home/me/.ibai');
    expect(html).toContain('/home/me/.ibai');
    expect(html).toContain('href="/"');
    // M6: no longer links to the retired /analytics page.
    expect(html).not.toContain('href="/analytics"');
  });
});

describe('renderSetupErrorHtml', () => {
  it('shows the error message and a retry link', () => {
    const html = renderSetupErrorHtml('EACCES: permission denied');
    expect(html).toContain('EACCES: permission denied');
    expect(html).toContain('href="/setup"');
  });
});

describe('render404Html', () => {
  it('renders a 404 with a link back to the SPA root', () => {
    const html = render404Html();
    expect(html).toContain('404');
    expect(html).toContain('href="/"');
    // M6: no longer points at the retired /catalog page.
    expect(html).not.toContain('href="/catalog"');
  });

  it('escapes a custom message', () => {
    const html = render404Html('<b>nope</b>');
    expect(html).not.toContain('<b>nope</b>');
    expect(html).toContain('&lt;b&gt;nope&lt;/b&gt;');
  });
});
