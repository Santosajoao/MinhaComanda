import './globals.css';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { ToastProvider } from '@/components/ui';

export const metadata = { title: 'Comandas', description: 'Controle, consumo e conferência de comandas' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR"><body><ToastProvider><AuthProvider>{children}</AuthProvider></ToastProvider></body></html>
  );
}
