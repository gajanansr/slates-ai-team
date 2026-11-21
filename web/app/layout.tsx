import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ServiceWorker } from '@/components/service-worker';
import { ThemeSync } from '@/components/theme';
import { Analytics } from '@/components/analytics';
import { THEME_BOOT, THEME_COLORS } from '@/lib/theme';
import { PRIVACY_BOOT } from '@/lib/privacy-boot';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://www.slates.space'),
  title: { default: 'Slates', template: '%s · Slates' },
  description: 'One board for you and all your AI agents. Your context in one place, with the features of 7 apps.',
  openGraph: {
    type: 'website',
    siteName: 'Slates',
    title: 'Slates: one board for all your AI agents',
    description: 'Your context in one place, with the features of 7 apps. Invite-only.',
    url: '/',
    images: [{ url: '/og.png?v=1', width: 1200, height: 630, alt: 'Slates: one board for all your AI agents' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Slates: one board for all your AI agents',
    description: 'Your context in one place, with the features of 7 apps. Invite-only.',
    images: ['/og.png?v=1'],
  },
  applicationName: 'Slates',
  appleWebApp: { capable: true, title: 'Slates', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icon.svg?v=3', type: 'image/svg+xml' },
      { url: '/icon-32.png?v=3', sizes: '32x32', type: 'image/png' },
      { url: '/icon-16.png?v=3', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png?v=3', sizes: '180x180' }],
  },
  robots: { index: true, follow: true },
  alternates: { canonical: '/' },
  keywords: ['agentic notes', 'agentic docs', 'agentic UI', 'AI agent workspace', 'MCP server', 'shared memory for AI agents', 'AI agent dashboard', 'notes for AI agents'],
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLORS.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.dark },
  ],
  colorScheme: 'light dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT + PRIVACY_BOOT }} />
      </head>
      <body>
        {children}
        <ServiceWorker />
        <ThemeSync />
        <Analytics />
      </body>
    </html>
  );
}
