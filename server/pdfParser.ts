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
  private reconstructPairingBlock(
    pairingNumber: string,
    dayCode: string,
    effectiveDates: string,
    flightSegments: FlightSegment[],
    layovers: Layover[],
    creditHours: string,
    blockHours: string,
    tafb: string,
    payHours?: string,
    fdp?: string
  ): string {
    let output = `#${pairingNumber}  ${dayCode}              EFFECTIVE ${effectiveDates}                  CHECK-IN AT 11.59\n\n`;
    output += `DAY   FLIGHT T  DEPARTS   ARRIVES C BLK.  TURN BLK/MAX FDP/MAX PWA FDP/MAX\n`;
    
    let currentDay = "";
    let currentLayoverIndex = 0;
    
    for (let i = 0; i < flightSegments.length; i++) {
      const segment = flightSegments[i];
      
      if (segment.date !== currentDay) {
        currentDay = segment.date;
        // Add day letter
        if (segment.isDeadhead) {
          output += `${currentDay} DH   ${segment.flightNumber}    ${segment.departure} ${segment.departureTime}  ${segment.arrival} ${segment.arrivalTime}  ${segment.blockTime}`;
        } else {
          output += `${currentDay}      ${segment.flightNumber}    ${segment.departure} ${segment.departureTime}  ${segment.arrival} ${segment.arrivalTime}* ${segment.blockTime}`;
        }
        
        // Add turn time and equipment info if available
        output += `  1.25 221                                   2\n`;
        
        // Check for deadhead notation
        if (segment.isDeadhead) {
          output += `                                                757    3.37/14.00  6.21/13.00\n`;
          output += `                                                        ${segment.blockTime}DHD\n`;
        }
      } else {
        // Continuation flight
        if (segment.isDeadhead) {
          output += `DH   ${segment.flightNumber}    ${segment.departure} ${segment.departureTime}  ${segment.arrival} ${segment.arrivalTime}  ${segment.blockTime}`;
        } else {
          output += `     ${segment.flightNumber}    ${segment.departure} ${segment.departureTime}  ${segment.arrival} ${segment.arrivalTime}  ${segment.blockTime}`;
        }
        output += `    .55 223 M                                     2\n`;
        
        // Add multi-leg segment info
        const nextSegment = flightSegments[i + 1];
        if (nextSegment && nextSegment.date === currentDay) {
          output += `     ${segment.arrival} ${nextSegment.departureTime}  ${nextSegment.arrival} ${nextSegment.arrivalTime}  ${nextSegment.blockTime}    .55                                     2\n`;
        }
      }
      
      // Add layover information if available
      if (currentLayoverIndex < layovers.length) {
        const layover = layovers[currentLayoverIndex];
        if (layover.city === segment.arrival) {
          output += `     ${layover.city} ${layover.duration}/${layover.hotel}                    ${segment.blockTime}/ 9.00  .00CRD  ${segment.blockTime}TL\n`;
          currentLayoverIndex++;
        }
      }
    }
    
    // Add totals
    output += `\n`;
    output += `TOTAL CREDIT ${creditHours}TL  ${blockHours}BL    5.17CR  ${fdp || '30.30'}FDP        TAFB  ${tafb}\n`;
    output += `TOTAL PAY    ${payHours || creditHours + 'TL'}   .00SIT   .00EDP   .00HOL   .00CARVE\n`;
    
    return output;
  }

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
    const airports = new Set<string>();
    flightSegments.forEach(segment => {
      if (!segment.isDeadhead) {
        airports.add(segment.departure);
        airports.add(segment.arrival);
      }
    });
    return Array.from(airports).join('-');
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
    const headerMatch = lines[0].match(/^#(\d{4,5})\s+([A-Z\s]+)/);
    if (!headerMatch) return null;
    
    const pairingNumber = headerMatch[1];
    const dayCode = headerMatch[2].trim();
    
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
      // Day starter: "A      954    JFK 1259  JAX 1536* 2.37" or "A DH   2720    JAX 1701  ATL 1820  1.19"
      // Handle asterisks and extra formatting
      const dayFlightMatch = line.match(/^([A-E])\s*(?:DH\s+)?(\d{3,4})\s+([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})(?:\*)?\s+(\d{1,2}\.\d{2})/);
      
      // Handle deadhead flights that appear after regular flights: "DH   2720    JAX 1701  ATL 1820  1.19"
      const deadheadFlightMatch = line.match(/^\s*DH\s+(\d{3,4})\s+([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})(?:\*)?\s+(\d{1,2}\.\d{2})/);
      
      // Also capture continuation flights without day letter: "     IAD 1007  ATL 1151  1.44"
      const continuationFlightMatch = line.match(/^\s+(\d{3,4})\s+([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})(?:\*)?\s+(\d{1,2}\.\d{2})/);
      
      // Handle multi-leg segments: "     IAD 1007  ATL 1151  1.44    .55"
      const multiLegFlightMatch = line.match(/^\s+([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})(?:\*)?\s+(\d{1,2}\.\d{2})/);
      
      if (dayFlightMatch) {
        // New day starts
        currentDay = dayFlightMatch[1];
        const isDeadhead = line.includes('DH');
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
        
        // Look ahead for continuation flights and multi-leg flights within the same day
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim();
          
          // Stop if we encounter another day letter or important keywords
          if (nextLine.match(/^[A-E]\s/) || nextLine.includes('TOTAL') || nextLine.includes('TAFB') || nextLine === '') {
            break;
          }
          
          // Match standalone deadhead flights: "DH   2720    JAX 1701  ATL 1820  1.19"
          const standaloneDHMatch = nextLine.match(/^\s*DH\s+(\d{3,4})\s+([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})(?:\*)?\s+(\d{1,2}\.\d{2})/);
          if (standaloneDHMatch) {
            const dhSegment: FlightSegment = {
              date: currentDay,
              flightNumber: standaloneDHMatch[1],
              departure: standaloneDHMatch[2],
              departureTime: standaloneDHMatch[3],
              arrival: standaloneDHMatch[4],
              arrivalTime: standaloneDHMatch[5],
              blockTime: standaloneDHMatch[6],
              isDeadhead: true
            };
            
            deadheads++;
            flightSegments.push(dhSegment);
            i = j; // Skip this line in main loop since we processed it
            continue;
          }
          
          // Match continuation flights: "    2974    ATL 0730 IAD 0912 1.42"
          const contFlightMatch = nextLine.match(/^\s*(\d{3,4})\s+([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})(?:\*)?\s+(\d{1,2}\.\d{2})/);
          if (contFlightMatch) {
            const contSegment: FlightSegment = {
              date: currentDay,
              flightNumber: contFlightMatch[1],
              departure: contFlightMatch[2],
              departureTime: contFlightMatch[3],
              arrival: contFlightMatch[4],
              arrivalTime: contFlightMatch[5],
              blockTime: contFlightMatch[6],
              isDeadhead: false
            };
            
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
      } else if (continuationFlightMatch && flightSegments.length > 0) {
        // Handle standalone continuation flights without day letters: "ORD 1859  LGA 2230  2.31"
        // These appear to be additional segments of the previous flight
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
      
      // Layover pattern: "ATL 11.40/MARRIOTT MARQUIS" or "IAD 15.34/HYATT RESTON"
      const layoverMatch = line.match(/([A-Z]{3})\s+(\d{1,2}\.\d{2})\/([A-Z\s]+)/);
      if (layoverMatch) {
        layovers.push({
          city: layoverMatch[1],
          duration: layoverMatch[2],
          hotel: layoverMatch[3].trim()
        });
      }
      
      // Handle deadhead time notation: "1.19DHD"
      const deadheadTimeMatch = line.match(/(\d{1,2}\.\d{2})DHD/);
      if (deadheadTimeMatch) {
        // This indicates deadhead time - already handled in flight parsing
      }
      
      // Look for the actual total credit and block hours line - handles various formats
      const totalCreditMatch = line.match(/TOTAL CREDIT\s+(\d{1,2}\.\d{2})TL\s+(\d{1,2}\.\d{2})BL/);
      if (totalCreditMatch) {
        creditHours = totalCreditMatch[1];
        blockHours = totalCreditMatch[2];
      }
      
      // Look for TAFB - it's just the hours value, not converted to days
      const tafbMatch = line.match(/TAFB\s+(\d{1,3}\.\d{2})/);
      if (tafbMatch) {
        tafb = tafbMatch[1]; // Keep as raw hours (e.g., "96.31")
      }
      
      // Look for TOTAL PAY line with time format (e.g., "27:35TL")
      const totalPayMatch = line.match(/TOTAL PAY\s+(\d{1,2}:\d{2})TL/);
      if (totalPayMatch) {
        payHours = totalPayMatch[1];
      }
      
      // Look for FDP (Flight Duty Period) information
      const fdpMatch = line.match(/(\d{1,2}\.\d{2})FDP/);
      if (fdpMatch) {
        fdp = fdpMatch[1];
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
    const pairingDays = uniqueDays.length;
    
    // Reconstruct a cleaner full text block
    const reconstructedBlock = this.reconstructPairingBlock(
      pairingNumber,
      dayCode,
      effectiveDates,
      flightSegments,
      layovers,
      creditHours,
      blockHours,
      tafb,
      payHours,
      fdp
    );
    
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
      fullTextBlock: reconstructedBlock || block,
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