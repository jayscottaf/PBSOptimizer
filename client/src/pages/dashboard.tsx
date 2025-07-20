
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
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface SearchFilters {
  search?: string;
  creditMin?: number;
  creditMax?: number;
  blockMin?: number;
  blockMax?: number;
  tafb?: string;
  holdProbabilityMin?: number;
  pairingDays?: number;
  pairingDaysMin?: number;
  pairingDaysMax?: number;
}

export default function Dashboard() {
  const [filters, setFilters] = useState<SearchFilters>({});
  const [activeFilters, setActiveFilters] = useState<Array<{key: string, label: string, value: any}>>([]);
  const [seniorityNumber, setSeniorityNumber] = useState("15860");
  const [base, setBase] = useState("NYC");
  const [aircraft, setAircraft] = useState("A220");

  const { data: bidPackages = [], refetch: refetchBidPackages } = useQuery({
    queryKey: ["bidPackages"],
    queryFn: api.getBidPackages,
  });

  const latestBidPackage = (bidPackages as any[]).find((pkg: any) => pkg.status === "completed");
  
  const { data: pairings = [] } = useQuery({
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
    if (value) {
      setActiveFilters(prev => [
        ...prev.filter(f => f.key !== key),
        { key, label, value }
      ]);
      setFilters(prev => ({ ...prev, [key]: value }));
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
                          <Select onValueChange={(value) => addFilter('creditRange', 'Credit Range', value)}>
                            <SelectTrigger>
                              <SelectValue placeholder="Credit Range" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">Low (0-15)</SelectItem>
                              <SelectItem value="medium">Medium (16-25)</SelectItem>
                              <SelectItem value="high">High (26+)</SelectItem>
                            </SelectContent>
                          </Select>

                          <Select onValueChange={(value) => addFilter('blockTime', 'Block Time', value)}>
                            <SelectTrigger>
                              <SelectValue placeholder="Block Time" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="short">Short (0-15h)</SelectItem>
                              <SelectItem value="medium">Medium (16-20h)</SelectItem>
                              <SelectItem value="long">Long (21h+)</SelectItem>
                            </SelectContent>
                          </Select>

                          <Select onValueChange={(value) => addFilter('tafb', 'TAFB', value)}>
                            <SelectTrigger>
                              <SelectValue placeholder="TAFB" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1-day">1 Day</SelectItem>
                              <SelectItem value="2-day">2 Days</SelectItem>
                              <SelectItem value="3-day">3 Days</SelectItem>
                              <SelectItem value="4-day">4+ Days</SelectItem>
                            </SelectContent>
                          </Select>

                          <Select onValueChange={(value) => addFilter('holdProbability', 'Hold Probability', value)}>
                            <SelectTrigger>
                              <SelectValue placeholder="Hold Probability" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="high">High (80%+)</SelectItem>
                              <SelectItem value="medium">Medium (50-80%)</SelectItem>
                              <SelectItem value="low">Low (&lt;50%)</SelectItem>
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
                          <PairingTable pairings={pairings} />
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
    </div>
  );
}
