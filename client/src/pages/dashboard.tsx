import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense, lazy } from 'react';
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
  Search,
  X,
  Bot,
  CloudUpload,
  BarChart2,
  User,
  RefreshCw,
  Trash2,
  Settings,
  Info,
  Star,
  Calendar,
  Moon,
  Sun,
  Monitor,
  ClipboardList,
  TrendingUp,
} from 'lucide-react';
import { FileUpload } from '@/components/ui/file-upload';
import { StatsPanel } from '@/components/stats-panel';
import { PairingTable } from '@/components/pairing-table';
import { PairingModal } from '@/components/pairing-modal';
import { SmartFilterSystem } from '@/components/smart-filter-system';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { AppHeader } from '@/components/layout/app-header';
import { MobileNav } from '@/components/layout/mobile-nav';
import { KpiStrip } from '@/components/home/kpi-strip';
import { TopPicks } from '@/components/home/top-picks';
import { WelcomeIntro } from '@/components/onboarding/welcome-flow';

// Code-split: these are only needed once the pilot opens the Calendar tab,
// the AI chat, the Bid Builder tab, or the upload dialog's Data Overview tab —
// no reason to ship them in the initial bundle everyone downloads just to see
// the pairing table.
const PairingChat = lazy(() =>
  import('@/components/pairing-chat').then(m => ({ default: m.PairingChat }))
);
const CalendarView = lazy(() =>
  import('@/components/calendar-view').then(m => ({ default: m.CalendarView }))
);
const ReasonsReportUpload = lazy(() =>
  import('@/components/reasons-report-upload').then(m => ({
    default: m.ReasonsReportUpload,
  }))
);
const DataManagementPanel = lazy(() =>
  import('@/components/data-management-panel').then(m => ({
    default: m.DataManagementPanel,
  }))
);
const BidBuilder = lazy(() =>
  import('@/components/bid-builder').then(m => ({ default: m.BidBuilder }))
);
const TrendsPanel = lazy(() =>
  import('@/components/trends-panel').then(m => ({ default: m.TrendsPanel }))
);
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cacheKeyForPairings,
  hasFullPairingsCache,
  loadFullPairingsCache,
  purgeUserCache,
  getCacheInfo,
} from '@/lib/offlineCache';
import { api } from '@/lib/api';
import { maxLayoverMinutes } from '@/lib/layover';
import { detectConflicts, type ConflictInfo } from '@/lib/conflictDetection';
import { pairingConflictsWithDaysOff } from '@/lib/pairingDates';
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
import { toast } from '@/hooks/use-toast';
import { useTheme } from 'next-themes';
interface SearchFilters {
  [key: string]: string | number | Date[] | string[] | undefined;
  search?: string;
  rotationNumber?: string;
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
  preferredDaysOff?: Date[];
  layoverLocations?: string[];
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
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

// Stable reference for useQuery's `data: x = []` destructuring default —
// without this, a new [] literal is created every render while the query is
// unresolved, which (combined with an effect keyed on that value) triggers
// React's "Maximum update depth exceeded" infinite-loop warning.
const EMPTY_ARRAY: any[] = [];

export default function Dashboard() {
  const { theme, setTheme } = useTheme();
  const [filters, setFilters] = useState<SearchFilters>({});
  const filtersRef = useRef<SearchFilters>({});
  const [debouncedFilters, setDebouncedFilters] = useState<SearchFilters>({});
  const [activeFilters, setActiveFilters] = useState<
    Array<{ key: string; label: string; value: any }>
  >([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showFilters, setShowFilters] = useState(false);
  const [showQuickStats, setShowQuickStats] = useState(false);
  const [hideConflicts, setHideConflicts] = useState(false);
  const [filterResetKey, setFilterResetKey] = useState(0);
  const [conflictMap, setConflictMap] = useState<Map<number, ConflictInfo>>(new Map());

  const queryClient = useQueryClient();

  // Ref to track the single upload-status poller for cleanup
  const uploadPollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Track processing bid package for persistent indicator
  const [processingBidPackage, setProcessingBidPackage] = useState<{id: number; name: string} | null>(null);

  // Auto-expand the mobile Quick Stats card while a package is processing —
  // it was collapsed by default, so a pilot uploading on mobile could miss
  // the progress indicator entirely unless they happened to tap "Show".
  useEffect(() => {
    if (processingBidPackage) {
      setShowQuickStats(true);
    }
  }, [processingBidPackage]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (uploadPollTimeoutRef.current) clearTimeout(uploadPollTimeoutRef.current);
    };
  }, []);

  // Single consolidated mechanism for tracking upload/parse completion —
  // there used to be three: an SSE stream (never worked in production,
  // since the server parses synchronously within the /api/upload request
  // so there's no separate process left running to emit progress from), a
  // dead unused interval poller, and this recursive poller with no unmount
  // cleanup. By the time /api/upload resolves, parsing has already finished
  // (it's awaited server-side), so this poller is mostly a defensive
  // fallback for the rare case the response is lost after the DB write.
  const pollBidPackageStatus = useCallback(
    (bidPackageId: number, attempt = 0) => {
      const maxAttempts = 60; // 60s at 1s intervals
      fetch(`/api/bid-packages/${bidPackageId}`)
        .then(res => (res.ok ? res.json() : null))
        .then(pkg => {
          if (!pkg) {
            throw new Error('status check failed');
          }

          if (pkg.status === 'processing') {
            if (pkg.month && pkg.year) {
              setProcessingBidPackage({ id: pkg.id, name: `${pkg.month} ${pkg.year}` });
            }
            if (attempt < maxAttempts) {
              uploadPollTimeoutRef.current = setTimeout(
                () => pollBidPackageStatus(bidPackageId, attempt + 1),
                1000
              );
            } else {
              setProcessingBidPackage(null);
              toast({
                title: 'Processing timeout',
                description: 'Processing is taking longer than expected. Please refresh the page.',
                variant: 'destructive',
              });
            }
            return;
          }

          // Terminal state (completed or failed)
          const actualName = pkg.month && pkg.year ? `${pkg.month} ${pkg.year}` : 'Bid Package';
          setProcessingBidPackage(null);

          queryClient.invalidateQueries({ queryKey: ['bidPackages'] });
          queryClient.invalidateQueries({ queryKey: ['data-health'] });
          queryClient.invalidateQueries({ queryKey: ['reasons-reports'] });
          queryClient.invalidateQueries({
            predicate: query => {
              const key = query.queryKey[0];
              return (
                key === 'pairings' ||
                key === 'initial-pairings' ||
                key === '/api/pairings' ||
                key === '/api/pairings/search' ||
                key === '/api/bid-packages' ||
                key === 'bid-package-stats'
              );
            },
          });

          toast({
            title: pkg.status === 'completed' ? '✓ Processing Complete' : '✗ Processing Failed',
            description:
              pkg.status === 'completed'
                ? `${actualName} is ready!`
                : `Failed to process ${actualName}. Please try again.`,
            variant: pkg.status === 'completed' ? 'default' : 'destructive',
            duration: 8000,
          });

          if (pkg.status === 'completed') {
            setSelectedBidPackageId(pkg.id);
          }
        })
        .catch(() => {
          if (attempt < maxAttempts) {
            uploadPollTimeoutRef.current = setTimeout(
              () => pollBidPackageStatus(bidPackageId, attempt + 1),
              1000
            );
          } else {
            setProcessingBidPackage(null);
          }
        });
    },
    [queryClient, toast]
  );

  // Enhanced debouncing with request deduplication
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters);
    }, 500); // Increased to 500ms for better deduplication

    return () => clearTimeout(timer);
  }, [filters]);
  const [name, setName] = useState(() => {
    return localStorage.getItem('name') || '';
  });
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
  const [position, setPosition] = useState(() => {
    return localStorage.getItem('position') || '';
  });

  // currentUser is the last-synced profile snapshot — set only by an
  // explicit "Save Profile" or "Link Device" action, never by in-progress
  // typing in the profile modal. This is what the rest of the app (favorites,
  // calendar, pairing queries) treats as "who the pilot is," decoupled from
  // whatever's currently in the form inputs.
  type CurrentUser = {
    id: number;
    name?: string;
    seniorityNumber: number;
    seniorityPercentile?: number;
    base: string;
    aircraft: string;
  };
  const [currentUser, setCurrentUser] = useState<CurrentUser | undefined>(() => {
    const savedId = localStorage.getItem('userId');
    if (!savedId) return undefined;
    const savedSeniorityNumber = localStorage.getItem('seniorityNumber');
    if (!savedSeniorityNumber) return undefined;
    const savedPercentile = localStorage.getItem('seniorityPercentile');
    return {
      id: parseInt(savedId),
      name: localStorage.getItem('name') || undefined,
      seniorityNumber: parseInt(savedSeniorityNumber),
      seniorityPercentile: savedPercentile ? parseFloat(savedPercentile) : undefined,
      base: localStorage.getItem('base') || '',
      aircraft: localStorage.getItem('aircraft') || '',
    };
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
      localStorage.setItem('name', name);
      localStorage.setItem('seniorityNumber', seniorityNumber);
      localStorage.setItem('seniorityPercentile', seniorityPercentile);
      localStorage.setItem('base', base);
      localStorage.setItem('aircraft', aircraft);
      localStorage.setItem('position', position);
    }
  }, [name, seniorityNumber, seniorityPercentile, base, aircraft, position, hasInitialized]);

  // Applies a profile returned by the server (from Save Profile or Link
  // Device) to both the form inputs and the synced currentUser snapshot.
  const applyProfile = useCallback((user: any) => {
    setCurrentUser({
      id: user.id,
      name: user.name || undefined,
      seniorityNumber: user.seniorityNumber,
      seniorityPercentile: user.seniorityPercentile ?? undefined,
      base: user.base,
      aircraft: user.aircraft,
    });
    setName(user.name || '');
    setSeniorityNumber(String(user.seniorityNumber));
    setSeniorityPercentile(
      user.seniorityPercentile !== null && user.seniorityPercentile !== undefined
        ? String(user.seniorityPercentile)
        : ''
    );
    setBase(user.base);
    setAircraft(user.aircraft);
    localStorage.setItem('userId', String(user.id));
  }, []);

  // "Link this device" (sync PIN entry on a fresh device) state
  const [linkPin, setLinkPin] = useState('');
  const [isLinkingDevice, setIsLinkingDevice] = useState(false);

  // Sync PIN settings state (for an already-linked device to set/change it)
  const [syncPinDraft, setSyncPinDraft] = useState('');
  const [isSavingPin, setIsSavingPin] = useState(false);

  const [selectedPairing, setSelectedPairing] = useState<any>(null);
  const [sortColumn, setSortColumn] = useState<string | null>('holdProbability');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  // First-run welcome step inside the profile dialog (presentation only —
  // the dialog's open/close gating below is untouched).
  const [welcomeIntroDone, setWelcomeIntroDone] = useState(false);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [showMobileAI, setShowMobileAI] = useState(false);

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


  const { data: bidPackages = EMPTY_ARRAY, refetch: refetchBidPackages } = useQuery({
    queryKey: ['bidPackages'],
    queryFn: api.getBidPackages,
    staleTime: 15 * 60 * 1000, // Increased cache time to 15 minutes
    gcTime: 30 * 60 * 1000, // Keep in memory for 30 minutes
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Explicit pilot choice from the bid-package selector. Persisted so the
  // choice survives a reload instead of silently reverting to "newest."
  const [selectedBidPackageId, setSelectedBidPackageId] = useState<number | null>(() => {
    const saved = localStorage.getItem('selectedBidPackageId');
    return saved ? parseInt(saved) : null;
  });

  useEffect(() => {
    if (selectedBidPackageId !== null && selectedBidPackageId !== undefined) {
      localStorage.setItem('selectedBidPackageId', String(selectedBidPackageId));
    }
  }, [selectedBidPackageId]);

  // Find the active bid package: the pilot's explicit selection if it still
  // exists, otherwise fall back to auto-picking (prefer completed, then most
  // recent by uploadedAt) — previously there was no way to view anything
  // other than whichever package happened to be newest.
  const latestBidPackage = React.useMemo(() => {
    if (!bidPackages || bidPackages.length === 0) {
      return null;
    }

    if (selectedBidPackageId !== null && selectedBidPackageId !== undefined) {
      const selected = (bidPackages as any[]).find(
        pkg => pkg.id === selectedBidPackageId
      );
      if (selected) {
        return selected;
      }
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
  }, [bidPackages, selectedBidPackageId]);

  const bidPackageId = latestBidPackage?.id; // Assuming you need this ID for other queries
  // Check if we have any completed bid packages
  const hasCompletedBidPackages = bidPackages.some(
    (pkg: any) => pkg.status === 'completed'
  );

  // Fetch bid package stats for percentile-based ratio calculations
  const { data: bidPackageStats } = useQuery({
    queryKey: ['bid-package-stats', bidPackageId || null],
    queryFn: async () => {
      if (!bidPackageId) {
        return null;
      }
      const response = await fetch(`/api/bid-packages/${bidPackageId}/stats`);
      if (!response.ok) {
        return null;
      }
      return response.json();
    },
    enabled: !!bidPackageId,
    staleTime: 5 * 60 * 1000,
  });

  // Removed redundant initial query to prevent duplicate API calls

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
    isError: isPairingsError,
    refetch: refetchPairings,
  } = useQuery({
    queryKey: [
      'pairings',
      bidPackageId,
      debouncedFilters,
      seniorityPercentile,
      sortColumn,
      sortDirection,
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
          ...debouncedFilters,
        },
        currentUser?.seniorityNumber || currentUser?.id
      ),
    enabled: !!bidPackageId && latestBidPackage?.status === 'completed',
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
      if (!bidPackageId || latestBidPackage?.status !== 'completed') {
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
      let needsFilteredRefetch = false;
      const MINIMUM_EXPECTED_PAIRINGS = 400; // Reasonable minimum for a full bid package

      if (hasFull) {
        // Load existing filtered cache
        console.log('Dashboard: Loading existing filtered cache');
        full = (await loadFullPairingsCache<any[]>(cacheKey)) ?? null;
        console.log('Dashboard: Loaded filtered cache, length:', full?.length || 0);

        // Check if any filters are active (excluding bidPackageId which is always present)
        const hasActiveFilters = Object.keys(debouncedFilters).some(
          key => key !== 'bidPackageId' && debouncedFilters[key] !== undefined && debouncedFilters[key] !== ''
        );

        // Validate filtered cache - it should have at least 400 pairings for a full bid package
        // Only validate size when NO filters are active (to detect incomplete uploads)
        // When filters are active, smaller result sets are expected and valid
        const filteredLength = full?.length || 0;
        if (!hasActiveFilters && filteredLength > 0 && filteredLength < MINIMUM_EXPECTED_PAIRINGS) {
          console.warn(
            `Dashboard: Filtered cache too small (${filteredLength} < ${MINIMUM_EXPECTED_PAIRINGS}), likely incomplete. Will re-fetch.`
          );
          needsFilteredRefetch = true;
          full = null; // Don't use the stale cache
          // DON'T call setFullLocal - keep the UI empty to avoid showing partial data
        } else {
          setFullLocal(full || null);
          // Hide status indicator after 3 seconds when cache already exists
          setTimeout(() => setShowInitialStatus(false), 3000);
        }
      } else {
        needsFilteredRefetch = true;
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

        if (unfilteredLength === 0 ||
            (unfilteredLength > 0 && unfilteredLength < filteredLength) ||
            unfilteredLength < MINIMUM_EXPECTED_PAIRINGS) {
          console.warn(
            `Dashboard: Invalid unfiltered cache detected (length: ${unfilteredLength}, filtered: ${filteredLength}, min expected: ${MINIMUM_EXPECTED_PAIRINGS}). Will re-fetch.`
          );
          needsUnfilteredRefetch = true;
          // DON'T call setUnfilteredLocal - avoid showing partial data
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

      if ((needsFilteredRefetch || !hasFull) && navigator.onLine) {
        // Prefetch full dataset (either missing or invalid/incomplete)
        try {
          setIsPrefetching(true);
          console.log('Dashboard: Prefetching filtered cache', needsFilteredRefetch ? '(forced due to incomplete cache)' : '(cache missing)');
          await api.prefetchAllPairings(
            {
              bidPackageId,
              ...debouncedFilters,
            } as any,
            userId,
            { force: true } // Force refetch to bypass any stale cache
          );

          // Re-check and load after prefetch
          const newHasFull = await hasFullPairingsCache(cacheKey);
          setIsFullCacheReady(newHasFull);

          if (newHasFull) {
            const full = await loadFullPairingsCache<any[]>(cacheKey);
            console.log('Dashboard: Loaded fresh filtered cache after prefetch, length:', full?.length || 0);
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
    latestBidPackage?.status,
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

  // Extract pairings from the response, with fallback to preloaded data
  // Store full local cache data
  const [fullLocal, setFullLocal] = useState<any[] | null>(null);
  // Store unfiltered cache for sorting
  const [unfilteredLocal, setUnfilteredLocal] = useState<any[] | null>(null);

  // Use pairings from response
  const pairings = pairingsResponse?.pairings || [];

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

      // Calculate averages by pairing days (1-5 days)
      const avgByDays: { [key: number]: { credit: number; block: number } } = {};
      for (let days = 1; days <= 5; days++) {
        const dayPairings = fullLocal.filter((p: any) => p.pairingDays === days);
        if (dayPairings.length > 0) {
          const dayCredit = dayPairings.reduce((sum, p) => sum + parseHours(p.creditHours), 0);
          const dayBlock = dayPairings.reduce((sum, p) => sum + parseHours(p.blockHours), 0);
          avgByDays[days] = {
            credit: dayCredit / dayPairings.length,
            block: dayBlock / dayPairings.length,
          };
        }
      }

      return {
        highCredit,
        likelyToHold,
        // ratioBreakdown removed - let StatsPanel calculate it with percentile-based logic
        avgByDays,
      };
    }

    // Fall back to server statistics when not using full cache
    // Remove ratioBreakdown from server stats to let StatsPanel calculate with percentiles
    const serverStats = pairingsResponse?.statistics as any;
    if (serverStats) {
      const { ratioBreakdown, ...rest } = serverStats;
      return rest;
    }
    return serverStats;
  }, [isFullCacheReady, fullLocal, pairingsResponse?.statistics]);

  // Debug logs removed after verification

  // Query for calendar events to detect conflicts
  const { data: calendarEventsData = EMPTY_ARRAY } = useQuery({
    queryKey: ['calendarEvents', currentUser?.id],
    queryFn: async () => {
      if (!currentUser) {
        return [];
      }
      try {
        const response = await fetch(`/api/calendar/${currentUser.id}`);
        if (!response.ok) {
          throw new Error('Failed to fetch calendar events');
        }
        return response.json();
      } catch (error) {
        console.error('Error fetching calendar events:', error);
        return [];
      }
    },
    enabled: !!currentUser,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });


  // Query for user's favorites with enhanced caching
  const { data: favorites = EMPTY_ARRAY, refetch: refetchFavorites } = useQuery({
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
  };

  // Shared comparator so any pairing list (main table, favorites) sorts the
  // same way when the pilot clicks a column header.
  const comparePairings = useCallback(
    (a: any, b: any, column: string | null, direction: 'asc' | 'desc') => {
      let aVal: any, bVal: any;

      switch (column) {
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
          const parseTimeTafb = (tafb: string) => {
            if (!tafb) return 0;
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
        case 'maxLayover':
          aVal = maxLayoverMinutes(a);
          bVal = maxLayoverMinutes(b);
          break;
        default:
          aVal = a.pairingNumber || '';
          bVal = b.pairingNumber || '';
      }

      if (direction === 'asc') {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      } else {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      }
    },
    []
  );

  // The favorites list is a separate fetch from the main pairing table, so
  // clicking a sort header while on the Favorites tab previously changed
  // global sort state without visibly re-sorting anything on screen.
  const sortedFavorites = useMemo(() => {
    return [...favorites].sort((a, b) =>
      comparePairings(a, b, sortColumn, sortDirection)
    );
  }, [favorites, sortColumn, sortDirection, comparePairings]);

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

    const mergedAfter: any = { ...filtersRef.current, ...processedFilters };
    // drop cleared keys so they don't persist silently
    Object.keys(mergedAfter).forEach(k => {
      if (
        mergedAfter[k] === undefined ||
        mergedAfter[k] === null ||
        mergedAfter[k] === ''
      ) {
        delete mergedAfter[k];
      }
    });
    filtersRef.current = mergedAfter;
    setFilters(mergedAfter);

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
          case 'preferredDaysOff': {
            const count = Array.isArray(value) ? value.length : 0;
            if (count === 0) {
              return;
            }
            label = `Days Off: ${count} selected`;
            break;
          }
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
          case 'rotationNumber':
            label = `Rotation #: ${value}`;
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
    filtersRef.current = {};
    setFilters({});
    setActiveFilters([]);
    setHideConflicts(false);
    // SmartFilterSystem tracks its own local state for Days Off / Layover
    // selections (needed for its "N selected" buttons). Bumping this key
    // remounts it with fresh state so those buttons don't keep showing a
    // stale selection count after the query itself has been cleared.
    setFilterResetKey(k => k + 1);
  };

  const handleTripLengthFilter = (days: number) => {
    setFilters(prev => ({
      ...prev,
      pairingDays: days,
    }));
    setActiveFilters(prev => [
      ...prev.filter(f => f.key !== 'pairingDays'),
      { key: 'pairingDays', label: `Trip Length: ${days}-day`, value: days },
    ]);
  };

  // Client-side sorting from full cache when available
  const sortedPairings = React.useMemo(() => {
    // When sorting is active OR preferredDaysOff filter is set, use unfiltered cache and apply filters client-side
    const hasPreferredDaysOff = filters.preferredDaysOff && filters.preferredDaysOff.length > 0;
    const useUnfiltered = (sortColumn || hasPreferredDaysOff) && unfilteredLocal && unfilteredLocal.length > 0;

    if (!useUnfiltered && (!isFullCacheReady || !fullLocal || fullLocal.length === 0)) {
      return pairings;
    }

    const sourceData = useUnfiltered ? unfilteredLocal : fullLocal;
    if (!sourceData) {
      return pairings;
    }
    console.log(`Sorting ${sourceData.length} pairings from ${useUnfiltered ? 'unfiltered' : 'filtered'} cache`);

    // Apply filters client-side when using unfiltered cache OR when preferredDaysOff is set
    let filtered = [...sourceData];
    if ((useUnfiltered || hasPreferredDaysOff) && filters && Object.keys(filters).length > 0) {
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

        // Rotation number filter
        if (filters.rotationNumber) {
          const rotationLower = filters.rotationNumber.toLowerCase();
          const pairingNum = pairing.pairingNumber?.toString().toLowerCase() || '';
          if (!pairingNum.includes(rotationLower)) {
            return false;
          }
        }

        // Preferred Days Off filter - exclude pairings with flights on these dates
        if (filters.preferredDaysOff && filters.preferredDaysOff.length > 0) {
          const year = latestBidPackage?.year || new Date().getFullYear();

          // Try to extract better effectiveDates from fullTextBlock if available
          let effectiveDates = pairing.effectiveDates || '';
          let pairingDays = pairing.pairingDays || 1;

          // If fullTextBlock exists, try to extract the full EFFECTIVE date range
          if (pairing.fullTextBlock) {
            // Multi-pass parsing to capture all exception types
            let dateRange = '';
            let dayOfWeekExceptions = '';
            let specificDateExceptions = '';

            // Extract the base date range
            const effectiveMatch = pairing.fullTextBlock.match(/EFFECTIVE\s+([A-Z]{3}\d{1,2}(?:-[A-Z]{3}\.?\s*\d{1,2})?)/i);
            if (effectiveMatch) {
              dateRange = effectiveMatch[1].trim();
            }

            // Extract day-of-week exceptions (can appear as "EXCPT MO SA SU" before EFFECTIVE)
            const dayOfWeekMatch = pairing.fullTextBlock.match(/(?:EXCPT|EXCEPT)\s+([A-Z]{2}(?:\s+[A-Z]{2})*)\s+EFFECTIVE/i);
            if (dayOfWeekMatch) {
              dayOfWeekExceptions = dayOfWeekMatch[1].trim();
            }

            // Extract specific date exceptions (can appear anywhere in fullTextBlock as "EXCEPT OCT 16 OCT 21")
            // Look for EXCEPT followed by month-day patterns
            const specificDateMatch = pairing.fullTextBlock.match(/EXCEPT\s+((?:[A-Z]{3}\s+\d{1,2}\s*)+)/i);
            if (specificDateMatch) {
              specificDateExceptions = specificDateMatch[1].trim();
            }

            // Combine all parts
            if (dateRange) {
              effectiveDates = dateRange;
              if (dayOfWeekExceptions || specificDateExceptions) {
                const allExceptions = [dayOfWeekExceptions, specificDateExceptions]
                  .filter(Boolean)
                  .join(' ');
                effectiveDates = `${dateRange} EXCEPT ${allExceptions}`;
              }
            }
          }

          if (effectiveDates && pairingDays) {
            const hasConflict = pairingConflictsWithDaysOff(
              effectiveDates,
              year,
              pairingDays,
              filters.preferredDaysOff
            );

            if (hasConflict) {
              return false;
            }
          }
        }

        return true;
      });
    }

    const sorted = filtered;

    // Apply sorting only - filters are already applied when the cache was created
    sorted.sort((a, b) => comparePairings(a, b, sortColumn, sortDirection));

    console.log(`After filtering and sorting: ${sorted.length} pairings`);
    return sorted;
  }, [fullLocal, unfilteredLocal, isFullCacheReady, filters, sortColumn, sortDirection, pairings, comparePairings]);

  // Use sorted pairings if available, otherwise use regular pairings
  // BUT: if layoverLocations filter is active, bypass cache and use API response directly
  const displayPairings = React.useMemo(() => {
    const hasLayoverFilter = debouncedFilters.layoverLocations && 
                             Array.isArray(debouncedFilters.layoverLocations) && 
                             debouncedFilters.layoverLocations.length > 0;
    
    // Always use API response if layover filter is active (bypass cache)
    if (hasLayoverFilter) {
      // Apply Days Off filter client-side when using API response directly
      let result = [...pairings];
      
      if (debouncedFilters.preferredDaysOff && debouncedFilters.preferredDaysOff.length > 0 && latestBidPackage) {
        const year = latestBidPackage.year || new Date().getFullYear();
        result = result.filter(pairing => {
          let effectiveDates = pairing.effectiveDates || '';
          let pairingDays = pairing.pairingDays || 1;
          
          // Try to extract better effectiveDates from fullTextBlock if available
          if (pairing.fullTextBlock) {
            const effectiveMatch = pairing.fullTextBlock.match(/EFFECTIVE\s+([A-Z]{3}\s*\d{1,2}\s*[-–]\s*[A-Z]{3}\s*\d{1,2})/i);
            if (effectiveMatch) {
              effectiveDates = effectiveMatch[1].trim();
            }
          }
          
          if (effectiveDates && pairingDays) {
            const hasConflict = pairingConflictsWithDaysOff(
              effectiveDates,
              year,
              pairingDays,
              debouncedFilters.preferredDaysOff || []
            );
            if (hasConflict) {
              return false;
            }
          }
          return true;
        });
      }
      
      return result;
    }
    
    // Otherwise use cached data if available. Trust sortedPairings even when
    // it's empty — an empty result can legitimately mean "filters (e.g.
    // Preferred Days Off) excluded everything," and falling back to the raw
    // unfiltered `pairings` in that case would show pairings the pilot asked
    // to exclude.
    if (isFullCacheReady) {
      return sortedPairings;
    }
    return pairings;
  }, [isFullCacheReady, sortedPairings, pairings, debouncedFilters, latestBidPackage]);

  // Filter out conflict pairings if hideConflicts is enabled
  const filteredDisplayPairings = React.useMemo(() => {
    if (!hideConflicts) {
      return displayPairings;
    }
    return displayPairings.filter(p => !conflictMap.has(p.id));
  }, [displayPairings, hideConflicts, conflictMap]);

  // Calculate conflicts when pairings or calendar events change
  React.useEffect(() => {
    if (displayPairings && displayPairings.length > 0 && calendarEventsData.length > 0 && latestBidPackage) {
      const conflicts = detectConflicts(displayPairings, calendarEventsData, latestBidPackage.year);
      setConflictMap(conflicts);
    } else {
      setConflictMap(new Map());
    }
  }, [displayPairings, calendarEventsData, latestBidPackage]);

  const openAIAssistant = useCallback(() => {
    // On mobile: show full-screen AI view; on desktop: open the modal.
    if (window.innerWidth < 1024) {
      setShowMobileAI(true);
    } else {
      setShowAIAssistant(true);
    }
  }, []);

  return (
    <SidebarProvider>
      {/* Processing Banner - Shows during bid package processing */}
      {processingBidPackage && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-info px-4 py-3 text-info-foreground shadow-lg">
          <div className="flex items-center justify-center gap-3">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <span className="font-medium">
              Processing {processingBidPackage.name}...
            </span>
            <span className="hidden text-sm opacity-80 sm:inline">
              This may take a minute. You can continue using the app.
            </span>
          </div>
        </div>
      )}

      <AppSidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        currentUser={currentUser}
        seniorityPercentile={seniorityPercentile}
        bidPackages={bidPackages as any[]}
        selectedPackage={latestBidPackage}
        onSelectPackage={setSelectedBidPackageId}
        onOpenProfile={() => setShowProfileModal(true)}
      />

      <SidebarInset
        className={`h-svh min-w-0 overflow-hidden ${processingBidPackage ? 'pt-12' : ''}`}
      >
        <AppHeader
          activeTab={activeTab}
          currentUser={currentUser}
          seniorityPercentile={seniorityPercentile}
          onUpload={() => setShowUploadModal(true)}
          onOpenAI={openAIAssistant}
        />

        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="h-full p-3 pb-20 sm:p-6 lg:pb-6">
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="h-full flex flex-col"
            >
              {/* Navigation now lives in the sidebar + mobile bottom nav; the
                  TabsList is kept for screen readers / keyboard tab semantics. */}
              <TabsList className="sr-only">
                <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                <TabsTrigger value="favorites">Favorites</TabsTrigger>
                <TabsTrigger value="calendar">Calendar</TabsTrigger>
                <TabsTrigger value="bidBuilder">Bid Builder</TabsTrigger>
                <TabsTrigger value="trends">Trends</TabsTrigger>
              </TabsList>

              <TabsContent value="dashboard" className="flex-1 overflow-auto">
              <div className="space-y-4">
                {/* Insight-first Home: KPIs and the optimizer's picks come
                    before the full table (insight → detail reading order). */}
                {bidPackageId && (
                  <>
                    <KpiStrip
                      pairings={displayPairings || []}
                      bidPackage={latestBidPackage}
                      seniorityPercentile={seniorityPercentile}
                    />
                    <TopPicks
                      bidPackageId={bidPackageId}
                      userId={currentUser?.id}
                      pairings={pairings || []}
                      onPairingClick={handlePairingClick}
                      onOpenBidBuilder={() => setActiveTab('bidBuilder')}
                    />
                    <Card>
                      <CardHeader className="py-3">
                        <CardTitle className="flex items-center justify-between text-base font-medium">
                          <div className="flex items-center gap-2">
                            <BarChart2 className="h-4 w-4" />
                            Detailed stats
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
                            statistics={effectiveStatistics}
                            bidPackageStats={bidPackageStats}
                            onTripLengthFilter={handleTripLengthFilter}
                          />
                        </CardContent>
                      )}
                    </Card>
                  </>
                )}

                {/* All pairings: filters + table */}
                <div className="flex flex-col bg-card">
                  <div className="w-full bg-card border-b p-4">
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold text-secondary-foreground">
                        Filters
                      </h3>
                      <SmartFilterSystem
                        key={filterResetKey}
                        pairings={pairings || []}
                        onFiltersChange={handleFiltersChange}
                        activeFilters={activeFilters}
                        onClearFilters={clearAllFilters}
                        bidPackage={latestBidPackage}
                        bidPackageId={bidPackageId}
                      />
                    </div>
                  </div>

                  {/* Pairing Results Section — fixed viewport-height panel so
                      the table keeps its own scroll while the page scrolls
                      the insight sections above it. */}
                  <div className="h-[75vh] min-h-[420px] p-4 lg:p-0">
                    <Card className="h-full flex flex-col">
                      <CardHeader className="flex flex-col gap-3 space-y-0 pb-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                          <CardTitle className="text-lg font-medium flex items-center gap-2">
                            <Search className="h-5 w-5 text-muted-foreground" />
                            All pairings
                          </CardTitle>
                          {bidPackages.length > 1 ? (
                            <Select
                              value={latestBidPackage ? String(latestBidPackage.id) : undefined}
                              onValueChange={value => setSelectedBidPackageId(parseInt(value))}
                            >
                              <SelectTrigger
                                className="h-8 w-auto min-w-[180px] text-sm"
                                data-testid="select-bid-package"
                              >
                                <SelectValue placeholder="Select bid package" />
                              </SelectTrigger>
                              <SelectContent>
                                {(bidPackages as any[])
                                  .slice()
                                  .sort(
                                    (a, b) =>
                                      new Date(b.uploadedAt).getTime() -
                                      new Date(a.uploadedAt).getTime()
                                  )
                                  .map(pkg => (
                                    <SelectItem key={pkg.id} value={String(pkg.id)}>
                                      {pkg.month} {pkg.year} · {pkg.base} {pkg.aircraft}
                                      {pkg.status !== 'completed' ? ` (${pkg.status})` : ''}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-sm text-gray-500">
                              {latestBidPackage
                                ? `${latestBidPackage.month} ${latestBidPackage.year}`
                                : ''}
                            </span>
                          )}
                          <span className="text-sm text-gray-500">
                            {filteredDisplayPairings.length} pairings
                            {hideConflicts && conflictMap.size > 0 ? ` (${conflictMap.size} hidden)` : ''}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Only show cache status when it's actually useful */}
                          {(isPrefetching ||
                            !isFullCacheReady ||
                            showInitialStatus) && (
                            <>
                              {isPrefetching ? (
                                <span className="text-xs px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-700 flex items-center">
                                  <RefreshCw className="h-3 w-3 mr-1 animate-spin" />{' '}
                                  Preparing offline cache...
                                </span>
                              ) : isFullCacheReady ? (
                                <span className="text-xs px-2 py-1 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-700">
                                  Available offline: Yes
                                </span>
                              ) : (
                                <span
                                  className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground border border-border cursor-pointer"
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
                          <Button
                            variant="link"
                            className="h-auto p-0 text-blue-600 hover:text-blue-700 font-medium"
                          >
                            Export CSV
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="flex-1 overflow-auto p-0">
                        {isUpdatingSeniority && (
                          <div className="absolute inset-0 bg-card bg-opacity-75 dark:bg-opacity-75 flex items-center justify-center z-10 rounded-lg">
                            <div className="flex items-center space-x-2 text-orange-600 dark:text-orange-400">
                              <RefreshCw className="h-6 w-6 animate-spin" />
                              <span className="text-lg font-medium">
                                Updating hold probabilities...
                              </span>
                            </div>
                          </div>
                        )}
                        {conflictMap.size > 0 && (
                          <div className="space-y-3 p-4">
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={hideConflicts}
                                  onChange={(e) => setHideConflicts(e.target.checked)}
                                  className="rounded border border-gray-300 dark:border-gray-600"
                                />
                                <span className="text-secondary-foreground">
                                  Hide conflicts ({conflictMap.size})
                                </span>
                              </label>
                            </div>
                          </div>
                        )}
                        <PairingTable
                          pairings={filteredDisplayPairings || []}
                          onSort={handleSort}
                          sortColumn={sortColumn || ''}
                          sortDirection={sortDirection}
                          onPairingClick={handlePairingClick}
                          conflicts={conflictMap}
                          showHeader={false}
                          isLoading={isLoadingPairings}
                          isError={isPairingsError}
                          onRetry={() => refetchPairings()}
                          hasActiveFilters={activeFilters.length > 0 || hideConflicts}
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
                      <Star className="h-5 w-5 text-yellow-500 dark:text-yellow-400" />
                      Your Favorites
                    </CardTitle>
                    <span className="text-sm text-muted-foreground">
                      {favorites.length} favorite pairings
                    </span>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-auto p-0">
                    {favorites.length > 0 ? (
                      <PairingTable
                        pairings={sortedFavorites}
                        onSort={handleSort}
                        sortColumn={sortColumn || ''}
                        sortDirection={sortDirection}
                        onPairingClick={handlePairingClick}
                        showDeleteButton={true}
                        onDeleteFavorite={handleDeleteFavorite}
                        showAddToCalendar={true}
                        currentUser={currentUser}
                        bidPackageYear={latestBidPackage?.year}
                        conflicts={conflictMap}
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
                <Suspense
                  fallback={
                    <div className="text-center py-8">
                      <Calendar className="mx-auto h-16 w-16 text-gray-300" />
                      <p className="mt-2 text-sm text-gray-500">Loading calendar…</p>
                    </div>
                  }
                >
                  <CalendarView
                    userId={currentUser.id}
                    bidPackageId={bidPackageId}
                  />
                </Suspense>
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

            <TabsContent
              value="bidBuilder"
              className="flex-1 overflow-auto p-1"
            >
              <Suspense fallback={<div className="text-sm text-gray-500">Loading…</div>}>
                <BidBuilder
                  bidPackageId={bidPackageId}
                  userId={currentUser?.id}
                />
              </Suspense>
            </TabsContent>

            <TabsContent value="trends" className="flex-1 overflow-auto p-1">
              <Suspense fallback={<div className="text-sm text-gray-500">Loading…</div>}>
                <TrendsPanel seniorityPercentile={seniorityPercentile} />
              </Suspense>
            </TabsContent>
          </Tabs>
          </div>
        </div>
      </SidebarInset>

      <MobileNav activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Pairing Modal */}
      {selectedPairing && (
        <PairingModal
          pairingId={selectedPairing.id}
          onClose={() => setSelectedPairing(null)}
          currentUser={currentUser}
        />
      )}

      {/* Upload Modal */}
      <Dialog open={showUploadModal} onOpenChange={setShowUploadModal}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Upload Files</DialogTitle>
            <DialogDescription>
              Upload bid packages or reasons reports to improve predictions
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="upload" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="upload">Upload</TabsTrigger>
              <TabsTrigger value="dataOverview" data-testid="tab-data-overview">Data Overview</TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Bid Package Upload */}
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-secondary-foreground">Bid Package</h3>
                  <FileUpload
                    onUpload={(file, result) => {
                        setShowUploadModal(false);
                        refetchBidPackages();
                        queryClient.invalidateQueries({ queryKey: ['data-health'] });

                        const uploadedBidPackageId = result?.bidPackage?.id;
                        if (uploadedBidPackageId) {
                          setProcessingBidPackage({ id: uploadedBidPackageId, name: 'bid package' });
                          pollBidPackageStatus(uploadedBidPackageId);
                        }
                    }}
                  />
                  <div className="text-xs text-gray-500 flex items-center">
                    <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                    PDF or TXT format
                  </div>
                </div>

                {/* Reasons Report Upload */}
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-secondary-foreground">Reasons Report</h3>
                  <Suspense fallback={<div className="text-sm text-gray-500">Loading…</div>}>
                    <ReasonsReportUpload
                      onUploadSuccess={() => {
                        queryClient.invalidateQueries({ queryKey: ['reasons-reports'] });
                        queryClient.invalidateQueries({ queryKey: ['data-health'] });
                        toast({
                          title: 'Historical data updated',
                          description: 'Hold probabilities will now use this data for predictions.',
                        });
                      }}
                    />
                  </Suspense>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="dataOverview" className="space-y-4">
              <Suspense fallback={<div className="text-sm text-gray-500">Loading…</div>}>
                <DataManagementPanel />
              </Suspense>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* AI Assistant Modal */}
      <Dialog open={showAIAssistant} onOpenChange={setShowAIAssistant}>
        <DialogContent className="h-[80vh] w-[calc(100vw-2rem)] max-w-4xl overflow-hidden p-0 sm:p-6 flex flex-col">
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
          <div className="flex-1 overflow-hidden min-h-0 min-w-0">
            {currentUser && latestBidPackage ? (
              <Suspense
                fallback={
                  <div className="flex items-center justify-center h-full text-gray-500">
                    Loading AI assistant…
                  </div>
                }
              >
                <PairingChat bidPackageId={bidPackageId} userId={currentUser?.id} />
              </Suspense>
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
        <div className="fixed inset-0 z-50 bg-white dark:bg-gray-950 lg:hidden">
          <div className="h-full flex flex-col">
            {/* Minimal header with just close button */}
            <div className="flex-shrink-0 flex items-center justify-between p-3 border-b dark:border-gray-800 bg-card">
              <h1 className="text-base font-medium dark:text-gray-100">AI Assistant</h1>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowMobileAI(false)}
                className="p-1 h-8 w-8"
                aria-label="Close AI Assistant"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Chat content - takes full remaining space */}
            <div className="flex-1 overflow-hidden">
              {currentUser && latestBidPackage ? (
                <Suspense
                  fallback={
                    <div className="flex items-center justify-center h-full text-gray-500">
                      Loading AI assistant…
                    </div>
                  }
                >
                  <PairingChat bidPackageId={bidPackageId} userId={currentUser?.id} compact={true} />
                </Suspense>
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
          if (!open && (!seniorityNumber || !base || !aircraft || !position)) {
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
        <DialogContent className="max-w-md max-h-[90vh] flex flex-col">
          {!currentUser && !seniorityNumber && !welcomeIntroDone ? (
            <>
              <DialogHeader>
                <DialogTitle>Welcome to PBS Optimizer</DialogTitle>
                <DialogDescription className="sr-only">
                  Three steps: set up your profile, upload a bid package, get
                  your bid.
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-y-auto pr-2">
                <WelcomeIntro onGetStarted={() => setWelcomeIntroDone(true)} />
              </div>
            </>
          ) : (
          <>
          <DialogHeader>
            <DialogTitle>Complete Your Profile</DialogTitle>
            <DialogDescription>
              Please fill in your pilot information to continue. All fields marked with * are required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto pr-2 flex-1">
            {!currentUser && (
              <div className="rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950 p-3 space-y-2">
                <div className="text-sm font-medium text-blue-900 dark:text-blue-200">
                  Already set up on another device?
                </div>
                <p className="text-xs text-blue-800 dark:text-blue-300">
                  Enter your sync PIN to load your existing profile, favorites, calendar, and AI chat history instead of starting fresh.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={linkPin}
                    onChange={e => setLinkPin(e.target.value)}
                    placeholder="Sync PIN"
                    className="bg-card"
                  />
                  <Button
                    variant="secondary"
                    disabled={!linkPin || isLinkingDevice}
                    onClick={async () => {
                      setIsLinkingDevice(true);
                      try {
                        const user = await api.linkDevice(linkPin);
                        applyProfile(user);
                        setLinkPin('');
                        toast({
                          title: 'Device Linked',
                          description: 'Your profile has been loaded onto this device.',
                        });
                        setShowProfileModal(false);
                      } catch (error: any) {
                        toast({
                          title: 'Link Failed',
                          description: error?.message || 'That PIN did not match any profile.',
                          variant: 'destructive',
                        });
                      } finally {
                        setIsLinkingDevice(false);
                      }
                    }}
                  >
                    Link Device
                  </Button>
                </div>
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">
                Name
              </label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name (optional)"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">
                Seniority Number <span className="text-red-500">*</span>
              </label>
              <Input
                data-testid="input-seniority-number"
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
                id="profile-base"
                data-testid="select-base"
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
                id="profile-aircraft"
                data-testid="select-aircraft"
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
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">
                Position <span className="text-red-500">*</span>
              </label>
              <select
                id="profile-position"
                data-testid="select-position"
                value={position}
                onChange={e => setPosition(e.target.value)}
                className={`flex h-10 w-full rounded-md border ${!position ? 'border-red-300' : 'border-input'} bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50`}
                required
              >
                <option value="">Select your position</option>
                <option value="A">A - Position A</option>
                <option value="B">B - Position B</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">Position A or B (matches ALV table)</p>
            </div>
            {currentUser && (
              <div className="border-t pt-4 mt-4">
                <div className="text-sm font-medium text-secondary-foreground mb-1">
                  Sync PIN
                </div>
                <p className="text-xs text-gray-500 mb-2">
                  Set a PIN, then enter it on any other device to load this same profile, favorites, calendar, and chat history there.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={syncPinDraft}
                    onChange={e => setSyncPinDraft(e.target.value)}
                    placeholder="Choose a PIN"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!syncPinDraft || isSavingPin}
                    onClick={async () => {
                      setIsSavingPin(true);
                      try {
                        await api.setSyncPin(currentUser.id, syncPinDraft);
                        toast({
                          title: 'Sync PIN Saved',
                          description: 'Use this PIN to link your other devices.',
                        });
                        setSyncPinDraft('');
                      } catch (error: any) {
                        toast({
                          title: 'Error',
                          description: error?.message || 'Failed to save sync PIN.',
                          variant: 'destructive',
                        });
                      } finally {
                        setIsSavingPin(false);
                      }
                    }}
                  >
                    Save PIN
                  </Button>
                </div>
              </div>
            )}
            <div className="border-t pt-4 mt-4">
              <div className="text-sm font-medium text-secondary-foreground mb-3">
                Appearance
              </div>
              <div className="flex gap-2 mb-4">
                <Button
                  variant={theme === 'light' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTheme('light')}
                  className="flex-1"
                >
                  <Sun className="h-4 w-4 mr-2" />
                  Light
                </Button>
                <Button
                  variant={theme === 'dark' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTheme('dark')}
                  className="flex-1"
                >
                  <Moon className="h-4 w-4 mr-2" />
                  Dark
                </Button>
                <Button
                  variant={theme === 'system' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTheme('system')}
                  className="flex-1"
                >
                  <Monitor className="h-4 w-4 mr-2" />
                  System
                </Button>
              </div>
            </div>
            <div className="border-t pt-4 mt-4">
              <div className="text-sm font-medium text-secondary-foreground mb-2">
                Cache Management
              </div>
              <div className="flex gap-2 mb-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      // Delete the entire IndexedDB database
                      await api.clearLocalCache();
                      // Clear React Query cache as well
                      queryClient.clear();
                      toast({
                        title: 'Success',
                        description: 'Cache cleared successfully. Reloading...',
                      });
                      // Reload to get fresh data with new schema
                      setTimeout(() => window.location.reload(), 500);
                    } catch (error) {
                      toast({
                        title: 'Error',
                        description: 'Failed to clear cache',
                        variant: 'destructive',
                      });
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
                data-testid="button-save-profile"
                onClick={async () => {
                  // Validate required fields
                  if (!seniorityNumber || !base || !aircraft || !position) {
                    toast({
                      title: 'Missing Required Fields',
                      description: 'Please fill in Seniority Number, Base, Aircraft, and Position',
                      variant: 'destructive',
                    });
                    return;
                  }

                  try {
                    // Create or update the one canonical user in the database
                    const savedUser = await api.createOrUpdateUser({
                      name: name || undefined,
                      seniorityNumber: parseInt(seniorityNumber),
                      seniorityPercentile: seniorityPercentile
                        ? Math.round(parseFloat(seniorityPercentile))
                        : undefined,
                      base,
                      aircraft,
                    });
                    applyProfile(savedUser);

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
          </>
          )}
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
