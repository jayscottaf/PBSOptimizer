import type { Express } from 'express';
import multer from 'multer';
import { restoreBidReview } from '../lib/stored-bid-review';
import type {
  ParsedPreferenceReason,
  PairingAward,
  ReasonsReportMetadata,
} from '../reasonsReportParser';
import { ReasonsReportParser } from '../reasonsReportParser';
import { decodeReasonsUpload } from '../lib/decode-reasons-upload';
import {
  parseBidDocument,
  reviewBefore,
  reviewResults,
} from '../lib/bid-review';
import { readBidPdf } from '../lib/bid-document-pdf';
import { storage } from '../storage';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 2,
    fields: 5,
    fieldSize: 200000,
  },
  fileFilter: (_req, file, cb) => {
    const valid =
      file.fieldname === 'bidConfirmation'
        ? /\.pdf$/i.test(file.originalname)
        : file.fieldname === 'reasonsReport' &&
          /\.html?(\.gz)?$/i.test(file.originalname);
    if (valid) cb(null, true);
    else
      cb(new Error('Use a PDF bid confirmation and an HTML Reasons Report.'));
  },
}).fields([
  { name: 'bidConfirmation', maxCount: 1 },
  { name: 'reasonsReport', maxCount: 1 },
]);

export function registerBidReviewRoutes(app: Express) {
  app.get('/api/bid/review/reports', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json(await storage.getBidReviewReports());
    } catch {
      res.status(500).json({
        message:
          'Could not load saved Reasons Reports. Retry or upload a report below.',
      });
    }
  });
  app.post('/api/bid/review', (req, res) => {
    upload(req, res, async error => {
      res.set('Cache-Control', 'no-store');
      if (error)
        return res.status(400).json({
          message:
            error instanceof Error ? error.message : 'Could not read upload.',
        });
      try {
        const files = req.files as
          | Record<string, Express.Multer.File[]>
          | undefined;
        const pdf = files?.bidConfirmation?.[0];
        const report = files?.reasonsReport?.[0];
        const mode = req.body.mode;
        if (mode !== 'before' && mode !== 'results')
          return res
            .status(400)
            .json({ message: 'Choose before-submission or results review.' });
        const document = pdf
          ? await readBidPdf(pdf.buffer)
          : req.body.bidText?.trim()
            ? parseBidDocument(req.body.bidText)
            : undefined;
        if (mode === 'before') {
          if (!document)
            return res.status(400).json({
              message: 'Upload a bid confirmation PDF or paste the bid text.',
            });
          return res.json({ review: reviewBefore(document), document });
        }
        let metadata: ReasonsReportMetadata;
        let allPreferences: ParsedPreferenceReason[];
        let allAwards: PairingAward[];
        let html: string | undefined;
        let legacyRecords: ReturnType<typeof restoreBidReview> | undefined;
        if (req.body.savedReport) {
          if (report)
            return res.status(400).json({
              message:
                'Choose a saved report or upload a new report, not both.',
            });
          const saved = (await storage.getBidReviewReports()).find(
            r => r.id === req.body.savedReport
          );
          if (!saved)
            return res.status(404).json({
              message:
                'This saved report is no longer available. Refresh the list or upload it again.',
            });
          const records = await storage.getStoredBidReviewReport(saved);
          if (!records.preferences.length)
            return res.status(400).json({
              message:
                'This older import contains awards only. Upload the original Reasons Report once to review its bid choices.',
            });
          metadata = {
            base: saved.base,
            aircraft: saved.aircraft,
            month: saved.month.toUpperCase().slice(0, 3),
            year: saved.year,
          };
          legacyRecords = restoreBidReview(records.preferences, records.awards);
          allPreferences = legacyRecords.preferences;
          allAwards = legacyRecords.awards;
        } else {
          if (!report)
            return res.status(400).json({
              message:
                'Select a saved Reasons Report or upload one for the period you want to review.',
            });
          html = await decodeReasonsUpload(report.buffer, report.originalname);
          const parsedMetadata = ReasonsReportParser.extractMetadata(html);
          if (!parsedMetadata)
            return res.status(400).json({
              message:
                'Could not identify the Reasons Report category and period.',
            });
          metadata = parsedMetadata;
          allPreferences =
            ReasonsReportParser.parseReasonsPane(html).preferences;
          allAwards = []; // Parse the award table after resolving the pilot.
        }
        const pilots = [
          ...new Map(
            allPreferences
              .filter(p => p.pilotSeniorityNumber)
              .map(p => [
                p.pilotSeniorityNumber!,
                {
                  seniorityNumber: p.pilotSeniorityNumber!,
                  name: p.pilotName ?? 'Pilot',
                },
              ])
          ).values(),
        ].sort((a, b) => a.seniorityNumber - b.seniorityNumber);
        if (!pilots.length)
          return res.status(400).json({
            message:
              'This report has no identifiable pilot sections. Use the composite Reasons Report.',
          });
        const requested = Number(req.body.seniorityNumber);
        let seniority =
          req.body.pilotSelected === 'true' &&
          pilots.some(p => p.seniorityNumber === requested)
            ? requested
            : undefined;
        // A pilot's seniority changes monthly. Use their explicitly linked
        // profile employee number if available; never guess by first name.
        if (!seniority && !req.body.pilotSelected) {
          const primary = await storage.getPrimaryUser();
          const profile = primary
            ? await storage.getBidProfile(primary.id)
            : undefined;
          const employee = profile?.employeeNumber?.replace(/^0+/, '');
          if (employee)
            seniority =
              allPreferences.find(
                p => p.pilotEmployeeNumber?.replace(/^0+/, '') === employee
              )?.pilotSeniorityNumber ?? undefined;
        }
        if (!seniority)
          return res.json({
            pilots,
            period: `${metadata.month} ${metadata.year}`,
            needsPilotSelection: true,
          });
        const preferences = allPreferences.filter(
          p => p.pilotSeniorityNumber === seniority
        );
        if (html)
          allAwards =
            await ReasonsReportParser.parseReasonsReportFromContent(html);
        const awards = allAwards.filter(p => p.seniorityNumber === seniority);
        const review = reviewResults({
          metadata,
          preferences,
          awards,
          document,
        });
        if (legacyRecords && preferences.some(p => !p.bidGroupInfo)) {
          review.groups = [];
          const groupSummary = review.summary.find(
            s => s.label === 'Awarded group'
          );
          if (groupSummary) groupSummary.value = 'Not retained';
          review.limitations.unshift(
            'This import did not retain all bid-group assignments. Group numbers and which later groups were reached are not inferred.'
          );
        }
        if (legacyRecords?.legacyPilots.has(seniority))
          review.limitations.unshift(
            'This review uses saved imported choices and awards. Older imports did not retain per-pilot report flags or group-limit messages. Upload the original report for those details; their absence is not evidence they did not occur.'
          );
        return res.json({ review, document });
      } catch (error) {
        console.warn(
          'Bid review failed:',
          error instanceof Error ? error.message : 'Unknown error'
        );
        return res.status(400).json({
          message:
            error instanceof Error
              ? error.message
              : 'Could not review these files. Please check them and retry.',
        });
      }
    });
  });
}
