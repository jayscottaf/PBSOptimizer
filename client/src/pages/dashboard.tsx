import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Bot
} from "lucide-react";
import { FileUpload } from "@/components/ui/file-upload";
import { StatsPanel } from "@/components/stats-panel";
import { PairingTable } from "@/components/pairing-table";
import { PairingChat } from "@/components/pairing-chat";
import { FiltersPanel } from "@/components/filters-panel";
import { PairingModal } from "@/components/pairing-modal";
import { CalendarView } from "@/components/calendar-view";
import { SmartFilterSystem } from "@/components/smart-filter-system";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ProfileModal } from "@/components/profile-modal";
import { useUploadBidPackage } from "@/hooks/useUploadBidPackage"; // Assuming this hook exists

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
  sortBy?: string;        // Add this line
  sortOrder?: 'asc' | 'desc';  // Add this line
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
  const [activeFilters, setActiveFilters] = useState<Array<{key: string, label: string, value: any}>>([]);
  const [activeTab, setActiveTab] = useState("dashboard");
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
    return localStorage.getItem('seniorityNumber') || "15860";
  });
  const [seniorityPercentile, setSeniorityPercentile] = useState(() => {
    return localStorage.getItem('seniorityPercentile') || '';
  });
  const [isUpdatingSeniority, setIsUpdatingSeniority] = useState(false);
  const [base, setBase] = useState(() => {
    return localStorage.getItem('base') || "NYC";
  });
  const [aircraft, setAircraft] = useState(() => {
    return localStorage.getItem('aircraft') || "A220";
  });

  // Save user info to localStorage when it changes
  React.useEffect(() => {
    localStorage.setItem('seniorityNumber', seniorityNumber);
    localStorage.setItem('seniorityPercentile', seniorityPercentile);
    localStorage.setItem('base', base);
    localStorage.setItem('aircraft', aircraft);
  }, [seniorityNumber, seniorityPercentile, base, aircraft]);

  const [selectedPairing, setSelectedPairing] = useState<any>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize] = useState<number>(50);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showAIAssistant, setShowAIAssistant] = useState(false);


  // Sidebar collapsed state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    return saved !== null ? JSON.parse(saved) : false;
  });

  // Save sidebar state to localStorage
  React.useEffect(() => {
    localStorage.setItem('sidebarCollapsed', JSON.stringify(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const { mutate: uploadMutation, data: uploadedPackage } = useUploadBidPackage({
    onUploadProgress: setUploadProgress,
    onSuccess: (data) => {
      // Optionally, trigger a refetch of pairings or other relevant data
    },
  });

  const handleFileUpload = (file: File) => {
    uploadMutation({ file });
  };

  const { data: bidPackages = [], refetch: refetchBidPackages } = useQuery({
    queryKey: ["bidPackages"],
    queryFn: api.getBidPackages,
    staleTime: 15 * 60 * 1000, // Increased cache time to 15 minutes
    gcTime: 30 * 60 * 1000, // Keep in memory for 30 minutes
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Debug logging
  console.log('Bid packages from API:', bidPackages);

  // Find the latest bid package (prefer completed, fall back to most recent by uploadedAt if none are completed)
  const latestBidPackage = React.useMemo(() => {
    if (!bidPackages || bidPackages.length === 0) return null;

    const packagesArray = (bidPackages as any[]).slice();
    // Sort by uploadedAt descending
    packagesArray.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

    // Try to find the most recent completed package first
    const mostRecentCompleted = packagesArray.find((pkg: any) => pkg.status === "completed");
    if (mostRecentCompleted) return mostRecentCompleted;

    // Fallback: return the most recent package regardless of status
    return packagesArray[0];
  }, [bidPackages]);

  console.log('Latest bid package:', latestBidPackage);

  const bidPackageId = latestBidPackage?.id; // Assuming you need this ID for other queries

  // Preload initial data for better performance
  const { data: initialPairingsResponse } = useQuery({
    queryKey: ["initial-pairings", bidPackageId],
    queryFn: () => api.searchPairings({
      bidPackageId: bidPackageId,
      page: 1,
      limit: 50,
      sortBy: 'pairingNumber',
      sortOrder: 'asc'
    }),
    enabled: !!bidPackageId && !debouncedFilters.search && Object.keys(debouncedFilters).length === 0,
    staleTime: 10 * 60 * 1000, // Cache initial data longer
    gcTime: 15 * 60 * 1000,
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
  const { data: pairingsResponse, isLoading: isLoadingPairings, refetch: refetchPairings } = useQuery({
    queryKey: ["pairings", bidPackageId, debouncedFilters, seniorityPercentile, sortColumn, sortDirection, currentPage, pageSize],
    queryFn: () => api.searchPairings({
      bidPackageId: bidPackageId,
      seniorityPercentage: seniorityPercentile ? parseFloat(seniorityPercentile) : undefined,
      sortBy: sortColumn || 'pairingNumber',
      sortOrder: sortDirection || 'asc',
      page: currentPage,
      limit: pageSize,
      ...debouncedFilters
    }),
    enabled: !!bidPackageId,
    staleTime: 5 * 60 * 1000, // Increased cache time to 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in memory for 10 minutes
    refetchOnMount: false,
    refetchOnWindowFocus: false, // Prevent refetch on window focus
    refetchOnReconnect: false, // Prevent refetch on reconnect
    // Add optimistic updates for better perceived performance
    placeholderData: (previousData) => previousData,
  });

  // When the bid package transitions to completed, invalidate and refetch pairings
  React.useEffect(() => {
    if (latestBidPackage?.id && latestBidPackage.status === 'completed') {
      queryClient.invalidateQueries({ queryKey: ["pairings", latestBidPackage.id] });
      queryClient.invalidateQueries({ queryKey: ["initial-pairings", latestBidPackage.id] });
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
  const pairings = pairingsResponse?.pairings || initialPairingsResponse?.pairings || [];
  const pagination = pairingsResponse?.pagination || initialPairingsResponse?.pagination;

  // Debug logs removed after verification

  // Query for user data with enhanced caching
  const { data: currentUser } = useQuery({
    queryKey: ["user", seniorityNumber, base, aircraft],
    queryFn: async () => {
      return await api.createOrUpdateUser({
        seniorityNumber: parseInt(seniorityNumber),
        base,
        aircraft
      });
    },
    enabled: !!seniorityNumber,
    staleTime: 30 * 60 * 1000, // User data is stable for 30 minutes
    gcTime: 60 * 60 * 1000, // Keep in memory for 1 hour
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Query for user's favorites with enhanced caching
  const { data: favorites = [], refetch: refetchFavorites } = useQuery({
    queryKey: ["favorites", currentUser?.id],
    queryFn: async () => {
      if (!currentUser) return [];
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
      if (!currentUser) return;

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
      } else if (keyToRemove === 'pairingDays' || keyToRemove === 'pairingDaysMin' || keyToRemove === 'pairingDaysMax') {
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
      const isCreditFilter = key === 'creditRange' || key === 'creditMin' || key === 'creditMax';
      const isBlockFilter = key === 'blockRange' || key === 'blockMin' || key === 'blockMax';
      const isPairingDaysFilter = key === 'pairingDays' || key === 'pairingDaysMin' || key === 'pairingDaysMax';

      if ((key === 'creditRange' || key === 'blockRange') && typeof value === 'object') {
        // Handle range filters specially
        setActiveFilters(prev => [
          ...prev.filter(f => 
            isCreditFilter ? !f.key.match(/^credit/) : 
            isBlockFilter ? !f.key.match(/^block/) : 
            f.key !== key
          ),
          { key, label, value }
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
            isCreditFilter ? !f.key.match(/^credit/) : 
            isBlockFilter ? !f.key.match(/^block/) : 
            isPairingDaysFilter ? !f.key.match(/^pairingDays/) :
            f.key !== key
          ),
          { key, label, value }
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
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
    setCurrentPage(1);
  };

  const handleFiltersChange = (newFilters: SearchFilters) => {
    // Process the new filters to handle range objects
    const processedFilters: SearchFilters = {};
    
    Object.entries(newFilters).forEach(([key, value]) => {
      if (key === 'creditRange' && typeof value === 'object' && value !== null) {
        // Flatten credit range object
        const rangeObj = value as any;
        if (rangeObj.creditMin !== undefined) processedFilters.creditMin = rangeObj.creditMin;
        if (rangeObj.creditMax !== undefined) processedFilters.creditMax = rangeObj.creditMax;
      } else if (key === 'blockRange' && typeof value === 'object' && value !== null) {
        // Flatten block range object
        const rangeObj = value as any;
        if (rangeObj.blockMin !== undefined) processedFilters.blockMin = rangeObj.blockMin;
        if (rangeObj.blockMax !== undefined) processedFilters.blockMax = rangeObj.blockMax;
      } else {
        // Regular filter
        processedFilters[key as keyof SearchFilters] = value;
      }
    });
    
    setFilters(prev => {
      const merged: any = { ...prev, ...processedFilters };
      // drop cleared keys so they don't persist silently
      Object.keys(merged).forEach((k) => {
        if (merged[k] === undefined || merged[k] === null || merged[k] === "") {
          delete merged[k];
        }
      });
      return merged;
    });
    setCurrentPage(1);
    
    // Update activeFilters to reflect the new filters
    const updatedActiveFilters: Array<{key: string, label: string, value: any}> = [];
    
    Object.entries(processedFilters).forEach(([key, value]) => {
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


  // Sorting logic
  // Remove the sortedPairings calculation and use pairings directly
  // const sortedPairings = React.useMemo(() => { ... }); // DELETE THIS

  // Use pairings directly since backend will sort them
  const displayPairings = React.useMemo(() => {
    if (!pairings || pairings.length === 0) return [];
    
    // If sorting by C/B ratio, do it in frontend since it's calculated
    if (sortColumn === 'creditBlockRatio') {
      const sorted = [...pairings].sort((a, b) => {
        const creditA = parseFloat(a.creditHours?.toString() || '0');
        const blockA = parseFloat(a.blockHours?.toString() || '1');
        const creditB = parseFloat(b.creditHours?.toString() || '0');
        const blockB = parseFloat(b.blockHours?.toString() || '1');
        
        const ratioA = blockA > 0 ? creditA / blockA : 0;
        const ratioB = blockB > 0 ? creditB / blockB : 0;
        
        return sortDirection === 'asc' ? ratioA - ratioB : ratioB - ratioA;
      });
      return sorted;
    }
    
    // For other columns, use backend sorting
    return pairings;
  }, [pairings, sortColumn, sortDirection]);

  // Mocking selectedBidPackageId for the polling logic in the modal
  const [selectedBidPackageId, setSelectedBidPackageId] = useState<string | null>(null);

  // Update the quick stats to use backend statistics
  const quickStats = React.useMemo(() => {
    if (!pairings || pairings.length === 0) {
      return { totalPairings: 0, likelyToHold: 0, highCredit: 0 };
    }

    // Use pagination total if available, otherwise fall back to current page count
    const totalPairings = pagination && pagination.total ? pagination.total : pairings.length;
    
    // Use backend statistics if available, otherwise calculate from current page
    const likelyToHold = pairingsResponse?.statistics?.likelyToHold 
      ? Number(pairingsResponse.statistics.likelyToHold)
      : pairings.filter(p => (p.holdProbability || 0) >= 0.7).length;
    
    const highCredit = pairingsResponse?.statistics?.highCredit 
      ? Number(pairingsResponse.statistics.highCredit)
      : pairings.filter(p => parseFloat(p.creditHours?.toString() || '0') >= 18).length;
    
    return {
      totalPairings,
      likelyToHold,
      highCredit
    };
  }, [pairings, pagination, pairingsResponse?.statistics]);

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Left Sidebar - Hidden on mobile */}
      <div className={`hidden lg:flex bg-white border-r transition-all duration-300 ${
        sidebarCollapsed ? 'w-16' : 'w-80'
      } flex-shrink-0 flex-col`}>
        {/* Toggle button */}
        <div className="p-4 border-b flex justify-end">
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
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
                <h3 className="mt-4 text-lg font-medium text-gray-900">No Bid Package</h3>
                <p className="mt-2 text-sm text-gray-500">
                  Upload a PDF bid package to get started with analyzing pairings.
                </p>
              </div>
            )
          ) : (
            <div className="space-y-6">
              {sidebarCollapsed ? (
                // Collapsed view - show essential numbers only
                <div className="space-y-4">
                  <div className="text-center">
                    <div className="text-lg font-bold text-blue-600">{quickStats.totalPairings}</div>
                    <div className="text-xs text-gray-600">Total</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-green-600">{quickStats.likelyToHold}</div>
                    <div className="text-xs text-gray-600">Hold</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-purple-600">{quickStats.highCredit}</div>
                    <div className="text-xs text-gray-600">HC</div>
                  </div>
                </div>
              ) : (
                // Expanded view - show full stats panel
                <div className="space-y-6">
                  <StatsPanel 
                    pairings={displayPairings || []} 
                    bidPackage={latestBidPackage} 
                    pagination={pagination}
                    statistics={pairingsResponse?.statistics as any}
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
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
            <div className="flex flex-col gap-4 mb-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Plane className="h-6 w-6 text-blue-600" />
                    <h1 className="text-xl sm:text-2xl font-bold text-gray-900">PBS Bid Optimizer</h1>
                  </div>
                  {currentUser && (
                    <Badge variant="outline" className="text-xs">
                      Seniority #{currentUser.seniorityNumber} ({seniorityPercentile}%)
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <TabsList className="grid grid-cols-2 sm:w-auto">
                    <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                    <TabsTrigger value="calendar">Calendar</TabsTrigger>
                  </TabsList>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => {
                      // Toggle between showing all pairings and favorites
                      if (activeTab === "favorites") {
                        setActiveTab("dashboard");
                      } else {
                        setActiveTab("favorites");
                      }
                    }}
                    className={`${activeTab === "favorites" ? "bg-yellow-50 text-yellow-700" : "text-gray-600"}`}
                  >
                    <Star className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setShowAIAssistant(true)}
                    className="flex items-center justify-center w-9 h-9 hover:bg-green-50 hover:border-green-300 transition-all duration-200 hover:scale-105 hover:shadow-md"
                    title="AI Assistant"
                  >
                    <Bot className="h-4 w-4 text-green-600 hover:text-green-700" />
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
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setShowUploadModal(true)}
                    className="flex items-center gap-2"
                  >
                    <CloudUpload className="h-4 w-4" />
                    <span className="hidden sm:inline">Upload</span>
                  </Button>
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
                        <Button variant="ghost" size="sm" onClick={() => setShowQuickStats(!showQuickStats)}>
                          {showQuickStats ? 'Hide' : 'Show'}
                        </Button>
                      </CardTitle>
                    </CardHeader>
                    {showQuickStats && (
                      <CardContent>
                        <StatsPanel pairings={displayPairings || []} bidPackage={latestBidPackage} />
                      </CardContent>
                    )}
                  </Card>
                </div>
              )}
            </div>

            <TabsContent value="dashboard" className="flex-1 overflow-hidden">
              <div className="space-y-6 h-full">

                {/* Mobile Filters - Only show on mobile when we have data */}
                {bidPackageId && (
                  <div className="lg:hidden">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Settings className="h-5 w-5" />
                            Smart Filters
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => setShowFilters(!showFilters)}>
                            {showFilters ? 'Hide' : 'Show'}
                          </Button>
                        </CardTitle>
                      </CardHeader>
                      {showFilters && (
                        <CardContent>
                          <SmartFilterSystem
                            pairings={displayPairings || []}
                            onFiltersChange={handleFiltersChange}
                            activeFilters={activeFilters}
                            onClearFilters={clearAllFilters}
                          />
                        </CardContent>
                      )}
                    </Card>
                  </div>
                )}

                {/* Desktop Filters - Only show on desktop */}
                {!sidebarCollapsed && bidPackageId && (
                  <Card className="hidden lg:block">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Settings className="h-5 w-5" />
                        Smart Filters
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <SmartFilterSystem
                        pairings={displayPairings || []}
                        onFiltersChange={handleFiltersChange}
                        activeFilters={activeFilters}
                        onClearFilters={clearAllFilters}
                      />
                    </CardContent>
                  </Card>
                )}

                {/* Pairing Results Section */}
                {bidPackageId && (
                  <Card className="h-full flex flex-col">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-lg font-medium flex items-center gap-2">
                        <Search className="h-5 w-5 text-muted-foreground" />
                        Pairing Results
                      </CardTitle>
                      <div className="flex items-center space-x-2">
                        {isUpdatingSeniority && (
                          <span className="flex items-center text-orange-600 text-sm">
                            <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                            Updating...
                          </span>
                        )}
                        <span className="text-sm text-gray-500">
                          {latestBidPackage.month} {latestBidPackage.year} - {pagination?.total || displayPairings.length} pairings
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="flex-1 overflow-auto p-0">
                      {isUpdatingSeniority && (
                        <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10 rounded-lg">
                          <div className="flex items-center space-x-2 text-orange-600">
                            <RefreshCw className="h-6 w-6 animate-spin" />
                            <span className="text-lg font-medium">Updating hold probabilities...</span>
                          </div>
                        </div>
                      )}
                      <PairingTable 
                        pairings={displayPairings || []} 
                        onSort={handleSort}
                        sortColumn={sortColumn || ''}
                        sortDirection={sortDirection}
                        onPairingClick={handlePairingClick}
                        pagination={pagination as any}
                        onPageChange={(page) => setCurrentPage(page)}
                      />
                    </CardContent>
                  </Card>
                )}
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
                        <h3 className="mt-4 text-lg font-medium text-gray-900">No Favorites Yet</h3>
                        <p className="mt-2 text-sm text-gray-500">
                          Click the star icon on any pairing to add it to your favorites.
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
                <CalendarView userId={currentUser.id} />
              ) : (
                <div className="text-center py-8">
                  <Calendar className="mx-auto h-16 w-16 text-gray-300" />
                  <h3 className="mt-4 text-lg font-medium text-gray-900">Calendar Loading</h3>
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
                  onUpload={(file) => {
                    console.log("File uploaded:", file);
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
                          const latestPackage = packages.reduce((latest: any, pkg: any) => {
                            if (pkg.status === 'completed' && (!latest || new Date(pkg.uploadedAt) > new Date(latest.uploadedAt))) {
                              return pkg;
                            }
                            return latest;
                          }, null);

                          if (latestPackage) {
                            console.log("Bid package processing completed, refreshing data...");
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
                            console.log("Polling timeout reached");
                          }
                        } catch (error) {
                          console.error("Error checking bid package status:", error);
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
        <DialogContent className="max-w-4xl h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-green-600" />
              PBS AI Assistant
            </DialogTitle>
            <DialogDescription>
              Ask questions about your pairings, get bidding recommendations, and analyze your options
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            {currentUser && latestBidPackage ? (
              <PairingChat 
                bidPackageId={bidPackageId}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                <div className="text-center">
                  <Bot className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                  <p>Upload a bid package to start using the AI assistant</p>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>



      {/* Profile Modal (moved inside the Profile tab content for better UX) */}
      <Dialog open={showProfileModal} onOpenChange={setShowProfileModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Your Profile</DialogTitle>
            <DialogDescription>
              Update your pilot information and preferences
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Seniority Number</label>
              <Input
                value={seniorityNumber}
                onChange={(e) => setSeniorityNumber(e.target.value)}
                placeholder="Enter seniority number"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Category Seniority %</label>
              <Input
                value={seniorityPercentile}
                onChange={(e) => setSeniorityPercentile(e.target.value)}
                placeholder="Enter seniority percentile"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Base</label>
              <Select value={base} onValueChange={setBase}>
                <SelectTrigger>
                  <SelectValue placeholder="Select base" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NYC">NYC</SelectItem>
                  <SelectItem value="ATL">ATL</SelectItem>
                  <SelectItem value="DFW">DFW</SelectItem>
                  <SelectItem value="LAX">LAX</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Aircraft</label>
              <Select value={aircraft} onValueChange={setAircraft}>
                <SelectTrigger>
                  <SelectValue placeholder="Select aircraft" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A220">A220</SelectItem>
                  <SelectItem value="A320">A320</SelectItem>
                  <SelectItem value="A350">A350</SelectItem>
                  <SelectItem value="B737">B737</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end pt-4">
              <Button onClick={() => setShowProfileModal(false)}>
                Save Changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}