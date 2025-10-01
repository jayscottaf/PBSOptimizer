import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Plane,
  Search,
  X,
  CloudUpload,
  BarChart2,
  User,
  RefreshCw,
  Trash2,
  Settings,
  Info,
  Star,
  Calendar,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Bot,
} from 'lucide-react';
import { FileUpload } from '@/components/ui/file-upload';
import { StatsPanel } from '@/components/stats-panel';
import { PairingTable } from '@/components/pairing-table';
import { PairingChat } from '@/components/pairing-chat';
import { FiltersPanel } from '@/components/filters-panel';
import { PairingModal } from '@/components/pairing-modal';
import { CalendarView } from '@/components/calendar-view';
import { SmartFilterSystem } from '@/components/smart-filter-system';
import { NetworkStatus } from '@/components/network-status';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cacheKeyForPairings,
  hasFullPairingsCache,
  loadFullPairingsCache,
  purgeUserCache,
  getCacheInfo,
} from '@/lib/offlineCache';
import { api } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ProfileModal } from '@/components/profile-modal';
import { useUploadBidPackage } from '@/hooks/useUploadBidPackage'; // Assuming this hook exists
import { toast } from '@/hooks/use-toast';
interface SearchFilters {
  search?: string;
  creditMin?: number;
  creditMax?: number;
  blockMin?: number;
  blockMax?: number;
  tafb?: string;
  tafbMin?: number;
  tafbMax?: number;
  holdProbabilityMin?: number;
  pairingDays?: number;
  pairingDaysMin?: number;
  pairingDaysMax?: number;
  efficiency?: number;
  sortBy?: string; // Add this line
  sortOrder?: 'asc' | 'desc'; // Add this line
}

// Placeholder for Pairing type if not defined elsewhere
interface Pairing {
  id: number;
  pairingNumber: string;
  creditHours: string;
  blockHours: string;
  tafb: string;
  holdProbability: string;
  // ... other properties
}

export default function Dashboard() {
  const [filters, setFilters] = useState<SearchFilters>({});
  const [debouncedFilters, setDebouncedFilters] = useState<SearchFilters>({});
  const [activeFilters, setActiveFilters] = useState<
    Array<{ key: string; label: string; value: any }>
  >([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showFilters, setShowFilters] = useState(false);
  const [showQuickStats, setShowQuickStats] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const queryClient = useQueryClient();

  // Enhanced debouncing with request deduplication
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters);
    }, 500); // Increased to 500ms for better deduplication

    return () => clearTimeout(timer);
  }, [filters]);
  const [seniorityNumber, setSeniorityNumber] = useState(() => {
    return localStorage.getItem('seniorityNumber') || '';
  });
  const [seniorityPercentile, setSeniorityPercentile] = useState(() => {
    return localStorage.getItem('seniorityPercentile') || '';
  });
  const [isUpdatingSeniority, setIsUpdatingSeniority] = useState(false);
  const [base, setBase] = useState(() => {
    return localStorage.getItem('base') || '';
  });
  const [aircraft, setAircraft] = useState(() => {
    return localStorage.getItem('aircraft') || '';
  });

  // Track if this is the initial load to prevent overwriting saved values
  const [hasInitialized, setHasInitialized] = useState(false);

  // Mark as initialized after first render
  React.useEffect(() => {
    setHasInitialized(true);
  }, []);

  // Save user info to localStorage when it changes (but not on initial load)
  React.useEffect(() => {
    if (hasInitialized) {
      localStorage.setItem('seniorityNumber', seniorityNumber);
      localStorage.setItem('seniorityPercentile', seniorityPercentile);
      localStorage.setItem('base', base);
      localStorage.setItem('aircraft', aircraft);
    }
  }, [seniorityNumber, seniorityPercentile, base, aircraft, hasInitialized]);

  const [selectedPairing, setSelectedPairing] = useState<any>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize] = useState<number>(50);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [showMobileAI, setShowMobileAI] = useState(false);

  // Sidebar collapsed state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    return saved !== null ? JSON.parse(saved) : false;
  });

  // Save sidebar state to localStorage
  React.useEffect(() => {
    localStorage.setItem('sidebarCollapsed', JSON.stringify(sidebarCollapsed));
  }, [sidebarCollapsed]);

  // Check if profile is complete on mount - show modal if not
  React.useEffect(() => {
    const checkProfile = () => {
      const hasRequired = seniorityNumber && base && aircraft;
      if (!hasRequired && hasInitialized) {
        setShowProfileModal(true);
      }
    };
    checkProfile();
  }, [hasInitialized, seniorityNumber, base, aircraft]);

  const { mutate: uploadMutation, data: uploadedPackage } = useUploadBidPackage(
    {
      onUploadProgress: setUploadProgress,
      onSuccess: data => {
        // Optionally, trigger a refetch of pairings or other relevant data
      },
    }
  );

  const handleFileUpload = (file: File) => {
    uploadMutation({ file });
  };

  const { data: bidPackages = [], refetch: refetchBidPackages } = useQuery({
    queryKey: ['bidPackages'],
    queryFn: api.getBidPackages,
    staleTime: 15 * 60 * 1000, // Increased cache time to 15 minutes
    gcTime: 30 * 60 * 1000, // Keep in memory for 30 minutes
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Find the latest bid package (prefer completed, fall back to most recent by uploadedAt if none are completed)
  const latestBidPackage = React.useMemo(() => {
    if (!bidPackages || bidPackages.length === 0) {
      return null;
    }

    const packagesArray = (bidPackages as any[]).slice();
    // Sort by uploadedAt descending
    packagesArray.sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );

    // Try to find the most recent completed package first
    const mostRecentCompleted = packagesArray.find(
      (pkg: any) => pkg.status === 'completed'
    );
    if (mostRecentCompleted) {
      return mostRecentCompleted;
    }

    // Fallback: return the most recent package regardless of status
    return packagesArray[0];
  }, [bidPackages]);

  const bidPackageId = latestBidPackage?.id; // Assuming you need this ID for other queries
  // Check if we have any completed bid packages
  const hasCompletedBidPackages = bidPackages.some(
    (pkg: any) => pkg.status === 'completed'
  );

  // Removed redundant initial query to prevent duplicate API calls

  // Query for user data with enhanced caching
  const { data: currentUser } = useQuery({
    queryKey: ['user', seniorityNumber, base, aircraft],
    queryFn: async () => {
      return await api.createOrUpdateUser({
        seniorityNumber: parseInt(seniorityNumber),
        base,
        aircraft,
      });
    },
    enabled: !!seniorityNumber,
    staleTime: 30 * 60 * 1000, // User data is stable for 30 minutes
    gcTime: 60 * 60 * 1000, // Keep in memory for 1 hour
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Only update loading state when user manually changes seniority in profile
  React.useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'seniorityPercentile' && e.newValue !== e.oldValue) {
        setIsUpdatingSeniority(true);
        const timer = setTimeout(() => {
          setIsUpdatingSeniority(false);
        }, 5000); // Reset after 5 seconds
        return () => clearTimeout(timer);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Optimized useQuery with enhanced caching and deduplication
  const {
    data: pairingsResponse,
    isLoading: isLoadingPairings,
    refetch: refetchPairings,
  } = useQuery({
    queryKey: [
      'pairings',
      bidPackageId,
      debouncedFilters,
      seniorityPercentile,
      sortColumn,
      sortDirection,
      currentPage,
      pageSize,
      currentUser?.seniorityNumber,
      currentUser?.id,
    ],
    queryFn: () =>
      api.searchPairings(
        {
          bidPackageId: bidPackageId,
          seniorityPercentage: seniorityPercentile
            ? parseFloat(seniorityPercentile)
            : undefined,
          sortBy: sortColumn || 'pairingNumber',
          sortOrder: sortDirection || 'asc',
          page: currentPage,
          limit: pageSize,
          ...debouncedFilters,
        },
        currentUser?.seniorityNumber || currentUser?.id
      ),
    enabled: !!bidPackageId,
    staleTime: 5 * 60 * 1000, // Increased cache time to 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in memory for 10 minutes
    refetchOnMount: false,
    refetchOnWindowFocus: false, // Prevent refetch on window focus
    refetchOnReconnect: false, // Prevent refetch on reconnect
    // Add optimistic updates for better perceived performance
    placeholderData: previousData => previousData,
  });

  // State for offline cache status
  const [isFullCacheReady, setIsFullCacheReady] = useState(false);
  const [isPrefetching, setIsPrefetching] = useState(false);
  const [showInitialStatus, setShowInitialStatus] = useState(true);

  // Auto-prefetch full dataset for current bid package and filters
  React.useEffect(() => {
    const run = async () => {
      if (!bidPackageId) {
        setIsFullCacheReady(false);
        setFullLocal(null);
        return;
      }

      // Use cache key WITHOUT sortBy/sortOrder to enable global sorting
      console.log('Dashboard: debouncedFilters =', debouncedFilters);
      const userId = currentUser?.seniorityNumber || currentUser?.id;

      // Generate TWO cache keys: filtered and unfiltered
      const cacheKey = cacheKeyForPairings(
        bidPackageId,
        debouncedFilters,
        userId
      );
      const unfilteredCacheKey = cacheKeyForPairings(
        bidPackageId,
        undefined, // No filters for unfiltered cache
        userId
      );
      console.log(
        'Dashboard: Generated cache keys - filtered:',
        cacheKey,
        'unfiltered:',
        unfilteredCacheKey,
        'for user:',
        userId
      );

      // Check if both caches exist
      const hasFull = await hasFullPairingsCache(cacheKey);
      const hasUnfiltered = await hasFullPairingsCache(unfilteredCacheKey);
      console.log(
        'Dashboard: Cache check - filtered:',
        hasFull,
        'unfiltered:',
        hasUnfiltered
      );
      setIsFullCacheReady(hasFull);

      // Load filtered cache if it exists
      let full: any[] | null = null;
      if (hasFull) {
        // Load existing filtered cache
        console.log('Dashboard: Loading existing filtered cache');
        full = await loadFullPairingsCache<any[]>(cacheKey);
        console.log('Dashboard: Loaded filtered cache, length:', full?.length || 0);
        setFullLocal(full || null);

        // Hide status indicator after 3 seconds when cache already exists
        setTimeout(() => setShowInitialStatus(false), 3000);
      }

      // Also load unfiltered cache for sorting
      let needsUnfilteredRefetch = false;
      if (hasUnfiltered) {
        console.log('Dashboard: Loading unfiltered cache for sorting');
        const unfiltered = await loadFullPairingsCache<any[]>(unfilteredCacheKey);
        console.log('Dashboard: Loaded unfiltered cache, length:', unfiltered?.length || 0);

        // Validate unfiltered cache - it should have at least as many items as filtered cache
        // and should have a reasonable minimum (e.g., > 400 for full bid packages)
        const filteredLength = full?.length || 0;
        const unfilteredLength = unfiltered?.length || 0;
        const MINIMUM_EXPECTED_PAIRINGS = 400; // Reasonable minimum for a full bid package

        if (unfilteredLength === 0 ||
            (unfilteredLength > 0 && unfilteredLength < filteredLength) ||
            unfilteredLength < MINIMUM_EXPECTED_PAIRINGS) {
          console.warn(
            `Dashboard: Invalid unfiltered cache detected (length: ${unfilteredLength}, filtered: ${filteredLength}, min expected: ${MINIMUM_EXPECTED_PAIRINGS}). Will re-fetch.`
          );
          needsUnfilteredRefetch = true;
        } else {
          setUnfilteredLocal(unfiltered || null);
        }
      } else {
        needsUnfilteredRefetch = true;
      }

      // Fetch unfiltered cache if it doesn't exist or is invalid
      if (needsUnfilteredRefetch && navigator.onLine && bidPackageId) {
        try {
          console.log('Dashboard: Prefetching unfiltered cache (all pairings, no filters)');
          await api.prefetchAllPairings(
            { bidPackageId } as any,
            userId,
            { force: true } // Force refetch to bypass stale cache
          );
          const newUnfiltered = await loadFullPairingsCache<any[]>(unfilteredCacheKey);
          console.log('Dashboard: Re-fetched unfiltered cache, length:', newUnfiltered?.length || 0);
          setUnfilteredLocal(newUnfiltered || null);

          // If filtered and unfiltered cache keys are the same (no active filters),
          // update filtered cache too
          if (cacheKey === unfilteredCacheKey && newUnfiltered) {
            console.log('Dashboard: Updating filtered cache with new unfiltered data');
            setFullLocal(newUnfiltered);
            setIsFullCacheReady(true);
          }
        } catch (error) {
          console.error('Unfiltered cache prefetch failed:', error);
        }
      }

      if (!hasFull && navigator.onLine) {
        // Prefetch full dataset
        try {
          setIsPrefetching(true);
          await api.prefetchAllPairings(
            {
              bidPackageId,
              ...debouncedFilters,
            } as any,
            userId
          );

          // Re-check and load after prefetch
          const newHasFull = await hasFullPairingsCache(cacheKey);
          setIsFullCacheReady(newHasFull);

          if (newHasFull) {
            const full = await loadFullPairingsCache<any[]>(cacheKey);
            setFullLocal(full || null);

            // Hide status indicator after 3 seconds when cache is ready
            setTimeout(() => setShowInitialStatus(false), 3000);
          }
        } catch (error) {
          console.error('Prefetch failed:', error);
          setIsFullCacheReady(false);
        } finally {
          setIsPrefetching(false);
        }
      }
    };
    run();
  }, [
    bidPackageId,
    JSON.stringify(debouncedFilters),
    currentUser?.seniorityNumber,
    currentUser?.id,
  ]);

  // When the bid package transitions to completed, invalidate and refetch pairings
  React.useEffect(() => {
    if (latestBidPackage?.id && latestBidPackage.status === 'completed') {
      queryClient.invalidateQueries({
        queryKey: ['pairings', latestBidPackage.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['initial-pairings', latestBidPackage.id],
      });
      refetchPairings();
    }
  }, [latestBidPackage?.status, latestBidPackage?.id]);

  // SSE handles progress; keep a light refresh on completion only
  React.useEffect(() => {
    if (latestBidPackage?.status === 'completed') {
      refetchBidPackages();
      refetchPairings();
    }
  }, [latestBidPackage?.status]);

  // Extract pairings and pagination from the response, with fallback to preloaded data
  // Store full local cache data
  const [fullLocal, setFullLocal] = useState<any[] | null>(null);
  // Store unfiltered cache for sorting
  const [unfilteredLocal, setUnfilteredLocal] = useState<any[] | null>(null);

  // Prefer full local cache whenever it exists (online or offline); fallback to server page
  const pairings = pairingsResponse?.pairings || [];
  const pagination = pairingsResponse?.pagination;

  // Create custom pagination - will be updated after sortedPairings is computed
  // This is a placeholder that will be overridden below
  const effectivePagination = pagination;

  // Calculate full dataset statistics when using offline cache
  const effectiveStatistics = React.useMemo(() => {
    if (isFullCacheReady && fullLocal && fullLocal.length > 0) {
      // Helper function to parse hours safely
      const parseHours = (hours: any): number => {
        if (typeof hours === 'number') {
          return hours;
        }
        if (typeof hours === 'string') {
          return parseFloat(hours) || 0;
        }
        return 0;
      };

      const getHoldProb = (value: any): number =>
        typeof value === 'number' ? value : parseFloat(String(value)) || 0;

      // Calculate stats from full dataset
      const highCredit = fullLocal.filter(
        p => parseHours(p.creditHours) >= 18
      ).length;
      const likelyToHold = fullLocal.filter(
        p => getHoldProb(p.holdProbability) >= 70
      ).length;

      // Calculate ratio breakdown from full dataset
      const ratioBreakdown = fullLocal.reduce(
        (acc, pairing) => {
          const credit = parseHours(pairing.creditHours);
          const block = parseHours(pairing.blockHours);
          const ratio = block > 0 ? credit / block : 0;

          if (ratio >= 1.3) {
            acc.excellent++;
          } else if (ratio >= 1.2) {
            acc.good++;
          } else if (ratio >= 1.1) {
            acc.average++;
          } else {
            acc.poor++;
          }
          return acc;
        },
        { excellent: 0, good: 0, average: 0, poor: 0 }
      );

      return {
        highCredit,
        likelyToHold,
        ratioBreakdown,
      };
    }

    // Fall back to server statistics when not using full cache
    return pairingsResponse?.statistics as any;
  }, [isFullCacheReady, fullLocal, pairingsResponse?.statistics]);

  // Debug logs removed after verification

  // Query for user's favorites with enhanced caching
  const { data: favorites = [], refetch: refetchFavorites } = useQuery({
    queryKey: ['favorites', currentUser?.id],
    queryFn: async () => {
      if (!currentUser) {
        return [];
      }
      try {
        return await api.getFavorites(currentUser.id);
      } catch (error) {
        console.error('Error fetching favorites:', error);
        return [];
      }
    },
    enabled: !!currentUser,
    staleTime: 10 * 60 * 1000, // Increased cache time to 10 minutes
    gcTime: 20 * 60 * 1000, // Keep in memory for 20 minutes
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const handleDeleteFavorite = async (pairingId: number) => {
    try {
      if (!currentUser) {
        return;
      }

      // Remove from favorites
      await api.removeFavorite(currentUser.id, pairingId);

      // Refresh favorites list
      refetchFavorites();
    } catch (error) {
      console.error('Error removing favorite:', error);
    }
  };

  const removeFilter = (keyToRemove: string) => {
    setActiveFilters(prev => prev.filter(f => f.key !== keyToRemove));
    setFilters(prev => {
      const newFilters = { ...prev };
      if (keyToRemove === 'creditRange') {
        // Remove both min and max for credit range
        delete newFilters.creditMin;
        delete newFilters.creditMax;
      } else if (keyToRemove === 'blockRange') {
        // Remove both min and max for block range
        delete newFilters.blockMin;
        delete newFilters.blockMax;
      } else if (
        keyToRemove === 'pairingDays' ||
        keyToRemove === 'pairingDaysMin' ||
        keyToRemove === 'pairingDaysMax'
      ) {
        // Remove all related pairingDays filters to ensure unfiltered state
        delete newFilters.pairingDays;
        delete newFilters.pairingDaysMin;
        delete newFilters.pairingDaysMax;
      } else {
        delete newFilters[keyToRemove as keyof SearchFilters];
      }
      return newFilters;
    });
  };

  const addFilter = (key: string, label: string, value: any) => {
    if (value !== undefined && value !== null && value !== '') {
      // Determine the filter category for replacement logic
      const isCreditFilter =
        key === 'creditRange' || key === 'creditMin' || key === 'creditMax';
      const isBlockFilter =
        key === 'blockRange' || key === 'blockMin' || key === 'blockMax';
      const isPairingDaysFilter =
        key === 'pairingDays' ||
        key === 'pairingDaysMin' ||
        key === 'pairingDaysMax';

      if (
        (key === 'creditRange' || key === 'blockRange') &&
        typeof value === 'object'
      ) {
        // Handle range filters specially
        setActiveFilters(prev => [
          ...prev.filter(f =>
            isCreditFilter
              ? !f.key.match(/^credit/)
              : isBlockFilter
                ? !f.key.match(/^block/)
                : f.key !== key
          ),
          { key, label, value },
        ]);
        setFilters(prev => {
          const newFilters = { ...prev };
          // Clear any existing filters for this range type
          if (key === 'creditRange') {
            delete newFilters.creditMin;
            delete newFilters.creditMax;
          } else if (key === 'blockRange') {
            delete newFilters.blockMin;
            delete newFilters.blockMax;
          }
          // Apply the range
          return { ...newFilters, ...value };
        });
      } else {
        // Handle single filters - remove existing filters of the same category
        setActiveFilters(prev => [
          ...prev.filter(f =>
            isCreditFilter
              ? !f.key.match(/^credit/)
              : isBlockFilter
                ? !f.key.match(/^block/)
                : isPairingDaysFilter
                  ? !f.key.match(/^pairingDays/)
                  : f.key !== key
          ),
          { key, label, value },
        ]);
        setFilters(prev => {
          const newFilters = { ...prev };
          // Clear related filters when adding a new one of the same category
          if (isCreditFilter) {
            delete newFilters.creditMin;
            delete newFilters.creditMax;
          } else if (isBlockFilter) {
            delete newFilters.blockMin;
            delete newFilters.blockMax;
          } else if (isPairingDaysFilter) {
            delete newFilters.pairingDays;
            delete newFilters.pairingDaysMin;
            delete newFilters.pairingDaysMax;
          }
          return { ...newFilters, [key]: value };
        });
      }
    }
  };

  const handlePairingClick = (pairing: any) => {
    setSelectedPairing(pairing);
  };

  const handleSort = (column: string) => {
    if (column === sortColumn) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  };

  const handleFiltersChange = (newFilters: SearchFilters) => {
    // Process the new filters to handle range objects
    const processedFilters: SearchFilters = {};

    Object.entries(newFilters).forEach(([key, value]) => {
      if (
        key === 'creditRange' &&
        typeof value === 'object' &&
        value !== null
      ) {
        // Flatten credit range object
        const rangeObj = value as any;
        if (rangeObj.creditMin !== undefined) {
          processedFilters.creditMin = rangeObj.creditMin;
        }
        if (rangeObj.creditMax !== undefined) {
          processedFilters.creditMax = rangeObj.creditMax;
        }
      } else if (
        key === 'blockRange' &&
        typeof value === 'object' &&
        value !== null
      ) {
        // Flatten block range object
        const rangeObj = value as any;
        if (rangeObj.blockMin !== undefined) {
          processedFilters.blockMin = rangeObj.blockMin;
        }
        if (rangeObj.blockMax !== undefined) {
          processedFilters.blockMax = rangeObj.blockMax;
        }
      } else {
        // Regular filter
        processedFilters[key as keyof SearchFilters] = value;
      }
    });

    let mergedAfter: any = {};
    setFilters(prev => {
      const merged: any = { ...prev, ...processedFilters };
      // drop cleared keys so they don't persist silently
      Object.keys(merged).forEach(k => {
        if (merged[k] === undefined || merged[k] === null || merged[k] === '') {
          delete merged[k];
        }
      });
      mergedAfter = merged;

      return merged;
    });
    setCurrentPage(1);

    // Update activeFilters to reflect the FULL merged filter set
    const updatedActiveFilters: Array<{
      key: string;
      label: string;
      value: any;
    }> = [];
    const sourceForLabels =
      mergedAfter && Object.keys(mergedAfter).length
        ? mergedAfter
        : processedFilters;

    Object.entries(sourceForLabels).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        let label = '';

        // Generate appropriate labels for different filter types
        switch (key) {
          case 'creditMin':
            label = `Credit: ≥${value}:00`;
            break;
          case 'creditMax':
            label = `Credit: ≤${value}:00`;
            break;
          case 'blockMin':
            label = `Block: ≥${value}:00`;
            break;
          case 'blockMax':
            label = `Block: ≤${value}:00`;
            break;
          case 'holdProbabilityMin':
            label = `Hold: ≥${value}%`;
            break;
          case 'pairingDaysMin':
            label = `Days: ≥${value}`;
            break;
          case 'pairingDays':
            label = `Days: ${value}`;
            break;
          case 'tafbMin':
            label = `TAFB: ≥${value}hrs`;
            break;
          case 'tafbMax':
            label = `TAFB: ≤${value}hrs`;
            break;
          case 'efficiency':
            label = `Efficiency: ≥${value}`;
            break;
          default:
            label = `${key}: ${value}`;
        }

        updatedActiveFilters.push({ key, label, value });
      }
    });

    setActiveFilters(updatedActiveFilters);
  };

  const clearAllFilters = () => {
    setFilters({});
    setActiveFilters([]);
  };
  // Client-side sorting from full cache when available
  const sortedPairings = React.useMemo(() => {
    // When sorting is active, use unfiltered cache and apply filters client-side
    const useUnfiltered = sortColumn && unfilteredLocal && unfilteredLocal.length > 0;

    if (!useUnfiltered && (!isFullCacheReady || !fullLocal || fullLocal.length === 0)) {
      return pairings;
    }

    const sourceData = useUnfiltered ? unfilteredLocal : fullLocal;
    console.log(`Sorting ${sourceData.length} pairings from ${useUnfiltered ? 'unfiltered' : 'filtered'} cache`);

    // Apply filters client-side when using unfiltered cache
    let filtered = [...sourceData];
    if (useUnfiltered && filters && Object.keys(filters).length > 0) {
      console.log('Applying filters client-side:', filters);
      filtered = filtered.filter(pairing => {
        // Credit hours filter
        if (filters.creditMin !== undefined) {
          const credit = parseFloat(pairing.creditHours?.toString() || '0');
          if (credit < filters.creditMin) {
            return false;
          }
        }
        if (filters.creditMax !== undefined) {
          const credit = parseFloat(pairing.creditHours?.toString() || '0');
          if (credit > filters.creditMax) {
            return false;
          }
        }

        // Block hours filter
        if (filters.blockMin !== undefined) {
          const block = parseFloat(pairing.blockHours?.toString() || '0');
          if (block < filters.blockMin) {
            return false;
          }
        }
        if (filters.blockMax !== undefined) {
          const block = parseFloat(pairing.blockHours?.toString() || '0');
          if (block > filters.blockMax) {
            return false;
          }
        }

        // Hold probability filter
        if (filters.holdProbabilityMin !== undefined) {
          const hold = parseFloat(pairing.holdProbability?.toString() || '0');
          if (hold < filters.holdProbabilityMin) {
            return false;
          }
        }

        // Pairing days filter
        if (filters.pairingDays !== undefined) {
          if (pairing.pairingDays !== filters.pairingDays) {
            return false;
          }
        }
        if (filters.pairingDaysMin !== undefined) {
          if ((pairing.pairingDays || 0) < filters.pairingDaysMin) {
            return false;
          }
        }
        if (filters.pairingDaysMax !== undefined) {
          if ((pairing.pairingDays || 0) > filters.pairingDaysMax) {
            return false;
          }
        }

        // TAFB filter
        if (filters.tafbMin !== undefined || filters.tafbMax !== undefined) {
          const tafbStr = pairing.tafb?.toString() || '0';
          let tafbHours = 0;
          if (tafbStr.includes(':')) {
            const [hours, minutes] = tafbStr.split(':').map(Number);
            tafbHours = hours + (minutes || 0) / 60;
          } else {
            tafbHours = parseFloat(tafbStr);
          }

          if (filters.tafbMin !== undefined && tafbHours < filters.tafbMin) {
            return false;
          }
          if (filters.tafbMax !== undefined && tafbHours > filters.tafbMax) {
            return false;
          }
        }

        // Efficiency filter (C/B ratio)
        if (filters.efficiency !== undefined) {
          const credit = parseFloat(pairing.creditHours?.toString() || '0');
          const block = parseFloat(pairing.blockHours?.toString() || '0');
          const efficiency = block > 0 ? credit / block : 0;
          if (efficiency < filters.efficiency) {
            return false;
          }
        }

        // Search filter
        if (filters.search) {
          const searchLower = filters.search.toLowerCase();
          const pairingNum = pairing.pairingNumber?.toString().toLowerCase() || '';
          const route = pairing.route?.toString().toLowerCase() || '';
          if (!pairingNum.includes(searchLower) && !route.includes(searchLower)) {
            return false;
          }
        }

        return true;
      });
      console.log(`After filtering: ${filtered.length} pairings`);
    }

    const sorted = filtered;

    // Apply sorting only - filters are already applied when the cache was created
    sorted.sort((a, b) => {
      let aVal: any, bVal: any;

      switch (sortColumn) {
        case 'creditHours':
          aVal = parseFloat(a.creditHours?.toString() || '0');
          bVal = parseFloat(b.creditHours?.toString() || '0');
          break;
        case 'blockHours':
          aVal = parseFloat(a.blockHours?.toString() || '0');
          bVal = parseFloat(b.blockHours?.toString() || '0');
          break;
        case 'holdProbability':
          aVal = a.holdProbability || 0;
          bVal = b.holdProbability || 0;
          break;
        case 'pairingDays':
          aVal = a.pairingDays || 0;
          bVal = b.pairingDays || 0;
          break;
        case 'creditBlockRatio':
          aVal =
            parseFloat(a.creditHours?.toString() || '0') /
            (parseFloat(a.blockHours?.toString() || '0') || 1);
          bVal =
            parseFloat(b.creditHours?.toString() || '0') /
            (parseFloat(b.blockHours?.toString() || '0') || 1);
          break;
        case 'tafb': {
          // Convert TAFB to minutes for proper sorting
          const parseTimeTafb = (tafb: string) => {
            if (!tafb) {
              return 0;
            }
            if (tafb.includes(':')) {
              const [hours, minutes] = tafb.split(':').map(Number);
              return hours * 60 + minutes;
            }
            return parseFloat(tafb) * 60;
          };
          aVal = parseTimeTafb(a.tafb?.toString() || '0');
          bVal = parseTimeTafb(b.tafb?.toString() || '0');
          break;
        }
        default:
          aVal = a.pairingNumber || '';
          bVal = b.pairingNumber || '';
      }

      if (sortDirection === 'asc') {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      } else {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      }
    });

    console.log(`After filtering and sorting: ${sorted.length} pairings`);
    return sorted;
  }, [fullLocal, unfilteredLocal, isFullCacheReady, filters, sortColumn, sortDirection, pairings]);

  // Update pagination based on sorted results
  const actualEffectivePagination = React.useMemo(() => {
    if (isFullCacheReady && sortedPairings.length > 0) {
      const total = sortedPairings.length;
      const totalPages = Math.ceil(total / pageSize);
      return {
        page: currentPage,
        limit: pageSize,
        total: total,
        totalPages: totalPages,
        hasNext: currentPage < totalPages,
        hasPrev: currentPage > 1,
      };
    }
    return effectivePagination;
  }, [isFullCacheReady, sortedPairings, currentPage, pageSize, effectivePagination]);

  // Use sorted pairings if available, otherwise use regular pairings
  // When using full cache with sorting, apply pagination slicing
  const displayPairings = React.useMemo(() => {
    if (isFullCacheReady && sortedPairings.length > 0) {
      // Apply pagination to sorted results
      const startIndex = (currentPage - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      return sortedPairings.slice(startIndex, endIndex);
    }
    return pairings;
  }, [isFullCacheReady, sortedPairings, currentPage, pageSize, pairings]);
  // Mocking selectedBidPackageId for the polling logic in the modal
  const [selectedBidPackageId, setSelectedBidPackageId] = useState<
    string | null
  >(null);

  // Update the quick stats to use backend statistics
  const quickStats = React.useMemo(() => {
    if (!pairings || pairings.length === 0) {
      return { totalPairings: 0, likelyToHold: 0, highCredit: 0 };
    }

    // Use pagination total if available, otherwise fall back to current page count
    const totalPairings =
      actualEffectivePagination && actualEffectivePagination.total
        ? actualEffectivePagination.total
        : pairings.length;
    // Use backend statistics if available, otherwise calculate from current page
    const likelyToHold = pairingsResponse?.statistics?.likelyToHold
      ? Number(pairingsResponse.statistics.likelyToHold)
      : pairings.filter(p => (p.holdProbability || 0) >= 0.7).length;

    const highCredit = pairingsResponse?.statistics?.highCredit
      ? Number(pairingsResponse.statistics.highCredit)
      : pairings.filter(p => parseFloat(p.creditHours?.toString() || '0') >= 18)
          .length;
    return {
      totalPairings,
      likelyToHold,
      highCredit,
    };
  }, [pairings, pagination, pairingsResponse?.statistics]);

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Left Sidebar - Hidden on mobile */}
      <div
        className={`hidden lg:flex bg-white border-r transition-all duration-300 ${
          sidebarCollapsed ? 'w-16' : 'w-80'
        } flex-shrink-0 flex-col`}
      >
        {/* Toggle button */}
        <div className="p-4 border-b flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto">
          {!bidPackageId ? (
            sidebarCollapsed ? (
              <div className="text-center">
                <CloudUpload className="mx-auto h-8 w-8 text-gray-300" />
              </div>
            ) : (
              <div className="text-center py-8">
                <CloudUpload className="mx-auto h-12 w-12 text-gray-300" />
                <h3 className="mt-4 text-lg font-medium text-gray-900">
                  No Bid Package
                </h3>
                <p className="mt-2 text-sm text-gray-500">
                  Upload a PDF bid package to get started with analyzing
                  pairings.
                </p>
              </div>
            )
          ) : (
            <div className="space-y-6">
              {sidebarCollapsed ? (
                // Collapsed view - show essential numbers only
                <div className="space-y-4">
                  <div className="text-center">
                    <div className="text-lg font-bold text-blue-600">
                      {quickStats.totalPairings}
                    </div>
                    <div className="text-xs text-gray-600">Total</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-green-600">
                      {quickStats.likelyToHold}
                    </div>
                    <div className="text-xs text-gray-600">Hold</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-purple-600">
                      {quickStats.highCredit}
                    </div>
                    <div className="text-xs text-gray-600">HC</div>
                  </div>
                </div>
              ) : (
                // Expanded view - show full stats panel
                <div className="space-y-6">
                  <StatsPanel
                    pairings={displayPairings || []}
                    bidPackage={latestBidPackage}
                    pagination={actualEffectivePagination}
                    statistics={effectiveStatistics}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <div className="p-3 sm:p-6 h-full">
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="h-full flex flex-col"
          >
            <div className="flex flex-col gap-4 mb-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Plane className="h-6 w-6 text-blue-600" />
                    <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
                      PBS Bid Optimizer
                    </h1>
                  </div>
                  {currentUser && (
                    <Badge variant="outline" className="text-xs">
                      Seniority #{currentUser.seniorityNumber} (
                      {seniorityPercentile}%)
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <TabsList className="grid grid-cols-1 sm:w-auto">
                    <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                  </TabsList>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      // Toggle between showing all pairings and favorites
                      if (activeTab === 'favorites') {
                        setActiveTab('dashboard');
                      } else {
                        setActiveTab('favorites');
                      }
                    }}
                    className={`${activeTab === 'favorites' ? 'bg-yellow-50 text-yellow-700' : 'text-gray-600'}`}
                  >
                    <Star className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveTab('calendar')}
                    className={`${activeTab === 'calendar' ? 'bg-blue-50 text-blue-700' : 'text-gray-600'}`}
                  >
                    <Calendar className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // On mobile: show full-screen AI view
                      // On desktop: open AI Assistant modal
                      if (window.innerWidth < 1024) {
                        // lg breakpoint
                        setShowMobileAI(true);
                      } else {
                        setShowAIAssistant(true);
                      }
                    }}
                    className={`flex items-center justify-center w-9 h-9 hover:bg-green-50 hover:border-green-300 transition-all duration-200 hover:scale-105 hover:shadow-md ${
                      showMobileAI
                        ? 'bg-green-50 border-green-300 text-green-700'
                        : 'text-green-600'
                    }`}
                    title="AI Assistant"
                  >
                    <Bot className="h-4 w-4 hover:text-green-700" />
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowProfileModal(true)}
                    className="flex items-center justify-center w-9 h-9 hover:bg-blue-50 hover:border-blue-300 transition-all duration-200 hover:scale-105"
                    title="User Profile"
                  >
                    <User className="h-4 w-4" />
                  </Button>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowUploadModal(true)}
                      className="flex items-center gap-2"
                    >
                      <CloudUpload className="h-4 w-4" />
                      <span className="hidden sm:inline">Upload</span>
                    </Button>

                    {/* Network Status - Inline WiFi icon */}
                    <div className="relative">
                      <NetworkStatus />
                    </div>
                  </div>
                </div>
              </div>

              {/* Mobile Stats Panel - Only show on mobile and when we have bid package data */}
              {bidPackageId && (
                <div className="lg:hidden">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <BarChart2 className="h-5 w-5" />
                          Quick Stats
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowQuickStats(!showQuickStats)}
                        >
                          {showQuickStats ? 'Hide' : 'Show'}
                        </Button>
                      </CardTitle>
                    </CardHeader>
                    {showQuickStats && (
                      <CardContent>
                        <StatsPanel
                          pairings={displayPairings || []}
                          bidPackage={latestBidPackage}
                          pagination={actualEffectivePagination}
                          statistics={effectiveStatistics}
                        />
                      </CardContent>
                    )}
                  </Card>
                </div>
              )}
            </div>

            <TabsContent value="dashboard" className="flex-1 overflow-hidden">
              <div className="space-y-6 h-full">
                {/* Removed duplicate mobile Smart Filters card to keep a single instance above results */}

                {/* Horizontal Filters Bar */}
                <div className="flex flex-col h-full bg-white">
                  <div className="w-full bg-white border-b p-4">
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold text-gray-700">
                        Filters
                      </h3>
                      <SmartFilterSystem
                        pairings={pairings || []}
                        onFiltersChange={handleFiltersChange}
                        activeFilters={activeFilters}
                        onClearFilters={clearAllFilters}
                      />
                    </div>
                  </div>

                  {/* Pairing Results Section */}
                  <div className="flex-1 overflow-auto p-4 lg:p-0">
                    {' '}
                    {/* Ensure results section takes remaining space */}
                    <Card className="h-full flex flex-col">
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-lg font-medium flex items-center gap-2">
                          <Search className="h-5 w-5 text-muted-foreground" />
                          Pairing Results
                        </CardTitle>
                        <div className="flex items-center space-x-2">
                          {/* Only show cache status when it's actually useful */}
                          {(isPrefetching ||
                            !isFullCacheReady ||
                            showInitialStatus) && (
                            <>
                              {isPrefetching ? (
                                <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 border border-blue-200 flex items-center">
                                  <RefreshCw className="h-3 w-3 mr-1 animate-spin" />{' '}
                                  Preparing offline cache...
                                </span>
                              ) : isFullCacheReady ? (
                                <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 border border-green-200">
                                  Available offline: Yes
                                </span>
                              ) : (
                                <span
                                  className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 border border-gray-200 cursor-pointer"
                                  onClick={async () => {
                                    console.log('Manual prefetch triggered');
                                    setShowInitialStatus(true); // Show status during manual prefetch
                                    console.log(
                                      'Clearing old cache entries first...'
                                    );
                                    // Clear old cache entries
                                    try {
                                      const request = indexedDB.open(
                                        'pbs-cache',
                                        1
                                      );
                                      const db = await new Promise<IDBDatabase>(
                                        (resolve, reject) => {
                                          request.onsuccess = () =>
                                            resolve(request.result);
                                          request.onerror = () =>
                                            reject(request.error);
                                        }
                                      );
                                      const tx = db.transaction(
                                        ['pairings'],
                                        'readwrite'
                                      );
                                      const store = tx.objectStore('pairings');
                                      await new Promise<void>(
                                        (resolve, reject) => {
                                          const clearReq = store.clear();
                                          clearReq.onsuccess = () => resolve();
                                          clearReq.onerror = () =>
                                            reject(clearReq.error);
                                        }
                                      );
                                      console.log('Cache cleared');
                                    } catch (e) {
                                      console.log('Failed to clear cache:', e);
                                    }

                                    setIsPrefetching(true);
                                    try {
                                      const userId =
                                        currentUser?.seniorityNumber ||
                                        currentUser?.id;
                                      await api.prefetchAllPairings(
                                        {
                                          bidPackageId,
                                          ...debouncedFilters,
                                        } as any,
                                        userId
                                      );

                                      const key = cacheKeyForPairings(
                                        bidPackageId,
                                        debouncedFilters,
                                        userId
                                      );
                                      const exists =
                                        await hasFullPairingsCache(key);
                                      console.log(
                                        'Manual prefetch - final check:',
                                        exists
                                      );

                                      if (exists) {
                                        const data =
                                          await loadFullPairingsCache(key);
                                        console.log(
                                          'Manual prefetch - data length:',
                                          data?.length
                                        );
                                        setIsFullCacheReady(true);
                                        setFullLocal(data || null);
                                        // Hide after manual prefetch completes
                                        setTimeout(
                                          () => setShowInitialStatus(false),
                                          3000
                                        );
                                      }
                                    } catch (error) {
                                      console.error(
                                        'Manual prefetch failed:',
                                        error
                                      );
                                    } finally {
                                      setIsPrefetching(false);
                                    }
                                  }}
                                >
                                  Available offline: No (click to cache)
                                </span>
                              )}
                            </>
                          )}
                          {isUpdatingSeniority && (
                            <span className="flex items-center text-orange-600 text-sm">
                              <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                              Updating...
                            </span>
                          )}
                          <span className="text-sm text-gray-500">
                            {latestBidPackage
                              ? `${latestBidPackage.month} ${latestBidPackage.year} - `
                              : ''}
                            {actualEffectivePagination?.total ||
                              displayPairings.length}{' '}
                            pairings
                          </span>
                        </div>
                      </CardHeader>
                      <CardContent className="flex-1 overflow-auto p-0">
                        {isUpdatingSeniority && (
                          <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10 rounded-lg">
                            <div className="flex items-center space-x-2 text-orange-600">
                              <RefreshCw className="h-6 w-6 animate-spin" />
                              <span className="text-lg font-medium">
                                Updating hold probabilities...
                              </span>
                            </div>
                          </div>
                        )}
                        <PairingTable
                          pairings={displayPairings || []}
                          onSort={handleSort}
                          sortColumn={sortColumn || ''}
                          sortDirection={sortDirection}
                          onPairingClick={handlePairingClick}
                          pagination={effectivePagination as any}
                          onPageChange={page => setCurrentPage(page)}
                        />
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Favorites Tab */}
            <TabsContent value="favorites" className="flex-1 overflow-hidden">
              <div className="space-y-6 h-full">
                <Card className="h-full flex flex-col">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-lg font-medium flex items-center gap-2">
                      <Star className="h-5 w-5 text-yellow-500" />
                      Your Favorites
                    </CardTitle>
                    <span className="text-sm text-gray-500">
                      {favorites.length} favorite pairings
                    </span>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-auto p-0">
                    {favorites.length > 0 ? (
                      <PairingTable
                        pairings={favorites}
                        onSort={handleSort}
                        sortColumn={sortColumn || ''}
                        sortDirection={sortDirection}
                        onPairingClick={handlePairingClick}
                        showDeleteButton={true}
                        onDeleteFavorite={handleDeleteFavorite}
                        showAddToCalendar={true}
                        currentUser={currentUser}
                      />
                    ) : (
                      <div className="text-center py-8">
                        <Star className="mx-auto h-16 w-16 text-gray-300" />
                        <h3 className="mt-4 text-lg font-medium text-gray-900">
                          No Favorites Yet
                        </h3>
                        <p className="mt-2 text-sm text-gray-500">
                          Click the star icon on any pairing to add it to your
                          favorites.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Calendar Tab */}
            <TabsContent value="calendar" className="flex-1 overflow-auto">
              {currentUser ? (
                <CalendarView
                  userId={currentUser.id}
                  bidPackageId={bidPackageId}
                />
              ) : (
                <div className="text-center py-8">
                  <Calendar className="mx-auto h-16 w-16 text-gray-300" />
                  <h3 className="mt-4 text-lg font-medium text-gray-900">
                    Calendar Loading
                  </h3>
                  <p className="mt-2 text-sm text-gray-500">
                    Setting up your calendar view...
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Pairing Modal */}
      {selectedPairing && (
        <PairingModal
          pairingId={selectedPairing.id}
          onClose={() => setSelectedPairing(null)}
        />
      )}

      {/* Upload Bid Package Modal */}
      <Dialog open={showUploadModal} onOpenChange={setShowUploadModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Bid Package</DialogTitle>
            <DialogDescription>
              Upload your PBS bid package to analyze pairings
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors">
              <CloudUpload className="mx-auto h-12 w-12 text-gray-400" />
              <div className="mt-4">
                <FileUpload
                  onUpload={file => {
                    console.log('File uploaded:', file);
                    setShowUploadModal(false);
                    refetchBidPackages();

                    // Poll for completion and refresh data
                    const pollForCompletion = async () => {
                      let attempts = 0;
                      const maxAttempts = 30; // 30 seconds max

                      const checkStatus = async () => {
                        attempts++;
                        try {
                          const packages = await api.getBidPackages();
                          const latestPackage = packages.reduce(
                            (latest: any, pkg: any) => {
                              if (
                                pkg.status === 'completed' &&
                                (!latest ||
                                  new Date(pkg.uploadedAt) >
                                    new Date(latest.uploadedAt))
                              ) {
                                return pkg;
                              }
                              return latest;
                            },
                            null
                          );

                          if (latestPackage) {
                            console.log(
                              'Bid package processing completed, refreshing data...'
                            );
                            // Refresh all data
                            refetchBidPackages();
                            if (latestPackage.id !== selectedBidPackageId) {
                              setSelectedBidPackageId(latestPackage.id);
                            }
                            return; // Exit polling
                          }

                          if (attempts < maxAttempts) {
                            setTimeout(checkStatus, 1000); // Check again in 1 second
                          } else {
                            console.log('Polling timeout reached');
                          }
                        } catch (error) {
                          console.error(
                            'Error checking bid package status:',
                            error
                          );
                          if (attempts < maxAttempts) {
                            setTimeout(checkStatus, 1000);
                          }
                        }
                      };

                      checkStatus();
                    };

                    pollForCompletion();
                  }}
                />
              </div>
            </div>
            <div className="text-xs text-gray-500 flex items-center">
              <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
              Supports NYC A220 bid packages (PDF or TXT format)
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Assistant Modal */}
      <Dialog open={showAIAssistant} onOpenChange={setShowAIAssistant}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-green-600" />
              PBS AI Assistant
            </DialogTitle>
            <DialogDescription>
              Ask questions about your pairings, get bidding recommendations,
              and analyze your options
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden min-h-0">
            {currentUser && latestBidPackage ? (
              <PairingChat bidPackageId={bidPackageId} />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                <div className="text-center">
                  <Bot className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                  <p>
                    {bidPackages.length === 0
                      ? 'Upload a bid package to start using the AI assistant'
                      : 'Processing bid package... AI assistant will be available once processing is complete'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {/* Mobile AI Assistant Full Screen - Only on Mobile */}
      {showMobileAI && (
        <div className="fixed inset-0 z-50 bg-white lg:hidden">
          <div className="h-full flex flex-col">
            {/* Minimal header with just close button */}
            <div className="flex-shrink-0 flex items-center justify-between p-3 border-b bg-white">
              <h1 className="text-base font-medium">AI Assistant</h1>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowMobileAI(false)}
                className="p-1 h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Chat content - takes full remaining space */}
            <div className="flex-1 overflow-hidden">
              {currentUser && latestBidPackage ? (
                <PairingChat bidPackageId={bidPackageId} compact={true} />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500 p-4">
                  <div className="text-center">
                    <Bot className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                    <p className="text-sm">Upload a bid package to start</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Profile Modal (moved inside the Profile tab content for better UX) */}
      <Dialog
        open={showProfileModal}
        onOpenChange={(open) => {
          // Prevent closing if required fields are empty
          if (!open && (!seniorityNumber || !base || !aircraft)) {
            toast({
              title: 'Profile Required',
              description: 'Please complete your profile before continuing. All fields marked with * are required.',
              variant: 'destructive',
            });
            return;
          }
          setShowProfileModal(open);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Complete Your Profile</DialogTitle>
            <DialogDescription>
              Please fill in your pilot information to continue. All fields marked with * are required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">
                Seniority Number <span className="text-red-500">*</span>
              </label>
              <Input
                value={seniorityNumber}
                onChange={e => setSeniorityNumber(e.target.value)}
                placeholder="Enter seniority number (e.g., 15600)"
                className={!seniorityNumber ? 'border-red-300 focus:border-red-500' : ''}
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">
                Category Seniority %
              </label>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={seniorityPercentile}
                onChange={e => setSeniorityPercentile(e.target.value)}
                placeholder="e.g., 47.6 (optional)"
              />
              <p className="text-xs text-gray-500 mt-1">Lower % = more senior</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">
                Base <span className="text-red-500">*</span>
              </label>
              <select
                value={base}
                onChange={e => setBase(e.target.value)}
                className={`flex h-10 w-full rounded-md border ${!base ? 'border-red-300' : 'border-input'} bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50`}
                required
              >
                <option value="">Select your base</option>
                <option value="NYC">NYC - New York</option>
                <option value="ATL">ATL - Atlanta</option>
                <option value="DFW">DFW - Dallas</option>
                <option value="LAX">LAX - Los Angeles</option>
                <option value="MSP">MSP - Minneapolis</option>
                <option value="SEA">SEA - Seattle</option>
                <option value="DTW">DTW - Detroit</option>
                <option value="SLC">SLC - Salt Lake City</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">
                Aircraft <span className="text-red-500">*</span>
              </label>
              <select
                value={aircraft}
                onChange={e => setAircraft(e.target.value)}
                className={`flex h-10 w-full rounded-md border ${!aircraft ? 'border-red-300' : 'border-input'} bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50`}
                required
              >
                <option value="">Select your aircraft</option>
                <option value="A220">A220</option>
                <option value="A320">A320</option>
                <option value="A321">A321</option>
                <option value="A330">A330</option>
                <option value="A350">A350</option>
                <option value="B737">B737</option>
                <option value="B757">B757</option>
                <option value="B767">B767</option>
              </select>
            </div>
            <div className="border-t pt-4 mt-4">
              <div className="text-sm font-medium text-gray-700 mb-2">
                Cache Management
              </div>
              <div className="flex gap-2 mb-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const userId =
                      currentUser?.seniorityNumber || currentUser?.id;
                    if (userId) {
                      try {
                        await purgeUserCache(userId);
                        // Clear React Query cache as well
                        queryClient.clear();
                        toast({
                          title: 'Success',
                          description: 'Cache cleared successfully',
                        });
                      } catch (error) {
                        toast({
                          title: 'Error',
                          description: 'Failed to clear cache',
                          variant: 'destructive',
                        });
                      }
                    }
                  }}
                >
                  Clear My Cache
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // Clear localStorage
                    localStorage.clear();
                    // Reload page to reset state
                    window.location.reload();
                  }}
                >
                  Reset App Data
                </Button>
                {import.meta.env.DEV && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        const info = await getCacheInfo();
                        console.log('📊 Cache Diagnostics:', info);
                        alert(
                          `Cache Info:\n• Schema: ${info.schemaVersion}\n• Total: ${info.totalEntries} entries\n• Users: ${Object.keys(info.userCacheStats).join(', ')}\n• Updated: ${info.lastUpdated?.toLocaleString() || 'Never'}`
                        );
                      } catch (error) {
                        console.error('Cache diagnostics failed:', error);
                        alert('Failed to get cache info - check console');
                      }
                    }}
                  >
                    Cache Info
                  </Button>
                )}
              </div>
            </div>
            <div className="flex justify-end pt-4">
              <Button
                onClick={async () => {
                  // Validate required fields
                  if (!seniorityNumber || !base || !aircraft) {
                    toast({
                      title: 'Missing Required Fields',
                      description: 'Please fill in Seniority Number, Base, and Aircraft',
                      variant: 'destructive',
                    });
                    return;
                  }

                  try {
                    // Create or update user in database
                    await api.createOrUpdateUser({
                      seniorityNumber: parseInt(seniorityNumber),
                      seniorityPercentile: seniorityPercentile
                        ? Math.round(parseFloat(seniorityPercentile))
                        : undefined,
                      base,
                      aircraft,
                    });

                    // Invalidate user query to refresh
                    queryClient.invalidateQueries({ queryKey: ['user'] });

                    toast({
                      title: 'Profile Saved',
                      description: 'Your profile has been saved successfully!',
                    });

                    setShowProfileModal(false);
                  } catch (error: any) {
                    toast({
                      title: 'Error',
                      description: error?.message || 'Failed to save profile. Please try again.',
                      variant: 'destructive',
                    });
                  }
                }}
              >
                Save Profile
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
