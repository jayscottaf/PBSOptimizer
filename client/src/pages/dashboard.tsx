import { printedDurationMinutes } from '@shared/durations';
import { filterPairings } from '@/lib/filter-pairings';
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  Suspense,
  lazy,
} from 'react';
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
// Only mounts once a pairing is clicked — no reason to ship it in the
// initial bundle everyone downloads to see the table.
const PairingModal = lazy(() =>
  import('@/components/pairing-modal').then(m => ({ default: m.PairingModal }))
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
import { purgeUserCache, getCacheInfo } from '@/lib/offlineCache';
import { api } from '@/lib/api';
import { filterFieldMeta, formatBidPeriod } from '@shared/pbsFilterLabels';
import { maxLayoverMinutes } from '@/lib/layover';
import { detectConflicts, type ConflictInfo } from '@/lib/conflictDetection';
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
import type { SearchFilters } from '@/lib/api';

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

  const queryClient = useQueryClient();

  // Ref to track the single upload-status poller for cleanup
  const uploadPollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Track processing bid package for persistent indicator
  const [processingBidPackage, setProcessingBidPackage] = useState<{
    id: number;
    name: string;
  } | null>(null);

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
      if (uploadPollTimeoutRef.current)
        clearTimeout(uploadPollTimeoutRef.current);
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
              setProcessingBidPackage({
                id: pkg.id,
                name: `${pkg.month} ${pkg.year}`,
              });
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
                description:
                  'Processing is taking longer than expected. Please refresh the page.',
                variant: 'destructive',
              });
            }
            return;
          }

          // Terminal state (completed or failed)
          const actualName =
            pkg.month && pkg.year ? `${pkg.month} ${pkg.year}` : 'Bid Package';
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
            title:
              pkg.status === 'completed'
                ? '✓ Processing Complete'
                : '✗ Processing Failed',
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
    updatedAt?: string;
  };
  const [currentUser, setCurrentUser] = useState<CurrentUser | undefined>(
    () => {
      const savedId = localStorage.getItem('userId');
      if (!savedId) return undefined;
      const savedSeniorityNumber = localStorage.getItem('seniorityNumber');
      if (!savedSeniorityNumber) return undefined;
      const savedPercentile = localStorage.getItem('seniorityPercentile');
      return {
        id: parseInt(savedId),
        name: localStorage.getItem('name') || undefined,
        seniorityNumber: parseInt(savedSeniorityNumber),
        seniorityPercentile: savedPercentile
          ? parseFloat(savedPercentile)
          : undefined,
        base: localStorage.getItem('base') || '',
        aircraft: localStorage.getItem('aircraft') || '',
        updatedAt: localStorage.getItem('profileUpdatedAt') || undefined,
      };
    }
  );

  const [historyRevision, setHistoryRevision] = useState(
    () => localStorage.getItem('historyRevision') || '0'
  );
  const probabilityCacheUser = `${currentUser?.id ?? 'guest'}:${seniorityPercentile || '50'}:${currentUser?.updatedAt || ''}:${historyRevision}`;

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
  }, [
    name,
    seniorityNumber,
    seniorityPercentile,
    base,
    aircraft,
    position,
    hasInitialized,
  ]);

  // Applies a profile returned by the server (from Save Profile or Link
  // Device) to both the form inputs and the synced currentUser snapshot.
  const applyProfile = useCallback(
    (user: any) => {
      setCurrentUser({
        id: user.id,
        name: user.name || undefined,
        seniorityNumber: user.seniorityNumber,
        seniorityPercentile: user.seniorityPercentile ?? undefined,
        base: user.base,
        aircraft: user.aircraft,
        updatedAt: user.updatedAt,
      });
      setName(user.name || '');
      setSeniorityNumber(String(user.seniorityNumber));
      setSeniorityPercentile(
        user.seniorityPercentile !== null &&
          user.seniorityPercentile !== undefined
          ? String(user.seniorityPercentile)
          : ''
      );
      setBase(user.base);
      setAircraft(user.aircraft);
      localStorage.setItem('userId', String(user.id));
      localStorage.setItem('profileUpdatedAt', user.updatedAt || '');
      queryClient.invalidateQueries();
    },
    [queryClient]
  );

  // "Link this device" (sync PIN entry on a fresh device) state
  const [linkPin, setLinkPin] = useState('');
  const [isLinkingDevice, setIsLinkingDevice] = useState(false);

  // Sync PIN settings state (for an already-linked device to set/change it)
  const [syncPinDraft, setSyncPinDraft] = useState('');
  const [isSavingPin, setIsSavingPin] = useState(false);

  const [selectedPairing, setSelectedPairing] = useState<any>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(
    'holdProbability'
  );
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

  const { data: bidPackages = EMPTY_ARRAY, refetch: refetchBidPackages } =
    useQuery({
      queryKey: ['bidPackages'],
      queryFn: api.getBidPackages,
      networkMode: 'always', // Invoke the IndexedDB fallback even when offline.
      staleTime: 15 * 60 * 1000, // Increased cache time to 15 minutes
      gcTime: 30 * 60 * 1000, // Keep in memory for 30 minutes
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });

  // Explicit pilot choice from the bid-package selector. Persisted so the
  // choice survives a reload instead of silently reverting to "newest."
  const [selectedBidPackageId, setSelectedBidPackageId] = useState<
    number | null
  >(() => {
    const saved = localStorage.getItem('selectedBidPackageId');
    return saved ? parseInt(saved) : null;
  });

  useEffect(() => {
    if (selectedBidPackageId !== null && selectedBidPackageId !== undefined) {
      localStorage.setItem(
        'selectedBidPackageId',
        String(selectedBidPackageId)
      );
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

  // One complete dataset per package/profile. Filters and sorting are local;
  // query-key isolation prevents an older request replacing a newer selection.
  const {
    data: pairingsResponse,
    isLoading: isLoadingPairings,
    isFetching: isPrefetching,
    isError: isPairingsError,
    refetch: refetchPairings,
  } = useQuery({
    queryKey: [
      'pairings',
      bidPackageId,
      probabilityCacheUser,
      latestBidPackage?.uploadedAt,
    ],
    networkMode: 'always', // Offline fallback lives inside the loader.
    queryFn: () =>
      api.loadPairingDataset(
        bidPackageId!,
        Number(seniorityPercentile || 50),
        probabilityCacheUser,
        String(latestBidPackage?.uploadedAt)
      ),
    enabled:
      hasInitialized &&
      !!bidPackageId &&
      latestBidPackage?.status === 'completed',
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
  const isFullCacheReady = pairingsResponse?.cached ?? false;
  const pairings = pairingsResponse?.pairings ?? EMPTY_ARRAY;
  const fullLocal = pairings;

  // Calculate full dataset statistics when using offline cache
  const effectiveStatistics = React.useMemo(() => {
    if (pairingsResponse) {
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
      const avgByDays: { [key: number]: { credit: number; block: number } } =
        {};
      for (let days = 1; days <= 5; days++) {
        const dayPairings = fullLocal.filter(
          (p: any) => p.pairingDays === days
        );
        if (dayPairings.length > 0) {
          const dayCredit = dayPairings.reduce(
            (sum, p) => sum + parseHours(p.creditHours),
            0
          );
          const dayBlock = dayPairings.reduce(
            (sum, p) => sum + parseHours(p.blockHours),
            0
          );
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

    return undefined;
  }, [fullLocal, pairingsResponse]);

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
  const { data: favorites = EMPTY_ARRAY, refetch: refetchFavorites } = useQuery(
    {
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
    }
  );

  const handleDeleteFavorite = useCallback(
    async (pairingId: number) => {
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
    },
    [currentUser, refetchFavorites]
  );

  // Star toggle in the pairing tables (matches the Favorites empty-state
  // promise that starring any pairing saves it).
  const favoritePairingIds = useMemo(
    () => new Set<number>((favorites as any[]).map(f => f.id)),
    [favorites]
  );

  const handleToggleFavorite = useCallback(
    async (pairing: any) => {
      if (!currentUser) {
        toast({
          title: 'Profile required',
          description: 'Set up your profile to save favorites.',
        });
        return;
      }
      const isFavorited = favoritePairingIds.has(pairing.id);
      try {
        if (isFavorited) {
          await api.removeFavorite(currentUser.id, pairing.id);
        } else {
          await api.addFavorite(currentUser.id, pairing.id);
        }
        refetchFavorites();
        toast({
          title: isFavorited ? 'Removed from favorites' : 'Added to favorites',
          description: `Pairing ${pairing.pairingNumber}`,
        });
      } catch (error: any) {
        toast({
          title: 'Could not update favorites',
          description: error?.message || 'Please try again.',
          variant: 'destructive',
        });
      }
    },
    [currentUser, favoritePairingIds, refetchFavorites]
  );

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

  // These are passed to the memoized PairingTable, so they must keep a
  // stable identity across renders or the memo never holds. The functional
  // setState form keeps the deps empty.
  const handlePairingClick = useCallback((pairing: any) => {
    setSelectedPairing(pairing);
  }, []);

  const handleRetryPairings = useCallback(() => {
    refetchPairings();
  }, [refetchPairings]);

  // Depends on the current sort, so its identity changes when the sort
  // changes — which is fine: the table has to re-render then anyway. What
  // matters is that it stays stable through unrelated Dashboard state.
  const handleSort = useCallback(
    (column: string) => {
      if (column === sortColumn) {
        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
      } else {
        setSortColumn(column);
        setSortDirection('desc');
      }
    },
    [sortColumn, sortDirection]
  );

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
          aVal = printedDurationMinutes(a.tafb) || 0;
          bVal = printedDurationMinutes(b.tafb) || 0;
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
          case 'layoverLocations':
            label = `Layovers In: ${Array.isArray(value) ? value.join(', ') : value}`;
            break;
          case 'excludeLayoverCities':
            label = `No Layovers In: ${Array.isArray(value) ? value.join(', ') : value}`;
            break;
          case 'checkInStations':
            label = `Check-In Station: ${Array.isArray(value) ? value.join(', ') : value}`;
            break;
          case 'excludeCheckInStations':
            label = `No Check-In At: ${Array.isArray(value) ? value.join(', ') : value}`;
            break;
          case 'hasRedeye':
            label = value ? 'Redeye: has' : 'Redeye: none';
            break;
          default: {
            // New PBS min/max fields share meta via the shared vocabulary
            // module; fall back to raw key for anything unknown.
            const meta = filterFieldMeta(key);
            if (meta) {
              const op = key.endsWith('Max') ? '≤' : '≥';
              label = `${meta.shortLabel}: ${op}${value}`;
            } else {
              label = `${key}: ${value}`;
            }
          }
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

  const sortedPairings = React.useMemo(() => {
    const filtered = filterPairings(
      pairings,
      debouncedFilters,
      latestBidPackage?.year || new Date().getFullYear()
    );
    return filtered.sort((a, b) =>
      comparePairings(a, b, sortColumn, sortDirection)
    );
  }, [
    pairings,
    debouncedFilters,
    latestBidPackage?.year,
    sortColumn,
    sortDirection,
    comparePairings,
  ]);
  const displayPairings = sortedPairings;

  // Conflicts derived in a memo rather than an effect + state: the effect
  // version ran after every commit that changed the list's array identity and
  // its setState forced a second full render pass of the page.
  const conflictMap = React.useMemo<Map<number, ConflictInfo>>(() => {
    if (
      displayPairings &&
      displayPairings.length > 0 &&
      calendarEventsData.length > 0 &&
      latestBidPackage
    ) {
      return detectConflicts(
        displayPairings,
        calendarEventsData,
        latestBidPackage.year
      );
    }
    return new Map();
  }, [displayPairings, calendarEventsData, latestBidPackage]);

  // Filter out conflict pairings if hideConflicts is enabled
  const filteredDisplayPairings = React.useMemo(() => {
    if (!hideConflicts) {
      return displayPairings;
    }
    return displayPairings.filter(p => !conflictMap.has(p.id));
  }, [displayPairings, hideConflicts, conflictMap]);

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
              className="h-full flex flex-col border-0 shadow-none"
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
                      <details
                        className="rounded-xl border bg-card"
                        onToggle={event =>
                          setShowQuickStats(event.currentTarget.open)
                        }
                      >
                        <summary className="cursor-pointer px-4 py-3 text-sm font-medium marker:text-primary">
                          Package statistics{' '}
                          <span className="ml-2 font-normal text-muted-foreground">
                            Credit, trip lengths and layovers
                          </span>
                        </summary>
                        {showQuickStats && (
                          <div className="p-4 pt-0">
                            <StatsPanel
                              pairings={displayPairings || []}
                              bidPackage={latestBidPackage}
                              statistics={effectiveStatistics}
                              bidPackageStats={bidPackageStats}
                              onTripLengthFilter={handleTripLengthFilter}
                            />
                          </div>
                        )}
                      </details>
                    </>
                  )}

                  {/* Browse pairings: filters + table */}
                  <div className="flex flex-col overflow-hidden rounded-xl border bg-card">
                    <div className="w-full bg-card border-b p-3 sm:p-4">
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
                    <div className="h-[75vh] min-h-[420px]">
                      <Card className="h-full flex flex-col border-0 shadow-none">
                        <CardHeader className="flex flex-col gap-3 space-y-0 pb-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                            <CardTitle className="text-lg font-medium flex items-center gap-2">
                              <Search className="h-5 w-5 text-muted-foreground" />
                              Browse pairings
                            </CardTitle>
                            {bidPackages.length > 1 ? (
                              <Select
                                value={
                                  latestBidPackage
                                    ? String(latestBidPackage.id)
                                    : undefined
                                }
                                onValueChange={value =>
                                  setSelectedBidPackageId(parseInt(value))
                                }
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
                                      <SelectItem
                                        key={pkg.id}
                                        value={String(pkg.id)}
                                      >
                                        {pkg.month} {pkg.year} · {pkg.base}{' '}
                                        {pkg.aircraft}
                                        {pkg.status !== 'completed'
                                          ? ` (${pkg.status})`
                                          : ''}
                                        {/* Period runs into the prior month for
                                          some packages (Sep = Aug 31–Sep 30) */}
                                        {formatBidPeriod(
                                          pkg.bidPeriodStart,
                                          pkg.bidPeriodEnd
                                        )
                                          ? ` · ${formatBidPeriod(pkg.bidPeriodStart, pkg.bidPeriodEnd)}`
                                          : ''}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                {latestBidPackage
                                  ? `${latestBidPackage.month} ${latestBidPackage.year}`
                                  : ''}
                              </span>
                            )}
                            <span className="text-sm text-muted-foreground">
                              {filteredDisplayPairings.length}{' '}
                              {filteredDisplayPairings.length === 1
                                ? 'pairing'
                                : 'pairings'}
                              {hideConflicts && conflictMap.size > 0
                                ? ` (${conflictMap.size} hidden)`
                                : ''}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              className="text-xs px-2 py-1 rounded border text-muted-foreground"
                              disabled={!bidPackageId || isPrefetching}
                              onClick={() => refetchPairings()}
                            >
                              {isPrefetching
                                ? 'Loading pairings…'
                                : isFullCacheReady
                                  ? 'Available offline: Yes'
                                  : 'Save for offline use'}
                            </button>
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
                                    onChange={e =>
                                      setHideConflicts(e.target.checked)
                                    }
                                    className="rounded border border-input"
                                  />
                                  <span className="text-secondary-foreground">
                                    Hide conflicts ({conflictMap.size})
                                  </span>
                                </label>
                              </div>
                            </div>
                          )}
                          <PairingTable
                            pairings={filteredDisplayPairings || EMPTY_ARRAY}
                            onSort={handleSort}
                            sortColumn={sortColumn || ''}
                            sortDirection={sortDirection}
                            onPairingClick={handlePairingClick}
                            conflicts={conflictMap}
                            showHeader={false}
                            isLoading={isLoadingPairings}
                            isError={isPairingsError}
                            onRetry={handleRetryPairings}
                            hasActiveFilters={
                              activeFilters.length > 0 || hideConflicts
                            }
                            favoritePairingIds={favoritePairingIds}
                            onToggleFavorite={handleToggleFavorite}
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
                  <Card className="h-full flex flex-col border-0 shadow-none">
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
                          favoritePairingIds={favoritePairingIds}
                          onToggleFavorite={handleToggleFavorite}
                        />
                      ) : (
                        <div className="text-center py-8">
                          <Star className="mx-auto h-16 w-16 text-muted-foreground/50" />
                          <h3 className="mt-4 text-lg font-medium text-foreground">
                            No Favorites Yet
                          </h3>
                          <p className="mt-2 text-sm text-muted-foreground">
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
                        <Calendar className="mx-auto h-16 w-16 text-muted-foreground/50" />
                        <p className="mt-2 text-sm text-muted-foreground">
                          Loading calendar…
                        </p>
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
                    <Calendar className="mx-auto h-16 w-16 text-muted-foreground/50" />
                    <h3 className="mt-4 text-lg font-medium text-foreground">
                      Calendar Loading
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Setting up your calendar view...
                    </p>
                  </div>
                )}
              </TabsContent>

              <TabsContent
                value="bidBuilder"
                className="flex-1 overflow-auto p-1"
              >
                <Suspense
                  fallback={
                    <div className="text-sm text-muted-foreground">
                      Loading…
                    </div>
                  }
                >
                  <BidBuilder
                    bidPackageId={bidPackageId}
                    userId={currentUser?.id}
                  />
                </Suspense>
              </TabsContent>

              <TabsContent value="trends" className="flex-1 overflow-auto p-1">
                <Suspense
                  fallback={
                    <div className="text-sm text-muted-foreground">
                      Loading…
                    </div>
                  }
                >
                  <TrendsPanel
                    seniorityPercentile={seniorityPercentile}
                    base={latestBidPackage?.base}
                    aircraft={latestBidPackage?.aircraft}
                  />
                </Suspense>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </SidebarInset>

      <MobileNav activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Pairing Modal */}
      {selectedPairing && (
        <Suspense fallback={null}>
          <PairingModal
            pairingId={selectedPairing.id}
            onClose={() => setSelectedPairing(null)}
            currentUser={currentUser}
          />
        </Suspense>
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
              <TabsTrigger value="dataOverview" data-testid="tab-data-overview">
                Data Overview
              </TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Bid Package Upload */}
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-secondary-foreground">
                    Bid Package
                  </h3>
                  <FileUpload
                    onUpload={(file, result) => {
                      setShowUploadModal(false);
                      refetchBidPackages();
                      queryClient.invalidateQueries({
                        queryKey: ['data-health'],
                      });

                      const uploadedBidPackageId = result?.bidPackage?.id;
                      if (uploadedBidPackageId) {
                        setProcessingBidPackage({
                          id: uploadedBidPackageId,
                          name: 'bid package',
                        });
                        pollBidPackageStatus(uploadedBidPackageId);
                      }
                    }}
                  />
                  <div className="text-xs text-muted-foreground flex items-center">
                    <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                    PDF or TXT format
                  </div>
                </div>

                {/* Reasons Report Upload */}
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-secondary-foreground">
                    Reasons Report
                  </h3>
                  <Suspense
                    fallback={
                      <div className="text-sm text-muted-foreground">
                        Loading…
                      </div>
                    }
                  >
                    <ReasonsReportUpload
                      onUploadSuccess={() => {
                        const revision = String(Date.now());
                        localStorage.setItem('historyRevision', revision);
                        setHistoryRevision(revision);
                        queryClient.invalidateQueries();
                        toast({
                          title: 'Historical data updated',
                          description:
                            'Hold probabilities will now use this data for predictions.',
                        });
                      }}
                    />
                  </Suspense>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="dataOverview" className="space-y-4">
              <Suspense
                fallback={
                  <div className="text-sm text-muted-foreground">Loading…</div>
                }
              >
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
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    Loading AI assistant…
                  </div>
                }
              >
                <PairingChat
                  bidPackageId={bidPackageId}
                  userId={currentUser?.id}
                />
              </Suspense>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="text-center">
                  <Bot className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
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
        <div className="fixed inset-0 z-50 bg-background lg:hidden">
          <div className="h-full flex flex-col border-0 shadow-none">
            {/* Minimal header with just close button */}
            <div className="flex-shrink-0 flex items-center justify-between p-3 border-b bg-card">
              <h1 className="text-base font-medium">AI Assistant</h1>
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
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      Loading AI assistant…
                    </div>
                  }
                >
                  <PairingChat
                    bidPackageId={bidPackageId}
                    userId={currentUser?.id}
                    compact={true}
                  />
                </Suspense>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground p-4">
                  <div className="text-center">
                    <Bot className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
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
        onOpenChange={open => {
          // Prevent closing if required fields are empty
          if (!open && (!seniorityNumber || !base || !aircraft || !position)) {
            toast({
              title: 'Profile Required',
              description:
                'Please complete your profile before continuing. All fields marked with * are required.',
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
                  Please fill in your pilot information to continue. All fields
                  marked with * are required.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 overflow-y-auto pr-2 flex-1">
                {!currentUser && (
                  <div className="rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950 p-3 space-y-2">
                    <div className="text-sm font-medium text-blue-900 dark:text-blue-200">
                      Already set up on another device?
                    </div>
                    <p className="text-xs text-blue-800 dark:text-blue-300">
                      Enter your sync PIN to load your existing profile,
                      favorites, calendar, and AI chat history instead of
                      starting fresh.
                    </p>
                    <div className="flex gap-2">
                      <Input
                        value={linkPin}
                        onChange={e => setLinkPin(e.target.value)}
                        inputMode="numeric"
                        autoComplete="one-time-code"
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
                              description:
                                'Your profile has been loaded onto this device.',
                            });
                            setShowProfileModal(false);
                          } catch (error: any) {
                            toast({
                              title: 'Link Failed',
                              description:
                                error?.message ||
                                'That PIN did not match any profile.',
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
                  <label className="text-sm font-medium text-secondary-foreground mb-1 block">
                    Name
                  </label>
                  <Input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Your name (optional)"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-secondary-foreground mb-1 block">
                    Seniority Number <span className="text-red-500">*</span>
                  </label>
                  <Input
                    data-testid="input-seniority-number"
                    value={seniorityNumber}
                    onChange={e => setSeniorityNumber(e.target.value)}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    placeholder="Enter seniority number (e.g., 15600)"
                    className={
                      !seniorityNumber
                        ? 'border-red-300 focus:border-red-500'
                        : ''
                    }
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-secondary-foreground mb-1 block">
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
                  <p className="text-xs text-muted-foreground mt-1">
                    Lower % = more senior
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-secondary-foreground mb-1 block">
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
                  <label className="text-sm font-medium text-secondary-foreground mb-1 block">
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
                  <label className="text-sm font-medium text-secondary-foreground mb-1 block">
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
                  <p className="text-xs text-muted-foreground mt-1">
                    Position A or B (matches ALV table)
                  </p>
                </div>
                {currentUser && (
                  <div className="border-t pt-4 mt-4">
                    <div className="text-sm font-medium text-secondary-foreground mb-1">
                      Sync PIN
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      After signing in to the app, use a 4–12 digit PIN to load
                      this profile and saved work on another device.
                    </p>
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        maxLength={12}
                        value={syncPinDraft}
                        onChange={e => setSyncPinDraft(e.target.value)}
                        inputMode="numeric"
                        autoComplete="off"
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
                              description:
                                'Use this PIN to link your other devices.',
                            });
                            setSyncPinDraft('');
                          } catch (error: any) {
                            toast({
                              title: 'Error',
                              description:
                                error?.message || 'Failed to save sync PIN.',
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
                            description:
                              'Cache cleared successfully. Reloading...',
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
                          description:
                            'Please fill in Seniority Number, Base, Aircraft, and Position',
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
                          description:
                            'Your profile has been saved successfully!',
                        });

                        setShowProfileModal(false);
                      } catch (error: any) {
                        toast({
                          title: 'Error',
                          description:
                            error?.message ||
                            'Failed to save profile. Please try again.',
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
