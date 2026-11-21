import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: { bodySizeLimit: '12mb' },
    // Keep pages you've opened in memory for 5 minutes: going back to a tab is instant.
    // Your own edits refresh them right away (server actions revalidate), and the app
    // refreshes the current page in the background when you come back to it.
    staleTimes: { dynamic: 300, static: 600 },
  },
  // Short addresses people (and agents) guess (BUG-18).
  async redirects() {
    return [
      { source: '/index.html', destination: '/', permanent: true }, // legacy static-site path
      { source: '/automations', destination: '/settings/automations', permanent: false },
      { source: '/templates', destination: '/boards/new', permanent: false },
      { source: '/history', destination: '/activity', permanent: false },
      { source: '/settings/admin', destination: '/admin', permanent: false }, // admin is its own app
    ];
  },
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      {
        source: '/admin',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'private, no-store' },
        ],
      },
      {
        source: '/p/:token*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
