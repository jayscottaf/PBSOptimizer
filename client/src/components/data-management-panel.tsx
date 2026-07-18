import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Database, Package, FileText, CheckCircle, AlertCircle, Loader2, FileStack, ChevronDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

interface UploadedReport {
  month: string;
  year: number;
  base: string;
  aircraft: string;
  count: number;
  uploadedAt: string;
}

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
  pairingCount: number;
  positions: PositionInfo[];
}

interface UnlinkedMonth {
  month: string;
  year: number;
  count: number;
}

interface DataHealthResponse {
  bidPackages: {
    total: number;
    current: string | null;
    statusCounts?: Record<string, number>;
    list: BidPackageInfo[];
  };
  historicalRecords: {
    total: number;
    linkedToBidPackage: number;
    unlinked: number;
    unlinkedMonths: UnlinkedMonth[];
  };
}

export function DataManagementPanel() {
  const [expandedPackages, setExpandedPackages] = useState<Set<number>>(new Set());
  const [showAllPackages, setShowAllPackages] = useState(false);
  const [showAllReports, setShowAllReports] = useState(false);

  const { data, isLoading, error } = useQuery<DataHealthResponse>({
    queryKey: ['data-health'],
    queryFn: async () => {
      const response = await fetch('/api/data-health');
      if (!response.ok) {
        throw new Error('Failed to fetch data health');
      }
      return response.json();
    },
    staleTime: 10 * 1000,
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasProcessing = data?.bidPackages?.list?.some(pkg => pkg.status === 'processing');
      return hasProcessing ? 3000 : false;
    },
  });

  const { data: reasonsReports = [], isLoading: isLoadingReports } = useQuery<UploadedReport[]>({
    queryKey: ['reasons-reports'],
    queryFn: async () => {
      const response = await fetch('/api/reasons-reports');
      if (!response.ok) {
        throw new Error('Failed to fetch reasons reports');
      }
      return response.json();
    },
    staleTime: 30 * 1000,
  });

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
            <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const { bidPackages, historicalRecords } = data;

  // Find the current package
  const currentPackage = bidPackages.list.find(pkg => pkg.isCurrent);
  const otherPackages = bidPackages.list.filter(pkg => !pkg.isCurrent);
  const statusCounts = bidPackages.statusCounts || {};
  const problemPackages = bidPackages.list.filter(
    pkg =>
      pkg.status === 'failed' ||
      pkg.status === 'processing' ||
      (pkg.status === 'completed' && pkg.pairingCount === 0)
  );
  const statusText = Object.entries(statusCounts)
    .map(([status, count]) => `${count} ${status}`)
    .join(', ');

  // Normalize month format: "January" or "JAN" -> "JAN"
  const normalizeMonth = (month: string): string => {
    const upper = month.toUpperCase();
    const monthMap: Record<string, string> = {
      JANUARY: 'JAN', FEBRUARY: 'FEB', MARCH: 'MAR', APRIL: 'APR',
      MAY: 'MAY', JUNE: 'JUN', JULY: 'JUL', AUGUST: 'AUG',
      SEPTEMBER: 'SEP', OCTOBER: 'OCT', NOVEMBER: 'NOV', DECEMBER: 'DEC',
    };
    return monthMap[upper] || upper.substring(0, 3);
  };

  // Check if a reasons report has a matching bid package
  const hasMatchingBidPackage = (report: UploadedReport) => {
    return bidPackages.list.some(pkg =>
      normalizeMonth(pkg.month) === normalizeMonth(report.month) &&
      pkg.year === report.year
    );
  };

  const togglePackage = (id: number) => {
    const newExpanded = new Set(expandedPackages);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedPackages(newExpanded);
  };

  return (
    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
      {/* Summary Stats */}
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
              {statusText && (
                <div className="text-xs text-blue-600 dark:text-blue-400">
                  {statusText}
                </div>
              )}
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

      {problemPackages.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-800">
          <CardContent className="py-3">
            <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
              <AlertCircle className="h-4 w-4 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium">Data diagnostics need attention</div>
                <div className="text-xs mt-1">
                  {problemPackages.length} package
                  {problemPackages.length > 1 ? 's' : ''} are failed,
                  processing, or completed with no pairings.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bid Packages */}
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
              {/* Current Package - Always Expanded */}
              {currentPackage && (
                <div
                  data-testid={`package-row-${currentPackage.id}`}
                  className="rounded-lg border bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
                >
                  <div className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-3">
                      <Package className="h-4 w-4 text-blue-500" />
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {currentPackage.month} {currentPackage.year}
                          <Badge variant="default" className="text-xs bg-blue-500">Current</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {currentPackage.base} {currentPackage.aircraft} |{' '}
                          {currentPackage.pairingCount} pairings
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {currentPackage.hasReasonsReport ? (
                        <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                          <CheckCircle className="h-4 w-4" />
                          <span className="text-xs">{currentPackage.reasonsReportCount} awards</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                          <AlertCircle className="h-4 w-4" />
                          <span className="text-xs">No awards data</span>
                        </div>
                      )}
                      <Badge
                        variant={currentPackage.status === 'completed' ? 'outline' : 'secondary'}
                        className={`text-xs ${currentPackage.status === 'processing' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 animate-pulse' : ''}`}
                      >
                        {currentPackage.status === 'processing' && <Loader2 className="h-3 w-3 mr-1 animate-spin inline" />}
                        {currentPackage.status}
                      </Badge>
                    </div>
                  </div>

                  {currentPackage.status === 'completed' &&
                    currentPackage.pairingCount === 0 && (
                      <div className="px-3 pb-3 text-xs text-red-600 dark:text-red-400">
                        Completed package has no pairings. Re-upload or inspect parser logs.
                      </div>
                    )}

                  {/* Position breakdown for current */}
                  {currentPackage.positions.length > 0 && (
                    <div className="px-3 pb-3 flex gap-1 flex-wrap">
                      {currentPackage.positions.map((pos, idx) => (
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
              )}

              {/* Other Packages - Collapsible */}
              {otherPackages.length > 0 && (
                <>
                  <button
                    onClick={() => setShowAllPackages(!showAllPackages)}
                    className="w-full flex items-center justify-between p-2 text-sm text-muted-foreground hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  >
                    <span>{otherPackages.length} other package{otherPackages.length > 1 ? 's' : ''}</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${showAllPackages ? 'rotate-180' : ''}`} />
                  </button>

                  {showAllPackages && (
                    <div className="space-y-2 pl-2 border-l-2 border-border">
                      {otherPackages.map((pkg) => (
                        <div
                          key={pkg.id}
                          data-testid={`package-row-${pkg.id}`}
                          className="rounded-lg border bg-muted border-border"
                        >
                          <button
                            onClick={() => togglePackage(pkg.id)}
                            className="w-full flex items-center justify-between p-3 text-left"
                          >
                            <div className="flex items-center gap-3">
                              <Package className="h-4 w-4 text-gray-400" />
                              <div>
                                <div className="font-medium">{pkg.month} {pkg.year}</div>
                                <div className="text-xs text-muted-foreground">
                                  {pkg.base} {pkg.aircraft} | {pkg.pairingCount} pairings
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {pkg.hasReasonsReport ? (
                                <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                                  <CheckCircle className="h-4 w-4" />
                                  <span className="text-xs">{pkg.reasonsReportCount} awards</span>
                                </div>
                              ) : (
                                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                              )}
                              <Badge
                                variant={pkg.status === 'completed' ? 'outline' : 'secondary'}
                                className={`text-xs ${pkg.status === 'failed' ? 'border-red-300 text-red-700 dark:text-red-300' : ''}`}
                              >
                                {pkg.status}
                              </Badge>
                              <ChevronDown className={`h-4 w-4 transition-transform ${expandedPackages.has(pkg.id) ? 'rotate-180' : ''}`} />
                            </div>
                          </button>

                          {expandedPackages.has(pkg.id) && pkg.positions.length > 0 && (
                            <div className="px-3 pb-3 flex gap-1 flex-wrap">
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
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reasons Reports */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileStack className="h-5 w-5" />
            Uploaded Reasons Reports
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingReports ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              <span className="ml-2 text-gray-500 text-sm">Loading reports...</span>
            </div>
          ) : reasonsReports.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No reasons reports uploaded yet</p>
          ) : (
            <div className="space-y-2">
              {/* Show first report always */}
              {reasonsReports.slice(0, 1).map((report, idx) => {
                const isLinked = hasMatchingBidPackage(report);
                return (
                  <div
                    key={idx}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      isLinked
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                        : 'bg-muted border-border'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <FileText className={`h-4 w-4 ${isLinked ? 'text-green-500' : 'text-gray-400'}`} />
                      <div>
                        <div className="font-medium">
                          {report.month} {report.year}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {report.base} {report.aircraft}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isLinked ? (
                        <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                          <CheckCircle className="h-4 w-4" />
                          <span className="text-xs">Has package</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                          <AlertCircle className="h-4 w-4" />
                          <span className="text-xs">Missing package</span>
                        </div>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {report.count} awards
                      </Badge>
                    </div>
                  </div>
                );
              })}

              {/* Other reports - Collapsible */}
              {reasonsReports.length > 1 && (
                <>
                  <button
                    onClick={() => setShowAllReports(!showAllReports)}
                    className="w-full flex items-center justify-between p-2 text-sm text-muted-foreground hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  >
                    <span>{reasonsReports.length - 1} other report{reasonsReports.length > 2 ? 's' : ''}</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${showAllReports ? 'rotate-180' : ''}`} />
                  </button>

                  {showAllReports && (
                    <div className="space-y-2 pl-2 border-l-2 border-border">
                      {reasonsReports.slice(1).map((report, idx) => {
                        const isLinked = hasMatchingBidPackage(report);
                        return (
                          <div
                            key={idx + 1}
                            className={`flex items-center justify-between p-3 rounded-lg border ${
                              isLinked
                                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                                : 'bg-muted border-border'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <FileText className={`h-4 w-4 ${isLinked ? 'text-green-500' : 'text-gray-400'}`} />
                              <div>
                                <div className="font-medium">
                                  {report.month} {report.year}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {report.base} {report.aircraft}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {isLinked ? (
                                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                              ) : (
                                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                              )}
                              <Badge variant="outline" className="text-xs">
                                {report.count} awards
                              </Badge>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
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
                {historicalRecords.unlinkedMonths && historicalRecords.unlinkedMonths.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="text-sm text-amber-700 dark:text-amber-400">Missing:</span>
                    {historicalRecords.unlinkedMonths.map((m, idx) => (
                      <Badge
                        key={idx}
                        variant="outline"
                        className="text-xs bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700"
                      >
                        {m.month} {m.year} ({m.count})
                      </Badge>
                    ))}
                  </div>
                )}
                <p className="text-sm text-amber-700 dark:text-amber-400 mt-2">
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
