import type { ReactNode } from 'react';

export const metadata = {
  title: 'react-apex-grid + Next.js',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
