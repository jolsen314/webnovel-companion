import { describe, expect, test } from 'vitest';
import { extractSeriesTitle, matchesSiteName } from '../../../src/lib/feeds/title';

describe('extractSeriesTitle', () => {
  test('prefers <h1> over og:title and <title>', () => {
    const html = `<html><head>
      <meta property="og:title" content="OG Name | Site">
      <title>Title Name - Site</title>
    </head><body><h1>Real Series Name</h1></body></html>`;
    expect(extractSeriesTitle(html, { siteName: 'site.example' })).toBe('Real Series Name');
  });

  test('falls back to og:title when no <h1>, stripping a host-matched suffix', () => {
    const html = `<head><meta property="og:title" content="Silver Moon Saga | Lunar Press"><title>x</title></head>`;
    expect(extractSeriesTitle(html, { siteName: 'lunarpress.example' })).toBe('Silver Moon Saga');
  });

  test('falls back to <title> when no <h1>/og, stripping a host-matched dash suffix', () => {
    const html = `<head><title>Cradle of Ash — Verdant Scrolls</title></head>`;
    expect(extractSeriesTitle(html, { siteName: 'verdantscrolls.example' })).toBe('Cradle of Ash');
  });

  test('does NOT strip a legit dash when the tail is not the site name', () => {
    const html = `<head><title>Volume 1 – Dawn</title></head>`;
    // 'Dawn' is not the site name, so the dash stays.
    expect(extractSeriesTitle(html, { siteName: 'reader.example' })).toBe('Volume 1 – Dawn');
  });

  test('strips a bare pipe suffix even with no siteName (pipe is a site separator)', () => {
    const html = `<head><title>Star Chef | Some Site</title></head>`;
    expect(extractSeriesTitle(html)).toBe('Star Chef');
  });

  test('leaves a dash suffix intact when no siteName is known', () => {
    const html = `<head><title>Volume 1 – Dawn</title></head>`;
    expect(extractSeriesTitle(html)).toBe('Volume 1 – Dawn');
  });

  test('returns null when there is no usable heading', () => {
    expect(extractSeriesTitle(`<html><body><div>loading…</div></body></html>`)).toBeNull();
  });

  test('collapses whitespace and trims', () => {
    expect(extractSeriesTitle(`<h1>  Spaced   Name  </h1>`)).toBe('Spaced Name');
  });

  test('skips an <h1> that is the site name, falling back to a real og:title', () => {
    const html = `<h1>Lunar Press</h1><head><meta property="og:title" content="Real Series | Lunar Press"></head>`;
    expect(extractSeriesTitle(html, { siteName: 'lunarpress.example' })).toBe('Real Series');
  });

  test('returns null when every signal is the site name', () => {
    const html = `<h1>Lunar Press</h1><title>Lunar Press</title>`;
    expect(extractSeriesTitle(html, { siteName: 'lunarpress.example' })).toBeNull();
  });

  // WP-30b (1): a consent/cookie-banner <h1> must not be taken as the title.
  test('skips a "we value your privacy" consent <h1>, falling through to <title>', () => {
    const html = `<h1>We value your privacy</h1><head><title>Cradle of Ash — Verdant Scrolls</title></head>`;
    expect(extractSeriesTitle(html, { siteName: 'verdantscrolls.example' })).toBe('Cradle of Ash');
  });

  test('skips a CCPA opt-out consent <h1>, falling through to og:title', () => {
    const html = `<h1>Opt out of the sale or sharing of personal information</h1>
      <head><meta property="og:title" content="Silver Moon Saga | Lunar Press"></head>`;
    expect(extractSeriesTitle(html, { siteName: 'lunarpress.example' })).toBe('Silver Moon Saga');
  });

  test('skips a cookie-notice <h1>, falling through to <title>', () => {
    const html = `<h1>This website uses cookies to ensure you get the best experience</h1>
      <head><title>Star Chef | Some Site</title></head>`;
    expect(extractSeriesTitle(html)).toBe('Star Chef');
  });

  // WP-30b (2): HTML entities must be decoded at extraction, not baked into the DB raw.
  test('decodes a numeric entity in <h1> (&#8217; → ’)', () => {
    expect(extractSeriesTitle(`<h1>Rowan&#8217;s Tale</h1>`)).toBe('Rowan’s Tale');
  });

  test('decodes a hex numeric entity in <h1> (&#x2019; → ’)', () => {
    expect(extractSeriesTitle(`<h1>Rowan&#x2019;s Tale</h1>`)).toBe('Rowan’s Tale');
  });

  test('decodes &#038; / &amp; ampersand in <h1>', () => {
    expect(extractSeriesTitle(`<h1>Swords &#038; Sorcery</h1>`)).toBe('Swords & Sorcery');
    expect(extractSeriesTitle(`<h1>Cloak &amp; Dagger</h1>`)).toBe('Cloak & Dagger');
  });

  test('decodes &nbsp; and collapses it to a normal space', () => {
    expect(extractSeriesTitle(`<h1>Ash&nbsp;Reign</h1>`)).toBe('Ash Reign');
  });

  test('decodes entities in a <title> fallback before stripping the site suffix', () => {
    const html = `<head><title>Emperor&#8217;s Return | Lunar Press</title></head>`;
    expect(extractSeriesTitle(html, { siteName: 'lunarpress.example' })).toBe('Emperor’s Return');
  });
});

describe('matchesSiteName', () => {
  test('loose match ignores www. and TLD, case-insensitive', () => {
    expect(matchesSiteName('Lunar Press', 'www.lunarpress.example')).toBe(true);
    expect(matchesSiteName('LUNARPRESS', 'lunarpress.example')).toBe(true);
  });
  test('non-matching text is false', () => {
    expect(matchesSiteName('Silver Moon Saga', 'lunarpress.example')).toBe(false);
  });
});
