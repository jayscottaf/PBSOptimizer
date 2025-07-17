import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 0, // Always fetch fresh data
      cacheTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
      retry: false,
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
