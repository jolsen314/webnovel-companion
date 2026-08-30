import Link from 'next/link';
import { Settings } from 'lucide-react';
import { SignOutButton } from '../SignOutButton';

/** A bookmark-ribbon glyph — the app's signature motif. */
function RibbonMark() {
  return (
    <svg className="brand__mark" width="18" height="24" viewBox="0 0 18 24" aria-hidden="true" fill="currentColor">
      <path d="M2 0h14a1 1 0 0 1 1 1v22.2a.6.6 0 0 1-.94.5L9 19.2l-7.06 4.5A.6.6 0 0 1 1 23.2V1a1 1 0 0 1 1-1Z" />
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
            <Settings size={18} aria-hidden="true" />
          </Link>
          <SignOutButton />
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
