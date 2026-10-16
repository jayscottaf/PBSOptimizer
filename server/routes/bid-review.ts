import type { Express } from 'express';
import multer from 'multer';
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
        if (!report)
          return res.status(400).json({
            message:
              'Upload the Reasons Report for the period you want to review.',
          });
        const html = await decodeReasonsUpload(
          report.buffer,
          report.originalname
        );
        const metadata = ReasonsReportParser.extractMetadata(html);
        if (!metadata)
          return res.status(400).json({
            message:
              'Could not identify the Reasons Report category and period.',
          });
        const pane = ReasonsReportParser.parseReasonsPane(html);
        const pilots = [
          ...new Map(
            pane.preferences
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
              pane.preferences.find(
                p => p.pilotEmployeeNumber?.replace(/^0+/, '') === employee
              )?.pilotSeniorityNumber ?? undefined;
        }
        if (!seniority)
          return res.json({
            pilots,
            period: `${metadata.month} ${metadata.year}`,
            needsPilotSelection: true,
          });
        const preferences = pane.preferences.filter(
          p => p.pilotSeniorityNumber === seniority
        );
        const awards = (
          await ReasonsReportParser.parseReasonsReportFromContent(html)
        ).filter(p => p.seniorityNumber === seniority);
        return res.json({
          review: reviewResults({ metadata, preferences, awards, document }),
          document,
        });
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
