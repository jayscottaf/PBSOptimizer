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
  const [uploadProgress, setUploadProgress] = useState(0);

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
    return saved !== null ? JSON.parse(saved) : false;
  });

  // Save sidebar state to localStorage
  React.useEffect(() => {
    localStorage.setItem('sidebarCollapsed', JSON.stringify(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const { mutate: uploadMutation, data: uploadedPackage } = useUploadBidPackage({
    onUploadProgress: setUploadProgress,
    onSuccess: (data) => {
      refetchBidPackages();
      // Optionally, trigger a refetch of pairings or other relevant data
    },
  });

  const handleFileUpload = (file: File) => {
    uploadMutation({ file });
  };

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

  const bidPackageId = latestBidPackage?.id; // Assuming you need this ID for other queries

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
    queryKey: ["pairings", bidPackageId, debouncedFilters, seniorityPercentile],
    queryFn: () => api.searchPairings({
      bidPackageId: bidPackageId,
      seniorityPercentage: seniorityPercentile ? parseFloat(seniorityPercentile) : undefined,
      ...debouncedFilters
    }),
    enabled: !!bidPackageId,
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
    staleTime: 5 * 60 * 1000, // Favorites don't change often - 5 minutes
    refetchOnMount: false,
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
  };

  const handleFiltersChange = (newFilters: SearchFilters) => {
    setFilters(newFilters);
    // Update activeFilters based on newFilters if needed for display
    // This part might need more specific logic depending on how activeFilters is managed
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
                  <StatsPanel pairings={sortedPairings || []} bidPackage={latestBidPackage} />

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-gray-900">Smart Filters</h3>
                      <Button variant="ghost" size="sm" onClick={() => setShowFilters(!showFilters)}>
                        <Settings className="h-4 w-4" />
                      </Button>
                    </div>
                    <SmartFilterSystem
                      pairings={sortedPairings || []}
                      onFiltersChange={handleFiltersChange}
                      activeFilters={activeFilters}
                      onClearFilters={() => setActiveFilters([])}
                    />
                  </div>
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
                  <TabsList className="grid grid-cols-3 sm:w-auto">
                    <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                    <TabsTrigger value="calendar">Calendar</TabsTrigger>
                    <TabsTrigger value="profile">Profile</TabsTrigger>
                  </TabsList>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setShowProfileModal(true)}
                    className="flex items-center gap-2 hover:bg-gray-50 transition-colors"
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
                  <StatsPanel pairings={sortedPairings || []} bidPackage={latestBidPackage} />
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
                            pairings={sortedPairings || []}
                            onFiltersChange={handleFiltersChange}
                            activeFilters={activeFilters}
                            onClearFilters={() => setActiveFilters([])}
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
                        pairings={sortedPairings || []}
                        onFiltersChange={handleFiltersChange}
                        activeFilters={activeFilters}
                        onClearFilters={() => setActiveFilters([])}
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
                          {latestBidPackage.month} {latestBidPackage.year} - {sortedPairings.length} pairings
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
                        pairings={sortedPairings || []} 
                        onSort={handleSort}
                        sortColumn={sortColumn || ''}
                        sortDirection={sortDirection}
                        onPairingClick={handlePairingClick}
                      />
                    </CardContent>
                  </Card>
                )}
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

            {/* Profile Tab */}
            <TabsContent value="profile" className="flex-1 overflow-auto">
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <User className="h-5 w-5" />
                      Profile Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    </div>
                    <div className="flex justify-end pt-6">
                      <Button onClick={() => setShowProfileModal(true)}>
                        Update Profile
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
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