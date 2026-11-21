import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Slates',
    short_name: 'Slates',
    description: 'One board for you and all your AI agents.',
    start_url: '/home',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone'],
    orientation: 'portrait',
    background_color: '#f1f2ec',
    theme_color: '#f1f2ec',
    categories: ['productivity'],
    icons: [
      { src: '/icon-192.png?v=3', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png?v=3', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-192.png?v=3', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-maskable-512.png?v=3', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Ask Slates', url: '/ask' },
      { name: 'Inbox', url: '/inbox' },
      { name: 'Notes', url: '/notes' },
    ],
    share_target: {
      action: '/share',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
        files: [{ name: 'file', accept: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'] }],
      },
    },
  };
}
