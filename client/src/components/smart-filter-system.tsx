import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  X,
  Calendar as CalendarIcon,
  MapPin,
  Search,
  SlidersHorizontal,
  ChevronDown,
} from 'lucide-react';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { PBS_FILTER_FIELDS } from '@shared/pbsFilterLabels';
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
    label: 'Pairing Length',
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
    label: 'Credit',
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
    label: 'Block',
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
    // App-computed insight, not a NAVBLUE bid property — labeled as such
    label: 'Hold Probability (App insight)',
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
    // App-computed insight, not a NAVBLUE bid property — labeled as such
    label: 'Credit/Block Ratio (App insight)',
    dataOptions: [
      { value: 1.3, label: 'Excellent (≥1.30)', filterKey: 'efficiency' },
      { value: 1.2, label: 'Very Good (≥1.20)', filterKey: 'efficiency' },
      { value: 1.1, label: 'Good (≥1.10)', filterKey: 'efficiency' },
      { value: 1.0, label: 'Average (≥1.00)', filterKey: 'efficiency' },
      { value: 0.9, label: 'Below Average (≥0.90)', filterKey: 'efficiency' },
    ],
  },
];

// PBS-native range filters shown in the "PBS Filters" section. metaKey
// looks up the NAVBLUE label/gloss in shared/pbsFilterLabels.ts.
const pbsRangeFields: Array<{
  minKey: string;
  maxKey: string;
  metaKey: string;
  step: string;
}> = [
  { minKey: 'deadheadsMin', maxKey: 'deadheadsMax', metaKey: 'deadheadsMin', step: '1' },
  { minKey: 'layoverCountMin', maxKey: 'layoverCountMax', metaKey: 'layoverCountMin', step: '1' },
  { minKey: 'totalLayoverHoursMin', maxKey: 'totalLayoverHoursMax', metaKey: 'totalLayoverHoursMin', step: '0.5' },
  { minKey: 'averageDailyCreditMin', maxKey: 'averageDailyCreditMax', metaKey: 'averageDailyCreditMin', step: '0.5' },
  { minKey: 'averageDailyBlockMin', maxKey: 'averageDailyBlockMax', metaKey: 'averageDailyBlockMin', step: '0.5' },
  { minKey: 'checkInHourMin', maxKey: 'checkInHourMax', metaKey: 'checkInHourMin', step: '1' },
];

// Special filter for layover locations - will be populated dynamically
const layoverFilterOption: FilterOption = {
  key: 'layoverLocations',
  label: 'Layovers In', // NAVBLUE term; wire key stays layoverLocations
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

  // Days Off is applied directly (not through activeFilters chips) but can
  // still be cleared from outside this component — e.g. removing its "Days
  // Off: N selected" chip in the dashboard's Active Filters row. Without
  // this, the "N selected" button here would keep showing a stale count
  // after the underlying filter was already cleared elsewhere.
  useEffect(() => {
    const stillActive = activeFilters.some(f => f.key === 'preferredDaysOff');
    if (!stillActive && selectedDaysOff.length > 0) {
      setSelectedDaysOff([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilters]);

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
  const rotationNumber =
    activeFilters
      .find(filter => filter.key === 'rotationNumber')
      ?.value?.toString() || '';
  
  // Build dynamic filter options (layovers handled separately with multi-select)
  const allFilterOptions = React.useMemo(() => {
    return [...filterOptions];
  }, []);

  const currentFunctionOptions = selectedFunction
    ? allFilterOptions.find(f => f.key === selectedFunction)?.dataOptions || []
    : [];

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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPbsFilters, setShowPbsFilters] = useState(false);

  // PBS Filters section — local input text, applied on blur/Enter so we
  // don't fire a search per keystroke. Keyed by SearchFilters wire key.
  const [pbsInputs, setPbsInputs] = useState<Record<string, string>>({});
  // Which field is focused and what it held when focus began. Blur only
  // applies when the value changed during the focus session — otherwise
  // clicking into a field and away would re-apply a filter the user just
  // removed via its chip while the field was focused.
  const focusedPbs = React.useRef<{ key: string; value: string } | null>(null);

  // When a PBS filter is cleared elsewhere (chip X, Clear all without a
  // remount), blank its input so blur can't silently re-apply a stale value.
  useEffect(() => {
    setPbsInputs(prev => {
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (key === focusedPbs.current?.key) {
          continue;
        }
        if (next[key] !== '' && !activeFilters.some(f => f.key === key)) {
          next[key] = '';
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeFilters]);

  const onPbsFocus = (key: string) => {
    focusedPbs.current = { key, value: pbsInputs[key] ?? '' };
  };

  const onPbsBlur = (
    key: string,
    raw: string,
    apply: (filterKey: string, raw: string) => void
  ) => {
    const started = focusedPbs.current;
    focusedPbs.current = null;
    if (started?.key === key && started.value === raw) {
      // Unchanged during this focus session — never re-apply. If the filter
      // was cleared externally while focused, blank the stale text too.
      if (!activeFilters.some(f => f.key === key)) {
        setPbsInputs(prev => (prev[key] ? { ...prev, [key]: '' } : prev));
      }
      return;
    }
    apply(key, raw);
  };

  // Explicit Enter apply: also reset the focus-session baseline so a
  // subsequent chip removal + blur can't re-apply this same value.
  const onPbsEnter = (
    key: string,
    raw: string,
    apply: (filterKey: string, raw: string) => void
  ) => {
    apply(key, raw);
    if (focusedPbs.current?.key === key) {
      focusedPbs.current = { key, value: raw };
    }
  };

  const applyPbsNumber = (filterKey: string, raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      onFiltersChange({ [filterKey]: undefined });
      return;
    }
    const num = parseFloat(trimmed);
    if (Number.isNaN(num)) {
      return;
    }
    onFiltersChange({ [filterKey]: num });
  };

  const applyPbsList = (filterKey: string, raw: string) => {
    const list = raw
      .split(/[,\s]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
    onFiltersChange({ [filterKey]: list.length > 0 ? list : undefined });
  };

  // Redeye tri-state derives from the live filter set, like quick filters
  const redeyeState: '' | 'has' | 'none' = (() => {
    const f = activeFilters.find(x => x.key === 'hasRedeye');
    if (!f) {
      return '';
    }
    return f.value ? 'has' : 'none';
  })();

  const setRedeye = (state: '' | 'has' | 'none') => {
    onFiltersChange({
      hasRedeye: state === '' ? undefined : state === 'has',
    });
  };

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

  // Pressed state is derived from the live activeFilters list so the chips
  // stay in sync no matter where a filter was set or cleared.
  const isQuickFilterActive = (key: QuickFilterKey): boolean => {
    if (key === 'goodHold') {
      return activeFilters.some(
        f => f.key === 'holdProbabilityMin' && Number(f.value) === 70
      );
    }
    if (key === 'highCredit') {
      return activeFilters.some(
        f => f.key === 'creditMin' && Number(f.value) === 15
      );
    }
    if (key === 'multiDay') {
      return activeFilters.some(
        f => f.key === 'pairingDaysMin' && Number(f.value) === 2
      );
    }
    return activeFilters.some(
      f => f.key === 'efficiency' && Number(f.value) === 1.3
    );
  };

  const applyQuickFilter = (key: QuickFilterKey) => {
    const active = isQuickFilterActive(key);
    const newFilters: any = {};
    if (key === 'goodHold') {
      newFilters.holdProbabilityMin = active ? undefined : 70;
    } else if (key === 'highCredit') {
      newFilters.creditMin = active ? undefined : 15.0;
      newFilters.creditMax = undefined;
    } else if (key === 'multiDay') {
      newFilters.pairingDays = undefined;
      newFilters.pairingDaysMin = active ? undefined : 2;
      newFilters.pairingDaysMax = undefined;
    } else if (key === 'excellentRatio') {
      newFilters.efficiency = active ? undefined : 1.3;
    }
    onFiltersChange(newFilters);
  };

  return (
    <div className="space-y-3">
      {/* Row 1 — search first, then one-tap chips, then pickers */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={rotationNumber}
            onChange={e => {
              const value = e.target.value.trim();
              onFiltersChange({ rotationNumber: value || undefined });
            }}
            placeholder="Search rotation #…"
            inputMode="numeric"
            className="flex h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            data-testid="input-rotation-number"
          />
        </div>

        {(quickFilterKeys || []).map(key => {
          const meta = allQuickFilters.find(f => f.key === key);
          if (!meta) {
            return null;
          }
          const pressed = isQuickFilterActive(key);
          return (
            <button
              key={key}
              type="button"
              aria-pressed={pressed}
              onClick={() => applyQuickFilter(key)}
              className={cn(
                'h-9 rounded-full border px-3 text-sm font-medium transition-colors',
                pressed
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border bg-background text-secondary-foreground hover:bg-accent'
              )}
            >
              {meta.label}
            </button>
          );
        })}

        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => setIsCalendarOpen(true)}
          data-testid="button-select-days-off"
        >
          <CalendarIcon className="h-4 w-4" />
          Days off
          {selectedDaysOff.length > 0 && (
            <Badge variant="secondary" className="ml-0.5 px-1.5 text-xs">
              {selectedDaysOff.length}
            </Badge>
          )}
        </Button>

        {layoverLocations.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => setIsLayoverDialogOpen(true)}
            data-testid="button-select-layovers"
          >
            <MapPin className="h-4 w-4" />
            Layovers In
            {selectedLayovers.length > 0 && (
              <Badge variant="secondary" className="ml-0.5 px-1.5 text-xs">
                {selectedLayovers.length}
              </Badge>
            )}
          </Button>
        )}

        <button
          type="button"
          onClick={() => setShowPbsFilters(v => !v)}
          aria-expanded={showPbsFilters}
          className="ml-auto flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <SlidersHorizontal className="h-4 w-4" />
          PBS Filters
          <ChevronDown
            className={cn(
              'h-4 w-4 transition-transform',
              showPbsFilters && 'rotate-180'
            )}
          />
        </button>

        <button
          type="button"
          onClick={() => setShowAdvanced(v => !v)}
          aria-expanded={showAdvanced}
          className="flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Advanced
          <ChevronDown
            className={cn(
              'h-4 w-4 transition-transform',
              showAdvanced && 'rotate-180'
            )}
          />
        </button>
      </div>

      {/* Active Filters Display */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeFilters.map((filter, index) => (
            <Badge
              key={index}
              variant="secondary"
              className="flex items-center gap-1 pr-1"
            >
              <span className="text-xs">{filter.label}</span>
              <button
                onClick={() => onFilterClear(filter.key)}
                className="ml-1 rounded-full p-0.5 transition-colors hover:bg-destructive/20"
                title="Remove filter"
                aria-label={`Remove ${filter.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="h-6 px-2 text-xs text-destructive hover:text-destructive"
          >
            Clear all
          </Button>
        </div>
      )}

      {/* Selected layover cities inline */}
      {selectedLayovers.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedLayovers.slice(0, 6).map(city => (
            <Badge
              key={city}
              variant="secondary"
              className="flex items-center gap-1 pr-1"
            >
              <span className="text-xs">{city}</span>
              <button
                onClick={() => toggleLayoverCity(city)}
                className="ml-1 rounded-full p-0.5 transition-colors hover:bg-destructive/20"
                aria-label={`Remove ${city}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {selectedLayovers.length > 6 && (
            <Badge variant="outline" className="text-xs">
              +{selectedLayovers.length - 6} more
            </Badge>
          )}
        </div>
      )}

      {/* PBS Filters — real NAVBLUE bid properties, matching the terms
          pilots use in the actual PBS system (see shared/pbsFilterLabels.ts) */}
      <Collapsible open={showPbsFilters} onOpenChange={setShowPbsFilters}>
        <CollapsibleTrigger className="sr-only">PBS filters</CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">
              Filter with the same properties you bid with in PBS. Leave a
              field blank to ignore it; press Enter or click away to apply.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pbsRangeFields.map(field => {
                const meta = PBS_FILTER_FIELDS[field.metaKey];
                return (
                  <div key={field.metaKey} className="space-y-1.5">
                    <label
                      className="text-sm font-medium text-secondary-foreground"
                      title={meta?.gloss}
                    >
                      {meta?.navblueLabel ?? field.metaKey}
                    </label>
                    <div className="flex items-center gap-2">
                      {[field.minKey, field.maxKey].map((key, i) => (
                        <input
                          key={key}
                          type="number"
                          inputMode="decimal"
                          step={field.step}
                          min="0"
                          placeholder={i === 0 ? 'Min' : 'Max'}
                          value={pbsInputs[key] ?? ''}
                          onFocus={() => onPbsFocus(key)}
                          onChange={e =>
                            setPbsInputs(prev => ({
                              ...prev,
                              [key]: e.target.value,
                            }))
                          }
                          onBlur={e =>
                            onPbsBlur(key, e.target.value, applyPbsNumber)
                          }
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              onPbsEnter(key, pbsInputs[key] ?? '', applyPbsNumber);
                            }
                          }}
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                          data-testid={`input-pbs-${key}`}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}

              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-secondary-foreground"
                  title={PBS_FILTER_FIELDS.checkInStations?.gloss}
                >
                  {PBS_FILTER_FIELDS.checkInStations?.navblueLabel}
                </label>
                <input
                  type="text"
                  placeholder="e.g. JFK, LGA"
                  value={pbsInputs.checkInStations ?? ''}
                  onFocus={() => onPbsFocus('checkInStations')}
                  onChange={e =>
                    setPbsInputs(prev => ({
                      ...prev,
                      checkInStations: e.target.value,
                    }))
                  }
                  onBlur={e =>
                    onPbsBlur('checkInStations', e.target.value, applyPbsList)
                  }
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      onPbsEnter(
                        'checkInStations',
                        pbsInputs.checkInStations ?? '',
                        applyPbsList
                      );
                    }
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm uppercase ring-offset-background placeholder:normal-case placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  data-testid="input-pbs-checkInStations"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-secondary-foreground"
                  title={PBS_FILTER_FIELDS.excludeLayoverCities?.gloss}
                >
                  {PBS_FILTER_FIELDS.excludeLayoverCities?.navblueLabel}
                </label>
                <input
                  type="text"
                  placeholder="e.g. EWR, BOS"
                  value={pbsInputs.excludeLayoverCities ?? ''}
                  onFocus={() => onPbsFocus('excludeLayoverCities')}
                  onChange={e =>
                    setPbsInputs(prev => ({
                      ...prev,
                      excludeLayoverCities: e.target.value,
                    }))
                  }
                  onBlur={e =>
                    onPbsBlur(
                      'excludeLayoverCities',
                      e.target.value,
                      applyPbsList
                    )
                  }
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      onPbsEnter(
                        'excludeLayoverCities',
                        pbsInputs.excludeLayoverCities ?? '',
                        applyPbsList
                      );
                    }
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm uppercase ring-offset-background placeholder:normal-case placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  data-testid="input-pbs-excludeLayoverCities"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-secondary-foreground"
                  title={PBS_FILTER_FIELDS.hasRedeye?.gloss}
                >
                  {PBS_FILTER_FIELDS.hasRedeye?.navblueLabel}
                </label>
                <div className="flex gap-1" role="radiogroup" aria-label="Redeye">
                  {(
                    [
                      { state: '' as const, label: 'Any' },
                      { state: 'has' as const, label: 'Has redeye' },
                      { state: 'none' as const, label: 'No redeye' },
                    ] as const
                  ).map(opt => (
                    <button
                      key={opt.label}
                      type="button"
                      role="radio"
                      aria-checked={redeyeState === opt.state}
                      onClick={() => setRedeye(opt.state)}
                      className={cn(
                        'h-9 flex-1 rounded-md border px-2 text-xs font-medium transition-colors',
                        redeyeState === opt.state
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-border bg-background text-secondary-foreground hover:bg-accent'
                      )}
                      data-testid={`button-pbs-redeye-${opt.label.replace(/\s/g, '-').toLowerCase()}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Advanced — the function/value picker, unchanged behavior */}
      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <CollapsibleTrigger className="sr-only">
          Advanced filters
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/40 p-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-secondary-foreground">
                Filter by
              </label>
              <select
                value={selectedFunction}
                onChange={e => {
                  setSelectedFunction(e.target.value);
                  setSelectedData(''); // Reset data selection when function changes
                }}
                className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Select function...</option>
                {allFilterOptions.map(option => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-secondary-foreground">
                Value
              </label>
              <select
                value={selectedData}
                onChange={e => {
                  handleSelectValueAndApply(e.target.value);
                }}
                disabled={!selectedFunction}
                className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">
                  {selectedFunction
                    ? 'Select value...'
                    : 'Select function first'}
                </option>
                {currentFunctionOptions.map((option, index) => (
                  <option key={index} value={option.value.toString()}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => setShowCustomize(true)}
              >
                Customize quick filters
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

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
                <p className="text-sm text-muted-foreground mb-2">Selected dates:</p>
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
