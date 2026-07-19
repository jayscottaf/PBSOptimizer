import { useEffect, useMemo, useState } from 'react';
import {
  ClipboardCopy,
  ChevronDown,
  GraduationCap,
  ListChecks,
  FileText,
  Lightbulb,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { BidExportResult } from '@/lib/api';

type EntryMode = 'beginner' | 'intermediate' | 'expert';

const MODES: Array<{ key: EntryMode; label: string; icon: typeof ListChecks }> =
  [
    { key: 'beginner', label: 'Beginner', icon: GraduationCap },
    { key: 'intermediate', label: 'Intermediate', icon: ListChecks },
    { key: 'expert', label: 'Expert', icon: FileText },
  ];

/** Stable key for the checked-off progress of one exported draft. A
 *  changed draft produces a different hash, resetting progress. */
function textHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}

interface PbsEntryAssistantProps {
  exported: BidExportResult;
  onCopyAll: () => void;
}

/**
 * Guided transfer of the built bid into NAVBLUE PBS. PBS has no
 * paste/import — every line is built through its widget UI — so this
 * renders the draft as a step-by-step entry checklist with the exact
 * display text PBS should show after each line, at three experience
 * levels (user-selected, remembered).
 */
export function PbsEntryAssistant({
  exported,
  onCopyAll,
}: PbsEntryAssistantProps) {
  const [mode, setMode] = useState<EntryMode>(() => {
    const saved = localStorage.getItem('pbs.entryMode');
    return saved === 'intermediate' || saved === 'expert' ? saved : 'beginner';
  });
  const progressKey = useMemo(
    () => `pbs.entryProgress.${textHash(exported.text)}`,
    [exported.text]
  );
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(progressKey);
      setChecked(raw ? JSON.parse(raw) : {});
    } catch {
      setChecked({});
    }
  }, [progressKey]);

  const setModePersist = (next: EntryMode) => {
    setMode(next);
    try {
      localStorage.setItem('pbs.entryMode', next);
    } catch {
      // ignore storage errors
    }
  };

  const toggleStep = (key: string, value: boolean) => {
    setChecked(prev => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(progressKey, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const copyLine = async (line: string) => {
    try {
      await navigator.clipboard.writeText(line);
      toast({ title: 'Line copied' });
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  };

  const totalSteps = exported.entrySteps.reduce(
    (sum, g) => sum + g.steps.length,
    0
  );
  const doneSteps = exported.entrySteps.reduce(
    (sum, g, gi) =>
      sum + g.steps.filter((_, si) => checked[`${gi}:${si}`]).length,
    0
  );

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">
            Enter this bid into PBS
          </CardTitle>
          <div className="flex items-center gap-2">
            <div
              role="group"
              aria-label="Experience level"
              className="flex rounded-md border border-border p-0.5"
            >
              {MODES.map(m => (
                <button
                  key={m.key}
                  type="button"
                  aria-pressed={mode === m.key}
                  onClick={() => setModePersist(m.key)}
                  className={cn(
                    'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                    mode === m.key
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <m.icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{m.label}</span>
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={onCopyAll}>
              <ClipboardCopy className="h-4 w-4 mr-1" /> Copy all
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {exported.warnings.length > 0 && (
          <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1">
            {exported.warnings.map((warning, i) => (
              <p key={i} className="text-xs text-amber-800 dark:text-amber-300">
                • {warning}
              </p>
            ))}
          </div>
        )}

        {mode === 'expert' ? (
          <>
            <pre className="rounded bg-muted p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto">
              {exported.text}
            </pre>
            <p className="text-xs text-muted-foreground">
              Enter each line in NAVBLUE in this order and verify it is
              accepted — property availability varies by configuration. This
              is a starting draft, not a guarantee of any award.
            </p>
          </>
        ) : (
          <>
            <div className="sticky top-0 z-10 -mx-1 rounded bg-card px-1 py-1.5">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium">
                  {doneSteps} of {totalSteps} lines entered
                </span>
                <span className="text-muted-foreground">
                  PBS has no paste — build each line, then verify the text
                </span>
              </div>
              <Progress value={totalSteps ? (doneSteps / totalSteps) * 100 : 0} />
            </div>
            <p className="text-xs text-muted-foreground">
              Work top to bottom — group order and line order are the bid.
              After saving each line in PBS, its displayed text must match the
              line below exactly; if it differs, delete it and re-enter.
            </p>

            {exported.entrySteps.map((group, gi) => (
              <div key={gi} className="space-y-1.5">
                <div className="flex items-baseline gap-2 border-b border-border pb-1">
                  <span className="text-sm font-semibold">{group.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {group.groupAction}
                  </span>
                </div>
                {group.steps.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No lines — just add the group itself.
                  </p>
                )}
                {group.steps.map((step, si) => {
                  const key = `${gi}:${si}`;
                  const isDone = !!checked[key];
                  return (
                    <div
                      key={si}
                      className={cn(
                        'rounded-lg border p-2.5 transition-colors',
                        isDone
                          ? 'border-success/40 bg-success/5'
                          : 'border-border'
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <Checkbox
                          checked={isDone}
                          onCheckedChange={v => toggleStep(key, !!v)}
                          aria-label="Mark line as entered"
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <code
                              className={cn(
                                'block text-xs leading-5',
                                isDone && 'text-muted-foreground line-through'
                              )}
                            >
                              {step.expectText}
                            </code>
                            <button
                              type="button"
                              onClick={() => copyLine(step.expectText)}
                              title="Copy this line's text"
                              className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <ClipboardCopy className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {mode === 'beginner' && step.why && (
                            <p className="mt-1 flex items-start gap-1.5 text-xs text-accent-foreground">
                              <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" />
                              {step.why}
                            </p>
                          )}
                          {mode === 'beginner' ? (
                            <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-xs text-muted-foreground">
                              {step.actions.map((action, ai) => (
                                <li key={ai}>{action}</li>
                              ))}
                            </ol>
                          ) : (
                            <Collapsible>
                              <CollapsibleTrigger className="mt-1 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
                                How to enter
                                <ChevronDown className="h-3 w-3" />
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs text-muted-foreground">
                                  {step.actions.map((action, ai) => (
                                    <li key={ai}>{action}</li>
                                  ))}
                                </ol>
                              </CollapsibleContent>
                            </Collapsible>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              This is a starting draft, not a guarantee of any award —
              property availability varies by airline configuration.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
