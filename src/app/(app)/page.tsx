import Link from 'next/link';

export default function HomePage() {
  return (
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
        <Link href="/completed" className="btn">
          Browse the completed shelf
        </Link>
      </div>
      <p className="hero__note">
        On iPhone, notifications need the app installed first: tap Share, then <code>Add to Home Screen</code>.
      </p>
    </section>
  );
}
