import { describe, expect, test } from 'vitest';
import { parseFeed, parseChapterNumber } from '../../../src/lib/feeds/parse';

// Anonymized fixtures using reserved .example domains (RFC 2606) and generic works,
// but preserving the real structural quirks the 2026-07-16 spike found on WordPress
// feeds: an opaque `?p=` guid, a chapter link carrying utm params and an
// HTML-entity-encoded `&#038;`, and a per-novel <category>.
const WP_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Translator</title>
    <item>
      <title>Example Novel Volume 2 Chapter 407: The Subtitle (3)</title>
      <link>https://translator.example/en-407/?utm_source=rss&#038;utm_medium=rss</link>
      <guid isPermaLink="false">https://translator.example/?p=13318</guid>
      <category><![CDATA[Example Novel]]></category>
      <pubDate>Thu, 16 Jul 2026 18:04:26 +0000</pubDate>
    </item>
  </channel>
</rss>`;

describe('parseFeed', () => {
  test('maps a WordPress RSS item into a FeedItem, decoding entity-encoded link chars', async () => {
    const feed = await parseFeed(WP_RSS);

    expect(feed.items).toHaveLength(1);
    const item = feed.items[0]!;
    expect(item.guid).toBe('https://translator.example/?p=13318');
    expect(item.url).toBe('https://translator.example/en-407/?utm_source=rss&utm_medium=rss');
    expect(item.title).toContain('Chapter 407');
    expect(item.categories).toContain('Example Novel');
    expect(item.publishedAt).toBeInstanceOf(Date);
    expect(item.number).toBe(407); // best-effort, parsed from the title
  });

  test('handles an Atom feed: id → guid, link href → url', async () => {
    const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Translator</title>
  <entry>
    <title>Chapter 79</title>
    <link href="https://reader.example/series/alpha/chapter-79"/>
    <id>https://reader.example/series/alpha/chapter-79</id>
    <updated>2026-04-12T01:20:11Z</updated>
  </entry>
</feed>`;

    const feed = await parseFeed(ATOM);
    const item = feed.items[0]!;

    expect(item.url).toBe('https://reader.example/series/alpha/chapter-79');
    expect(item.guid).toBe('https://reader.example/series/alpha/chapter-79');
    expect(item.publishedAt).toBeInstanceOf(Date);
  });
});

describe('parseChapterNumber (best-effort)', () => {
  test.each([
    ['Some Novel Chapter 79', 79],
    // Split chapter: the base number, ignoring "(3)" — see WP-21 (completion uses max number, not post count).
    ['A Long Title Part 2 Chapter 407: The Subtitle (3)', 407],
    ['NN Ch90 - The Subtitle', 90],
    ['XX Ch439 - Another Subtitle', 439],
    ['Chapter 12.5', 12.5],
    ['Ep. 12', 12],
  ])('parses %j → %d', (title, expected) => {
    expect(parseChapterNumber(title)).toBe(expected);
  });

  test.each([['Prologue'], ['Epilogue'], ['Extra: Side Story'], ['A Chronicle Begins']])(
    'returns null when there is no chapter number: %j',
    (title) => {
      expect(parseChapterNumber(title)).toBeNull();
    },
  );
});
