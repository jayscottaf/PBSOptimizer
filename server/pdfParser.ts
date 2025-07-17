import { spawn } from "child_process";
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
    
    // Extract effective dates from the block
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.includes('EFFECTIVE')) {
        const dateMatch = line.match(/EFFECTIVE\s+([A-Z]{3}\d{2}(?:-[A-Z]{3}\.\s*\d{2})?)/);
        if (dateMatch) {
          effectiveDates = dateMatch[1];
        }
      }
      
      // Flight segment pattern: Match both formats:
      // 1. A DH 2810 LGA 1130 ORD 1310 2.40 1.15 223
      // 2.      563 LGA 1925 MCI 2145 3.20
      const flightMatch = line.match(/^([A-Z]?\s*)((?:DH\s+)?(\d{3,4}))\s+([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})\s+(\d{1,2}\.\d{2})/);
      if (flightMatch) {
        const segment: FlightSegment = {
          date: flightMatch[1].trim() || 'A', // Day code (A, B, C, etc.) or default to A
          flightNumber: flightMatch[3],
          departure: flightMatch[4],
          departureTime: flightMatch[5],
          arrival: flightMatch[6],
          arrivalTime: flightMatch[7],
          blockTime: flightMatch[8],
          isDeadhead: line.includes('DH ')
        };
        
        if (segment.isDeadhead) {
          deadheads++;
        }
        
        flightSegments.push(segment);
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
      
      // Look for TAFB in the total line
      const tafbMatch = line.match(/TAFB\s+(\d+)D\s+(\d{1,2}\.\d{2})/);
      if (tafbMatch) {
        tafb = `${tafbMatch[1]}d ${tafbMatch[2]}`;
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
    
    const pairing: ParsedPairing = {
      pairingNumber,
      effectiveDates,
      route,
      creditHours: creditHours || "0.00",
      blockHours: blockHours || "0.00",
      tafb: tafb || "1d 00:00",
      fdp: fdp || undefined,
      payHours: payHours || undefined,
      sitEdpPay: sitEdpPay || undefined,
      carveouts: carveouts || undefined,
      deadheads,
      layovers,
      flightSegments,
      fullTextBlock: block,
      holdProbability: 0 // Will be calculated
    };
    
    // Calculate hold probability
    pairing.holdProbability = this.calculateHoldProbability(pairing);
    
    return pairing;
  }

  private async extractTextFromPDF(filePath: string): Promise<string> {
    const fs = require('fs');
    const pdfParse = require('pdf-parse');
    
    try {
      const pdfBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(pdfBuffer);
      return data.text;
    } catch (error) {
      console.error('Error extracting text from PDF:', error);
      throw new Error(`Failed to extract text from PDF: ${error}`);
    }
  }

  async parsePDF(filePath: string, bidPackageId: number): Promise<void> {
    try {
      console.log(`Starting PDF parsing for bid package ${bidPackageId}`);
      
      const text = await this.extractTextFromPDF(filePath);
      console.log(`PDF parsed successfully, ${text.length} characters`);
      
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
            holdProbability: pairing.holdProbability
          };
          
          await storage.createPairing(pairingData);
        }
        
        console.log(`Saved batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(parsedPairings.length/batchSize)} (${batch.length} pairings)`);
      }
      
      // Update bid package status to completed
      await storage.updateBidPackageStatus(bidPackageId, "completed");
      
      console.log(`PDF parsing completed for bid package ${bidPackageId}`);
      
    } catch (error) {
      console.error('Error parsing PDF:', error);
      await storage.updateBidPackageStatus(bidPackageId, "failed");
      throw error;
    }
  }
}

export const pdfParser = new PDFParser();