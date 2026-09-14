// Leave room for multipart headers below the hosting request limit.
export const MAX_REASONS_TRANSFER_BYTES = 4 * 1024 * 1024;
export const MAX_REASONS_FILE_BYTES = 10 * 1024 * 1024;

export function isReasonsHtml(name: string): boolean {
  return /\.html?$/i.test(name);
}
