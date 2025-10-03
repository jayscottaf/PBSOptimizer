import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import { format } from 'date-fns';
import { useState } from 'react';
import type { SearchFilters } from '@/lib/api';
interface FiltersPanelProps {
  onFiltersChange: (filters: SearchFilters) => void;
  bidPackages?: Array<{
    id: number;
    name: string;
    month: string;
    year: number;
    status: string;
  }>;
}
export function FiltersPanel({
  onFiltersChange,
  bidPackages = [],
}: FiltersPanelProps) {
  const [selectedDaysOff, setSelectedDaysOff] = useState<Date[]>([]);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const handleFilterChange = (key: keyof SearchFilters, value: string) => {
    const numericValue =
      key.includes('Min') || key.includes('Max') ? parseFloat(value) : value;
    onFiltersChange({ [key]: numericValue });
  };

  const handleDayOffSelect = (date: Date | undefined) => {
    if (!date) {
      return;
    }

    const newDaysOff = selectedDaysOff.some(d => d.getTime() === date.getTime())
      ? selectedDaysOff.filter(d => d.getTime() !== date.getTime())
      : [...selectedDaysOff, date];

    setSelectedDaysOff(newDaysOff);
    onFiltersChange({ preferredDaysOff: newDaysOff });
  };

  const removeDayOff = (dateToRemove: Date) => {
    const newDaysOff = selectedDaysOff.filter(
      d => d.getTime() !== dateToRemove.getTime()
    );
    setSelectedDaysOff(newDaysOff);
    onFiltersChange({ preferredDaysOff: newDaysOff });
  };

  const clearAllDaysOff = () => {
    setSelectedDaysOff([]);
    onFiltersChange({ preferredDaysOff: [] });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4"></div>
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          Credit Range
        </label>
        <Select
          onValueChange={value => {
            if (value === '5:00-5:30') {
              onFiltersChange({ creditMin: 5.0, creditMax: 5.5 });
            } else if (value === '5:30-6:00') {
              onFiltersChange({ creditMin: 5.5, creditMax: 6.0 });
            } else if (value === '6:00+') {
              onFiltersChange({ creditMin: 6.0 });
            } else {
              onFiltersChange({ creditMin: undefined, creditMax: undefined });
            }
          }}
        >
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
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          Block Time
        </label>
        <Select
          onValueChange={value => {
            if (value === '<4:30') {
              onFiltersChange({ blockMax: 4.5 });
            } else if (value === '4:30-5:00') {
              onFiltersChange({ blockMin: 4.5, blockMax: 5.0 });
            } else if (value === '5:00+') {
              onFiltersChange({ blockMin: 5.0 });
            } else {
              onFiltersChange({ blockMin: undefined, blockMax: undefined });
            }
          }}
        >
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
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          TAFB
        </label>
        <Select onValueChange={value => handleFilterChange('tafb', value)}>
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
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          Hold Probability
        </label>
        <Select
          onValueChange={value => {
            if (value === 'high') {
              onFiltersChange({ holdProbabilityMin: 80 });
            } else if (value === 'medium') {
              onFiltersChange({ holdProbabilityMin: 50 });
            } else if (value === 'low') {
              onFiltersChange({ holdProbabilityMin: 0 });
            } else {
              onFiltersChange({ holdProbabilityMin: undefined });
            }
          }}
        >
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

      {/* Preferred Days Off Filter */}
      <div className="border-t pt-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Preferred Days Off
        </label>
        <div className="flex flex-wrap gap-2 items-center">
          <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-9 px-3">
                <CalendarIcon className="h-4 w-4 mr-2" />
                Select Days Off
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="multiple"
                selected={selectedDaysOff}
                onSelect={dates => {
                  if (dates) {
                    setSelectedDaysOff(dates);
                    onFiltersChange({ preferredDaysOff: dates });
                  }
                }}
                initialFocus
              />
              <div className="p-3 border-t flex justify-between">
                <Button variant="outline" size="sm" onClick={clearAllDaysOff}>
                  Clear All
                </Button>
                <Button size="sm" onClick={() => setIsCalendarOpen(false)}>
                  Done
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          {/* Display selected days */}
          {selectedDaysOff.map((date, index) => (
            <div
              key={index}
              className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-md text-xs"
            >
              <span>{format(date, 'MMM dd')}</span>
              <button
                onClick={() => removeDayOff(date)}
                className="hover:bg-blue-200 rounded-full p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}

          {selectedDaysOff.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllDaysOff}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              Clear All
            </Button>
          )}
        </div>
        {selectedDaysOff.length > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {selectedDaysOff.length} day
            {selectedDaysOff.length !== 1 ? 's' : ''} selected for days off
          </p>
        )}
      </div>
    </div>
  );
}
