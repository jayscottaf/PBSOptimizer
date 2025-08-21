import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { queryClient, clearAllCache, clearPairingCache, refreshAllData } from "./lib/queryClient";

// Development utilities - available in browser console
if (import.meta.env.DEV) {
  (window as any).debugCache = {
    clear: clearAllCache,
    clearPairings: clearPairingCache,
    refresh: refreshAllData,
    inspect: () => {
      const cache = queryClient.getQueryCache().getAll();
      console.log('🔍 Cache inspection:', {
        totalQueries: cache.length,
        queries: cache.map(q => ({ 
          key: q.queryKey, 
          state: q.state.status,
          lastUpdated: q.state.dataUpdatedAt ? new Date(q.state.dataUpdatedAt).toLocaleTimeString() : 'never'
        }))
      });
    }
  };
  console.log('🛠️ Cache utilities available: window.debugCache');
}

createRoot(document.getElementById("root")!).render(<App />);

// Register service worker (Stage 1: basic app shell installability)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}