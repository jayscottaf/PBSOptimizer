import { useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import type {
  BidDocument,
  BidReviewResult,
  ReviewFinding,
} from '@shared/bid-review';
import { prepareReasonsUpload } from '@/lib/prepare-reasons-upload';
import { MAX_REASONS_TRANSFER_BYTES } from '@shared/reasons-upload';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface ReviewResponse {
  review?: BidReviewResult;
  document?: BidDocument;
  needsPilotSelection?: boolean;
  pilots?: { name: string; seniorityNumber: number }[];
  period?: string;
}
export function BidReviewPanel({
  seniorityNumber,
  onBuildBid,
  initialBidText,
}: {
  seniorityNumber?: number;
  onBuildBid: () => void;
  initialBidText?: string;
}) {
  const [mode, setMode] = useState<'results' | 'before'>(
    initialBidText ? 'before' : 'results'
  );
  const pdfInput = useRef<HTMLInputElement>(null);
  const reportInput = useRef<HTMLInputElement>(null);
  const [confirmation, setConfirmation] = useState<File>();
  const [report, setReport] = useState<File>();
  const [bidText, setBidText] = useState(initialBidText ?? '');
  const [pilot, setPilot] = useState(String(seniorityNumber ?? ''));
  const [pilotSelected, setPilotSelected] = useState(false);
  const review = useMutation<ReviewResponse, Error>({
    mutationFn: async () => {
      const form =
        mode === 'results' && report
          ? await prepareReasonsUpload(report)
          : new FormData();
      const transferSize =
        (form.get('reasonsReport') as File | null)?.size ?? 0;
      if (transferSize + (confirmation?.size ?? 0) > MAX_REASONS_TRANSFER_BYTES)
        throw new Error(
          'The combined upload is too large. Use a smaller confirmation PDF, or review the Reasons Report without a PDF.'
        );
      if (confirmation) form.append('bidConfirmation', confirmation);
      form.append('mode', mode);
      form.append('bidText', bidText);
      form.append('seniorityNumber', pilot);
      if (pilotSelected) form.append('pilotSelected', 'true');
      const res = await fetch('/api/bid/review', {
        method: 'POST',
        body: form,
      }).catch(() => {
        throw new Error(
          'Could not send these files. Check your connection and ensure cloud files have finished downloading, then choose them again.'
        );
      });
      const data = await res.json().catch(() => ({
        message: 'Could not read the review response. Please retry.',
      }));
      if (!res.ok) throw new Error(data.message ?? 'Review failed');
      return data;
    },
    onSuccess: data => {
      if (data.needsPilotSelection) {
        setPilot('');
        setPilotSelected(false);
      }
    },
  });
  const reset = () => review.reset();
  const result = review.data?.review;
  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-6">
      <div>
        <p className="text-sm font-medium text-primary">
          Check your strategy. Learn from the award.
        </p>
        <h2 className="mt-1 text-2xl font-semibold">Bid Review</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Review a bid before submitting it, or understand what happened after
          awards. Your documents are analyzed for this review without replacing
          uploaded package or history data.
        </p>
      </div>
      <Tabs
        value={mode}
        onValueChange={value => {
          setMode(value as typeof mode);
          reset();
        }}
      >
        <TabsList className="grid h-auto w-full grid-cols-2">
          <TabsTrigger
            disabled={review.isPending}
            className="min-h-11"
            value="results"
          >
            Review my results
          </TabsTrigger>
          <TabsTrigger
            disabled={review.isPending}
            className="min-h-11"
            value="before"
          >
            Before I submit
          </TabsTrigger>
        </TabsList>
        <TabsContent value="results">
          <p className="my-3 text-sm text-muted-foreground">
            The Reasons Report is the record of the bid PBS processed. A missing
            or older printed bid is OK; differences are flagged.
          </p>
        </TabsContent>
        <TabsContent value="before">
          <p className="my-3 text-sm text-muted-foreground">
            Use your latest saved bid. Changes made in PBS afterward remain
            unreviewed. For package-fit simulation, use{' '}
            <button className="underline text-primary" onClick={onBuildBid}>
              Build a bid
            </button>
            .
          </p>
        </TabsContent>
      </Tabs>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {mode === 'results'
              ? '1. Add the award evidence'
              : '1. Add your latest bid'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === 'results' && (
            <label className="block text-sm font-medium">
              Reasons Report HTML (required)
              <Input
                disabled={review.isPending}
                type="file"
                className="mt-2 h-auto py-3"
                accept=".htm,.html"
                ref={reportInput}
                onChange={e => {
                  setReport(e.target.files?.[0]);
                  setPilot(String(seniorityNumber ?? ''));
                  setPilotSelected(false);
                  reset();
                }}
              />
            </label>
          )}
          <label className="block text-sm font-medium">
            Bid confirmation PDF {mode === 'results' ? '(optional)' : ''}
            <Input
              disabled={review.isPending}
              type="file"
              className="mt-2 h-auto py-3"
              accept=".pdf"
              ref={pdfInput}
              onChange={e => {
                setConfirmation(e.target.files?.[0]);
                reset();
              }}
            />
          </label>
          {!confirmation && (
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">
                Or paste numbered bid text
              </summary>
              <label className="mt-2 block text-sm">
                Bid text
                <textarea
                  className="mt-1 min-h-36 w-full rounded-md border bg-background p-3 font-mono text-xs"
                  disabled={review.isPending}
                  value={bidText}
                  onChange={e => {
                    setBidText(e.target.value);
                    reset();
                  }}
                />
              </label>
            </details>
          )}
          {review.data?.needsPilotSelection && (
            <label className="block rounded-lg border bg-muted/20 p-3 text-sm font-medium">
              Choose your pilot for {review.data.period}
              <p className="mb-2 mt-1 font-normal text-muted-foreground">
                Seniority changes monthly. Confirm your name and number from
                this report.
              </p>
              <select
                aria-label="Pilot in Reasons Report"
                className="h-11 w-full rounded-md border bg-background px-2"
                value={pilot}
                onChange={e => {
                  setPilot(e.target.value);
                  setPilotSelected(true);
                }}
              >
                <option value="">Select your pilot</option>
                {review.data.pilots?.map(p => (
                  <option key={p.seniorityNumber} value={p.seniorityNumber}>
                    {p.name} · #{p.seniorityNumber}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(confirmation || (mode === 'results' && report)) && (
            <div className="space-y-2 rounded-lg bg-muted/20 p-3 text-xs text-muted-foreground">
              {mode === 'results' && report && (
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-all">
                    Report in use: {report.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={review.isPending}
                    onClick={() => {
                      setReport(undefined);
                      if (reportInput.current) reportInput.current.value = '';
                      reset();
                    }}
                  >
                    Remove report
                  </Button>
                </div>
              )}
              {confirmation && (
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-all">
                    Bid copy in use: {confirmation.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={review.isPending}
                    onClick={() => {
                      setConfirmation(undefined);
                      if (pdfInput.current) pdfInput.current.value = '';
                      reset();
                    }}
                  >
                    Remove bid copy
                  </Button>
                </div>
              )}
            </div>
          )}
          <Button
            disabled={
              review.isPending ||
              (mode === 'results'
                ? !report
                : !confirmation && !bidText.trim()) ||
              (review.data?.needsPilotSelection && !pilotSelected)
            }
            onClick={() => review.mutate()}
          >
            {review.isPending
              ? 'Reading and reviewing…'
              : mode === 'results'
                ? 'Review results'
                : 'Check this bid'}
          </Button>
          {review.isError && (
            <p role="alert" className="text-sm text-destructive">
              {review.error.message}
            </p>
          )}
        </CardContent>
      </Card>
      {result && (
        <div aria-live="polite" className="space-y-5">
          <div>
            <h3 className="text-xl font-semibold">
              {result.mode === 'results'
                ? 'Your bid explained'
                : 'Your pre-submission check'}
              {result.period ? ` · ${result.period}` : ''}
            </h3>
            {result.pilot && (
              <p className="mt-1 text-sm text-muted-foreground">
                {result.pilot.name} · seniority #{result.pilot.seniorityNumber}
              </p>
            )}
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {result.summary.map(item => (
              <div key={item.label} className="rounded-xl border bg-card p-4">
                <dt className="text-sm text-muted-foreground">{item.label}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
          <section className="space-y-3" aria-label="Review feedback">
            <h3 className="font-semibold">What worked and what to consider</h3>
            {!result.findings.length && (
              <p className="text-sm text-muted-foreground">
                No issues were found by the supported structure checks. This is
                not a complete validation of every PBS instruction.
              </p>
            )}
            {result.findings
              .filter(f => f.tone === 'warning')
              .map((finding, i) => (
                <Feedback key={i} finding={finding} />
              ))}
            {(['success', 'info'] as const).map(tone => {
              const items = result.findings.filter(f => f.tone === tone);
              return items.length ? (
                <details key={tone} className="rounded-xl border bg-card p-4">
                  <summary className="cursor-pointer text-sm font-semibold">
                    {tone === 'success'
                      ? 'What worked'
                      : 'Evidence & strategy details'}{' '}
                    ({items.length})
                  </summary>
                  <div className="mt-3 space-y-3">
                    {items.map((finding, i) => (
                      <Feedback key={i} finding={finding} />
                    ))}
                  </div>
                </details>
              ) : null;
            })}
          </section>
          <section className="rounded-xl border p-4">
            <h3 className="mb-2 font-semibold">Bid groups</h3>
            {result.groups.map(group => (
              <div
                key={group.number}
                className="flex flex-wrap justify-between gap-2 border-b py-3 last:border-0"
              >
                <span className="text-sm">
                  {group.number}. {group.label}
                </span>
                <span className="text-sm text-muted-foreground">
                  {group.status}
                </span>
              </div>
            ))}
          </section>
          {result.awards.length > 0 && (
            <section className="rounded-xl border p-4">
              <h3 className="font-semibold">Awarded trips</h3>
              {result.awards.map((award, i) => (
                <div
                  key={`${award.pairingNumber}-${i}`}
                  className="border-b py-3 text-sm last:border-0"
                >
                  <p className="font-medium">
                    #{award.pairingNumber} · {award.credit} credit ·{' '}
                    {award.source}
                  </p>
                  <p className="text-muted-foreground">
                    {award.start} → {award.end}
                  </p>
                </div>
              ))}
            </section>
          )}
          {result.comparisons.length > 0 && (
            <details className="rounded-xl border p-4">
              <summary className="cursor-pointer font-medium">
                Saved-copy differences ({result.comparisons.length})
              </summary>
              {result.comparisons.map(diff => (
                <div key={diff.number} className="mt-3 border-t pt-3 text-sm">
                  <p className="font-medium">Choice {diff.number}</p>
                  <p className="mt-1 text-muted-foreground">
                    Saved copy: {diff.snapshot ?? 'Not found'}
                  </p>
                  <p className="mt-1">
                    Processed bid: {diff.processed ?? 'Not found'}
                  </p>
                </div>
              ))}
            </details>
          )}
          <div className="rounded-xl bg-muted/30 p-4 text-xs text-muted-foreground">
            {result.limitations.map(text => (
              <p key={text} className="mb-2 last:mb-0">
                {text}
              </p>
            ))}
          </div>
          {review.data?.document && (
            <details className="rounded-xl border p-4">
              <summary className="cursor-pointer text-sm font-medium">
                Recognized bid text — verify the import
              </summary>
              {review.data.document.lines.map((line, i) => (
                <p key={i} className="mt-2 text-xs">
                  {line.number !== null ? `${line.number}. ` : ''}
                  {line.text}
                </p>
              ))}
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Feedback({ finding }: { finding: ReviewFinding }) {
  return (
    <article
      className={`rounded-xl border p-4 ${finding.tone === 'warning' ? 'border-amber-500/30 bg-amber-500/5' : finding.tone === 'success' ? 'border-emerald-500/25 bg-emerald-500/5' : 'bg-card'}`}
    >
      <p className="text-sm font-semibold">
        {finding.tone === 'warning'
          ? 'Check · '
          : finding.tone === 'success'
            ? 'Worked · '
            : 'Consider · '}
        {finding.title}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{finding.detail}</p>
    </article>
  );
}
