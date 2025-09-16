import { QueryClient, QueryFunction } from '@tanstack/react-query';

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: 'include',
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = 'returnNull' | 'throw';
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join('/') as string, {
      credentials: 'include',
    });

    if (unauthorizedBehavior === 'returnNull' && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: 'throw' }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
      gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes (was cacheTime in v4)
      retry: 1, // Allow one retry for network issues
      refetchOnMount: false, // Don't refetch if data exists and is fresh
    },
    mutations: {
      retry: false,
    },
  },
});

// Cache clearing utilities
export const clearAllCache = () => {
  queryClient.clear();
  console.log('🗑️ All cache cleared');
};

export const clearPairingCache = () => {
  queryClient.removeQueries({ queryKey: ['/api/pairings'] });
  queryClient.removeQueries({ queryKey: ['/api/pairings/search'] });
  console.log('🗑️ Pairing cache cleared');
};

export const refreshAllData = async () => {
  await queryClient.invalidateQueries();
  console.log('🔄 All data refreshed');
};
