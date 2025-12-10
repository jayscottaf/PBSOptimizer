import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, X, Calendar as CalendarIcon, MapPin } from 'lucide-react';
import { SearchFilters } from '@/lib/api';
import { api } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
interface FilterOption {
  key: string;
  label: string;
  dataOptions: Array<{
    value: any;
    label: string;
    filterKey?: string; // For cases where we need different filter keys
    additionalFilter?: { key: string; value: any }; // For complex filters
  }>;
}

interface SmartFilterSystemProps {
  pairings: any[];
  onFiltersChange: (filters: SearchFilters) => void;
  activeFilters: Array<{ key: string; label: string; value: any }>;
  onClearFilters: () => void;
  bidPackage?: { month: string; year: number };
  bidPackageId?: number;
}

const filterOptions: FilterOption[] = [
  {
    key: 'pairingDays',
    label: 'Pairing Days',
    dataOptions: [
      { value: 1, label: '1 Day (Turns)' },
      { value: 2, label: '2 Days' },
      { value: 3, label: '3 Days' },
      { value: 4, label: '4 Days' },
      { value: 5, label: '5+ Days', filterKey: 'pairingDaysMin' },
    ],
  },
  {
    key: 'creditHours',
    label: 'Credit Hours',
    dataOptions: [
      {
        value: 4.0,
        label: 'Light (4:00-8:00)',
        filterKey: 'creditMin',
        additionalFilter: { key: 'creditMax', value: 8.0 },
      },
      {
        value: 8.0,
        label: 'Moderate (8:00-15:00)',
        filterKey: 'creditMin',
        additionalFilter: { key: 'creditMax', value: 15.0 },
      },
      {
        value: 15.0,
        label: 'Heavy (15:00-25:00)',
        filterKey: 'creditMin',
        additionalFilter: { key: 'creditMax', value: 25.0 },
      },
      { value: 25.0, label: 'Max Credit (25:00+)', filterKey: 'creditMin' },
    ],
  },

  {
    key: 'blockHours',
    label: 'Block Hours',
    dataOptions: [
      {
        value: 3.0,
        label: 'Short (3:00-6:00)',
        filterKey: 'blockMin',
        additionalFilter: { key: 'blockMax', value: 6.0 },
      },
      {
        value: 6.0,
        label: 'Medium (6:00-12:00)',
        filterKey: 'blockMin',
        additionalFilter: { key: 'blockMax', value: 12.0 },
      },
      {
        value: 12.0,
        label: 'Long (12:00-20:00)',
        filterKey: 'blockMin',
        additionalFilter: { key: 'blockMax', value: 20.0 },
      },
      { value: 20.0, label: 'Extended (20:00+)', filterKey: 'blockMin' },
      { value: 0.0, label: 'Quick Turns (≤6:00)', filterKey: 'blockMax' },
    ],
  },
  {
    key: 'holdProbability',
    label: 'Hold Probability',
    dataOptions: [
      { value: 90, label: 'Senior (90%+)', filterKey: 'holdProbabilityMin' },
      { value: 70, label: 'Good (70%+)', filterKey: 'holdProbabilityMin' },
      { value: 50, label: 'Fair (50%+)', filterKey: 'holdProbabilityMin' },
      { value: 25, label: 'Long Shot (25%+)', filterKey: 'holdProbabilityMin' },
      {
        value: 10,
        label: 'Any Chance (10%+)',
        filterKey: 'holdProbabilityMin',
      },
    ],
  },
  {
    key: 'tafb',
    label: 'Time Away (TAFB)',
    dataOptions: [
      { value: 24, label: 'Quick Turn (≤24hrs)', filterKey: 'tafbMax' },
      { value: 48, label: 'Short (≤48hrs)', filterKey: 'tafbMax' },
      { value: 72, label: 'Medium (≤72hrs)', filterKey: 'tafbMax' },
      { value: 96, label: 'Long (≤96hrs)', filterKey: 'tafbMax' },
      { value: 120, label: 'Extended (5+ days)', filterKey: 'tafbMin' },
    ],
  },

  {
    key: 'efficiency',
    label: 'Credit/Block Ratio',
    dataOptions: [
      { value: 1.3, label: 'Excellent (≥1.30)', filterKey: 'efficiency' },
      { value: 1.2, label: 'Very Good (≥1.20)', filterKey: 'efficiency' },
      { value: 1.1, label: 'Good (≥1.10)', filterKey: 'efficiency' },
      { value: 1.0, label: 'Average (≥1.00)', filterKey: 'efficiency' },
      { value: 0.9, label: 'Below Average (≥0.90)', filterKey: 'efficiency' },
    ],
  },
];

// Special filter for layover locations - will be populated dynamically
const layoverFilterOption: FilterOption = {
  key: 'layoverLocations',
  label: 'Layover Locations',
  dataOptions: [],
};

export function SmartFilterSystem({
  pairings,
  onFiltersChange,
  activeFilters,
  onClearFilters,
  bidPackage,
  bidPackageId,
}: SmartFilterSystemProps) {
  // Calculate default month for calendar based on bid package
  const defaultMonth = React.useMemo(() => {
    if (!bidPackage) return new Date();

    const monthMap: { [key: string]: number } = {
      'January': 0, 'February': 1, 'March': 2, 'April': 3,
      'May': 4, 'June': 5, 'July': 6, 'August': 7,
      'September': 8, 'October': 9, 'November': 10, 'December': 11
    };

    const monthNum = monthMap[bidPackage.month];
    if (monthNum !== undefined) {
      return new Date(bidPackage.year, monthNum, 1);
    }
    return new Date();
  }, [bidPackage]);

  // Preferred days off state
  const [selectedDaysOff, setSelectedDaysOff] = useState<Date[]>([]);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [layoverLocations, setLayoverLocations] = useState<string[]>([]);
  const [selectedLayovers, setSelectedLayovers] = useState<string[]>([]);
  const [isLayoverDialogOpen, setIsLayoverDialogOpen] = useState(false);

  // Fetch layover locations when bid package changes
  useEffect(() => {
    if (bidPackageId) {
      api.getLayoverLocations(bidPackageId).then(locations => {
        setLayoverLocations(locations);
      }).catch(() => {
        setLayoverLocations([]);
      });
    }
  }, [bidPackageId]);

  // Handle layover location toggle (multi-select)
  const toggleLayoverCity = (city: string) => {
    const newSelection = selectedLayovers.includes(city)
      ? selectedLayovers.filter(c => c !== city)
      : [...selectedLayovers, city];
    
    setSelectedLayovers(newSelection);
    
    // Apply filter with array of cities
    if (newSelection.length === 0) {
      onFiltersChange({ layoverLocations: undefined });
    } else {
      onFiltersChange({ layoverLocations: newSelection });
    }
  };

  const clearAllLayovers = () => {
    setSelectedLayovers([]);
    onFiltersChange({ layoverLocations: undefined });
  };
  // Helper functions to handle filter changes
  const onFilterApply = (
    filterKey: string,
    filterValue: any,
    displayLabel: string
  ) => {
    const newFilters: any = {};
    newFilters[filterKey] = filterValue;
    onFiltersChange(newFilters);
  };

  const onFilterClear = (filterKey: string) => {
    const newFilters: any = {};
    newFilters[filterKey] = undefined;
    onFiltersChange(newFilters);
  };
  // Handle preferred days off
  const handleDayOffSelect = (dates: Date[] | undefined) => {
    if (!dates) {
      setSelectedDaysOff([]);
      onFiltersChange({ preferredDaysOff: undefined });
      return;
    }

    setSelectedDaysOff(dates);
    if (dates.length === 0) {
      onFiltersChange({ preferredDaysOff: undefined });
    } else {
      // Apply filter directly without adding to activeFilters
      onFiltersChange({ preferredDaysOff: dates });
    }
  };

  const removeDayOff = (dateToRemove: Date) => {
    const newDaysOff = selectedDaysOff.filter(
      d => d.getTime() !== dateToRemove.getTime()
    );
    setSelectedDaysOff(newDaysOff);
    if (newDaysOff.length === 0) {
      onFiltersChange({ preferredDaysOff: undefined });
    } else {
      onFiltersChange({ preferredDaysOff: newDaysOff });
    }
  };

  const clearAllDaysOff = () => {
    setSelectedDaysOff([]);
    onFiltersChange({ preferredDaysOff: undefined });
  };

  const [selectedFunction, setSelectedFunction] = useState<string>('');
  const [selectedData, setSelectedData] = useState<string>('');
  
  // Build dynamic filter options (layovers handled separately with multi-select)
  const allFilterOptions = React.useMemo(() => {
    return [...filterOptions];
  }, []);

  const currentFunctionOptions = selectedFunction
    ? allFilterOptions.find(f => f.key === selectedFunction)?.dataOptions || []
    : [];

  const handleAddFilter = () => {
    if (!selectedFunction || !selectedData) {
      return;
    }

    const functionOption = allFilterOptions.find(f => f.key === selectedFunction);
    const dataOption = currentFunctionOptions.find(
      d => d.value.toString() === selectedData
    );

    if (!functionOption || !dataOption) {
      return;
    }

    // Clear conflicting filters based on category
    if (functionOption.key === 'creditHours') {
      onFilterClear('creditMin');
      onFilterClear('creditMax');
      onFilterClear('creditRange');
    } else if (functionOption.key === 'pairingDays') {
      // Clear all pairing day related filters when setting a new pairing days filter
      onFilterClear('pairingDays');
      onFilterClear('pairingDaysMin');
      onFilterClear('pairingDaysMax');
    } else if (functionOption.key === 'blockHours') {
      onFilterClear('blockMin');
      onFilterClear('blockMax');
      onFilterClear('blockRange');
    }

    // Handle range filters (like credit hours and block hours) specially
    if (dataOption.additionalFilter) {
      // For range filters, create a combined filter object
      const rangeFilter = {
        [dataOption.filterKey || functionOption.key]: dataOption.value,
        [dataOption.additionalFilter.key]: dataOption.additionalFilter.value,
      };
      // Determine the range filter key based on the function
      const rangeKey =
        functionOption.key === 'creditHours'
          ? 'creditRange'
          : functionOption.key === 'blockHours'
            ? 'blockRange'
            : functionOption.key + 'Range';
      onFilterApply(
        rangeKey,
        rangeFilter,
        `${functionOption.label}: ${dataOption.label}`
      );
    } else {
      // Apply single filter
      const filterKey = dataOption.filterKey || functionOption.key;
      onFilterApply(
        filterKey,
        dataOption.value,
        `${functionOption.label}: ${dataOption.label}`
      );
    }

    // Reset selections
    setSelectedFunction('');
    setSelectedData('');
  };

  // Apply immediately when user selects a value
  const handleSelectValueAndApply = (value: string) => {
    setSelectedData(value);
    if (!selectedFunction || !value) {
      return;
    }

    const functionOption = allFilterOptions.find(f => f.key === selectedFunction);
    const optionList = functionOption?.dataOptions || [];
    const dataOption = optionList.find(d => d.value.toString() === value);
    if (!functionOption || !dataOption) {
      return;
    }

    // Clear conflicting filters within the same category only (allow multi-category combos)
    if (functionOption.key === 'creditHours') {
      onFilterClear('creditMin');
      onFilterClear('creditMax');
      onFilterClear('creditRange');
    } else if (functionOption.key === 'pairingDays') {
      onFilterClear('pairingDays');
      onFilterClear('pairingDaysMin');
      onFilterClear('pairingDaysMax');
    } else if (functionOption.key === 'blockHours') {
      onFilterClear('blockMin');
      onFilterClear('blockMax');
      onFilterClear('blockRange');
    }

    if (dataOption.additionalFilter) {
      const rangeFilter = {
        [dataOption.filterKey || functionOption.key]: dataOption.value,
        [dataOption.additionalFilter.key]: dataOption.additionalFilter.value,
      };
      const rangeKey =
        functionOption.key === 'creditHours'
          ? 'creditRange'
          : functionOption.key === 'blockHours'
            ? 'blockRange'
            : functionOption.key + 'Range';
      onFilterApply(
        rangeKey,
        rangeFilter,
        `${functionOption.label}: ${dataOption.label}`
      );
    } else {
      const filterKey = dataOption.filterKey || functionOption.key;
      onFilterApply(
        filterKey,
        dataOption.value,
        `${functionOption.label}: ${dataOption.label}`
      );
    }

    // Reset selections after applying
    setSelectedFunction('');
    setSelectedData('');
  };

  // Quick Filters - user configurable
  type QuickFilterKey =
    | 'goodHold'
    | 'highCredit'
    | 'multiDay'
    | 'excellentRatio';
  const allQuickFilters: Array<{ key: QuickFilterKey; label: string }> = [
    { key: 'goodHold', label: 'Good Hold' },
    { key: 'highCredit', label: 'High Credit' },
    { key: 'multiDay', label: 'Multi-Day' },
    { key: 'excellentRatio', label: 'Excellent C/B (≥1.30)' },
  ];

  const [quickFilterKeys, setQuickFilterKeys] = useState<QuickFilterKey[]>([]);
  const [showCustomize, setShowCustomize] = useState(false);

  // Load persisted preferences
  useEffect(() => {
    try {
      const raw = localStorage.getItem('pbs.quickFilters');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setQuickFilterKeys(parsed as QuickFilterKey[]);
        } else {
          setQuickFilterKeys(['goodHold', 'highCredit', 'multiDay']);
        }
      } else {
        setQuickFilterKeys(['goodHold', 'highCredit', 'multiDay']);
      }
    } catch {
      setQuickFilterKeys(['goodHold', 'highCredit', 'multiDay']);
    }
  }, []);

  const persistQuickFilters = (keys: QuickFilterKey[]) => {
    setQuickFilterKeys(keys);
    try {
      localStorage.setItem('pbs.quickFilters', JSON.stringify(keys));
    } catch {
      // Silently ignore localStorage errors
    }
  };

  const toggleQuickFilter = (key: QuickFilterKey, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...(quickFilterKeys || []), key]))
      : (quickFilterKeys || []).filter(k => k !== key);
    persistQuickFilters(next);
  };

  const applyQuickFilter = (key: QuickFilterKey) => {
    const newFilters: any = {};
    if (key === 'goodHold') {
      newFilters.holdProbabilityMin = 70;
    } else if (key === 'highCredit') {
      newFilters.creditMin = 15.0;
      newFilters.creditMax = undefined;
    } else if (key === 'multiDay') {
      newFilters.pairingDays = undefined;
      newFilters.pairingDaysMin = 2;
      newFilters.pairingDaysMax = undefined;
    } else if (key === 'excellentRatio') {
      newFilters.efficiency = 1.3;
    }
    onFiltersChange(newFilters);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
        {/* Function Selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Filter By</label>
          <select
            value={selectedFunction}
            onChange={e => {
              setSelectedFunction(e.target.value);
              setSelectedData(''); // Reset data selection when function changes
            }}
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">Select function...</option>
            {allFilterOptions.map(option => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Data Selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Value</label>
          <select
            value={selectedData}
            onChange={e => {
              handleSelectValueAndApply(e.target.value);
            }}
            disabled={!selectedFunction}
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">
              {selectedFunction ? 'Select value...' : 'Select function first'}
            </option>
            {currentFunctionOptions.map((option, index) => (
              <option key={index} value={option.value.toString()}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Add Filter Button (hidden; auto-applies on selection) */}
        <Button
          onClick={handleAddFilter}
          disabled
          className="hidden items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Filter
        </Button>
      </div>

      {/* Active Filters Display */}
      {activeFilters.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              Active Filters:
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearFilters}
              className="text-xs text-red-600 hover:text-red-700"
            >
              Clear All
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {activeFilters.map((filter, index) => (
              <Badge
                key={index}
                variant="secondary"
                className="flex items-center gap-1 pr-1"
              >
                <span className="text-xs">{filter.label}</span>
                <button
                  onClick={() => onFilterClear(filter.key)}
                  className="ml-1 hover:bg-red-100 rounded-full p-0.5 transition-colors"
                  title="Remove filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Preferred Days Off and Layover Locations Row */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Preferred Days Off */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Days Off:
          </span>
          <Button
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
            onClick={() => setIsCalendarOpen(true)}
            data-testid="button-select-days-off"
          >
            <CalendarIcon className="h-4 w-4" />
            {selectedDaysOff.length === 0
              ? 'Select'
              : `${selectedDaysOff.length} selected`}
          </Button>
        </div>

        {/* Layover Locations Multi-Select */}
        {layoverLocations.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Layover Cities:
            </span>
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-2"
              onClick={() => setIsLayoverDialogOpen(true)}
              data-testid="button-select-layovers"
            >
              <MapPin className="h-4 w-4" />
              {selectedLayovers.length === 0
                ? 'Select cities'
                : `${selectedLayovers.length} selected`}
            </Button>
            {/* Show selected cities as badges inline */}
            {selectedLayovers.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selectedLayovers.slice(0, 3).map(city => (
                  <Badge
                    key={city}
                    variant="secondary"
                    className="flex items-center gap-1 pr-1"
                  >
                    <span className="text-xs">{city}</span>
                    <button
                      onClick={() => toggleLayoverCity(city)}
                      className="ml-1 hover:bg-red-100 rounded-full p-0.5 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {selectedLayovers.length > 3 && (
                  <Badge variant="outline" className="text-xs">
                    +{selectedLayovers.length - 3} more
                  </Badge>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Layover Cities Dialog */}
      <Dialog open={isLayoverDialogOpen} onOpenChange={setIsLayoverDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Select Layover Cities</DialogTitle>
            <DialogDescription>
              Filter pairings by overnight layover locations
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-72 pr-4">
            <div className="grid grid-cols-3 gap-3">
              {layoverLocations.map(city => (
                <div key={city} className="flex items-center space-x-2">
                  <Checkbox
                    id={`layover-dialog-${city}`}
                    checked={selectedLayovers.includes(city)}
                    onCheckedChange={() => toggleLayoverCity(city)}
                    data-testid={`checkbox-layover-${city}`}
                  />
                  <Label
                    htmlFor={`layover-dialog-${city}`}
                    className="text-sm cursor-pointer"
                  >
                    {city}
                  </Label>
                </div>
              ))}
            </div>
          </ScrollArea>
          {selectedLayovers.length > 0 && (
            <div className="pt-3 border-t">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">
                  {selectedLayovers.length} cities selected
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAllLayovers}
                  className="text-xs text-red-600 hover:text-red-700"
                >
                  Clear All
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {selectedLayovers.map(city => (
                  <Badge
                    key={city}
                    variant="secondary"
                    className="flex items-center gap-1 pr-1"
                  >
                    <span className="text-xs">{city}</span>
                    <button
                      onClick={() => toggleLayoverCity(city)}
                      className="ml-1 hover:bg-red-100 rounded-full p-0.5 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end pt-3">
            <Button size="sm" onClick={() => setIsLayoverDialogOpen(false)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Calendar Dialog */}
      <Dialog open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Select Preferred Days Off</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center">
            <Calendar
              mode="multiple"
              selected={selectedDaysOff}
              onSelect={handleDayOffSelect}
              defaultMonth={defaultMonth}
              initialFocus
              className="rounded-md"
            />
            {selectedDaysOff.length > 0 && (
              <div className="mt-3 w-full">
                <p className="text-sm text-gray-600 mb-2">Selected dates:</p>
                <div className="flex flex-wrap gap-1">
                  {selectedDaysOff.map((date, index) => (
                    <Badge
                      key={index}
                      variant="secondary"
                      className="flex items-center gap-1 pr-1"
                    >
                      <span className="text-xs">{format(date, 'M/d')}</span>
                      <button
                        onClick={() => removeDayOff(date)}
                        className="ml-1 hover:bg-red-100 rounded-full p-0.5 transition-colors"
                        title="Remove date"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-between pt-3 border-t">
            <Button variant="outline" size="sm" onClick={clearAllDaysOff}>
              Clear All
            </Button>
            <Button size="sm" onClick={() => setIsCalendarOpen(false)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Quick Filter Buttons */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500 dark:text-gray-400">Quick filters:</span>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs dark:text-gray-300"
            onClick={() => setShowCustomize(true)}
          >
            Customize
          </Button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {(quickFilterKeys || []).map(key => {
            const meta = allQuickFilters.find(f => f.key === key);
            if (!meta) {
              return null;
            }
            return (
              <Button
                key={key}
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => applyQuickFilter(key)}
              >
                {meta.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Customize Quick Filters Dialog */}
      <Dialog open={showCustomize} onOpenChange={setShowCustomize}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Customize Quick Filters</DialogTitle>
            <DialogDescription>
              Choose which shortcuts show below. Your selections are saved in
              this browser.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {allQuickFilters.map(item => (
              <label key={item.key} className="flex items-center gap-2">
                <Checkbox
                  checked={quickFilterKeys?.includes(item.key)}
                  onCheckedChange={(val: boolean) =>
                    toggleQuickFilter(item.key, !!val)
                  }
                />
                <Label className="text-sm cursor-pointer">{item.label}</Label>
              </label>
            ))}
            <div className="pt-2 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCustomize(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
