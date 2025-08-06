import React, { useState, useEffect } from "react";
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
  GripVertical
} from "lucide-react";
import { FileUpload } from "@/components/ui/file-upload";
import { StatsPanel } from "@/components/stats-panel";
import { PairingTable } from "@/components/pairing-table";
import { PairingChat } from "@/components/pairing-chat";
import { FiltersPanel } from "@/components/filters-panel";
import { PairingModal } from "@/components/pairing-modal";
import { CalendarView } from "@/components/calendar-view";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";

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
}

// Placeholder for Pairing type if not defined elsewhere
interface Pairing {
  id: number;
  pairingNumber: string;
  creditHours: string;
  blockHours: string;
  tafb: string;
  holdProbability: string;
  pairingDays: string;
  // ... other properties
}

export default function Dashboard() {
  const [filters, setFilters] = useState<SearchFilters>({});
  const [activeFilters, setActiveFilters] = useState<Array<{key: string, label: string, value: any}>>([]);
  const [seniorityNumber, setSeniorityNumber] = useState(() => {
    return localStorage.getItem('seniorityNumber') || "15860";
  });
  const [base, setBase] = useState(() => {
    return localStorage.getItem('base') || "NYC";
  });
  const [aircraft, setAircraft] = useState(() => {
    return localStorage.getItem('aircraft') || "A220";
  });

  // Save user info to localStorage when it changes
  React.useEffect(() => {
    localStorage.setItem('seniorityNumber', seniorityNumber);
    localStorage.setItem('base', base);
    localStorage.setItem('aircraft', aircraft);
  }, [seniorityNumber, base, aircraft]);
  const [selectedPairing, setSelectedPairing] = useState<any>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [showUploadModal, setShowUploadModal] = useState(false);
  
  // Card order state
  const [cardOrder, setCardOrder] = useState(() => {
    const saved = localStorage.getItem('cardOrder');
    return saved ? JSON.parse(saved) : ['info', 'stats'];
  });

  // Save card order to localStorage
  React.useEffect(() => {
    localStorage.setItem('cardOrder', JSON.stringify(cardOrder));
  }, [cardOrder]);

  const { data: bidPackages = [], refetch: refetchBidPackages } = useQuery({
    queryKey: ["bidPackages"],
    queryFn: api.getBidPackages,
  });

  // Find the latest completed bid package
  const latestBidPackage = React.useMemo(() => {
    return (bidPackages as any[]).reduce((latest: any, pkg: any) => {
      if (pkg.status === "completed" && (!latest || new Date(pkg.createdAt) > new Date(latest.createdAt))) {
        return pkg;
      }
      return latest;
    }, null);
  }, [bidPackages]);

  const { data: pairings = [], isLoading: isLoadingPairings } = useQuery({
    queryKey: ["pairings", latestBidPackage?.id, filters],
    queryFn: () => api.searchPairings({
      bidPackageId: latestBidPackage?.id,
      ...filters
    }),
    enabled: !!latestBidPackage,
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
      delete newFilters[keyToRemove as keyof SearchFilters];
      return newFilters;
    });
  };

  const addFilter = (key: string, label: string, value: any) => {
    if (value !== undefined && value !== null && value !== '') {
      setActiveFilters(prev => [
        ...prev.filter(f => f.key !== key),
        { key, label, value }
      ]);
      setFilters(prev => ({ ...prev, [key]: value }));
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

  const handleDragEnd = (result: any) => {
    if (!result.destination) return;

    const items = Array.from(cardOrder);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    setCardOrder(items);
  };


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
                <Button variant="ghost" size="sm">
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
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">

            {/* Left Column - Stacked on mobile, sidebar on desktop */}
            <div className="xl:col-span-1">
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="sidebar-cards">
                  {(provided) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className="space-y-4 sm:space-y-6"
                    >
                      {cardOrder.map((cardId, index) => (
                        <Draggable key={cardId} draggableId={cardId} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={`${snapshot.isDragging ? 'z-50' : ''}`}
                            >
                              {cardId === 'info' && (
                                <Card className={`${snapshot.isDragging ? 'shadow-lg' : ''}`}>
                                  <CardHeader className="pb-3 sm:pb-6">
                                    <div className="flex items-center justify-between">
                                      <CardTitle className="text-base sm:text-lg font-semibold text-gray-900">Your Info</CardTitle>
                                      <div {...provided.dragHandleProps} className="cursor-grab active:cursor-grabbing">
                                        <GripVertical className="h-4 w-4 text-gray-400" />
                                      </div>
                                    </div>
                                  </CardHeader>
                                  <CardContent className="space-y-3 sm:space-y-4">
                                    <div>
                                      <label className="text-sm font-medium text-gray-700 mb-1 block">Seniority Number</label>
                                      <Input
                                        value={seniorityNumber}
                                        onChange={(e) => setSeniorityNumber(e.target.value)}
                                        placeholder="Enter seniority number"
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
                                  </CardContent>
                                </Card>
                              )}

                              {cardId === 'stats' && (
                                <Card className={`${snapshot.isDragging ? 'shadow-lg' : ''}`}>
                                  <CardHeader className="pb-3 sm:pb-6">
                                    <div className="flex items-center justify-between">
                                      <CardTitle className="text-base sm:text-lg font-semibold text-gray-900">Quick Stats</CardTitle>
                                      <div {...provided.dragHandleProps} className="cursor-grab active:cursor-grabbing">
                                        <GripVertical className="h-4 w-4 text-gray-400" />
                                      </div>
                                    </div>
                                  </CardHeader>
                                  <CardContent>
                                    <StatsPanel pairings={sortedPairings || []} />
                                  </CardContent>
                                </Card>
                              )}
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </div>

          {/* Right Column - Main Content */}
          <div className="xl:col-span-3">
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
                            placeholder="Search pairings..."
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
                                {filter.label}: {filter.value}
                                <X 
                                  className="h-3 w-3 cursor-pointer" 
                                  onClick={() => removeFilter(filter.key)}
                                />
                              </Badge>
                            ))}
                          </div>
                        )}

                        {/* Filter Controls */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
                          <Select onValueChange={(value) => {
                            if (value === 'clear') {
                              removeFilter('creditMin');
                            } else {
                              addFilter('creditMin', 'Credit Min', parseFloat(value));
                            }
                          }}>
                            <SelectTrigger>
                              <SelectValue placeholder="Credit Min" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="clear">Any</SelectItem>
                              <SelectItem value="4.0">4:00</SelectItem>
                              <SelectItem value="4.5">4:30</SelectItem>
                              <SelectItem value="5.0">5:00</SelectItem>
                              <SelectItem value="5.5">5:30</SelectItem>
                              <SelectItem value="6.0">6:00</SelectItem>
                              <SelectItem value="6.5">6:30</SelectItem>
                              <SelectItem value="7.0">7:00</SelectItem>
                              <SelectItem value="7.5">7:30</SelectItem>
                              <SelectItem value="8.0">8:00</SelectItem>
                            </SelectContent>
                          </Select>

                          <Select onValueChange={(value) => {
                            if (value === 'clear') {
                              removeFilter('creditMax');
                            } else {
                              addFilter('creditMax', 'Credit Max', parseFloat(value));
                            }
                          }}>
                            <SelectTrigger>
                              <SelectValue placeholder="Credit Max" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="clear">Any</SelectItem>
                              <SelectItem value="5.0">5:00</SelectItem>
                              <SelectItem value="5.5">5:30</SelectItem>
                              <SelectItem value="6.0">6:00</SelectItem>
                              <SelectItem value="6.5">6:30</SelectItem>
                              <SelectItem value="7.0">7:00</SelectItem>
                              <SelectItem value="7.5">7:30</SelectItem>
                              <SelectItem value="8.0">8:00</SelectItem>
                              <SelectItem value="9.0">9:00</SelectItem>
                              <SelectItem value="10.0">10:00</SelectItem>
                              <SelectItem value="12.0">12:00</SelectItem>
                            </SelectContent>
                          </Select>

                          <Select onValueChange={(value) => {
                            if (value === 'clear') {
                              removeFilter('blockMin');
                            } else {
                              addFilter('blockMin', 'Block Min', parseFloat(value));
                            }
                          }}>
                            <SelectTrigger>
                              <SelectValue placeholder="Block Min" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="clear">Any</SelectItem>
                              <SelectItem value="3.0">3:00</SelectItem>
                              <SelectItem value="3.5">3:30</SelectItem>
                              <SelectItem value="4.0">4:00</SelectItem>
                              <SelectItem value="4.5">4:30</SelectItem>
                              <SelectItem value="5.0">5:00</SelectItem>
                              <SelectItem value="5.5">5:30</SelectItem>
                              <SelectItem value="6.0">6:00</SelectItem>
                              <SelectItem value="6.5">6:30</SelectItem>
                              <SelectItem value="7.0">7:00</SelectItem>
                            </SelectContent>
                          </Select>

                          <Select onValueChange={(value) => {
                            if (value === 'clear') {
                              removeFilter('blockMax');
                            } else {
                              addFilter('blockMax', 'Block Max', parseFloat(value));
                            }
                          }}>
                            <SelectTrigger>
                              <SelectValue placeholder="Block Max" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="clear">Any</SelectItem>
                              <SelectItem value="4.0">4:00</SelectItem>
                              <SelectItem value="4.5">4:30</SelectItem>
                              <SelectItem value="5.0">5:00</SelectItem>
                              <SelectItem value="5.5">5:30</SelectItem>
                              <SelectItem value="6.0">6:00</SelectItem>
                              <SelectItem value="6.5">6:30</SelectItem>
                              <SelectItem value="7.0">7:00</SelectItem>
                              <SelectItem value="8.0">8:00</SelectItem>
                              <SelectItem value="9.0">9:00</SelectItem>
                              <SelectItem value="10.0">10:00</SelectItem>
                            </SelectContent>
                          </Select>

                          <Select onValueChange={(value) => {
                            if (value === "short") {
                              addFilter('tafbMax', 'TAFB < 50hrs', 50);
                              removeFilter('tafbMin');
                            } else if (value === "medium") {
                              addFilter('tafbMin', 'TAFB 50-80hrs', 50);
                              addFilter('tafbMax', 'TAFB 50-80hrs', 80);
                            } else if (value === "long") {
                              addFilter('tafbMin', 'TAFB > 80hrs', 80);
                              removeFilter('tafbMax');
                            } else {
                              // Clear TAFB filters
                              removeFilter('tafbMin');
                              removeFilter('tafbMax');
                            }
                          }}>
                            <SelectTrigger>
                              <SelectValue placeholder="TAFB" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="any">Any TAFB</SelectItem>
                              <SelectItem value="short">Short (&lt; 50hrs)</SelectItem>
                              <SelectItem value="medium">Medium (50-80hrs)</SelectItem>
                              <SelectItem value="long">Long (&gt; 80hrs)</SelectItem>
                            </SelectContent>
                          </Select>

                          <Select onValueChange={(value) => {
                            if (value === 'clear') {
                              removeFilter('holdProbabilityMin');
                            } else {
                              addFilter('holdProbabilityMin', 'Hold Prob Min', parseFloat(value));
                            }
                          }}>
                            <SelectTrigger>
                              <SelectValue placeholder="Hold Prob Min" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="clear">Any</SelectItem>
                              <SelectItem value="0.5">50%</SelectItem>
                              <SelectItem value="0.6">60%</SelectItem>
                              <SelectItem value="0.7">70%</SelectItem>
                              <SelectItem value="0.8">80%</SelectItem>
                              <SelectItem value="0.9">90%</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Results */}
                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-gray-900">Pairing Results</h3>
                            <span className="text-sm text-gray-500">
                              {latestBidPackage.month} {latestBidPackage.year} - {sortedPairings.length} pairings
                            </span>
                          </div>
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
    </div>
  );
}