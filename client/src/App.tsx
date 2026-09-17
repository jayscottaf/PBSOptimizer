import React from 'react';
import { AccessGate } from '@/components/access-gate';
import { Switch, Route } from 'wouter';
import { queryClient } from './lib/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from 'next-themes';
import NotFound from '@/pages/not-found';

const Dashboard = React.lazy(() => import('@/pages/dashboard'));

function DashboardLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm space-y-4 text-center" role="status">
        <div className="mx-auto h-10 w-10 animate-pulse rounded-xl bg-primary/15" />
        <div className="space-y-2">
          <div className="mx-auto h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="mx-auto h-3 w-56 animate-pulse rounded bg-muted/70" />
        </div>
        <span className="sr-only">Loading your bid workspace</span>
      </div>
    </div>
  );
}

function Router() {
  return (
    <React.Suspense fallback={<DashboardLoading />}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route component={NotFound} />
      </Switch>
    </React.Suspense>
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
          <AccessGate>
            <Router />
          </AccessGate>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
