import {
  NunitoSans_400Regular, NunitoSans_500Medium, NunitoSans_600SemiBold, NunitoSans_700Bold, NunitoSans_800ExtraBold, useFonts,
} from '@expo-google-fonts/nunito-sans';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { Loading } from '@/components';
import { SessionProvider } from '@/lib/session';
import { color } from '@/theme';

// Keyboard focus ring for every control (design system focus-ring: white, then dolphin-deep), shown only for
// keyboard focus; an outline keeps each control's own thick-base shadow.
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `:focus-visible { outline: 3px solid ${color.dolphinDeep}; outline-offset: 3px; }
    :focus:not(:focus-visible) { outline: none; }`;
  document.head.append(style);
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    NunitoSans_400Regular, NunitoSans_500Medium, NunitoSans_600SemiBold, NunitoSans_700Bold, NunitoSans_800ExtraBold,
  });
  if (!fontsLoaded) return <Loading />;
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <Slot />
      </SessionProvider>
    </QueryClientProvider>
  );
}
