import {
  isReasonsHtml,
  MAX_REASONS_FILE_BYTES,
  MAX_REASONS_TRANSFER_BYTES,
} from '../../../shared/reasons-upload';

export async function prepareReasonsUpload(file: File): Promise<FormData> {
  if (file.type !== 'text/html' && !isReasonsHtml(file.name)) {
    throw new Error('Please upload an HTML file (.html or .htm).');
  }
  if (file.size > MAX_REASONS_FILE_BYTES) {
    throw new Error('Reasons reports must be 10 MB or smaller.');
  }
  let payload: Blob = file;
  let name = file.name;
  if (file.size > MAX_REASONS_TRANSFER_BYTES) {
    if (typeof globalThis.CompressionStream === 'undefined') {
      throw new Error(
        'Please use an updated Chrome, Safari, or Edge browser to upload this large report.'
      );
    }
    payload = await new Response(
      file.stream().pipeThrough(new globalThis.CompressionStream('gzip'))
    ).blob();
    name = `${isReasonsHtml(file.name) ? file.name : `${file.name}.html`}.gz`;
  }
  if (payload.size > MAX_REASONS_TRANSFER_BYTES) {
    throw new Error(
      'This report is too large to upload even after compression. Please export a smaller report.'
    );
  }
  const formData = new FormData();
  formData.append('reasonsReport', payload, name);
  return formData;
}
