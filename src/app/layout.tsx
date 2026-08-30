import type { Metadata, Viewport } from 'next';
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono, Cinzel, EB_Garamond, Chakra_Petch, Space_Grotesk } from 'next/font/google';
import { ServiceWorkerRegister } from './ServiceWorkerRegister';
import { buildThemeScript } from '../lib/theme';
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
const cinzel = Cinzel({ subsets: ['latin'], variable: '--font-cinzel', display: 'swap', weight: ['400', '600', '700'] });
const ebGaramond = EB_Garamond({ subsets: ['latin'], variable: '--font-eb-garamond', display: 'swap', weight: ['400', '500'], style: ['normal', 'italic'] });
const chakra = Chakra_Petch({ subsets: ['latin'], variable: '--font-chakra', display: 'swap', weight: ['400', '600', '700'] });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk', display: 'swap', weight: ['400', '500', '600'] });

export const metadata: Metadata = {
  title: 'Webnovel Companion',
  description: 'Track the webnovels you read across sites and get a push the moment a new chapter drops.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Webnovel Companion',
  appleWebApp: { capable: true, title: 'Companion', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#15131a',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable} ${cinzel.variable} ${ebGaramond.variable} ${chakra.variable} ${spaceGrotesk.variable}`}
    >
      <body>
        {/* Applies the saved theme before first paint (no FOUC). suppressHydrationWarning on <html>
            because this script sets data-theme, which the server does not render. */}
        <script dangerouslySetInnerHTML={{ __html: buildThemeScript() }} />
        {/* WP-28h: turbulence-displacement filter for the scroll theme's rough torn-paper
            panel edge. Applied via CSS `filter: url(#wp28h-rough-edge)` to a background-only
            layer so the parchment edge roughens without distorting the text above it. */}
        <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute' }}>
          <filter id="wp28h-rough-edge" x="-8%" y="-8%" width="116%" height="116%">
            <feTurbulence type="fractalNoise" baseFrequency="0.019" numOctaves="3" seed="9" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="12" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
