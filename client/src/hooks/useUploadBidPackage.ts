import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface UploadBidPackageParams {
  file: File;
}

interface UploadBidPackageOptions {
  onUploadProgress?: (progress: number) => void;
  onSuccess?: (data: any) => void;
  onError?: (error: any) => void;
}

export const useUploadBidPackage = (options: UploadBidPackageOptions = {}) => {
  const { onUploadProgress, onSuccess, onError } = options;

  return useMutation({
    mutationFn: async ({ file }: UploadBidPackageParams) => {
      // Simulate progress updates during upload
      if (onUploadProgress) {
        onUploadProgress(10);
        setTimeout(() => onUploadProgress(30), 500);
        setTimeout(() => onUploadProgress(60), 1000);
        setTimeout(() => onUploadProgress(90), 1500);
      }

      const result = await api.uploadBidPackage(file, {
        name: file.name,
        month: 'September', // Would be dynamically determined
        year: 2025,
        base: 'NYC',
        aircraft: 'A220',
      });

      if (onUploadProgress) {
        onUploadProgress(100);
      }

      return result;
    },
    onSuccess: data => {
      if (onSuccess) {
        onSuccess(data);
      }
    },
    onError: error => {
      if (onError) {
        onError(error);
      }
    },
  });
};
