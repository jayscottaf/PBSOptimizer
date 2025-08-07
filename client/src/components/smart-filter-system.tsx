import React, { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

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
  onFilterApply: (filterKey: string, filterValue: any, displayLabel: string) => void;
  onFilterClear: (filterKey: string) => void;
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
    key: "turnFilters",
    label: "Turn Filters",
    dataOptions: [
      { value: 8.0, label: "Turns Only (≤8:00)", filterKey: "creditMax" },
      { value: 1, label: "Single Day Only", filterKey: "pairingDays" },
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

export function SmartFilterSystem({ onFilterApply, onFilterClear }: SmartFilterSystemProps) {
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
    } else if (functionOption.key === 'turnFilters') {
      // Turn filters should clear existing credit and pairing day filters
      onFilterClear('creditMin');
      onFilterClear('creditMax');
      onFilterClear('creditRange');
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
            onValueChange={setSelectedData}
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

        {/* Add Filter Button */}
        <Button 
          onClick={handleAddFilter}
          disabled={!selectedFunction || !selectedData}
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Filter
        </Button>
      </div>

      {/* Quick Filter Buttons */}
      <div className="space-y-2">
        <span className="text-sm text-gray-500">Quick filters:</span>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            className="text-xs"
            onClick={() => {
              onFilterClear("creditMin");
              onFilterClear("creditMax");
              onFilterApply("creditMax", 8.0, "Turns Only (≤8:00)");
            }}
          >
            Turns Only
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            className="text-xs"
            onClick={() => onFilterApply("holdProbabilityMin", 70, "Good Hold Probability")}
          >
            Good Hold
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            className="text-xs"
            onClick={() => {
              onFilterClear("creditMax");
              onFilterApply("creditMin", 15.0, "High Credit (15:00+)");
            }}
          >
            High Credit
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            className="text-xs"
            onClick={() => onFilterApply("pairingDaysMin", 2, "Multi-Day")}
          >
            Multi-Day
          </Button>
        </div>
      </div>
    </div>
  );
}