import { useState, useEffect } from 'react';

export interface NetworkStatus {
  isOnline: boolean;
  isSlowConnection: boolean;
  connectionType: string;
  lastOnlineTime: Date | null;
  reconnectAttempts: number;
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isOnline: navigator.onLine,
    isSlowConnection: false,
    connectionType: 'unknown',
    lastOnlineTime: navigator.onLine ? new Date() : null,
    reconnectAttempts: 0
  });

  useEffect(() => {
    // Detect connection type and speed (only when online)
    const detectConnectionType = () => {
      if (!navigator.onLine) {
        setStatus(prev => ({
          ...prev,
          connectionType: 'offline',
          isSlowConnection: false
        }));
        return;
      }

      const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      if (connection) {
        const isSlowConnection = connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g' || connection.downlink < 1;
        setStatus(prev => ({
          ...prev,
          connectionType: connection.effectiveType || 'unknown',
          isSlowConnection
        }));
      } else {
        setStatus(prev => ({
          ...prev,
          connectionType: 'unknown',
          isSlowConnection: false
        }));
      }
    };

    // Online/offline event handlers
    const handleOnline = () => {
      console.log('🌐 Network: Back online');
      setStatus(prev => ({
        ...prev,
        isOnline: true,
        lastOnlineTime: new Date(),
        reconnectAttempts: 0
      }));
      detectConnectionType();
    };

    const handleOffline = () => {
      console.log('📡 Network: Gone offline');
      setStatus(prev => ({
        ...prev,
        isOnline: false,
        reconnectAttempts: prev.reconnectAttempts + 1
      }));
    };

    // Connection change handler
    const handleConnectionChange = () => {
      console.log('🔄 Network: Connection changed');
      detectConnectionType();
    };

    // Add event listeners
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    const connection = (navigator as any).connection;
    if (connection) {
      connection.addEventListener('change', handleConnectionChange);
    }

    // Initial detection
    detectConnectionType();

    // Cleanup
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (connection) {
        connection.removeEventListener('change', handleConnectionChange);
      }
    };
  }, []);

  return status;
}

// Network health checker with retry logic
export class NetworkHealthChecker {
  private static instance: NetworkHealthChecker;
  private healthCheckUrl = '/api/health';
  private checkInterval = 30000; // 30 seconds
  private retryDelays = [1000, 3000, 5000, 10000]; // Progressive backoff
  
  static getInstance(): NetworkHealthChecker {
    if (!NetworkHealthChecker.instance) {
      NetworkHealthChecker.instance = new NetworkHealthChecker();
    }
    return NetworkHealthChecker.instance;
  }

  async checkConnectivity(timeout = 5000): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(this.healthCheckUrl, {
        method: 'HEAD',
        cache: 'no-cache',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      console.warn('Network health check failed:', error);
      return false;
    }
  }

  async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
    context = 'operation'
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        if (attempt > 0) {
          console.log(`✅ ${context} succeeded after ${attempt} retries`);
        }
        return result;
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxRetries) {
          console.error(`❌ ${context} failed after ${maxRetries} retries:`, error);
          break;
        }
        
        const delay = this.retryDelays[Math.min(attempt, this.retryDelays.length - 1)];
        console.log(`🔄 ${context} attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError!;
  }
}
