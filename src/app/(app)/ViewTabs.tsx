import Link from 'next/link';

/** Segmented control shared by the feed (/) and shelf (/shelf) pages. Rendered inside each
 *  page (not the app layout) so it never appears on /add, /settings, or /series/:id. */
export function ViewTabs({ active }: { active: 'feed' | 'shelf' }) {
  return (
    <nav className="viewtabs" aria-label="Views">
      <Link href="/" className={`viewtabs__tab${active === 'feed' ? ' is-active' : ''}`} aria-current={active === 'feed' ? 'page' : undefined}>
        What&rsquo;s new
      </Link>
      <Link href="/shelf" className={`viewtabs__tab${active === 'shelf' ? ' is-active' : ''}`} aria-current={active === 'shelf' ? 'page' : undefined}>
        Shelf
      </Link>
    </nav>
  );
}
