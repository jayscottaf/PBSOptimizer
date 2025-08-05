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
  Info
} from "lucide-react";
import { FileUpload } from "@/components/ui/file-upload";
import { StatsPanel } from "@/components/stats-panel";
import { PairingTable } from "@/components/pairing-table";
import { PairingChat } from "@/components/pairing-chat";
import { FiltersPanel } from "@/components/filters-panel";
import { PairingModal } from "@/components/pairing-modal";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

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
      setSortDirection("asc");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Modern Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-2">
                <Plane className="text-blue-600 h-6 w-6" />
                <h1 className="text-xl font-bold text-gray-900">Delta PBS Optimizer</h1>
              </div>
              <nav className="hidden md:flex items-center space-x-1 bg-gray-100 rounded-lg p-1">
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
            <div className="flex items-center space-x-4">
              <div className="hidden sm:flex items-center space-x-2 text-sm text-gray-600">
                <span>Seniority:</span>
                <span className="font-mono font-medium text-blue-600">#{seniorityNumber}</span>
                <span className="text-gray-400">|</span>
                <span className="font-medium">{base} {aircraft} FO</span>
              </div>
              <div className="flex items-center space-x-2">
                <Button variant="ghost" size="sm">
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm">
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm">
                  <Settings className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm">
                  <User className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">

          {/* Left Column */}
          <div className="lg:col-span-1 space-y-6">

            {/* Upload Bid Package Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-gray-900">Upload Bid Package</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors">
                  <CloudUpload className="mx-auto h-12 w-12 text-gray-400" />
                  <div className="mt-4">
                    <FileUpload 
                      onUpload={(file) => {
                        console.log("File uploaded:", file);
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

                              if (latestPackage?.status === 'completed') {
                                // Refresh all data when processing is complete
                                refetchBidPackages();
                                if (selectedPairing?.id !== latestPackage.id) {
                                  setSelectedPairing(latestPackage); // Assuming we want to set the latest completed package
                                }
                                return true;
                              } else if (latestPackage?.status === 'failed') {
                                console.error('Bid package processing failed');
                                return true;
                              } else if (attempts < maxAttempts) {
                                setTimeout(checkStatus, 1000);
                              }
                            } catch (error) {
                              console.error('Error checking status:', error);
                              if (attempts < maxAttempts) {
                                setTimeout(checkStatus, 1000);
                              }
                            }
                            return false;
                          };

                          checkStatus();
                        };

                        pollForCompletion();
                      }}
                    />
                  </div>
                </div>
                <div className="text-xs text-gray-500 space-y-2">
                  <div className="flex items-center space-x-2">
                    <Info className="h-3 w-3" />
                    <span>Supports NYC A220 bid packages (PDF or TXT format)</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <BarChart2 className="h-3 w-3" />
                    <span>Processing extracts all pairing data for search</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Your Info Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-gray-900">Your Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
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

            {/* Quick Stats Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-gray-900">Quick Stats</CardTitle>
              </CardHeader>
              <CardContent>
                <StatsPanel pairings={pairings} />
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Main Content */}
          <div className="lg:col-span-3">
            <Card>
              <CardContent className="p-0">
                <Tabs defaultValue="search" className="w-full">
                  <div className="border-b">
                    <TabsList className="h-12 w-full justify-start rounded-none bg-transparent p-0">
                      <TabsTrigger 
                        value="search" 
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent"
                      >
                        Search & Filter
                      </TabsTrigger>
                      <TabsTrigger 
                        value="analysis"
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent"
                      >
                        Analysis
                      </TabsTrigger>
                      <TabsTrigger 
                        value="assistant"
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent"
                      >
                        AI Assistant
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  {/* Search & Filter Tab */}
                  <TabsContent value="search" className="p-6 space-y-6">
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
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                            } else if (value === "medium") {
                              addFilter('tafbMin', 'TAFB 50-80hrs', 50);
                              addFilter('tafbMax', 'TAFB 50-80hrs', 80);
                            } else if (value === "long") {
                              addFilter('tafbMin', 'TAFB > 80hrs', 80);
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

                          <Select onValueChange={(value) => addFilter('holdProbabilityMin', 'Hold Prob Min', value)}>
                            <SelectTrigger>
                              <SelectValue placeholder="Hold Prob Min" />
                            </SelectTrigger>
                            <SelectContent>
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
                              {latestBidPackage.month} {latestBidPackage.year} - {pairings.length} pairings
                            </span>
                          </div>
                          <PairingTable 
                            pairings={pairings || []} 
                            onSort={handleSort}
                            sortColumn={sortColumn}
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
                  <TabsContent value="analysis" className="p-6">
                    <div className="text-center py-12">
                      <BarChart2 className="mx-auto h-24 w-24 text-gray-300" />
                      <h3 className="mt-4 text-lg font-medium text-gray-900">No Data for Analysis</h3>
                      <p className="mt-2 text-sm text-gray-500">
                        Advanced analytics and visualizations will appear here once you have pairing data.
                      </p>
                    </div>
                  </TabsContent>

                  {/* AI Assistant Tab */}
                  <TabsContent value="assistant" className="p-6">
                    {latestBidPackage ? (
                      <PairingChat bidPackageId={latestBidPackage.id} />
                    ) : (
                      <div className="text-center py-12">
                        <User className="mx-auto h-24 w-24 text-gray-300" />
                        <h3 className="mt-4 text-lg font-medium text-gray-900">AI Assistant Not Active</h3>
                        <p className="mt-2 text-sm text-gray-500">
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

      {/* Pairing Modal */}
      {selectedPairing && (
        <PairingModal 
          pairingId={selectedPairing.id} 
          onClose={() => setSelectedPairing(null)} 
        />
      )}
    </div>
  );
}