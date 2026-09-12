import { useEffect, useState, type ReactNode } from 'react';

export function AccessGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
    'loading' | 'allowed' | 'locked' | 'unavailable'
  >('loading');
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const response = await fetch('/api/health', {
          credentials: 'include',
          cache: 'no-store',
        });
        if (cancelled) return;
        if (response.ok) {
          localStorage.setItem('pbs:authorized-device', 'true');
          setState('allowed');
        } else {
          setState(response.status === 401 ? 'locked' : 'unavailable');
        }
      } catch {
        if (!cancelled)
          setState(
            !navigator.onLine &&
              localStorage.getItem('pbs:authorized-device') === 'true'
              ? 'allowed'
              : 'unavailable'
          );
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, []);
  if (state === 'allowed') return children;
  return (
    <main className="mx-auto max-w-md p-8 space-y-4">
      <h1 className="text-xl font-semibold">PBS Optimizer</h1>
      {state === 'loading' ? (
        <p>Checking access…</p>
      ) : state === 'locked' ? (
        <>
          <p>Enter your app PIN to continue.</p>
          <a className="underline" href="/api/access">
            Unlock with PIN
          </a>
        </>
      ) : (
        <>
          <p>
            The app is unavailable. Check your connection or the app access
            configuration.
          </p>
          <button
            className="underline"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </>
      )}
    </main>
  );
}
