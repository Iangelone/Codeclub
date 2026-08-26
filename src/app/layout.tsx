import './globals.css';

export const metadata = { title: 'Codeclub', description: 'AI-focused IDE', icons: { icon: '/logo.png', shortcut: '/logo.png', apple: '/logo.png' } };
const contentSecurityPolicy = [
  "default-src 'self' file:",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: file: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: ws:",
  "worker-src 'self' blob:",
  "frame-src 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><head><meta httpEquiv="Content-Security-Policy" content={contentSecurityPolicy} /></head><body>{children}</body></html>;
}
