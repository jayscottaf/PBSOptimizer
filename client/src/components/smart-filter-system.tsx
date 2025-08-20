import React, { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, X } from "lucide-react";
import { SearchFilters } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
  activeFilters: Array<{key: string, label: string, value: any}>;
  onClearFilters: () => void;
}

const filterOptions: FilterOption[] = [
  {
    key: "pairingDays",
    label: "Pairing Days",
    dataOptions: [
      { value: 1, label: "1 Day (Turns)" },
      { value: 2, label: "2 Days" },
      { value: 3, label: "3 Days" },
      { value: 4, label: "4 Days" },
      { value: 5, label: "5+ Days", filterKey: "pairingDaysMin" },
    ]
  },
  {
    key: "creditHours",
    label: "Credit Hours",
    dataOptions: [
      { value: 4.0, label: "Light (4:00-8:00)", filterKey: "creditMin", additionalFilter: { key: "creditMax", value: 8.0 } },
      { value: 8.0, label: "Moderate (8:00-15:00)", filterKey: "creditMin", additionalFilter: { key: "creditMax", value: 15.0 } },
      { value: 15.0, label: "Heavy (15:00-25:00)", filterKey: "creditMin", additionalFilter: { key: "creditMax", value: 25.0 } },
      { value: 25.0, label: "Max Credit (25:00+)", filterKey: "creditMin" },
    ]
  },

  {
    key: "blockHours",
    label: "Block Hours",
    dataOptions: [
      { value: 3.0, label: "Short (3:00-6:00)", filterKey: "blockMin", additionalFilter: { key: "blockMax", value: 6.0 } },
      { value: 6.0, label: "Medium (6:00-12:00)", filterKey: "blockMin", additionalFilter: { key: "blockMax", value: 12.0 } },
      { value: 12.0, label: "Long (12:00-20:00)", filterKey: "blockMin", additionalFilter: { key: "blockMax", value: 20.0 } },
      { value: 20.0, label: "Extended (20:00+)", filterKey: "blockMin" },
      { value: 0.0, label: "Quick Turns (≤6:00)", filterKey: "blockMax" },
    ]
  },
  {
    key: "holdProbability",
    label: "Hold Probability",
    dataOptions: [
      { value: 90, label: "Senior (90%+)", filterKey: "holdProbabilityMin" },
      { value: 70, label: "Good (70%+)", filterKey: "holdProbabilityMin" },
      { value: 50, label: "Fair (50%+)", filterKey: "holdProbabilityMin" },
      { value: 25, label: "Long Shot (25%+)", filterKey: "holdProbabilityMin" },
      { value: 10, label: "Any Chance (10%+)", filterKey: "holdProbabilityMin" },
    ]
  },
  {
    key: "tafb",
    label: "Time Away (TAFB)",
    dataOptions: [
      { value: 24, label: "Quick Turn (≤24hrs)", filterKey: "tafbMax" },
      { value: 48, label: "Short (≤48hrs)", filterKey: "tafbMax" },
      { value: 72, label: "Medium (≤72hrs)", filterKey: "tafbMax" },
      { value: 96, label: "Long (≤96hrs)", filterKey: "tafbMax" },
      { value: 120, label: "Extended (5+ days)", filterKey: "tafbMin" },
    ]
  },
  {
    key: "efficiency",
    label: "Credit/Block Ratio",
    dataOptions: [
      { value: 1.3, label: "Excellent (≥1.30)", filterKey: "efficiency" },
      { value: 1.2, label: "Very Good (≥1.20)", filterKey: "efficiency" },
      { value: 1.1, label: "Good (≥1.10)", filterKey: "efficiency" },
      { value: 1.0, label: "Average (≥1.00)", filterKey: "efficiency" },
      { value: 0.9, label: "Below Average (≥0.90)", filterKey: "efficiency" },
    ]
  }
];

export function SmartFilterSystem({ 
  pairings, 
  onFiltersChange, 
  activeFilters, 
  onClearFilters 
}: SmartFilterSystemProps) {

  // Helper functions to handle filter changes
  const onFilterApply = (filterKey: string, filterValue: any, displayLabel: string) => {
    const newFilters: any = {};
    newFilters[filterKey] = filterValue;
    onFiltersChange(newFilters);
  };

  const onFilterClear = (filterKey: string) => {
    const newFilters: any = {};
    newFilters[filterKey] = undefined;
    onFiltersChange(newFilters);
  };

  const [selectedFunction, setSelectedFunction] = useState<string>("");
  const [selectedData, setSelectedData] = useState<string>("");

  const currentFunctionOptions = selectedFunction 
    ? filterOptions.find(f => f.key === selectedFunction)?.dataOptions || []
    : [];

  const handleAddFilter = () => {
    if (!selectedFunction || !selectedData) return;

    const functionOption = filterOptions.find(f => f.key === selectedFunction);
    const dataOption = currentFunctionOptions.find(d => d.value.toString() === selectedData);

    if (!functionOption || !dataOption) return;

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
        [dataOption.additionalFilter.key]: dataOption.additionalFilter.value
      };
      // Determine the range filter key based on the function
      const rangeKey = functionOption.key === 'creditHours' ? 'creditRange' : 
                      functionOption.key === 'blockHours' ? 'blockRange' : 
                      functionOption.key + 'Range';
      onFilterApply(rangeKey, rangeFilter, `${functionOption.label}: ${dataOption.label}`);
    } else {
      // Apply single filter
      const filterKey = dataOption.filterKey || functionOption.key;
      onFilterApply(filterKey, dataOption.value, `${functionOption.label}: ${dataOption.label}`);
    }

    // Reset selections
    setSelectedFunction("");
    setSelectedData("");
  };

  // Apply immediately when user selects a value
  const handleSelectValueAndApply = (value: string) => {
    setSelectedData(value);
    if (!selectedFunction || !value) return;

    const functionOption = filterOptions.find(f => f.key === selectedFunction);
    const optionList = functionOption?.dataOptions || [];
    const dataOption = optionList.find(d => d.value.toString() === value);
    if (!functionOption || !dataOption) return;

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
        [dataOption.additionalFilter.key]: dataOption.additionalFilter.value
      };
      const rangeKey = functionOption.key === 'creditHours' ? 'creditRange' : 
                      functionOption.key === 'blockHours' ? 'blockRange' : 
                      functionOption.key + 'Range';
      onFilterApply(rangeKey, rangeFilter, `${functionOption.label}: ${dataOption.label}`);
    } else {
      const filterKey = dataOption.filterKey || functionOption.key;
      onFilterApply(filterKey, dataOption.value, `${functionOption.label}: ${dataOption.label}`);
    }

    // Reset selections after applying
    setSelectedFunction("");
    setSelectedData("");
  };

  // Quick Filters - user configurable
  type QuickFilterKey = 'goodHold' | 'highCredit' | 'multiDay' | 'excellentRatio';
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
        if (Array.isArray(parsed)) setQuickFilterKeys(parsed as QuickFilterKey[]);
        else setQuickFilterKeys(['goodHold', 'highCredit', 'multiDay']);
      } else {
        setQuickFilterKeys(['goodHold', 'highCredit', 'multiDay']);
      }
    } catch {
      setQuickFilterKeys(['goodHold', 'highCredit', 'multiDay']);
    }
  }, []);

  const persistQuickFilters = (keys: QuickFilterKey[]) => {
    setQuickFilterKeys(keys);
    try { localStorage.setItem('pbs.quickFilters', JSON.stringify(keys)); } catch {}
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
          <label className="text-sm font-medium text-gray-700">Filter By</label>
          <Select value={selectedFunction} onValueChange={(value) => {
            setSelectedFunction(value);
            setSelectedData(""); // Reset data selection when function changes
          }}>
            <SelectTrigger>
              <SelectValue placeholder="Select function..." />
            </SelectTrigger>
            <SelectContent>
              {filterOptions.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Data Selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Value</label>
          <Select 
            value={selectedData} 
            onValueChange={handleSelectValueAndApply}
            disabled={!selectedFunction}
          >
            <SelectTrigger>
              <SelectValue placeholder={selectedFunction ? "Select value..." : "Select function first"} />
            </SelectTrigger>
            <SelectContent>
              {currentFunctionOptions.map((option, index) => (
                <SelectItem key={index} value={option.value.toString()}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            <span className="text-sm font-medium text-gray-700">Active Filters:</span>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onClearFilters}
              className="text-xs text-red-600 hover:text-red-700"
            >
              Clear All
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
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

      {/* Quick Filter Buttons */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Quick filters:</span>
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowCustomize(true)}>
            Customize
          </Button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {(quickFilterKeys || []).map((key) => {
            const meta = allQuickFilters.find(f => f.key === key);
            if (!meta) return null;
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
              Choose which shortcuts show below. Your selections are saved in this browser.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {allQuickFilters.map(item => (
              <label key={item.key} className="flex items-center gap-2">
                <Checkbox
                  checked={quickFilterKeys?.includes(item.key)}
                  onCheckedChange={(val: boolean) => toggleQuickFilter(item.key, !!val)}
                />
                <Label className="text-sm cursor-pointer">{item.label}</Label>
              </label>
            ))}
            <div className="pt-2 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowCustomize(false)}>Close</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}