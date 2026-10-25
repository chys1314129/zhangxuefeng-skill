import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import BottomNav from '@/components/Layout/BottomNav';
import DesktopHeader from '@/components/Layout/DesktopHeader';
import { AuthProvider } from '@/hooks/useAuth';
import './globals.css';

export const metadata: Metadata = {
  title: '只找厕所 — 急的时候，打开就能找到',
  description:
    '专注于公共厕所定位、一键步行导航、拍照众包共享与实时互助留言板的轻量级地图应用',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#2563eb',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="antialiased selection:bg-blue-100 selection:text-blue-900 flex flex-col min-h-dvh">
        <AuthProvider>
          <DesktopHeader />
          <main className="flex-1">{children}</main>
          <BottomNav />
          <Toaster position="top-center" richColors closeButton />
        </AuthProvider>
      </body>
    </html>
  );
}
