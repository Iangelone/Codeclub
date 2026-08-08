import './globals.css';

export const metadata = { title: 'Codeclub', description: 'AI-focused IDE' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><head><meta httpEquiv="Content-Security-Policy" content="default-src 'self' file:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: file:; font-src 'self' data:; connect-src 'self' https: ws:; worker-src 'self' blob:; frame-src 'self' https:; object-src 'none'; base-uri 'self';" /></head><body>{children}</body></html>;
}

