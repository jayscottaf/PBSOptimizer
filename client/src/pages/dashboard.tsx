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
  PanelLeftOpen
} from "lucide-react";
import { FileUpload } from "@/components/ui/file-upload";
import { StatsPanel } from "@/components/stats-panel";
import { PairingTable } from "@/components/pairing-table";
import { PairingChat } from "@/components/pairing-chat";
import { FiltersPanel } from "@/components/filters-panel";
import { PairingModal } from "@/components/pairing-modal";
import { CalendarView } from "@/components/calendar-view";
import { SmartFilterSystem } from "@/components/smart-filter-system";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ProfileModal } from "@/components/profile-modal";

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

  // Debounce filters to prevent excessive API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters);
    }, 300); // 300ms delay

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
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);

  // Sidebar collapsed state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    return saved ? JSON.parse(saved) : false;
  });

  // Save sidebar state to localStorage
  React.useEffect(() => {
    localStorage.setItem('sidebarCollapsed', JSON.stringify(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const { data: bidPackages = [], refetch: refetchBidPackages } = useQuery({
    queryKey: ["bidPackages"],
    queryFn: api.getBidPackages,
    staleTime: 10 * 60 * 1000, // Bid packages don't change often
    refetchOnMount: false,
  });

  // Find the latest completed bid package
  const latestBidPackage = React.useMemo(() => {
    if (!bidPackages || bidPackages.length === 0) return null;
    return (bidPackages as any[]).reduce((latest: any, pkg: any) => {
      if (pkg.status === "completed" && (!latest || new Date(pkg.createdAt) > new Date(latest.createdAt))) {
        return pkg;
      }
      return latest;
    }, null);
  }, [bidPackages]);

  // Track when seniority percentage changes and trigger loading state
  React.useEffect(() => {
    if (seniorityPercentile && latestBidPackage) {
      setIsUpdatingSeniority(true);
      const timer = setTimeout(() => {
        setIsUpdatingSeniority(false);
      }, 20000); // Reset after 20 seconds max

      return () => clearTimeout(timer);
    }
  }, [seniorityPercentile, latestBidPackage]);

  const { data: pairings = [], isLoading: isLoadingPairings } = useQuery({
    queryKey: ["pairings", latestBidPackage?.id, debouncedFilters, seniorityPercentile],
    queryFn: () => api.searchPairings({
      bidPackageId: latestBidPackage?.id,
      seniorityPercentage: seniorityPercentile ? parseFloat(seniorityPercentile) : undefined,
      ...debouncedFilters
    }),
    enabled: !!latestBidPackage,
    staleTime: 2 * 60 * 1000, // Keep pairing data fresh for 2 minutes
    refetchOnMount: false,
  });

  // Query for user data
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
    staleTime: 15 * 60 * 1000, // User data is stable for 15 minutes
    refetchOnMount: false,
  });

  // Query for user's favorites
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
  };

  // Sorting logic
  const sortedPairings = React.useMemo(() => {
    if (!pairings || pairings.length === 0) {
      return [];
    }

    let sorted = [...pairings];

    if (sortColumn) {
      sorted.sort((a, b) => {
        let valA: any, valB: any;

        switch (sortColumn) {
          case 'creditHours':
          case 'credit':
            valA = parseFloat(a.creditHours?.toString() || '0');
            valB = parseFloat(b.creditHours?.toString() || '0');
            break;
          case 'blockHours':
          case 'block':
            valA = parseFloat(a.blockHours?.toString() || '0');
            valB = parseFloat(b.blockHours?.toString() || '0');
            break;
          case 'tafb':
            valA = parseFloat(a.tafb?.toString() || '0');
            valB = parseFloat(b.tafb?.toString() || '0');
            break;
          case 'pairingDays':
            valA = parseInt(a.pairingDays?.toString() || '1', 10);
            valB = parseInt(b.pairingDays?.toString() || '1', 10);
            break;
          case 'creditBlockRatio':
            const creditA = parseFloat(a.creditHours?.toString() || '0');
            const blockA = parseFloat(a.blockHours?.toString() || '1');
            const creditB = parseFloat(b.creditHours?.toString() || '0');
            const blockB = parseFloat(b.blockHours?.toString() || '1');
            valA = creditA / blockA;
            valB = creditB / blockB;
            break;
          case 'holdProbability':
            valA = parseInt(a.holdProbability?.toString() || '0', 10);
            valB = parseInt(b.holdProbability?.toString() || '0', 10);
            break;
          case 'pairingNumber':
            valA = parseInt(a.pairingNumber, 10);
            valB = parseInt(b.pairingNumber, 10);
            break;
          default:
            valA = (a as any)[sortColumn];
            valB = (b as any)[sortColumn];
        }

        if (valA === undefined || valA === null) return sortDirection === "asc" ? 1 : -1;
        if (valB === undefined || valB === null) return sortDirection === "asc" ? -1 : 1;

        if (typeof valA === 'string' && typeof valB === 'string') {
          return sortDirection === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else if (typeof valA === 'number' && typeof valB === 'number') {
          return sortDirection === "asc" ? valA - valB : valB - valA;
        } else {
          // Fallback for mixed or other types
          return sortDirection === "asc" ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
        }
      });
    }

    return sorted;
  }, [pairings, sortColumn, sortDirection]);

  // Mocking selectedBidPackageId for the polling logic in the modal
  const [selectedBidPackageId, setSelectedBidPackageId] = useState<string | null>(null);

  // Calculate quick stats for collapsed view
  const quickStats = React.useMemo(() => {
    if (!sortedPairings || sortedPairings.length === 0) {
      return { totalPairings: 0, likelyToHold: 0, highCredit: 0 };
    }

    const parseHours = (hours: any): number => {
      if (typeof hours === 'number') return hours;
      if (typeof hours === 'string') {
        return parseFloat(hours) || 0;
      }
      return 0;
    };

    const highCreditCount = sortedPairings.filter(p => parseHours(p.creditHours) >= 18).length;
    const likelyToHoldCount = sortedPairings.filter(p => (p.holdProbability || 0) >= 0.7).length;

    return {
      totalPairings: sortedPairings.length,
      likelyToHold: likelyToHoldCount,
      highCredit: highCreditCount
    };
  }, [sortedPairings]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Modern Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="w-full px-2 sm:px-4 md:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            <div className="flex items-center space-x-2 sm:space-x-6 flex-1 min-w-0">
              <div className="flex items-center space-x-2 min-w-0">
                <Plane className="text-blue-600 h-5 w-5 sm:h-6 sm:w-6 flex-shrink-0" />
                <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">Delta PBS Optimizer</h1>
              </div>
              <nav className="hidden lg:flex items-center space-x-1 bg-gray-100 rounded-lg p-1">
                <Button variant="secondary" size="sm" className="bg-white text-gray-900 shadow-sm">
                  Bid Analysis
                </Button>
                <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900">
                  History
                </Button>
                <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900">
                  Predictions
                </Button>
              </nav>
            </div>
            <div className="flex items-center space-x-2 sm:space-x-4 flex-shrink-0">
              <div className="hidden md:flex items-center space-x-2 text-xs sm:text-sm text-gray-600">
                <span className="hidden lg:inline">Seniority:</span>
                <span className="font-mono font-medium text-blue-600">#{seniorityNumber}</span>
                {seniorityPercentile && (
                  <span className="font-mono font-medium text-purple-600">({seniorityPercentile}%)</span>
                )}
                {isUpdatingSeniority && (
                  <span className="flex items-center text-orange-600 text-xs">
                    <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                    Updating...
                  </span>
                )}
                <span className="text-gray-400 hidden lg:inline">|</span>
                <span className="font-medium hidden lg:inline">{base} {aircraft} FO</span>
              </div>
              <div className="flex items-center space-x-1 sm:space-x-2">
                <Button variant="ghost" size="sm" className="hidden sm:flex">
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="hidden sm:flex">
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm">
                  <Settings className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowProfileModal(true)}>
                  <User className="h-4 w-4" />
                </Button>
              </div>
              {/* Upload Bid Package Button */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowUploadModal(true)}
                  className="flex items-center gap-2"
                >
                  <CloudUpload className="h-4 w-4" />
                  Upload Bid Package
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="w-full px-2 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
        <div className="w-full">
          <div className="flex gap-4 sm:gap-6 lg:gap-8">

            {/* Collapsible Sidebar */}
            <div className={`transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-16' : 'w-80'}`}>
              <Card className="h-fit">
                <CardContent className="p-4 sm:p-6 relative">
                  {/* Collapse button positioned at top-right corner */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                    className="absolute top-2 right-2 h-6 w-6 p-1 z-10"
                  >
                    {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                  </Button>

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
                      <StatsPanel pairings={sortedPairings || []} bidPackage={latestBidPackage} />

                      {/* Additional Tools Section */}
                      <div className="pt-4 border-t border-gray-200">
                        <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
                          <Settings className="h-4 w-4 mr-2" />
                          Quick Actions
                        </h4>
                        <div className="space-y-2">
                          <Button variant="outline" size="sm" className="w-full justify-start">
                            <BarChart2 className="h-4 w-4 mr-2" />
                            View Analytics
                          </Button>
                          <Button variant="outline" size="sm" className="w-full justify-start">
                            <Star className="h-4 w-4 mr-2" />
                            Manage Favorites
                          </Button>
                          <Button variant="outline" size="sm" className="w-full justify-start">
                            <Calendar className="h-4 w-4 mr-2" />
                            Calendar View
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Main Content */}
            <div className="flex-1 min-w-0">
              <Card>
                <CardContent className="p-0">
                  <Tabs defaultValue="search" className="w-full">
                    <div className="border-b">
                      <TabsList className="h-10 sm:h-12 w-full justify-start rounded-none bg-transparent p-0 overflow-x-auto">
                        <TabsTrigger 
                          value="search" 
                          className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent text-xs sm:text-sm whitespace-nowrap px-2 sm:px-4"
                        >
                          Search & Filter
                        </TabsTrigger>
                        <TabsTrigger 
                          value="analysis"
                          className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent text-xs sm:text-sm whitespace-nowrap px-2 sm:px-4"
                        >
                          Analysis
                        </TabsTrigger>
                        <TabsTrigger 
                          value="favorites"
                          className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent text-xs sm:text-sm whitespace-nowrap px-2 sm:px-4"
                        >
                          Favorites
                        </TabsTrigger>
                        <TabsTrigger 
                          value="calendar"
                          className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent text-xs sm:text-sm whitespace-nowrap px-2 sm:px-4"
                        >
                          Calendar
                        </TabsTrigger>
                        <TabsTrigger 
                          value="assistant"
                          className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent text-xs sm:text-sm whitespace-nowrap px-2 sm:px-4"
                        >
                          AI Assistant
                        </TabsTrigger>
                      </TabsList>
                    </div>

                    {/* Search & Filter Tab */}
                    <TabsContent value="search" className="p-3 sm:p-6 space-y-4 sm:space-y-6">
                      {latestBidPackage ? (
                        <>
                          {/* Search Bar */}
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                            <Input
                              placeholder="Search routes, pairing numbers..."
                              className="pl-10"
                              value={filters.search || ''}
                              onChange={(e) => addFilter('search', 'Search', e.target.value)}
                            />
                          </div>

                          {/* Active Filters */}
                          {activeFilters.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {activeFilters.map((filter) => (
                                <Badge key={filter.key} variant="secondary" className="flex items-center gap-1">
                                  {filter.label}
                                  <X 
                                    className="h-3 w-3 cursor-pointer" 
                                    onClick={() => removeFilter(filter.key)}
                                  />
                                </Badge>
                              ))}
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => {
                                  setActiveFilters([]);
                                  setFilters({});
                                }}
                                className="text-xs h-6"
                              >
                                Clear All
                              </Button>
                            </div>
                          )}

                          {/* Smart Filter System */}
                          <SmartFilterSystem 
                            onFilterApply={(filterKey, filterValue, displayLabel) => {
                              addFilter(filterKey, displayLabel, filterValue);
                            }}
                            onFilterClear={(filterKey) => {
                              removeFilter(filterKey);
                            }}
                          />

                          {/* Results */}
                          <div className="relative">
                            <div className="flex items-center justify-between mb-4">
                              <h3 className="text-lg font-semibold text-gray-900">Pairing Results</h3>
                              <div className="flex items-center space-x-2">
                                {isUpdatingSeniority && (
                                  <span className="flex items-center text-orange-600 text-sm">
                                    <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                                    Recalculating hold probabilities...
                                  </span>
                                )}
                                <span className="text-sm text-gray-500">
                                  {latestBidPackage.month} {latestBidPackage.year} - {sortedPairings.length} pairings
                                </span>
                              </div>
                            </div>
                            {isUpdatingSeniority && (
                              <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10 rounded-lg">
                                <div className="flex items-center space-x-2 text-orange-600">
                                  <RefreshCw className="h-6 w-6 animate-spin" />
                                  <span className="text-lg font-medium">Updating hold probabilities...</span>
                                </div>
                              </div>
                            )}
                            <PairingTable 
                              pairings={sortedPairings || []} 
                              onSort={handleSort}
                              sortColumn={sortColumn || ''}
                              sortDirection={sortDirection}
                              onPairingClick={handlePairingClick}
                            />
                          </div>
                        </>
                      ) : (
                        // Empty State for No Bid Package
                        <div className="text-center py-12">
                          <Plane className="mx-auto h-24 w-24 text-gray-300" />
                          <h3 className="mt-4 text-lg font-medium text-gray-900">No Bid Package Ready</h3>
                          <p className="mt-2 text-sm text-gray-500">
                            Upload a bid package to start analyzing pairings and planning your bids.
                          </p>
                        </div>
                      )}
                    </TabsContent>

                    {/* Analysis Tab */}
                    <TabsContent value="analysis" className="p-3 sm:p-6">
                      <div className="text-center py-8 sm:py-12">
                        <BarChart2 className="mx-auto h-16 w-16 sm:h-24 sm:w-24 text-gray-300" />
                        <h3 className="mt-4 text-base sm:text-lg font-medium text-gray-900">No Data for Analysis</h3>
                        <p className="mt-2 text-sm text-gray-500 px-4">
                          Advanced analytics and visualizations will appear here once you have pairing data.
                        </p>
                      </div>
                    </TabsContent>

                    {/* Favorites Tab */}
                    <TabsContent value="favorites" className="p-3 sm:p-6 space-y-4 sm:space-y-6">
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-semibold text-gray-900">Your Favorite Pairings</h3>
                          <span className="text-sm text-gray-500">
                            {favorites.length} favorite{favorites.length !== 1 ? 's' : ''}
                          </span>
                        </div>

                        {favorites.length > 0 ? (
                          <PairingTable 
                            pairings={favorites} 
                            onSort={handleSort}
                            sortColumn={sortColumn || ''}
                            sortDirection={sortDirection}
                            onPairingClick={handlePairingClick}
                            showDeleteButton={true}
                            onDeleteFavorite={handleDeleteFavorite}
                          />
                        ) : (
                          <div className="text-center py-8 sm:py-12">
                            <Star className="mx-auto h-16 w-16 sm:h-24 sm:w-24 text-gray-300" />
                            <h3 className="mt-4 text-base sm:text-lg font-medium text-gray-900">No Favorites Yet</h3>
                            <p className="mt-2 text-sm text-gray-500 px-4">
                              Click the "Add to Favorites" button on any pairing to save it here.
                            </p>
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    {/* Calendar Tab */}
                    <TabsContent value="calendar" className="p-3 sm:p-6">
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

                    {/* AI Assistant Tab */}
                    <TabsContent value="assistant" className="p-3 sm:p-6">
                      {latestBidPackage ? (
                        <PairingChat bidPackageId={latestBidPackage.id} />
                      ) : (
                        <div className="text-center py-8 sm:py-12">
                          <User className="mx-auto h-16 w-16 sm:h-24 sm:w-24 text-gray-300" />
                          <h3 className="mt-4 text-base sm:text-lg font-medium text-gray-900">AI Assistant Not Active</h3>
                          <p className="mt-2 text-sm text-gray-500 px-4">
                            Upload a bid package to start chatting with your AI assistant about pairing analysis.
                          </p>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </div>
          </div>
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
                            if (pkg.status === 'completed' && (!latest || new Date(pkg.createdAt) > new Date(latest.createdAt))) {
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

      {/* Profile Modal */}
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