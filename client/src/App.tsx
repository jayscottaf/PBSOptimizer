import React from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  // Listen for online/offline events (simple banner only)
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      const el = document.getElementById('offline-banner');
      if (el) el.style.display = 'none';
    });
    window.addEventListener('offline', () => {
      const el = document.getElementById('offline-banner');
      if (el) el.style.display = 'block';
    });
  }
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div id="offline-banner" style={{
          display: isOffline ? 'block' : 'none',
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
          background: '#b91c1c', color: 'white', padding: '8px', textAlign: 'center'
        }}>
          You are offline. Some data may be unavailable.
        </div>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
