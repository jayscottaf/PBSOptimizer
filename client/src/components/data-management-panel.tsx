import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Database, Package, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

interface PositionInfo {
  position: string;
  count: number;
  linkedCount: number;
}

interface BidPackageInfo {
  id: number;
  month: string;
  year: number;
  base: string;
  aircraft: string;
  status: string;
  uploadedAt: string;
  isCurrent: boolean;
  hasReasonsReport: boolean;
  reasonsReportCount: number;
  linkedRecords: number;
  positions: PositionInfo[];
}

interface DataHealthResponse {
  bidPackages: {
    total: number;
    current: string | null;
    list: BidPackageInfo[];
  };
  historicalRecords: {
    total: number;
    linkedToBidPackage: number;
    unlinked: number;
  };
}

export function DataManagementPanel() {
  const [data, setData] = useState<DataHealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDataHealth();
  }, []);

  const fetchDataHealth = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/data-health');
      if (!response.ok) {
        throw new Error('Failed to fetch data health');
      }
      const result = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-500">Loading data...</span>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-red-500">
            <AlertCircle className="h-8 w-8 mx-auto mb-2" />
            <p>{error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { bidPackages, historicalRecords } = data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Database className="h-5 w-5" />
            Data Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
              <div className="text-blue-600 dark:text-blue-400 font-medium">Bid Packages</div>
              <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{bidPackages.total}</div>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
              <div className="text-green-600 dark:text-green-400 font-medium">Historical Records</div>
              <div className="text-2xl font-bold text-green-700 dark:text-green-300">{historicalRecords.total}</div>
              <div className="text-xs text-green-600 dark:text-green-400">
                {historicalRecords.linkedToBidPackage} linked
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Package className="h-5 w-5" />
            Uploaded Bid Packages
          </CardTitle>
        </CardHeader>
        <CardContent>
          {bidPackages.list.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No bid packages uploaded yet</p>
          ) : (
            <div className="space-y-2">
              {bidPackages.list.map((pkg) => (
                <div
                  key={pkg.id}
                  data-testid={`package-row-${pkg.id}`}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    pkg.isCurrent 
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' 
                      : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Package className={`h-4 w-4 ${pkg.isCurrent ? 'text-blue-500' : 'text-gray-400'}`} />
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {pkg.month} {pkg.year}
                        {pkg.isCurrent && (
                          <Badge variant="default" className="text-xs bg-blue-500">Current</Badge>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {pkg.base} {pkg.aircraft}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {pkg.hasReasonsReport ? (
                      <div className="flex flex-col items-end gap-1" data-testid={`status-linked-${pkg.id}`}>
                        <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                          <CheckCircle className="h-4 w-4" />
                          <span className="text-xs">
                            {pkg.reasonsReportCount} records
                          </span>
                        </div>
                        {pkg.positions.length > 0 && (
                          <div className="flex gap-1">
                            {pkg.positions.map((pos, idx) => (
                              <Badge 
                                key={idx} 
                                variant="outline" 
                                className="text-xs bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                              >
                                {pos.position}: {pos.count}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400" data-testid={`status-no-report-${pkg.id}`}>
                        <FileText className="h-4 w-4" />
                        <span className="text-xs">No reasons report</span>
                      </div>
                    )}
                    
                    <Badge 
                      variant={pkg.status === 'completed' ? 'outline' : 'secondary'}
                      className="text-xs"
                    >
                      {pkg.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {historicalRecords.unlinked > 0 && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-300">
                  {historicalRecords.unlinked} historical records without bid package data
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                  Upload the corresponding bid packages for these months to enable accurate fingerprint matching.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
