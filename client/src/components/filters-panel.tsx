import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SearchFilters } from "@/lib/api";

interface FiltersPanelProps {
  onFiltersChange: (filters: SearchFilters) => void;
}

export function FiltersPanel({ onFiltersChange }: FiltersPanelProps) {
  const handleFilterChange = (key: keyof SearchFilters, value: string) => {
    const numericValue = key.includes('Min') || key.includes('Max') ? parseFloat(value) : value;
    onFiltersChange({ [key]: numericValue });
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Credit Range</label>
        <Select onValueChange={(value) => {
          if (value === "5:00-5:30") {
            onFiltersChange({ creditMin: 5.0, creditMax: 5.5 });
          } else if (value === "5:30-6:00") {
            onFiltersChange({ creditMin: 5.5, creditMax: 6.0 });
          } else if (value === "6:00+") {
            onFiltersChange({ creditMin: 6.0 });
          } else {
            onFiltersChange({ creditMin: undefined, creditMax: undefined });
          }
        }}>
          <SelectTrigger className="text-sm">
            <SelectValue placeholder="Any Credit" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any Credit</SelectItem>
            <SelectItem value="5:00-5:30">5:00 - 5:30</SelectItem>
            <SelectItem value="5:30-6:00">5:30 - 6:00</SelectItem>
            <SelectItem value="6:00+">6:00+</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Block Time</label>
        <Select onValueChange={(value) => {
          if (value === "<4:30") {
            onFiltersChange({ blockMax: 4.5 });
          } else if (value === "4:30-5:00") {
            onFiltersChange({ blockMin: 4.5, blockMax: 5.0 });
          } else if (value === "5:00+") {
            onFiltersChange({ blockMin: 5.0 });
          } else {
            onFiltersChange({ blockMin: undefined, blockMax: undefined });
          }
        }}>
          <SelectTrigger className="text-sm">
            <SelectValue placeholder="Any Block" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any Block</SelectItem>
            <SelectItem value="<4:30">&lt; 4:30/day</SelectItem>
            <SelectItem value="4:30-5:00">4:30 - 5:00/day</SelectItem>
            <SelectItem value="5:00+">5:00+/day</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">TAFB</label>
        <Select onValueChange={(value) => handleFilterChange('tafb', value)}>
          <SelectTrigger className="text-sm">
            <SelectValue placeholder="Any TAFB" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any TAFB</SelectItem>
            <SelectItem value="3d">3 Days</SelectItem>
            <SelectItem value="4d">4 Days</SelectItem>
            <SelectItem value="5d+">5+ Days</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Hold Probability</label>
        <Select onValueChange={(value) => {
          if (value === "high") {
            onFiltersChange({ holdProbabilityMin: 80 });
          } else if (value === "medium") {
            onFiltersChange({ holdProbabilityMin: 50 });
          } else if (value === "low") {
            onFiltersChange({ holdProbabilityMin: 0 });
          } else {
            onFiltersChange({ holdProbabilityMin: undefined });
          }
        }}>
          <SelectTrigger className="text-sm">
            <SelectValue placeholder="Any Probability" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any Probability</SelectItem>
            <SelectItem value="high">High (80%+)</SelectItem>
            <SelectItem value="medium">Medium (50-80%)</SelectItem>
            <SelectItem value="low">Low (&lt;50%)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
