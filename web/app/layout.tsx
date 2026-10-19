import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PlayPilot',
  description: 'Automatically saves the songs you keep replaying on Spotify.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
