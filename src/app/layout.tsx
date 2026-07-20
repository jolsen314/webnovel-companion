import type { Metadata, Viewport } from 'next';
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import Link from 'next/link';
import { ServiceWorkerRegister } from './ServiceWorkerRegister';
import './globals.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
});
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  variable: '--font-plex-sans',
  display: 'swap',
  weight: ['300', '400', '500', '600'],
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-plex-mono',
  display: 'swap',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: 'Webnovel Companion',
  description:
    'Track the webnovels you read across sites and get a push the moment a new chapter drops.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Webnovel Companion',
  appleWebApp: { capable: true, title: 'Companion', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#15131a',
  colorScheme: 'dark',
};

/** A bookmark-ribbon glyph — the app's signature motif. */
function RibbonMark() {
  return (
    <svg className="brand__mark" width="18" height="24" viewBox="0 0 18 24" aria-hidden="true" fill="currentColor">
      <path d="M2 0h14a1 1 0 0 1 1 1v22.2a.6.6 0 0 1-.94.5L9 19.2l-7.06 4.5A.6.6 0 0 1 1 23.2V1a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <header className="appHeader">
          <Link href="/" className="brand" aria-label="Webnovel Companion — home">
            <RibbonMark />
            <span className="brand__name">
              Webnovel <em>Companion</em>
            </span>
          </Link>
          <Link href="/add" className="btn btn--primary">
            Add a series
          </Link>
        </header>
        <main>{children}</main>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
