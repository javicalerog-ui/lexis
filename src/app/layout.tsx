import type { Metadata, Viewport } from 'next';
import { Inter, Outfit } from 'next/font/google';
import { RegisterSW } from '@/components/pwa/RegisterSW';
import { FloatingVoiceCapture } from '@/components/voice/FloatingVoiceCapture';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Lexis · Segundo cerebro',
  description: 'Captura cualquier cosa. Recuérdalo todo.',
  manifest: '/manifest.json',
  applicationName: 'Lexis',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Lexis',
  },
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
    shortcut: '/icons/icon-192.png',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: '#060812',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${inter.variable} ${outfit.variable}`}>
      <body>
        {children}
        <FloatingVoiceCapture />
        <RegisterSW />
      </body>
    </html>
  );
}
