import React from 'react';
import { Switch, Route } from 'wouter';
import { queryClient } from './lib/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from 'next-themes';
import Dashboard from '@/pages/dashboard';
import NotFound from '@/pages/not-found';
function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

function OfflineBanner() {
  const [offline, setOffline] = React.useState(
    typeof navigator !== 'undefined' && !navigator.onLine
  );
  React.useEffect(() => {
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  if (!offline) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[1000] bg-destructive px-3 py-2 text-center text-sm font-medium text-destructive-foreground"
    >
      You are offline. Some data may be unavailable.
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <TooltipProvider delayDuration={200} skipDelayDuration={0}>
          <OfflineBanner />
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
