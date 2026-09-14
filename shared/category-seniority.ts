import { z } from 'zod';

export const categorySeniorityInput = z.object({
  seniorityNumber: z.coerce.number().int().positive().max(2147483647),
  base: z.string().trim().toUpperCase().min(1).max(10),
  aircraft: z.string().trim().toUpperCase().min(1).max(50),
  position: z.enum(['A', 'B']),
});

export interface CategorySeniority {
  percentile: number;
  seniorOrEqual: number;
  totalPilots: number;
  month: string;
  year: number;
}

export interface CategoryComparison extends CategorySeniority {
  base: string;
  aircraft: string;
  position: 'A' | 'B';
}
