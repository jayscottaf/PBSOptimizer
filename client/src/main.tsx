import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { queryClient, clearAllCache, clearPairingCache, refreshAllData } from "./lib/queryClient";
import { migrateOldCacheFormat, getCacheInfo } from "./lib/offlineCache";
import { addTestingUtilities } from "./lib/offlineTestSuite";

// Development utilities - available in browser console
if (import.meta.env.DEV) {
  (window as any).debugCache = {
    clear: clearAllCache,
    clearPairings: clearPairingCache,
    refresh: refreshAllData,
    info: getCacheInfo,
    migrate: migrateOldCacheFormat,
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
  
  // Add offline testing utilities
  addTestingUtilities();
}

// Initialize app with migration checks
(async () => {
  // Render the app first to prevent startup delays
  createRoot(document.getElementById("root")!).render(<App />);
  
  // Run cache migration check in background
  try {
    setTimeout(async () => {
      await migrateOldCacheFormat();
    }, 1000); // Delay to allow app to load first
  } catch (error) {
    console.warn('Cache migration check failed:', error);
  }
})();

// Enhanced Service Worker registration with update handling (Stage 6)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        // console.log('SW registered: ', registration); // Reduced logging
        
        // Check for updates every 10 minutes
        setInterval(() => {
          registration.update();
        }, 10 * 60 * 1000);
        
        // Handle waiting service worker (update available)
        if (registration.waiting) {
          showUpdateAvailable(registration);
        }
        
        // Listen for new service worker installation
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateAvailable(registration);
              }
            });
          }
        });
      })
      .catch(registrationError => {
        console.log('SW registration failed: ', registrationError);
      });
  });

  // Listen for messages from service worker
  navigator.serviceWorker.addEventListener('message', (event) => {
    const { type, version, timestamp } = event.data || {};
    
    switch (type) {
      case 'SW_UPDATED':
        console.log(`Service Worker updated to version ${version}`);
        showUpdateNotification(version);
        break;
    }
  });

  // Function to aggressively remove offline banners
  const removeOfflineBanners = () => {
    // Remove common offline banner selectors
    const selectors = [
      '.chrome-offline-banner',
      '.browser-offline-bar', 
      '.offline-notification',
      'div[style*="You are offline"]',
      'div[style*="background"][style*="red"]',
      'div[style*="position: fixed"][style*="top: 0"]'
    ];
    
    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        (el as HTMLElement).remove();
      });
    });
    
    // Remove any element containing "You are offline" text
    const allElements = document.querySelectorAll('*');
    allElements.forEach(el => {
      if (el.textContent?.includes('You are offline') && 
          el !== document.body && 
          el !== document.documentElement) {
        const styles = getComputedStyle(el);
        if (styles.position === 'fixed' || styles.position === 'absolute') {
          (el as HTMLElement).remove();
        }
      }
    });
  };

  // Hide browser's default offline UI
  window.addEventListener('online', () => {
    document.body.classList.remove('offline');
    removeOfflineBanners();
  });
  
  window.addEventListener('offline', () => {
    document.body.classList.add('offline');
    // Aggressively remove offline banners
    removeOfflineBanners();
    // Continue checking for new banners
    const interval = setInterval(removeOfflineBanners, 500);
    setTimeout(() => clearInterval(interval), 5000);
  });

  // Initial banner removal
  setTimeout(removeOfflineBanners, 100);
}

// Show update available notification
function showUpdateAvailable(registration: ServiceWorkerRegistration) {
  // Create a simple toast notification
  const toast = document.createElement('div');
  toast.innerHTML = `
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      background: #0F172A;
      color: white;
      padding: 16px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 10000;
      max-width: 300px;
      font-family: system-ui, -apple-system, sans-serif;
    ">
      <div style="font-weight: 600; margin-bottom: 8px;">Update Available</div>
      <div style="font-size: 14px; margin-bottom: 12px; opacity: 0.9;">
        A new version of PBS Optimizer is ready to install.
      </div>
      <div style="display: flex; gap: 8px;">
        <button id="update-now" style="
          background: #3B82F6;
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 13px;
          cursor: pointer;
        ">Update Now</button>
        <button id="update-later" style="
          background: transparent;
          color: #9CA3AF;
          border: 1px solid #374151;
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 13px;
          cursor: pointer;
        ">Later</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(toast);
  
  // Handle update now
  toast.querySelector('#update-now')?.addEventListener('click', () => {
    if (registration.waiting) {
      // Send skip waiting message
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      
      // Listen for the controlling change
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });
    }
    toast.remove();
  });
  
  // Handle update later
  toast.querySelector('#update-later')?.addEventListener('click', () => {
    toast.remove();
  });
  
  // Auto-remove after 30 seconds
  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 30000);
}

// Show simple update notification
function showUpdateNotification(version: string) {
  console.log(`App updated to version ${version}`);
  // Could add a subtle notification here if needed
}