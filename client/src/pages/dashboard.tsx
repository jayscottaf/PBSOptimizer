import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type SearchFilters } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileUpload } from "@/components/ui/file-upload";
import { PairingTable } from "@/components/pairing-table";
import { PairingModal } from "@/components/pairing-modal";
import { FiltersPanel } from "@/components/filters-panel";
import { SeniorityChart } from "@/components/seniority-chart";
import { StatsPanel } from "@/components/stats-panel";
import { Plane, Settings, Search, Plus, X } from "lucide-react";

export default function Dashboard() {
  const [seniorityNumber, setSeniorityNumber] = useState("15860");
  const [base, setBase] = useState("NYC (JFK/LGA)");
  const [aircraft, setAircraft] = useState("A220");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPairingId, setSelectedPairingId] = useState<number | null>(null);
  const [activeFilters, setActiveFilters] = useState<string[]>(["High Credit"]);
  const [searchFilters, setSearchFilters] = useState<SearchFilters>({});

  const { data: bidPackages = [], refetch: refetchBidPackages } = useQuery({
    queryKey: ["/api/bid-packages"],
    refetchInterval: 5000, // Auto-refresh every 5 seconds to show status updates
  });

  const { data: pairings = [], refetch: refetchPairings } = useQuery({
    queryKey: ["/api/pairings/search"],
    queryFn: () => api.searchPairings({ ...searchFilters, search: searchQuery }),
  });

  const latestBidPackage = bidPackages[0];

  const handleSearch = () => {
    refetchPairings();
  };

  const removeFilter = (filter: string) => {
    setActiveFilters(activeFilters.filter(f => f !== filter));
  };

  const addFilter = () => {
    // This would open a filter selection dialog
    console.log("Add filter clicked");
  };

  const handlePairingClick = (pairingId: number) => {
    setSelectedPairingId(pairingId);
  };

  const closePairingModal = () => {
    setSelectedPairingId(null);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Plane className="text-blue-600 h-6 w-6" />
                <h1 className="text-xl font-bold text-gray-900">Delta PBS Optimizer</h1>
              </div>
              <div className="hidden md:flex items-center space-x-1 bg-gray-100 rounded-lg p-1">
                <Button variant="secondary" size="sm" className="bg-white text-gray-900 shadow-sm">
                  Bid Analysis
                </Button>
                <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900">
                  History
                </Button>
                <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900">
                  Predictions
                </Button>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="hidden sm:flex items-center space-x-2 text-sm text-gray-600">
                <span>Seniority:</span>
                <span className="font-mono font-medium text-blue-600">#{seniorityNumber}</span>
                <span className="text-gray-400">|</span>
                <span>NYC A220 FO</span>
              </div>
              <Button variant="ghost" size="sm">
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          
          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-6">
            {/* Upload Section */}
            <Card>
              <CardContent className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Upload Bid Package</h2>
                <div className="space-y-4">
                  <FileUpload 
                    onUpload={(file) => {
                      console.log("File uploaded:", file);
                      // Refresh the bid packages list to show new upload
                      refetchBidPackages();
                    }}
                  />
                  <div className="text-xs text-gray-500 space-y-1">
                    <div className="flex items-center">
                      <span>ℹ️ Supports NYC A220 bid packages (PDF format)</span>
                    </div>
                    <div>
                      <span>📊 Processing extracts all pairing data for search</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Bid Package Status */}
            {bidPackages.length > 0 && (
              <Card>
                <CardContent className="p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Bid Package Status</h2>
                  <div className="space-y-3">
                    {bidPackages.slice(0, 3).map((pkg) => (
                      <div key={pkg.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex-1">
                          <div className="font-medium text-sm text-gray-900">{pkg.name}</div>
                          <div className="text-xs text-gray-500">{pkg.month} {pkg.year}</div>
                        </div>
                        <div>
                          {pkg.status === 'processing' && (
                            <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                              Processing...
                            </Badge>
                          )}
                          {pkg.status === 'completed' && (
                            <Badge variant="default" className="bg-green-100 text-green-800">
                              Ready to Search
                            </Badge>
                          )}
                          {pkg.status === 'failed' && (
                            <Badge variant="destructive" className="bg-red-100 text-red-800">
                              Failed
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Seniority Input */}
            <Card>
              <CardContent className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Info</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Seniority Number</label>
                    <Input 
                      type="number" 
                      placeholder="15860" 
                      value={seniorityNumber}
                      onChange={(e) => setSeniorityNumber(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Base</label>
                    <Select value={base} onValueChange={setBase}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NYC (JFK/LGA)">NYC (JFK/LGA)</SelectItem>
                        <SelectItem value="ATL">ATL</SelectItem>
                        <SelectItem value="LAX">LAX</SelectItem>
                        <SelectItem value="SEA">SEA</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Aircraft</label>
                    <Select value={aircraft} onValueChange={setAircraft}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="A220">A220</SelectItem>
                        <SelectItem value="A319/320/321">A319/320/321</SelectItem>
                        <SelectItem value="737-800/900">737-800/900</SelectItem>
                        <SelectItem value="757/767">757/767</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Quick Stats */}
            <StatsPanel pairings={pairings} />
          </div>

          {/* Main Panel */}
          <div className="lg:col-span-3 space-y-6">
            
            {/* Search and Filters */}
            <Card>
              <CardContent className="p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
                  <h2 className="text-lg font-semibold text-gray-900">Pairing Analysis</h2>
                  <div className="mt-4 sm:mt-0 flex items-center space-x-2">
                    <span className="text-sm text-gray-500">
                      {latestBidPackage ? `${latestBidPackage.month} ${latestBidPackage.year} Bid Package` : 'No Bid Package'}
                    </span>
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  </div>
                </div>

                {/* Search Bar */}
                <div className="mb-6">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                    <Input 
                      className="pl-10"
                      placeholder="Search pairings by number, destinations, or criteria..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    />
                  </div>
                </div>

                {/* Filter Pills */}
                <div className="flex flex-wrap gap-2 mb-6">
                  {activeFilters.map((filter) => (
                    <Badge key={filter} variant="default" className="bg-blue-600 hover:bg-blue-700">
                      <span>{filter}</span>
                      <X className="ml-2 h-3 w-3 cursor-pointer" onClick={() => removeFilter(filter)} />
                    </Badge>
                  ))}
                  <Button variant="outline" size="sm" onClick={addFilter}>
                    <Plus className="h-3 w-3 mr-1" />
                    Add Filter
                  </Button>
                </div>

                {/* Advanced Filters */}
                <FiltersPanel onFiltersChange={setSearchFilters} />
              </CardContent>
            </Card>

            {/* Results Table */}
            <PairingTable 
              pairings={pairings} 
              onPairingClick={handlePairingClick}
            />

            {/* Seniority Analysis Chart */}
            <SeniorityChart />
          </div>
        </div>
      </div>

      {/* Pairing Detail Modal */}
      {selectedPairingId && (
        <PairingModal 
          pairingId={selectedPairingId}
          onClose={closePairingModal}
        />
      )}
    </div>
  );
}
