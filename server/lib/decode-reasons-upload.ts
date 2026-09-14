import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { MAX_REASONS_FILE_BYTES } from '../../shared/reasons-upload';

const unzip = promisify(gunzip);

export async function decodeReasonsUpload(
  buffer: Buffer,
  name: string
): Promise<string> {
  if (/\.html?\.gz$/i.test(name)) {
    try {
      buffer = await unzip(buffer, { maxOutputLength: MAX_REASONS_FILE_BYTES });
    } catch {
      throw new Error(
        'The compressed report is invalid or exceeds the 10 MB report limit. Please select the original HTML report again.'
      );
    }
  }
  if (buffer.length > MAX_REASONS_FILE_BYTES) {
    throw new Error('Reasons reports must be 10 MB or smaller.');
  }
  // Preserve the legacy NAVBLUE non-breaking spaces used by the parser.
  const utf8 = buffer.toString('utf-8');
  return utf8.includes('\uFFFD') ? buffer.toString('latin1') : utf8;
}
