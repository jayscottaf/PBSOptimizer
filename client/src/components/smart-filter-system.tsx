
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
      { value: 4.0, label: "4:00-5:00", filterKey: "creditMin", additionalFilter: { key: "creditMax", value: 5.0 } },
      { value: 5.0, label: "5:00-6:00", filterKey: "creditMin", additionalFilter: { key: "creditMax", value: 6.0 } },
      { value: 6.0, label: "6:00-7:00", filterKey: "creditMin", additionalFilter: { key: "creditMax", value: 7.0 } },
      { value: 7.0, label: "7:00-8:00", filterKey: "creditMin", additionalFilter: { key: "creditMax", value: 8.0 } },
      { value: 8.0, label: "8:00+", filterKey: "creditMin" },
    ]
  },
  {
    key: "blockHours",
    label: "Block Hours",
    dataOptions: [
      { value: 3.0, label: "3:00-4:00", filterKey: "blockMin", additionalFilter: { key: "blockMax", value: 4.0 } },
      { value: 4.0, label: "4:00-5:00", filterKey: "blockMin", additionalFilter: { key: "blockMax", value: 5.0 } },
      { value: 5.0, label: "5:00-6:00", filterKey: "blockMin", additionalFilter: { key: "blockMax", value: 6.0 } },
      { value: 6.0, label: "6:00-7:00", filterKey: "blockMin", additionalFilter: { key: "blockMax", value: 7.0 } },
      { value: 7.0, label: "7:00+", filterKey: "blockMin" },
    ]
  },
  {
    key: "holdProbability",
    label: "Hold Probability",
    dataOptions: [
      { value: 0.9, label: "Senior (90%+)", filterKey: "holdProbabilityMin" },
      { value: 0.7, label: "Good (70%+)", filterKey: "holdProbabilityMin" },
      { value: 0.5, label: "Fair (50%+)", filterKey: "holdProbabilityMin" },
      { value: 0.25, label: "Long Shot (25%+)", filterKey: "holdProbabilityMin" },
      { value: 0.1, label: "Any Chance (10%+)", filterKey: "holdProbabilityMin" },
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
      { value: 1.3, label: "Excellent (≥1.30)" },
      { value: 1.2, label: "Very Good (≥1.20)" },
      { value: 1.1, label: "Good (≥1.10)" },
      { value: 1.0, label: "Average (≥1.00)" },
      { value: 0.9, label: "Below Average (≥0.90)" },
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

    // Apply main filter
    const filterKey = dataOption.filterKey || functionOption.key;
    onFilterApply(filterKey, dataOption.value, `${functionOption.label}: ${dataOption.label}`);

    // Apply additional filter if present (for ranges)
    if (dataOption.additionalFilter) {
      onFilterApply(
        dataOption.additionalFilter.key, 
        dataOption.additionalFilter.value, 
        `${functionOption.label}: ${dataOption.label}`
      );
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
      <div className="flex flex-wrap gap-2">
        <span className="text-sm text-gray-500 flex items-center">Quick filters:</span>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => onFilterApply("pairingDays", 1, "Turns Only")}
        >
          Turns Only
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => onFilterApply("holdProbabilityMin", 0.7, "Good Hold Probability")}
        >
          Good Hold (70%+)
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => onFilterApply("creditMin", 6.0, "High Credit")}
        >
          High Credit (6:00+)
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => onFilterApply("pairingDaysMin", 2, "Multi-Day")}
        >
          Multi-Day
        </Button>
      </div>
    </div>
  );
}
