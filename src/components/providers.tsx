'use client';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from 'next-themes';
import { Toaster } from 'sonner';
import { AppearanceProvider } from './appearance';
import { MotionProvider } from './motion';

function ThemeToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      richColors
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position="bottom-right"
    />
  );
}
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 15000, retry: 1 } } }),
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={client}>
        <AppearanceProvider>
          <MotionProvider>
            {children}
            <ThemeToaster />
          </MotionProvider>
        </AppearanceProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
