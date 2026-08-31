import Link from 'next/link';
import { ThemeScene } from './ThemeScene';

/** Shown by both the feed and the shelf when the user has zero series. */
export function EmptyHero() {
  return (
    <>
      {/* Root-level sibling of .hero (not a child): the fixed backdrop resolves its
          z-index in the root stacking context, spanning the viewport behind the
          centered hero column instead of being trapped in its max-width box. */}
      <ThemeScene variant="hero" />
      <section className="hero">
        <p className="hero__eyebrow">Your shelf</p>
        <h1 className="hero__title">
          It&rsquo;s quiet in here.
          <br />
          Let&rsquo;s fix that.
        </h1>
        <p className="hero__lede">
          Add a series and I&rsquo;ll watch its release feed. When a new chapter drops, your phone lights up&nbsp;— no
          more checking a dozen sites to see if today&rsquo;s the day.
        </p>
        <div className="hero__actions">
          <Link href="/add" className="btn btn--primary">
            Add your first series
          </Link>
        </div>
      </section>
    </>
  );
}
