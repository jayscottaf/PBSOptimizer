import { useState, useEffect } from 'react';
import {
  useNetworkStatus,
  NetworkHealthChecker,
} from '@/hooks/useNetworkStatus';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  WifiOff,
  Wifi,
  WifiLow,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';

interface NetworkStatusProps {
  className?: string;
  showDetails?: boolean;
}

export function NetworkStatus({
  className = '',
  showDetails = false,
}: NetworkStatusProps) {
  const networkStatus = useNetworkStatus();
  const [isRetrying, setIsRetrying] = useState(false);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<Date | null>(
    null
  );
  const [showFullStatus, setShowFullStatus] = useState(showDetails);

  // Auto-hide details for cleaner UI
  useEffect(() => {
    if (!showDetails) {
      if (!networkStatus.isOnline) {
        // Show offline details briefly, then hide
        setShowFullStatus(true);
        const timer = setTimeout(() => setShowFullStatus(false), 4000);
        return () => clearTimeout(timer);
      } else {
        // Hide details when online
        setShowFullStatus(false);
      }
    }
  }, [networkStatus.isOnline, showDetails]);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      const healthChecker = NetworkHealthChecker.getInstance();
      const isHealthy = await healthChecker.checkConnectivity();
      if (isHealthy) {
        setLastSuccessfulSync(new Date());
        // Force a page refresh to sync data
        window.location.reload();
      }
    } catch (error) {
      console.error('Manual retry failed:', error);
    } finally {
      setIsRetrying(false);
    }
  };

  const getWifiIcon = () => {
    if (!networkStatus.isOnline) {
      return <WifiOff className="h-5 w-5 text-red-500" />;
    }
    if (networkStatus.isSlowConnection) {
      return <WifiLow className="h-5 w-5 text-yellow-500" />;
    }
    return <Wifi className="h-5 w-5 text-green-500" />;
  };

  const getTooltipText = () => {
    if (!networkStatus.isOnline) {
      return 'Offline - Using cached data';
    }
    if (networkStatus.isSlowConnection) {
      return 'Slow connection detected';
    }
    return 'Online';
  };

  return (
    <div className={`${className}`}>
      {/* Always visible WiFi icon - inline style */}
      <div
        className="flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors cursor-pointer relative"
        onClick={() => {
          if (!networkStatus.isOnline) {
            setShowFullStatus(!showFullStatus);
          }
        }}
        title={getTooltipText()}
      >
        {getWifiIcon()}
        {isRetrying && (
          <RefreshCw className="h-3 w-3 text-blue-500 animate-spin absolute -top-1 -right-1" />
        )}
      </div>

      {/* Expandable details panel - only when offline and expanded */}
      {!networkStatus.isOnline && showFullStatus && (
        <div className="absolute top-10 right-0 w-72 bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-gray-700">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">Working Offline</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRetry}
              disabled={isRetrying}
              className="h-7 px-2 text-xs"
            >
              <RefreshCw
                className={`h-3 w-3 mr-1 ${isRetrying ? 'animate-spin' : ''}`}
              />
              Retry
            </Button>
          </div>

          <div className="text-gray-600 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-3 w-3 text-green-500" />
              <span>Cached data & local sorting available</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3 w-3 text-yellow-500" />
              <span>AI chat and uploads require internet</span>
            </div>
            {networkStatus.lastOnlineTime && (
              <div className="text-gray-500 text-xs pt-2 border-t">
                Last online: {networkStatus.lastOnlineTime.toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Success indicator when back online */}
      {networkStatus.isOnline && lastSuccessfulSync && showFullStatus && (
        <div className="absolute top-10 right-0 w-64 bg-green-50 border border-green-200 rounded-lg shadow-lg p-3 z-50">
          <div className="flex items-center gap-2 text-green-800">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span className="font-medium">Back Online</span>
          </div>
          <div className="text-green-600 text-sm mt-1">
            Connection restored at {lastSuccessfulSync.toLocaleTimeString()}
          </div>
        </div>
      )}

      {/* Performance warning for slow connections */}
      {networkStatus.isOnline &&
        networkStatus.isSlowConnection &&
        showFullStatus && (
          <div className="absolute top-10 right-0 w-64 bg-yellow-50 border border-yellow-200 rounded-lg shadow-lg p-3 z-50">
            <div className="flex items-center gap-2 text-yellow-800">
              <WifiLow className="h-4 w-4 text-yellow-600" />
              <span className="font-medium">Slow Connection</span>
            </div>
            <div className="text-yellow-600 text-sm mt-1">
              Using cached data when possible for better performance.
            </div>
          </div>
        )}
    </div>
  );
}
