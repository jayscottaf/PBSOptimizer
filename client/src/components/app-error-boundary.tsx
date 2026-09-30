import React from 'react';
import { Button } from '@/components/ui/button';

const RELOAD_KEY = 'chunk-reload-at';

/**
 * A stale-chunk failure (a deploy replaced the file the cached page asks
 * for) is fixed by a reload. Guarded so a genuinely broken build or an
 * offline cold start can't put the app into a reload loop.
 */
export function reloadOnceForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|Importing a module script failed|Failed to fetch dynamically|ChunkLoadError|Loading chunk/i.test(
    message
  );
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('App render failed:', error);
    if (isChunkLoadError(error) && navigator.onLine) {
      reloadOnceForStaleChunk();
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm space-y-4 text-center" role="alert">
          <h1 className="text-lg font-semibold text-foreground">
            {offline ? "You're offline" : 'Something went wrong'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {offline
              ? 'This part of the app has not been saved for offline use yet. Reconnect and reload to continue.'
              : isChunkLoadError(error)
                ? 'A newer version of the app was published while this page was open. Reload to get it.'
                : 'The app hit an unexpected error. Reloading usually fixes it.'}
          </p>
          <Button className="min-h-11 w-full" onClick={() => window.location.reload()}>
            Reload app
          </Button>
        </div>
      </div>
    );
  }
}
