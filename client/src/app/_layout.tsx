import '@/theme/tokens.css';
import '@/theme/bundle.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { SessionProvider } from '@/lib/session';

// The service worker (built by Workbox, see workbox-config.cjs) keeps the app usable offline; not in development.
// After a deploy the page first opens from the old cache while the new worker installs and takes over (skipWaiting,
// clientsClaim); reload once then, so the new version shows without refreshing by hand. Not on the first install.
if (!__DEV__ && 'serviceWorker' in navigator) {
  const updating = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (updating) location.reload(); });
  navigator.serviceWorker.register('/sw.js');
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <Slot />
      </SessionProvider>
    </QueryClientProvider>
  );
}
