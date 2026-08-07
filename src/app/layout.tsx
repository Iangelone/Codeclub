import './globals.css';

export const metadata = { title: 'Codeclub', description: 'AI-focused IDE' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}


