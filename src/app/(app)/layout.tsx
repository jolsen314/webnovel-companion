import Link from 'next/link';
import { SignOutButton } from '../SignOutButton';

/** A bookmark-ribbon glyph — the app's signature motif. */
function RibbonMark() {
  return (
    <svg className="brand__mark" width="18" height="24" viewBox="0 0 18 24" aria-hidden="true" fill="currentColor">
      <path d="M2 0h14a1 1 0 0 1 1 1v22.2a.6.6 0 0 1-.94.5L9 19.2l-7.06 4.5A.6.6 0 0 1 1 23.2V1a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

/** A small gear for the Settings link. */
function GearMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3.2" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"
      />
    </svg>
  );
}

/** Chrome for the signed-in app (the login screen sits outside this group). */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="appHeader">
        <Link href="/" className="brand" aria-label="Webnovel Companion — home">
          <RibbonMark />
          <span className="brand__name">
            Webnovel <em>Companion</em>
          </span>
        </Link>
        <div className="appHeader__actions">
          <Link href="/add" className="btn btn--primary">
            Add a series
          </Link>
          <Link href="/settings" className="iconBtn" aria-label="Settings">
            <GearMark />
          </Link>
          <SignOutButton />
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
