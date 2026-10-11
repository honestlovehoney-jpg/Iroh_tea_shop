import type { Metadata } from 'next';
import { Cormorant_Garamond, Inter } from 'next/font/google';
import './globals.css';
import '../ui/styles/tokens.css';

const display = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-display-face',
  display: 'swap',
  preload: true,
});
const body = Inter({
  subsets: ['latin'],
  variable: '--font-body-face',
  display: 'swap',
  preload: true,
});

export const metadata: Metadata = {
  title: 'Bitget Thesis Desk — Reality stock research',
  description:
    'A 3D research workbench for tokenized US stocks on Bitget Reality. Catalog search, candle evidence, coverage, and Qwen-powered analysis. AI researches; humans decide.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
