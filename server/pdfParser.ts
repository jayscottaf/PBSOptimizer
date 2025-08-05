import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import type { InsertPairing } from "@shared/schema";
import { samplePdfText } from "./samplePdfText";

interface FlightSegment {
  date: string;
  flightNumber: string;
  departure: string;
  departureTime: string;
  arrival: string;
  arrivalTime: string;
  blockTime: string;
  turnTime?: string;
  layover?: string;
  isDeadhead?: boolean;
}

interface Layover {
  city: string;
  hotel?: string;
  duration: string;
}

interface ParsedPairing {
  pairingNumber: string;
  effectiveDates: string;
  route: string;
  creditHours: string;
  blockHours: string;
  tafb: string;
  fdp?: string;
  payHours?: string;
  sitEdpPay?: string;
  carveouts?: string;
  deadheads: number;
  layovers: Layover[];
  flightSegments: FlightSegment[];
  fullTextBlock: string;
  holdProbability: number;
  pairingDays: number;
}

export class PDFParser {
  private calculateHoldProbability(pairing: ParsedPairing): number {
    // Basic probability calculation based on credit hours, block time, and TAFB
    const credit = parseFloat(pairing.creditHours);
    const block = parseFloat(pairing.blockHours);
    const tafbDays = this.extractTafbDays(pairing.tafb);

    let probability = 50; // Base probability

    // Higher credit hours = higher probability
    if (credit >= 6.0) probability += 20;
    else if (credit >= 5.5) probability += 10;
    else if (credit < 5.0) probability -= 10;

    // Lower block time per day = higher probability
    const blockPerDay = block / tafbDays;
    if (blockPerDay < 4.0) probability += 15;
    else if (blockPerDay > 5.0) probability -= 10;

    // TAFB preferences (3-4 days preferred)
    if (tafbDays >= 3 && tafbDays <= 4) probability += 10;
    else if (tafbDays > 5) probability -= 15;

    // Deadheads reduce probability
    probability -= (pairing.deadheads * 10);

    // Ensure probability is between 0 and 100
    return Math.max(0, Math.min(100, probability));
  }

  private extractTafbDays(tafb: string): number {
    const match = tafb.match(/(\d+)d/);
    return match ? parseInt(match[1]) : 1;
  }

  private parseRoute(flightSegments: FlightSegment[]): string {
    // Build the complete route path in chronological order
    const routePath: string[] = [];

    if (flightSegments.length === 0) {
      return "";
    }

    // Sort segments by date and time for proper chronological order
    const sortedSegments = [...flightSegments].sort((a, b) => {
      // First sort by date (A, B, C, D, E)
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;

      // Then sort by departure time within the same date
      return a.departureTime.localeCompare(b.departureTime);
    });

    // Start with the first departure airport
    if (sortedSegments.length > 0) {
      routePath.push(sortedSegments[0].departure);
    }

    // Add each arrival airport in chronological order
    for (const segment of sortedSegments) {
      routePath.push(segment.arrival);
    }

    // Remove consecutive duplicates while preserving the full journey
    const cleanedRoute: string[] = [];
    for (let i = 0; i < routePath.length; i++) {
      if (i === 0 || routePath[i] !== routePath[i - 1]) {
        cleanedRoute.push(routePath[i]);
      }
    }

    return cleanedRoute.join('-');
  }

  private extractPairingBlocks(text: string): string[] {
    const pairingBlocks: string[] = [];
    const lines = text.split('\n');
    let currentBlock = '';
    let inPairing = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check if this line starts a new pairing (format: #7986 SA)
      if (line.match(/^#\d{4,5}\s+[A-Z]{2}/)) {
        if (currentBlock && inPairing) {
          pairingBlocks.push(currentBlock.trim());
        }
        currentBlock = line + '\n';
        inPairing = true;
      } else if (inPairing) {
        currentBlock += line + '\n';

        // Check if we've reached the end of this pairing (next pairing starts)
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (nextLine.match(/^#\d{4,5}\s+[A-Z]{2}/)) {
            pairingBlocks.push(currentBlock.trim());
            currentBlock = '';
            inPairing = false;
          }
        }
      }
    }

    // Add the last pairing if exists
    if (currentBlock && inPairing) {
      pairingBlocks.push(currentBlock.trim());
    }

    return pairingBlocks;
  }

  private parsePairingBlock(block: string): ParsedPairing | null {
    const lines = block.split('\n');
    if (lines.length < 2) return null;

    // Parse the header line to get pairing number and effective dates
    const headerMatch = lines[0].match(/^#(\d{4,5})\s+([A-Z]{2})/);
    if (!headerMatch) return null;

    const pairingNumber = headerMatch[1];
    const dayCode = headerMatch[2];

    const flightSegments: FlightSegment[] = [];
    const layovers: Layover[] = [];
    let creditHours = "0.00";
    let blockHours = "0.00";
    let tafb = "0d 00:00";
    let fdp = "";
    let payHours = "";
    let sitEdpPay = "";
    let carveouts = "";
    let deadheads = 0;
    let effectiveDates = "";
    let currentDay = "A"; // Track current day for continuation flights

    // Extract effective dates from the block
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.includes('EFFECTIVE')) {
        const dateMatch = line.match(/EFFECTIVE\s+([A-Z]{3}\d{2}(?:-[A-Z]{3}\.\s*\d{2})?)/);
        if (dateMatch) {
          effectiveDates = dateMatch[1];
        }
      }

      // Enhanced flight pattern detection to capture all flights within each day
      // Day starter: "A DH 2895 EWR 1432 MSP 1629 2.57" or "B    2974    ATL 0735 IAD 0919 1.44"
      // Handle asterisks and extra formatting: "A    1188    LGA 0715  ORD 0851* 2.36"
      const dayFlightMatch = line.match(/^([A-E])\s*(?:DH\s+)?(\d{3,4})\s+([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})(?:\*)?\s+(\d{1,2}\.\d{2})/);

      if (dayFlightMatch) {
        // New day starts
        currentDay = dayFlightMatch[1];
        const isDeadhead = line.includes('DH');

        // Check for duplicates before adding
        const isDuplicate = flightSegments.some(seg => 
          seg.flightNumber === dayFlightMatch[2] && 
          seg.departure === dayFlightMatch[3] && 
          seg.departureTime === dayFlightMatch[4] &&
          seg.date === currentDay
        );

        if (!isDuplicate) {
          const segment: FlightSegment = {
            date: currentDay,
            flightNumber: dayFlightMatch[2],
            departure: dayFlightMatch[3],
            departureTime: dayFlightMatch[4],
            arrival: dayFlightMatch[5],
            arrivalTime: dayFlightMatch[6],
            blockTime: dayFlightMatch[7],
            isDeadhead
          };

          if (segment.isDeadhead) {
            deadheads++;
          }

          flightSegments.push(segment);
        }

        // Look ahead for continuation flights and multi-leg flights within the same day
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim();

          // Stop if we encounter another day letter or important keywords
          if (nextLine.match(/^[A-E]\s/) || nextLine.includes('TOTAL') || nextLine.includes('TAFB') || nextLine === '') {
            break;
          }

          // Match continuation flights: "    2974    IAD 1014 ATL 1200 1.46"
          const contFlightMatch = nextLine.match(/^\s*(?:DH\s+)?(\d{3,4})\s+([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})(?:\*?)?\s+(\d{1,2}\.\d{2})/);
          if (contFlightMatch) {
            const isContDeadhead = nextLine.includes('DH');
            const contSegment: FlightSegment = {
              date: currentDay,
              flightNumber: contFlightMatch[1],
              departure: contFlightMatch[2],
              departureTime: contFlightMatch[3],
              arrival: contFlightMatch[4],
              arrivalTime: contFlightMatch[5],
              blockTime: contFlightMatch[6],
              isDeadhead: isContDeadhead
            };

            if (isContDeadhead) {
              deadheads++;
            }

            flightSegments.push(contSegment);
            i = j; // Skip this line in main loop since we processed it
            continue;
          }

          // Match multi-leg format (same flight, different segment): "        IAD 1014 ATL 1200 1.46"
          // Also handle formats with additional data: "                 ORD 1859  LGA 2230  2.31           M 10.30/13.00 10.30/12.30 2"
          const multiLegMatch = nextLine.match(/^\s+([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})\s+(\d{1,2}\.\d{2})/);
          if (multiLegMatch && flightSegments.length > 0) {
            // This is another leg of the previous flight
            const lastFlight = flightSegments[flightSegments.length - 1];
            const multiLegSegment: FlightSegment = {
              date: currentDay,
              flightNumber: lastFlight.flightNumber, // Same flight number
              departure: multiLegMatch[1],
              departureTime: multiLegMatch[2],
              arrival: multiLegMatch[3],
              arrivalTime: multiLegMatch[4],
              blockTime: multiLegMatch[5],
              isDeadhead: false
            };

            flightSegments.push(multiLegSegment);
            i = j; // Skip this line in main loop
            continue;
          }

          // Handle lines that start with spaces and contain flight data but no flight number
          // These are continuation segments of the previous flight
          const continuationMatch = nextLine.match(/^\s+([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})\s+(\d{1,2}\.\d{2})/);
          if (continuationMatch && flightSegments.length > 0) {
            const lastFlight = flightSegments[flightSegments.length - 1];
            const continuationSegment: FlightSegment = {
              date: currentDay,
              flightNumber: lastFlight.flightNumber, // Same flight number as previous
              departure: continuationMatch[1],
              departureTime: continuationMatch[2],
              arrival: continuationMatch[3],
              arrivalTime: continuationMatch[4],
              blockTime: continuationMatch[5],
              isDeadhead: false
            };

            flightSegments.push(continuationSegment);
            i = j; // Skip this line in main loop
            continue;
          }

          // Also check for standalone deadhead flights that might be on their own line
          const deadheadMatch = nextLine.match(/^\s*DH\s+(\d{3,4})\s+([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})\s+(\d{1,2}\.\d{2})/);
          if (deadheadMatch) {
            const dhSegment: FlightSegment = {
              date: currentDay,
              flightNumber: deadheadMatch[1],
              departure: deadheadMatch[2],
              departureTime: deadheadMatch[3],
              arrival: deadheadMatch[4],
              arrivalTime: deadheadMatch[5],
              blockTime: deadheadMatch[6],
              isDeadhead: true
            };

            deadheads++;
            flightSegments.push(dhSegment);
            i = j; // Skip this line
            continue;
          }

          // If we can't match any flight pattern, stop looking ahead
          break;
        }
      }

      // Additional flight parsing patterns for missed segments
      // Pattern 1: Standalone flight numbers that were missed: "1482    ATL 1246  IAD 1431* 1.45" or "2608    SLC 2130  IDA 2227   .57"
      const standaloneFlight = line.match(/^\s*(\d{3,4})\s+([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})(?:\*)?\s+(\d{0,2}\.?\d{1,2})/);
      if (standaloneFlight && currentDay) {
        // Handle block time format (add leading zero if starts with decimal)
        let blockTime = standaloneFlight[6];
        if (blockTime.startsWith('.')) {
          blockTime = '0' + blockTime;
        }
        // Check for duplicates before adding
        const isDuplicate = flightSegments.some(seg => 
          seg.flightNumber === standaloneFlight[1] && 
          seg.departure === standaloneFlight[2] && 
          seg.departureTime === standaloneFlight[3] &&
          seg.date === currentDay
        );

        if (!isDuplicate) {
          const segment: FlightSegment = {
            date: currentDay,
            flightNumber: standaloneFlight[1],
            departure: standaloneFlight[2],
            departureTime: standaloneFlight[3],
            arrival: standaloneFlight[4],
            arrivalTime: standaloneFlight[5],
            blockTime: blockTime,
            isDeadhead: false
          };

          flightSegments.push(segment);
        }
      }

      // Pattern 2: Day letters that start new days: "D      2275    PDX 0715  SEA 0813   .58"
      // Handle both ".58" and "0.58" formats
      const dayStartMatch = line.match(/^([A-E])\s+(\d{3,4})\s+([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})(?:\*)?\s+(\d{0,2}\.?\d{2})/);
      if (dayStartMatch) {
        currentDay = dayStartMatch[1];
        let blockTime = dayStartMatch[7];
        // Handle ".58" format by adding leading zero
        if (blockTime.startsWith('.')) {
          blockTime = '0' + blockTime;
        }

        // Check for duplicates before adding
        const isDuplicate = flightSegments.some(seg => 
          seg.flightNumber === dayStartMatch[2] && 
          seg.departure === dayStartMatch[3] && 
          seg.departureTime === dayStartMatch[4] &&
          seg.date === currentDay
        );

        if (!isDuplicate) {
          const segment: FlightSegment = {
            date: currentDay,
            flightNumber: dayStartMatch[2],
            departure: dayStartMatch[3],
            departureTime: dayStartMatch[4],
            arrival: dayStartMatch[5],
            arrivalTime: dayStartMatch[6],
            blockTime: blockTime,
            isDeadhead: false
          };

          flightSegments.push(segment);
        }
      }

      // Pattern 3: Single day flight at start of line: "E       454    DFW 0710  JFK 1200  3.50"
      const singleDayFlight = line.match(/^([A-E])\s+(\d{3,4})\s+([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})\s+(\d{1,2}\.\d{2})/);
      if (singleDayFlight && !dayStartMatch) { // Avoid duplicate processing
        currentDay = singleDayFlight[1];

        // Check for duplicates before adding
        const isDuplicate = flightSegments.some(seg => 
          seg.flightNumber === singleDayFlight[2] && 
          seg.departure === singleDayFlight[3] && 
          seg.departureTime === singleDayFlight[4] &&
          seg.date === currentDay
        );

        if (!isDuplicate) {
          const segment: FlightSegment = {
            date: currentDay,
            flightNumber: singleDayFlight[2],
            departure: singleDayFlight[3],
            departureTime: singleDayFlight[4],
            arrival: singleDayFlight[5],
            arrivalTime: singleDayFlight[6],
            blockTime: singleDayFlight[7],
            isDeadhead: false
          };

          flightSegments.push(segment);
        }
      }

      // Pattern 4: Handle standalone continuation flights without day letters: "ORD 1859  LGA 2230  2.31"
      const continuationFlightMatch = line.match(/^\s*([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})(?:\*)?\s+(\d{1,2}\.\d{2})/);
      if (continuationFlightMatch && flightSegments.length > 0 && !standaloneFlight && !dayStartMatch && !singleDayFlight) {
        const lastFlight = flightSegments[flightSegments.length - 1];
        const contSegment: FlightSegment = {
          date: currentDay,
          flightNumber: lastFlight.flightNumber, // Use previous flight number
          departure: continuationFlightMatch[1],
          departureTime: continuationFlightMatch[2],
          arrival: continuationFlightMatch[3],
          arrivalTime: continuationFlightMatch[4],
          blockTime: continuationFlightMatch[5],
          isDeadhead: false
        };

        flightSegments.push(contSegment);
      }

      // Layover pattern: ORD 18.43/PALMER HOUSE
      const layoverMatch = line.match(/([A-Z]{3})\s+(\d{1,2}\.\d{2})\/([A-Z\s]+)/);
      if (layoverMatch) {
        layovers.push({
          city: layoverMatch[1],
          duration: layoverMatch[2],
          hotel: layoverMatch[3].trim()
        });
      }

      // Look for the actual total credit and block hours line - updated format
      const totalCreditMatch = line.match(/TOTAL CREDIT\s+(\d{1,2}\.\d{2})TL\s+(\d{1,2}\.\d{2})BL/);
      if (totalCreditMatch) {
        creditHours = totalCreditMatch[1];
        blockHours = totalCreditMatch[2];
      }

      // Look for TAFB - it's just the hours value, not converted to days
      const tafbMatch = line.match(/TAFB\s+(\d{1,3}\.\d{2})/);
      if (tafbMatch) {
        tafb = tafbMatch[1]; // Keep as raw hours (e.g., "100.53")
      }

      // Look for TOTAL PAY line with time format (e.g., "12:43TL")
      const totalPayMatch = line.match(/TOTAL PAY\s+(\d{1,2}:\d{2})TL/);
      if (totalPayMatch) {
        payHours = totalPayMatch[1];
      }

    }

    // Generate route from flight segments
    const route = this.parseRoute(flightSegments);

    // If no effective dates found, use a default
    if (!effectiveDates) {
      effectiveDates = "AUG01-AUG31";
    }

    // Calculate pairing days from unique day letters in flight segments
    const uniqueDays = [...new Set(flightSegments.map(seg => seg.date))].sort();
    let pairingDays = uniqueDays.length;

    // Enhanced validation: check for day patterns in the full text block
    // Some pairings might have days mentioned that don't have flight segments
    const dayPatternMatches = block.match(/^([A-E])\s/gm);
    if (dayPatternMatches) {
      const textDays = [...new Set(dayPatternMatches.map(match => match.trim().charAt(0)))];
      const textDayCount = textDays.length;
      
      // Use the higher count between flight segments and text patterns
      if (textDayCount > pairingDays) {
        pairingDays = textDayCount;
      }
    }

    // Additional validation for complex routes
    if (pairingDays <= 2 && flightSegments.length >= 6) {
      const routeSegments = route.split('-').length;
      if (routeSegments >= 7) {
        pairingDays = Math.max(pairingDays, 4);
      }
    }

    const pairing: ParsedPairing = {
      pairingNumber,
      effectiveDates,
      route,
      creditHours: creditHours || "0.00",
      blockHours: blockHours || "0.00",
      tafb: tafb || "0.00",
      fdp: fdp || undefined,
      payHours: payHours || undefined,
      sitEdpPay: sitEdpPay || undefined,
      carveouts: carveouts || undefined,
      deadheads,
      layovers,
      flightSegments,
      fullTextBlock: block,
      holdProbability: 0, // Will be calculated
      pairingDays
    };

    // Calculate hold probability
    pairing.holdProbability = this.calculateHoldProbability(pairing);

    return pairing;
  }

  private async extractTextFromTXT(filePath: string): Promise<string> {
    try {
      console.log(`Reading text from: ${filePath}`);

      // Verify file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`TXT file not found: ${filePath}`);
      }

      const text = fs.readFileSync(filePath, 'utf8');
      console.log(`TXT file read successfully: ${text.length} characters`);
      return text;
    } catch (error) {
      console.error('Error reading TXT file:', error);
      throw new Error(`Failed to read TXT file: ${error.message}`);
    }
  }

  private async extractTextFromPDF(filePath: string): Promise<string> {
    try {
      console.log(`Attempting to extract text from: ${filePath}`);

      // Verify file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`PDF file not found: ${filePath}`);
      }

      // Use standalone Node.js worker to avoid tsx/ES module conflicts
      const result = execSync(`node server/pdfParserWorker.cjs "${filePath}"`, { 
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large PDFs
      });

      const lines = result.trim().split('\n');
      const successIndex = lines.findIndex(line => line === 'SUCCESS');

      if (successIndex === -1) {
        throw new Error('PDF parsing worker did not report success');
      }

      const jsonResult = lines.slice(successIndex + 1).join('\n');
      const parsed = JSON.parse(jsonResult);

      console.log(`PDF parsed successfully: ${parsed.text.length} characters extracted`);
      return parsed.text;
    } catch (error) {
      console.error('Error extracting text from PDF:', error);
      throw new Error(`Failed to extract text from PDF: ${error.message}`);
    }
  }

  async parseFile(filePath: string, bidPackageId: number, mimeType: string): Promise<void> {
    try {
      console.log(`Starting file parsing for bid package ${bidPackageId}`);

      let text: string;
      if (mimeType === 'text/plain') {
        text = await this.extractTextFromTXT(filePath);
        console.log(`TXT file parsed successfully, ${text.length} characters`);
      } else {
        text = await this.extractTextFromPDF(filePath);
        console.log(`PDF parsed successfully, ${text.length} characters`);
      }

      // Extract pairing blocks from the text
      const pairingBlocks = this.extractPairingBlocks(text);
      console.log(`Found ${pairingBlocks.length} pairing blocks`);

      const parsedPairings: ParsedPairing[] = [];

      // Parse each pairing block
      for (const block of pairingBlocks) {
        const pairing = this.parsePairingBlock(block);
        if (pairing) {
          parsedPairings.push(pairing);
        }
      }

      console.log(`Successfully parsed ${parsedPairings.length} pairings`);

      // Save pairings to database in batches for better performance
      const batchSize = 50;
      for (let i = 0; i < parsedPairings.length; i += batchSize) {
        const batch = parsedPairings.slice(i, i + batchSize);

        for (const pairing of batch) {
          const pairingData: InsertPairing = {
            bidPackageId,
            pairingNumber: pairing.pairingNumber,
            effectiveDates: pairing.effectiveDates,
            route: pairing.route || "TBD",
            creditHours: pairing.creditHours,
            blockHours: pairing.blockHours,
            tafb: pairing.tafb,
            fdp: pairing.fdp || undefined,
            payHours: pairing.payHours || undefined,
            sitEdpPay: pairing.sitEdpPay || undefined,
            carveouts: pairing.carveouts || undefined,
            deadheads: pairing.deadheads,
            layovers: pairing.layovers,
            flightSegments: pairing.flightSegments,
            fullTextBlock: pairing.fullTextBlock,
            holdProbability: pairing.holdProbability,
            pairingDays: pairing.pairingDays
          };

          await storage.createPairing(pairingData);
        }

        console.log(`Saved batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(parsedPairings.length/batchSize)} (${batch.length} pairings)`);
      }

      // Update bid package status to completed
      await storage.updateBidPackageStatus(bidPackageId, "completed");

      console.log(`File parsing completed for bid package ${bidPackageId}`);

    } catch (error) {
      console.error('Error parsing file:', error);
      await storage.updateBidPackageStatus(bidPackageId, "failed");
      throw error;
    }
  }

  async parsePDF(filePath: string, bidPackageId: number): Promise<void> {
    return this.parseFile(filePath, bidPackageId, 'application/pdf');
  }
}

export const pdfParser = new PDFParser();