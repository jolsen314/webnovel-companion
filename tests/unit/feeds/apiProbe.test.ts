import { describe, expect, test } from 'vitest';
import { probeForApi } from '../../../src/lib/feeds/apiProbe';

const BASE = 'https://spa.example/series/alpha';

describe('probeForApi', () => {
  test('a shell pointing at a .json data file → one candidate with the resolved absolute apiUrl', () => {
    const html = `<html><body><div id="app" data-title="/data/alpha.json"></div></body></html>`;
    const hits = probeForApi(html, BASE);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.apiUrl).toBe('https://spa.example/data/alpha.json');
    expect(hits[0]!.descriptor.urlField).toBeTruthy();
    expect(hits[0]!.descriptor.titleField).toBeTruthy();
  });

  test('a page with no JSON-data signal → []', () => {
    const html = `<html><body><a href="/chapter-1">Ch 1</a></body></html>`;
    expect(probeForApi(html, BASE)).toEqual([]);
  });

  test('a data attribute that is not JSON → [] (no false positive)', () => {
    const html = `<html><body><div data-title="Alpha Novel"></div></body></html>`;
    expect(probeForApi(html, BASE)).toEqual([]);
  });

  test('a page with TWO .json data-* attributes → both candidates, in document order', () => {
    const html = `<html><body>
      <div id="decoy" data-config="/settings.json"></div>
      <div id="app" data-chapters="/data/alpha-chapters.json"></div>
    </body></html>`;
    const hits = probeForApi(html, BASE);
    expect(hits.map((h) => h.apiUrl)).toEqual([
      'https://spa.example/settings.json',
      'https://spa.example/data/alpha-chapters.json',
    ]);
  });

  test('an unparseable .json pointer is skipped without throwing, and scanning continues', () => {
    const html = `<html><body>
      <div data-x="http://[bad.json"></div>
      <div data-title="/data/alpha.json"></div>
    </body></html>`;
    const hits = probeForApi(html, BASE);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.apiUrl).toBe('https://spa.example/data/alpha.json');
  });
});
