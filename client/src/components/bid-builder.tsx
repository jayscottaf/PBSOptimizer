import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
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
  clearScheduleStartNext: {
    icon: SkipForward,
    accent: 'border-l-gray-400',
    chip: 'text-gray-600 dark:text-gray-400',
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
  if (filter.creditMin !== undefined || filter.creditMax !== undefined) {
    parts.push(
      `credit ${filter.creditMin ?? 0}-${filter.creditMax ?? '∞'}`
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
  if (filter.deadheadsMax !== undefined) {
    parts.push(`max ${filter.deadheadsMax} DH`);
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
    case 'clearScheduleStartNext':
      return 'Clear Schedule and Start Next Bid Group';
  }
}

interface PreferenceFormState {
  kind: PreferenceKind;
  pairingDaysMin: string;
  pairingDaysMax: string;
  layoverCities: string;
  creditMin: string;
  creditMax: string;
  checkInHourMin: string;
  checkInHourMax: string;
  pairingNumbers: string;
  limit: string;
  elseStartNext: boolean;
  creditWindow: 'min' | 'max' | 'mid';
  preferOffDates: Date[];
}

const EMPTY_FORM: PreferenceFormState = {
  kind: 'award',
  pairingDaysMin: '',
  pairingDaysMax: '',
  layoverCities: '',
  creditMin: '',
  creditMax: '',
  checkInHourMin: '',
  checkInHourMax: '',
  pairingNumbers: '',
  limit: '',
  elseStartNext: false,
  creditWindow: 'max',
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
    const cities = form.layoverCities
      .split(/[,\s]+/)
      .map(city => city.trim().toUpperCase())
      .filter(Boolean);
    if (cities.length > 0) filter.layoverCities = cities;
    if (num(form.creditMin) !== undefined) filter.creditMin = num(form.creditMin);
    if (num(form.creditMax) !== undefined) filter.creditMax = num(form.creditMax);
    if (num(form.checkInHourMin) !== undefined)
      filter.checkInHourMin = num(form.checkInHourMin);
    if (num(form.checkInHourMax) !== undefined)
      filter.checkInHourMax = num(form.checkInHourMax);
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
  return { type: 'clearScheduleStartNext' };
}

interface BidBuilderProps {
  bidPackageId?: number;
}

export function BidBuilder({ bidPackageId }: BidBuilderProps) {
  const { toast } = useToast();
  const [bid, setBid] = useState<DraftBid>(loadDraft);
  const [addingToGroup, setAddingToGroup] = useState<number | null>(null);
  const [form, setForm] = useState<PreferenceFormState>({ ...EMPTY_FORM });
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [exported, setExported] = useState<BidExportResult | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);

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
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Draft Bid</h2>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowTemplates(v => !v)}
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
              }}
            >
              Clear draft
            </Button>
          </div>
        </div>

        {templatesVisible && (
          <Card className="border-dashed">
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

      {/* Results column */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
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
          <Card>
            <CardHeader className="py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  NAVBLUE bid text (review-ready)
                </CardTitle>
                <Button size="sm" variant="outline" onClick={copyExport}>
                  <ClipboardCopy className="h-4 w-4 mr-1" /> Copy
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {exported.warnings.length > 0 && (
                <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1">
                  {exported.warnings.map((warning, i) => (
                    <p
                      key={i}
                      className="text-xs text-amber-800 dark:text-amber-300"
                    >
                      • {warning}
                    </p>
                  ))}
                </div>
              )}
              <pre className="rounded bg-muted p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto">
                {exported.text}
              </pre>
              <p className="text-xs text-muted-foreground">
                Enter each line in NAVBLUE and verify it is accepted — property
                availability varies by configuration. This is a starting
                draft, not a guarantee of any award.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
      </div>
    </div>
  );
}
