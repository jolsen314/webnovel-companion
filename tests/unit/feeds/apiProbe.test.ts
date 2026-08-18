import { describe, expect, test } from 'vitest';
import { probeForApi } from '../../../src/lib/feeds/apiProbe';

const BASE = 'https://spa.example/series/alpha';

describe('probeForApi', () => {
  test('a shell pointing at a .json data file → descriptor with the resolved absolute apiUrl', () => {
    const html = `<html><body><div id="app" data-title="/data/alpha.json"></div></body></html>`;
    const hit = probeForApi(html, BASE);
    expect(hit).not.toBeNull();
    expect(hit!.apiUrl).toBe('https://spa.example/data/alpha.json');
    expect(hit!.descriptor.urlField).toBeTruthy();
    expect(hit!.descriptor.titleField).toBeTruthy();
  });

  test('a page with no JSON-data signal → null', () => {
    const html = `<html><body><a href="/chapter-1">Ch 1</a></body></html>`;
    expect(probeForApi(html, BASE)).toBeNull();
  });

  test('a data attribute that is not JSON → null (no false positive)', () => {
    const html = `<html><body><div data-title="Alpha Novel"></div></body></html>`;
    expect(probeForApi(html, BASE)).toBeNull();
  });
});
