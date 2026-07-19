import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type BidExportResult } from '@/lib/api';
import type {
  BidGroup,
  BidPreference,
  DraftBid,
  PairingFilter,
  SimulationResult,
} from '@shared/bidTypes';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Calendar } from '@/components/ui/calendar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PairingDisplay } from '@/components/pairing-display';
import { PbsEntryAssistant } from '@/components/pbs-entry-assistant';
import { useToast } from '@/hooks/use-toast';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  CalendarOff,
  ClipboardCopy,
  Gauge,
  Play,
  Plus,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Target,
  Trash2,
} from 'lucide-react';

const DRAFT_STORAGE_KEY = 'draftBid';

const EMPTY_BID: DraftBid = {
  groups: [
    { type: 'pairings', preferences: [] },
    { type: 'reserve', preferences: [] },
  ],
};

type PreferenceKind = BidPreference['type'];

const PREFERENCE_LABELS: Record<PreferenceKind, string> = {
  award: 'Award Pairings',
  avoid: 'Avoid Pairings',
  preferOff: 'Prefer Off',
  setConditionCredit: 'Set Condition (credit window)',
  setConditionPattern: 'Set Condition (pattern: days on/off)',
  clearScheduleStartNext: 'Clear Schedule and Start Next',
};

/** Visual identity per preference type: icon + accent for fast scanning. */
const PREFERENCE_STYLE: Record<
  PreferenceKind,
  { icon: typeof Target; accent: string; chip: string }
> = {
  award: {
    icon: Target,
    accent: 'border-l-emerald-500',
    chip: 'text-emerald-600 dark:text-emerald-400',
  },
  avoid: {
    icon: Ban,
    accent: 'border-l-red-500',
    chip: 'text-red-600 dark:text-red-400',
  },
  preferOff: {
    icon: CalendarOff,
    accent: 'border-l-sky-500',
    chip: 'text-sky-600 dark:text-sky-400',
  },
  setConditionCredit: {
    icon: Gauge,
    accent: 'border-l-purple-500',
    chip: 'text-purple-600 dark:text-purple-400',
  },
  setConditionPattern: {
    icon: Gauge,
    accent: 'border-l-indigo-500',
    chip: 'text-indigo-600 dark:text-indigo-400',
  },
  clearScheduleStartNext: {
    icon: SkipForward,
    accent: 'border-l-gray-400',
    chip: 'text-muted-foreground',
  },
};

interface BidTemplate {
  id: string;
  label: string;
  description: string;
  build: () => DraftBid;
}

/**
 * Quick-start drafts modeled on the coach's strategy archetypes. Each is a
 * legal structure (negatives before awards, fallback award, trailing
 * reserve group) the pilot then tunes.
 */
const BID_TEMPLATES: BidTemplate[] = [
  {
    id: 'quality-of-life',
    label: 'Quality of Life',
    description:
      'No early check-ins, favor 2-3 day trips, broad fallback so PBS can still complete the line.',
    build: () => ({
      groups: [
        {
          type: 'pairings',
          preferences: [
            { type: 'avoid', filter: { checkInHourMax: 5 } },
            {
              type: 'award',
              filter: { pairingDaysMin: 2, pairingDaysMax: 3 },
              limit: 4,
            },
            { type: 'award' },
          ],
        },
        { type: 'reserve', preferences: [] },
      ],
    }),
  },
  {
    id: 'maximize-credit',
    label: 'Maximize Credit',
    description:
      'Max Credit window with an exit (caps can apply), high daily-credit trips first, broad fallback.',
    build: () => ({
      groups: [
        {
          type: 'pairings',
          preferences: [
            {
              type: 'setConditionCredit',
              creditWindow: 'max',
              elseStartNext: true,
            },
            { type: 'award', filter: { averageDailyCreditMin: 5.5 } },
            { type: 'award' },
          ],
        },
        {
          type: 'pairings',
          preferences: [{ type: 'award' }],
        },
        { type: 'reserve', preferences: [] },
      ],
    }),
  },
  {
    id: 'commuter',
    label: 'Commuter Friendly',
    description:
      'Late check-ins (10:00+), longer trips to cut commute legs, broad fallback.',
    build: () => ({
      groups: [
        {
          type: 'pairings',
          preferences: [
            { type: 'avoid', filter: { checkInHourMax: 9 } },
            {
              type: 'award',
              filter: { pairingDaysMin: 3, pairingDaysMax: 4 },
            },
            { type: 'award' },
          ],
        },
        { type: 'reserve', preferences: [] },
      ],
    }),
  },
];

// DraftBid is plain JSON data, so a JSON round-trip is a safe deep clone
function cloneBid(bid: DraftBid): DraftBid {
  return JSON.parse(JSON.stringify(bid)) as DraftBid;
}

function loadDraft(): DraftBid {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DraftBid;
      if (Array.isArray(parsed?.groups)) return parsed;
    }
  } catch {
    // fall through to empty draft
  }
  return cloneBid(EMPTY_BID);
}

function formatHours(hours: number): string {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return `${whole}:${String(minutes).padStart(2, '0')}`;
}

function summarizeFilter(filter?: PairingFilter): string {
  if (!filter) return 'any pairing';
  const parts: string[] = [];
  if (filter.pairingNumbers?.length) {
    parts.push(`#${filter.pairingNumbers.join(', #')}`);
  }
  if (
    filter.pairingDaysMin !== undefined ||
    filter.pairingDaysMax !== undefined
  ) {
    if (filter.pairingDaysMin === filter.pairingDaysMax) {
      parts.push(`${filter.pairingDaysMin}-day`);
    } else {
      parts.push(
        `${filter.pairingDaysMin ?? 1}-${filter.pairingDaysMax ?? '∞'} days`
      );
    }
  }
  if (filter.layoverCities?.length) {
    parts.push(`layover ${filter.layoverCities.join('/')}`);
  }
  if (filter.excludeLayoverCities?.length) {
    parts.push(`not layover ${filter.excludeLayoverCities.join('/')}`);
  }
  if (
    filter.layoverCountMin !== undefined ||
    filter.layoverCountMax !== undefined
  ) {
    parts.push(
      `${filter.layoverCountMin ?? 0}-${filter.layoverCountMax ?? '∞'} layovers`
    );
  }
  if (
    filter.totalLayoverHoursMin !== undefined ||
    filter.totalLayoverHoursMax !== undefined
  ) {
    parts.push(
      `total LO ${filter.totalLayoverHoursMin ?? 0}-${filter.totalLayoverHoursMax ?? '∞'}h`
    );
  }
  if (filter.creditMin !== undefined || filter.creditMax !== undefined) {
    parts.push(
      `credit ${filter.creditMin ?? 0}-${filter.creditMax ?? '∞'}`
    );
  }
  if (filter.blockMin !== undefined || filter.blockMax !== undefined) {
    parts.push(`block ${filter.blockMin ?? 0}-${filter.blockMax ?? '∞'}`);
  }
  if (
    filter.averageDailyCreditMin !== undefined ||
    filter.averageDailyCreditMax !== undefined
  ) {
    parts.push(
      `ADC ${filter.averageDailyCreditMin ?? 0}-${filter.averageDailyCreditMax ?? '∞'}`
    );
  }
  if (
    filter.averageDailyBlockMin !== undefined ||
    filter.averageDailyBlockMax !== undefined
  ) {
    parts.push(
      `ADB ${filter.averageDailyBlockMin ?? 0}-${filter.averageDailyBlockMax ?? '∞'}`
    );
  }
  if (
    filter.checkInHourMin !== undefined ||
    filter.checkInHourMax !== undefined
  ) {
    parts.push(
      `check-in ${filter.checkInHourMin ?? 0}:00-${filter.checkInHourMax ?? 23}:59`
    );
  }
  if (filter.deadheadsMin !== undefined) {
    parts.push(filter.deadheadsMin === 1 ? 'has DH' : `≥${filter.deadheadsMin} DH`);
  }
  if (filter.deadheadsMax !== undefined) {
    parts.push(`≤${filter.deadheadsMax} DH`);
  }
  if (filter.checkInStations?.length) {
    parts.push(`check-in @ ${filter.checkInStations.join('/')}`);
  }
  if (filter.hasRedeye !== undefined) {
    parts.push(filter.hasRedeye ? 'has redeye' : 'no redeye');
  }
  if (filter.carryOutMin !== undefined || filter.carryOutMax !== undefined) {
    parts.push(
      `carry-out ${filter.carryOutMin ?? 0}-${filter.carryOutMax ?? '∞'}d`
    );
  }
  return parts.length > 0 ? parts.join(', ') : 'any pairing';
}

function summarizePreference(pref: BidPreference): string {
  switch (pref.type) {
    case 'award':
      return (
        `Award: ${summarizeFilter(pref.filter)}` +
        (pref.limit !== undefined ? ` (Limit ${pref.limit})` : '')
      );
    case 'avoid':
      return (
        `Avoid: ${summarizeFilter(pref.filter)}` +
        (pref.elseStartNext ? ' + Else Start Next' : '')
      );
    case 'preferOff':
      return (
        `Prefer Off: ${(pref.preferOffDates ?? []).join(', ')}` +
        (pref.elseStartNext ? ' + Else Start Next' : '')
      );
    case 'setConditionCredit': {
      const labels = { min: 'Minimum', max: 'Maximum', mid: 'Mid', normal: 'Normal' };
      return `Set Condition: ${labels[pref.creditWindow ?? 'normal']} Credit`;
    }
    case 'setConditionPattern':
      return (
        `Set Condition: Pattern ${pref.patternDaysOnMin}-${pref.patternDaysOnMax} on, ` +
        `${pref.patternDaysOffMin}+ off` +
        (pref.elseStartNext ? ' + Else Start Next' : '')
      );
    case 'clearScheduleStartNext':
      return 'Clear Schedule and Start Next Bid Group';
  }
}

interface PreferenceFormState {
  kind: PreferenceKind;
  pairingDaysMin: string;
  pairingDaysMax: string;
  layoverCities: string;
  excludeLayoverCities: string;
  layoverCountMin: string;
  layoverCountMax: string;
  totalLayoverHoursMin: string;
  totalLayoverHoursMax: string;
  creditMin: string;
  creditMax: string;
  blockMin: string;
  blockMax: string;
  averageDailyCreditMin: string;
  averageDailyCreditMax: string;
  averageDailyBlockMin: string;
  averageDailyBlockMax: string;
  checkInHourMin: string;
  checkInHourMax: string;
  deadheadsMin: string;
  deadheadsMax: string;
  checkInStations: string;
  redeye: '' | 'has' | 'none';
  carryOutMin: string;
  carryOutMax: string;
  pairingNumbers: string;
  limit: string;
  elseStartNext: boolean;
  creditWindow: 'min' | 'max' | 'mid';
  patternDaysOnMin: string;
  patternDaysOnMax: string;
  patternDaysOffMin: string;
  preferOffDates: Date[];
}

const EMPTY_FORM: PreferenceFormState = {
  kind: 'award',
  pairingDaysMin: '',
  pairingDaysMax: '',
  layoverCities: '',
  excludeLayoverCities: '',
  layoverCountMin: '',
  layoverCountMax: '',
  totalLayoverHoursMin: '',
  totalLayoverHoursMax: '',
  creditMin: '',
  creditMax: '',
  blockMin: '',
  blockMax: '',
  averageDailyCreditMin: '',
  averageDailyCreditMax: '',
  averageDailyBlockMin: '',
  averageDailyBlockMax: '',
  checkInHourMin: '',
  checkInHourMax: '',
  deadheadsMin: '',
  deadheadsMax: '',
  checkInStations: '',
  redeye: '',
  carryOutMin: '',
  carryOutMax: '',
  pairingNumbers: '',
  limit: '',
  elseStartNext: false,
  creditWindow: 'max',
  patternDaysOnMin: '',
  patternDaysOnMax: '',
  patternDaysOffMin: '',
  preferOffDates: [],
};

function buildPreference(form: PreferenceFormState): BidPreference | null {
  const num = (value: string): number | undefined => {
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  };
  if (form.kind === 'award' || form.kind === 'avoid') {
    const filter: PairingFilter = {};
    if (num(form.pairingDaysMin) !== undefined)
      filter.pairingDaysMin = num(form.pairingDaysMin);
    if (num(form.pairingDaysMax) !== undefined)
      filter.pairingDaysMax = num(form.pairingDaysMax);
    const parseCities = (raw: string) =>
      raw
        .split(/[,\s]+/)
        .map(city => city.trim().toUpperCase())
        .filter(Boolean);
    const cities = parseCities(form.layoverCities);
    if (cities.length > 0) filter.layoverCities = cities;
    const excludeCities = parseCities(form.excludeLayoverCities);
    if (excludeCities.length > 0) filter.excludeLayoverCities = excludeCities;
    if (num(form.layoverCountMin) !== undefined)
      filter.layoverCountMin = num(form.layoverCountMin);
    if (num(form.layoverCountMax) !== undefined)
      filter.layoverCountMax = num(form.layoverCountMax);
    if (num(form.totalLayoverHoursMin) !== undefined)
      filter.totalLayoverHoursMin = num(form.totalLayoverHoursMin);
    if (num(form.totalLayoverHoursMax) !== undefined)
      filter.totalLayoverHoursMax = num(form.totalLayoverHoursMax);
    if (num(form.creditMin) !== undefined) filter.creditMin = num(form.creditMin);
    if (num(form.creditMax) !== undefined) filter.creditMax = num(form.creditMax);
    if (num(form.blockMin) !== undefined) filter.blockMin = num(form.blockMin);
    if (num(form.blockMax) !== undefined) filter.blockMax = num(form.blockMax);
    if (num(form.averageDailyCreditMin) !== undefined)
      filter.averageDailyCreditMin = num(form.averageDailyCreditMin);
    if (num(form.averageDailyCreditMax) !== undefined)
      filter.averageDailyCreditMax = num(form.averageDailyCreditMax);
    if (num(form.averageDailyBlockMin) !== undefined)
      filter.averageDailyBlockMin = num(form.averageDailyBlockMin);
    if (num(form.averageDailyBlockMax) !== undefined)
      filter.averageDailyBlockMax = num(form.averageDailyBlockMax);
    if (num(form.checkInHourMin) !== undefined)
      filter.checkInHourMin = num(form.checkInHourMin);
    if (num(form.checkInHourMax) !== undefined)
      filter.checkInHourMax = num(form.checkInHourMax);
    if (num(form.deadheadsMin) !== undefined)
      filter.deadheadsMin = num(form.deadheadsMin);
    if (num(form.deadheadsMax) !== undefined)
      filter.deadheadsMax = num(form.deadheadsMax);
    const stations = parseCities(form.checkInStations);
    if (stations.length > 0) filter.checkInStations = stations;
    if (form.redeye === 'has') filter.hasRedeye = true;
    if (form.redeye === 'none') filter.hasRedeye = false;
    if (num(form.carryOutMin) !== undefined)
      filter.carryOutMin = num(form.carryOutMin);
    if (num(form.carryOutMax) !== undefined)
      filter.carryOutMax = num(form.carryOutMax);
    const numbers = form.pairingNumbers
      .split(/[,\s]+/)
      .map(token => token.trim())
      .filter(Boolean);
    if (numbers.length > 0) filter.pairingNumbers = numbers;
    const pref: BidPreference = {
      type: form.kind,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
    };
    if (form.kind === 'award' && num(form.limit) !== undefined) {
      pref.limit = num(form.limit);
    }
    if (form.kind === 'avoid' && form.elseStartNext) {
      pref.elseStartNext = true;
    }
    return pref;
  }
  if (form.kind === 'preferOff') {
    if (form.preferOffDates.length === 0) return null;
    const dates = form.preferOffDates
      .map(date => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      })
      .sort();
    return {
      type: 'preferOff',
      preferOffDates: dates,
      ...(form.elseStartNext ? { elseStartNext: true } : {}),
    };
  }
  if (form.kind === 'setConditionCredit') {
    return {
      type: 'setConditionCredit',
      creditWindow: form.creditWindow,
      ...(form.elseStartNext ? { elseStartNext: true } : {}),
    };
  }
  if (form.kind === 'setConditionPattern') {
    const on1 = num(form.patternDaysOnMin);
    const on2 = num(form.patternDaysOnMax);
    const off = num(form.patternDaysOffMin);
    if (on1 === undefined || on2 === undefined || off === undefined) {
      return null;
    }
    return {
      type: 'setConditionPattern',
      patternDaysOnMin: on1,
      patternDaysOnMax: on2,
      patternDaysOffMin: off,
      ...(form.elseStartNext ? { elseStartNext: true } : {}),
    };
  }
  return { type: 'clearScheduleStartNext' };
}

interface BidBuilderProps {
  bidPackageId?: number;
  userId?: number;
}

export function BidBuilder({ bidPackageId, userId }: BidBuilderProps) {
  const { toast } = useToast();
  const [bid, setBid] = useState<DraftBid>(loadDraft);
  const [addingToGroup, setAddingToGroup] = useState<number | null>(null);
  const [form, setForm] = useState<PreferenceFormState>({ ...EMPTY_FORM });
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [exported, setExported] = useState<BidExportResult | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const templatesCardRef = useRef<HTMLDivElement | null>(null);
  const [optimizeDepth, setOptimizeDepth] = useState<
    'auto' | 'compact' | 'deep'
  >('auto');
  const [optimizerRationale, setOptimizerRationale] = useState<string[]>([]);
  const [learnEmployeeNumber, setLearnEmployeeNumber] = useState('');
  const queryClient = useQueryClient();

  const { data: bidProfile } = useQuery({
    queryKey: ['bid-profile', userId],
    queryFn: async () => {
      const res = await fetch(`/api/bid-profile/${userId}`);
      if (!res.ok) throw new Error('Failed to load profile');
      return res.json();
    },
    enabled: !!userId,
    staleTime: 60_000,
  });

  const learnProfileMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/bid-profile/${userId}/learn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeNumber: learnEmployeeNumber.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Learning failed');
      }
      return res.json();
    },
    onSuccess: result => {
      queryClient.invalidateQueries({ queryKey: ['bid-profile', userId] });
      toast({
        title: 'Profile learned from your history',
        description: `${result.learnedFromPeriods} bid periods analyzed. Auto-draft now uses your revealed preferences.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Learning failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(bid));
    } catch {
      // storage full/unavailable - draft just won't persist
    }
  }, [bid]);

  const preferenceCount = useMemo(
    () => bid.groups.reduce((sum, group) => sum + group.preferences.length, 0),
    [bid]
  );

  const simulateMutation = useMutation({
    mutationFn: () => api.simulateBid(bidPackageId!, bid),
    onSuccess: result => {
      setSimulation(result);
    },
    onError: (error: Error) => {
      toast({
        title: 'Simulation failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const exportMutation = useMutation({
    mutationFn: () => api.exportBid(bid),
    onSuccess: result => {
      setExported(result);
    },
    onError: (error: Error) => {
      toast({
        title: 'Export failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const optimizeMutation = useMutation({
    mutationFn: () =>
      api.optimizeBid(bidPackageId!, userId, undefined, optimizeDepth),
    onSuccess: result => {
      setBid(result.bid);
      setSimulation(result.simulation);
      setExported(null);
      setOptimizerRationale(result.rationale);
      toast({
        title:
          result.profileSource === 'neutral'
            ? 'Draft generated (neutral profile)'
            : 'Optimized draft generated',
        description:
          result.profileSource === 'neutral'
            ? 'No preference profile yet — learn one from your history or set weights for a personalized draft.'
            : `Built from your ${result.profileSource} profile. Review, tune, and re-simulate.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Optimize failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const updateBid = (updater: (draft: DraftBid) => void) => {
    setBid(prev => {
      const next = cloneBid(prev);
      updater(next);
      return next;
    });
    setSimulation(null);
    setExported(null);
  };

  const movePreference = (
    groupIndex: number,
    prefIndex: number,
    direction: -1 | 1
  ) => {
    updateBid(draft => {
      const prefs = draft.groups[groupIndex].preferences;
      const target = prefIndex + direction;
      if (target < 0 || target >= prefs.length) return;
      [prefs[prefIndex], prefs[target]] = [prefs[target], prefs[prefIndex]];
    });
  };

  const addPreference = (groupIndex: number) => {
    const pref = buildPreference(form);
    if (!pref) {
      toast({
        title: 'Incomplete preference',
        description: 'Prefer Off needs at least one date selected.',
        variant: 'destructive',
      });
      return;
    }
    updateBid(draft => {
      draft.groups[groupIndex].preferences.push(pref);
    });
    setAddingToGroup(null);
    setForm({ ...EMPTY_FORM });
  };

  const copyExport = async () => {
    if (!exported) return;
    try {
      await navigator.clipboard.writeText(exported.text);
      toast({ title: 'Copied', description: 'Bid text copied to clipboard.' });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Select the text and copy manually.',
        variant: 'destructive',
      });
    }
  };

  const applyTemplate = (template: BidTemplate) => {
    setBid(template.build());
    setSimulation(null);
    setExported(null);
    setShowTemplates(false);
    toast({
      title: `${template.label} template loaded`,
      description: 'Tune the preferences, then Simulate.',
    });
  };

  if (!bidPackageId) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Upload a bid package first — the Bid Builder simulates your draft
          against the loaded pairings.
        </CardContent>
      </Card>
    );
  }

  const templatesVisible = showTemplates || preferenceCount === 0;

  // The strategy card is force-shown on an empty draft, so a plain toggle
  // makes the Templates button feel dead (and on mobile the card sits below
  // the fold). Reveal + scroll to it; only a second click on an explicitly
  // opened card hides it again.
  const handleTemplatesClick = () => {
    if (showTemplates && preferenceCount > 0) {
      setShowTemplates(false);
      return;
    }
    setShowTemplates(true);
    window.requestAnimationFrame(() => {
      templatesCardRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  };

  return (
    <div className="space-y-4">
      {/* How it works strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-muted/40 px-4 py-2.5 text-sm">
        <span className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
            1
          </span>
          Build your bid groups
        </span>
        <span className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
            2
          </span>
          Simulate against this month's pairings
        </span>
        <span className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
            3
          </span>
          Copy the NAVBLUE text into PBS
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
      {/* Builder column */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Draft Bid</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => optimizeMutation.mutate()}
              disabled={optimizeMutation.isPending}
              title="Generate a draft from your preference profile, hold history, and this month's pairings"
            >
              <Sparkles className="h-4 w-4 mr-1" />
              {optimizeMutation.isPending ? 'Optimizing…' : 'Auto-draft'}
            </Button>
            <Select
              value={optimizeDepth}
              onValueChange={value =>
                setOptimizeDepth(value as 'auto' | 'compact' | 'deep')
              }
            >
              <SelectTrigger
                className="h-9 w-[7.5rem] text-sm"
                title="Cascade depth: Auto matches your completion odds; Deep builds the long relaxation ladder a junior pilot needs"
                data-testid="select-optimize-depth"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Depth: Auto</SelectItem>
                <SelectItem value="compact">Depth: Compact</SelectItem>
                <SelectItem value="deep">Depth: Deep</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTemplatesClick}
              title="Start from a strategy template"
            >
              <Sparkles className="h-4 w-4 mr-1" /> Templates
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                updateBid(draft => {
                  draft.groups.splice(
                    draft.groups.length - 1,
                    0,
                    { type: 'pairings', preferences: [] }
                  );
                })
              }
            >
              <Plus className="h-4 w-4 mr-1" /> Group
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setBid(cloneBid(EMPTY_BID));
                setSimulation(null);
                setExported(null);
                setOptimizerRationale([]);
              }}
            >
              Clear draft
            </Button>
          </div>
        </div>

        {userId && bidProfile && (
          <Card className="border-dashed">
            <CardHeader className="py-3">
              <CardTitle className="flex items-center justify-between text-sm font-medium">
                <span>Preference profile</span>
                <Badge variant="outline">
                  {bidProfile.source === 'none'
                    ? 'not set'
                    : `${bidProfile.source}${bidProfile.learnedFromPeriods ? ` · ${bidProfile.learnedFromPeriods} periods` : ''}`}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {bidProfile.source !== 'none' && bidProfile.weights && (
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <Badge variant="secondary">
                    {bidProfile.weights.creditLeaning <= -0.33
                      ? 'Quality-of-life bidder'
                      : bidProfile.weights.creditLeaning >= 0.33
                        ? 'Credit maximizer'
                        : 'Balanced credit/QoL'}
                  </Badge>
                  {(bidProfile.weights.checkInStationAvoids ?? []).map(
                    (s: string) => (
                      <Badge key={s} variant="secondary">
                        avoids {s} check-in
                      </Badge>
                    )
                  )}
                  {bidProfile.weights.avoidsCarryOut && (
                    <Badge variant="secondary">avoids carry-out</Badge>
                  )}
                  {bidProfile.weights.avoidsRedeyes && (
                    <Badge variant="secondary">avoids redeyes</Badge>
                  )}
                  {(bidProfile.weights.preferOffDOWs ?? []).length > 0 && (
                    <Badge variant="secondary">
                      off {(bidProfile.weights.preferOffDOWs as string[])
                        .map(d => d.slice(0, 3))
                        .join('/')}
                    </Badge>
                  )}
                  {bidProfile.weights.preferredPattern && (
                    <Badge variant="secondary">
                      pattern {bidProfile.weights.preferredPattern.daysOnMin}-
                      {bidProfile.weights.preferredPattern.daysOnMax} on /{' '}
                      {bidProfile.weights.preferredPattern.daysOffMin}+ off
                    </Badge>
                  )}
                  {(bidProfile.weights.preferredTripLengths ?? []).length >
                    0 && (
                    <Badge variant="secondary">
                      trips{' '}
                      {(bidProfile.weights.preferredTripLengths as number[]).join(
                        '>'
                      )}
                      d
                    </Badge>
                  )}
                </div>
              )}
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">
                    Employee number (learn from your own bid history)
                  </Label>
                  <Input
                    placeholder="e.g. 050000600"
                    value={learnEmployeeNumber}
                    onChange={e => setLearnEmployeeNumber(e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    !learnEmployeeNumber.trim() ||
                    learnProfileMutation.isPending
                  }
                  onClick={() => learnProfileMutation.mutate()}
                >
                  {learnProfileMutation.isPending
                    ? 'Learning…'
                    : bidProfile.source === 'none'
                      ? 'Learn profile'
                      : 'Re-learn'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Your profile is learned only from your own Reasons history
                and drives Auto-draft. Nothing is preset.
              </p>
            </CardContent>
          </Card>
        )}

        {optimizerRationale.length > 0 && (
          <Card className="border-dashed">
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4" /> Why this draft
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">
                {optimizerRationale.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {templatesVisible && (
          <Card ref={templatesCardRef} className="border-dashed">
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-amber-500" />
                Start from a strategy
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-3">
              {BID_TEMPLATES.map(template => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => applyTemplate(template)}
                  className="rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-accent"
                >
                  <span className="block text-sm font-medium">
                    {template.label}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {template.description}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        {bid.groups.map((group: BidGroup, groupIndex: number) => (
          <Card key={groupIndex}>
            <CardHeader className="py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  Group {groupIndex + 1}:{' '}
                  {group.type === 'reserve' ? 'Reserve' : 'Pairings'}
                </CardTitle>
                {bid.groups.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      updateBid(draft => {
                        draft.groups.splice(groupIndex, 1);
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {group.type === 'reserve' ? (
                <p className="text-sm text-muted-foreground">
                  Reserve fallback group. Reserve line construction is not
                  simulated; keeping this group is the handbook's rule of
                  thumb — it does not hurt regular-line chances.
                </p>
              ) : (
                <>
                  {group.preferences.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No preferences yet. PBS would fill this group with the
                      system-generated Award Pairings.
                    </p>
                  )}
                  {group.preferences.map(
                    (pref: BidPreference, prefIndex: number) => {
                      const style = PREFERENCE_STYLE[pref.type];
                      const PrefIcon = style.icon;
                      return (
                      <div
                        key={prefIndex}
                        className={`flex items-center gap-2 rounded border border-l-4 ${style.accent} px-2 py-1.5 text-sm`}
                      >
                        <PrefIcon
                          className={`h-4 w-4 shrink-0 ${style.chip}`}
                        />
                        <span className="flex-1">
                          <span className="mr-1.5 text-xs text-muted-foreground">
                            {prefIndex + 1}.
                          </span>
                          {summarizePreference(pref)}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={prefIndex === 0}
                          onClick={() =>
                            movePreference(groupIndex, prefIndex, -1)
                          }
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={prefIndex === group.preferences.length - 1}
                          onClick={() =>
                            movePreference(groupIndex, prefIndex, 1)
                          }
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() =>
                            updateBid(draft => {
                              draft.groups[groupIndex].preferences.splice(
                                prefIndex,
                                1
                              );
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      );
                    }
                  )}

                  {addingToGroup === groupIndex ? (
                    <div className="space-y-3 rounded border p-3">
                      <div className="space-y-1.5">
                        <Label>Preference type</Label>
                        <Select
                          value={form.kind}
                          onValueChange={value =>
                            setForm(prev => ({
                              ...prev,
                              kind: value as PreferenceKind,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(
                              Object.keys(PREFERENCE_LABELS) as PreferenceKind[]
                            ).map(kind => (
                              <SelectItem key={kind} value={kind}>
                                {PREFERENCE_LABELS[kind]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {(form.kind === 'award' || form.kind === 'avoid') && (
                        <div className="grid grid-cols-2 gap-2">
                          <div className="col-span-2 mt-1 border-t border-border pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Trip shape
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Days min</Label>
                            <Input
                              type="number"
                              value={form.pairingDaysMin}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  pairingDaysMin: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Days max</Label>
                            <Input
                              type="number"
                              value={form.pairingDaysMax}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  pairingDaysMax: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs"># Layovers min</Label>
                            <Input
                              type="number"
                              min="0"
                              value={form.layoverCountMin}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  layoverCountMin: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs"># Layovers max</Label>
                            <Input
                              type="number"
                              min="0"
                              value={form.layoverCountMax}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  layoverCountMax: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Deadheads min</Label>
                            <Input
                              type="number"
                              min="0"
                              value={form.deadheadsMin}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  deadheadsMin: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Deadheads max</Label>
                            <Input
                              type="number"
                              min="0"
                              value={form.deadheadsMax}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  deadheadsMax: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">
                              Carry-out days min
                            </Label>
                            <Input
                              type="number"
                              min="0"
                              value={form.carryOutMin}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  carryOutMin: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">
                              Carry-out days max
                            </Label>
                            <Input
                              type="number"
                              min="0"
                              value={form.carryOutMax}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  carryOutMax: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Redeye</Label>
                            <Select
                              value={form.redeye || 'any'}
                              onValueChange={value =>
                                setForm(p => ({
                                  ...p,
                                  redeye: (value === 'any' ? '' : value) as
                                    | ''
                                    | 'has'
                                    | 'none',
                                }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="any">
                                  Either (no condition)
                                </SelectItem>
                                <SelectItem value="has">
                                  Has a redeye leg
                                </SelectItem>
                                <SelectItem value="none">No redeyes</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="col-span-2 mt-1 border-t border-border pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Credit & block
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Credit min (hrs)</Label>
                            <Input
                              type="number"
                              step="0.5"
                              value={form.creditMin}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  creditMin: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Credit max (hrs)</Label>
                            <Input
                              type="number"
                              step="0.5"
                              value={form.creditMax}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  creditMax: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Block min (hrs)</Label>
                            <Input
                              type="number"
                              step="0.5"
                              value={form.blockMin}
                              onChange={e =>
                                setForm(p => ({ ...p, blockMin: e.target.value }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Block max (hrs)</Label>
                            <Input
                              type="number"
                              step="0.5"
                              value={form.blockMax}
                              onChange={e =>
                                setForm(p => ({ ...p, blockMax: e.target.value }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">
                              Avg daily credit min
                            </Label>
                            <Input
                              type="number"
                              step="0.25"
                              value={form.averageDailyCreditMin}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  averageDailyCreditMin: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">
                              Avg daily credit max
                            </Label>
                            <Input
                              type="number"
                              step="0.25"
                              value={form.averageDailyCreditMax}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  averageDailyCreditMax: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">
                              Avg daily block min
                            </Label>
                            <Input
                              type="number"
                              step="0.25"
                              value={form.averageDailyBlockMin}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  averageDailyBlockMin: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">
                              Avg daily block max
                            </Label>
                            <Input
                              type="number"
                              step="0.25"
                              value={form.averageDailyBlockMax}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  averageDailyBlockMax: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="col-span-2 mt-1 border-t border-border pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Layovers
                          </div>
                          <div className="col-span-2 space-y-1">
                            <Label className="text-xs">
                              Layover cities (comma-separated)
                            </Label>
                            <Input
                              placeholder="BOS, MIA"
                              value={form.layoverCities}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  layoverCities: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="col-span-2 space-y-1">
                            <Label className="text-xs">
                              Exclude layover cities (comma-separated)
                            </Label>
                            <Input
                              placeholder="ORD, DFW"
                              value={form.excludeLayoverCities}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  excludeLayoverCities: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">
                              Total layover min (hrs)
                            </Label>
                            <Input
                              type="number"
                              step="0.5"
                              value={form.totalLayoverHoursMin}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  totalLayoverHoursMin: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">
                              Total layover max (hrs)
                            </Label>
                            <Input
                              type="number"
                              step="0.5"
                              value={form.totalLayoverHoursMax}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  totalLayoverHoursMax: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="col-span-2 mt-1 border-t border-border pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Check-in & specifics
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">
                              Check-in from (0-23)
                            </Label>
                            <Input
                              type="number"
                              min="0"
                              max="23"
                              value={form.checkInHourMin}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  checkInHourMin: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">
                              Check-in to (0-23)
                            </Label>
                            <Input
                              type="number"
                              min="0"
                              max="23"
                              value={form.checkInHourMax}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  checkInHourMax: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="col-span-2 space-y-1">
                            <Label className="text-xs">
                              Check-in stations (comma-separated)
                            </Label>
                            <Input
                              placeholder="JFK, LGA"
                              value={form.checkInStations}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  checkInStations: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="col-span-2 space-y-1">
                            <Label className="text-xs">
                              Specific pairing numbers (optional)
                            </Label>
                            <Input
                              placeholder="7601, 7645"
                              value={form.pairingNumbers}
                              onChange={e =>
                                setForm(p => ({
                                  ...p,
                                  pairingNumbers: e.target.value,
                                }))
                              }
                            />
                          </div>
                          {form.kind === 'award' && (
                            <div className="space-y-1">
                              <Label className="text-xs">
                                Limit (max awards)
                              </Label>
                              <Input
                                type="number"
                                min="1"
                                value={form.limit}
                                onChange={e =>
                                  setForm(p => ({
                                    ...p,
                                    limit: e.target.value,
                                  }))
                                }
                              />
                            </div>
                          )}
                          {form.kind === 'avoid' && (
                            <div className="flex items-center gap-2 pt-5">
                              <Switch
                                checked={form.elseStartNext}
                                onCheckedChange={checked =>
                                  setForm(p => ({
                                    ...p,
                                    elseStartNext: checked,
                                  }))
                                }
                              />
                              <Label className="text-xs">
                                Else Start Next
                              </Label>
                            </div>
                          )}
                        </div>
                      )}

                      {form.kind === 'preferOff' && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">
                            Pick dates in true priority order awareness: list
                            the most important first — in Denial Mode, PBS
                            drops Prefer Off dates from the END of the list.
                          </p>
                          <Calendar
                            mode="multiple"
                            selected={form.preferOffDates}
                            onSelect={dates =>
                              setForm(p => ({
                                ...p,
                                preferOffDates: dates ?? [],
                              }))
                            }
                          />
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={form.elseStartNext}
                              onCheckedChange={checked =>
                                setForm(p => ({ ...p, elseStartNext: checked }))
                              }
                            />
                            <Label className="text-xs">Else Start Next</Label>
                          </div>
                        </div>
                      )}

                      {form.kind === 'setConditionCredit' && (
                        <div className="space-y-2">
                          <Select
                            value={form.creditWindow}
                            onValueChange={value =>
                              setForm(p => ({
                                ...p,
                                creditWindow: value as 'min' | 'max' | 'mid',
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="max">
                                Maximum Credit (ALV to top of window)
                              </SelectItem>
                              <SelectItem value="min">
                                Minimum Credit (bottom of window to ALV)
                              </SelectItem>
                              <SelectItem value="mid">
                                Mid Credit (ALV ±5, cannot be capped)
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            Min/Max Credit bidders can be capped by seniority;
                            without an exit, PBS ignores a capped condition.
                          </p>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={form.elseStartNext}
                              onCheckedChange={checked =>
                                setForm(p => ({ ...p, elseStartNext: checked }))
                              }
                            />
                            <Label className="text-xs">Else Start Next</Label>
                          </div>
                        </div>
                      )}

                      {form.kind === 'setConditionPattern' && (
                        <div className="space-y-2">
                          <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Days on (min)</Label>
                              <Input
                                type="number"
                                min="1"
                                value={form.patternDaysOnMin}
                                onChange={e =>
                                  setForm(p => ({
                                    ...p,
                                    patternDaysOnMin: e.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Days on (max)</Label>
                              <Input
                                type="number"
                                min="1"
                                value={form.patternDaysOnMax}
                                onChange={e =>
                                  setForm(p => ({
                                    ...p,
                                    patternDaysOnMax: e.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Days off (min)</Label>
                              <Input
                                type="number"
                                min="1"
                                value={form.patternDaysOffMin}
                                onChange={e =>
                                  setForm(p => ({
                                    ...p,
                                    patternDaysOffMin: e.target.value,
                                  }))
                                }
                              />
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Shapes the whole line: work stretches of min–max
                            days separated by at least the given days off.
                            Exported exactly; not yet scored by Simulate.
                          </p>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={form.elseStartNext}
                              onCheckedChange={checked =>
                                setForm(p => ({ ...p, elseStartNext: checked }))
                              }
                            />
                            <Label className="text-xs">Else Start Next</Label>
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => addPreference(groupIndex)}
                        >
                          Add
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAddingToGroup(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setAddingToGroup(groupIndex);
                        setForm({ ...EMPTY_FORM });
                      }}
                    >
                      <Plus className="h-4 w-4 mr-1" /> Add preference
                    </Button>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Results column — sticky on wide screens so simulation results stay
          visible while editing a long draft on the left. */}
      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => simulateMutation.mutate()}
            disabled={simulateMutation.isPending || preferenceCount === 0}
          >
            <Play className="h-4 w-4 mr-1" />
            {simulateMutation.isPending ? 'Simulating…' : 'Simulate'}
          </Button>
          <Button
            variant="outline"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending || preferenceCount === 0}
          >
            <ClipboardCopy className="h-4 w-4 mr-1" />
            {exportMutation.isPending ? 'Exporting…' : 'Export NAVBLUE text'}
          </Button>
        </div>

        {!simulation && !exported && (
          <Card className="border-dashed">
            <CardContent className="flex items-start gap-3 py-6 text-sm text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="font-medium text-foreground">
                  Test before you bid.
                </p>
                <p className="mt-1">
                  Simulate runs your draft against every pairing in this
                  package and predicts what you could hold at your seniority.
                  Export produces the NAVBLUE text to enter into PBS — with
                  warnings for structural mistakes the guides call out.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {simulation && (
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-medium">
                Predicted line
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  Credit {formatHours(simulation.totalCredit)}
                </Badge>
                <Badge variant="secondary">
                  Expected {formatHours(simulation.expectedCredit)}
                </Badge>
                <Badge variant="secondary">
                  Window {formatHours(simulation.window.min)}–
                  {formatHours(simulation.window.max)}
                </Badge>
                <Badge
                  variant={simulation.lineComplete ? 'default' : 'destructive'}
                >
                  {simulation.lineComplete ? 'Line complete' : 'Incomplete'}
                </Badge>
              </div>

              {simulation.awards.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pairing</TableHead>
                      <TableHead>Days</TableHead>
                      <TableHead>Credit</TableHead>
                      <TableHead>Hold</TableHead>
                      <TableHead>By pref</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {simulation.awards.map(award => (
                      <TableRow key={award.pairingNumber}>
                        <TableCell>
                          <PairingDisplay
                            pairing={{ pairingNumber: award.pairingNumber }}
                            displayText={award.pairingNumber}
                          />
                        </TableCell>
                        <TableCell>{award.pairingDays}d</TableCell>
                        <TableCell>{formatHours(award.creditHours)}</TableCell>
                        <TableCell>
                          {award.holdProbability !== null
                            ? `${award.holdProbability}%`
                            : '—'}
                        </TableCell>
                        <TableCell>#{award.awardedByPreference}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No pairings predicted from your Award preferences.
                </p>
              )}

              {simulation.groupResults.some(
                g => g.inertPreferences.length > 0
              ) && (
                <div className="space-y-1 text-sm">
                  <p className="font-medium">Preferences that did nothing:</p>
                  {simulation.groupResults.flatMap(g =>
                    g.inertPreferences.map((inert, i) => (
                      <p
                        key={`${g.groupIndex}-${i}`}
                        className="text-muted-foreground"
                      >
                        Group {g.groupIndex + 1}, pref{' '}
                        {inert.preferenceIndex + 1}: {inert.reason}
                      </p>
                    ))
                  )}
                </div>
              )}

              <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1">
                <p className="flex items-center gap-1 text-sm font-medium text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4" /> What this does NOT
                  model
                </p>
                {simulation.caveats.map((caveat, i) => (
                  <p
                    key={i}
                    className="text-xs text-amber-800 dark:text-amber-300"
                  >
                    • {caveat}
                  </p>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {exported && (
          <PbsEntryAssistant exported={exported} onCopyAll={copyExport} />
        )}
      </div>
      </div>
    </div>
  );
}
