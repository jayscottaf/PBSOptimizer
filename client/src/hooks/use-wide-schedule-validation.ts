import { useQuery } from '@tanstack/react-query';
import type { WideScheduleValidationResult } from '@shared/wide-schedule-validation';

export function useWideScheduleValidation(
  bidPackageId: number | undefined,
  seniorityNumber: number | undefined,
  position: 'A' | 'B'
) {
  return useQuery<WideScheduleValidationResult>({
    queryKey: [
      'wide-schedule-validation',
      bidPackageId,
      position,
      seniorityNumber,
    ],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        bidPackageId: String(bidPackageId),
        position,
        seniorityNumber: String(seniorityNumber),
      });
      const response = await fetch(`/api/wide-schedules/validation?${params}`, {
        signal,
      });
      if (!response.ok) throw new Error('Could not load award validation.');
      return response.json();
    },
    enabled: Boolean(bidPackageId && seniorityNumber),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
