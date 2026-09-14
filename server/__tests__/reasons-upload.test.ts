import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { prepareReasonsUpload } from '../../client/src/lib/prepare-reasons-upload';
import { decodeReasonsUpload } from '../lib/decode-reasons-upload';
import {
  MAX_REASONS_FILE_BYTES,
  MAX_REASONS_TRANSFER_BYTES,
} from '../../shared/reasons-upload';

test('large HTML transfers below hosting limit and preserves legacy bytes', async () => {
  const bytes = Buffer.alloc(5_000_000, 0xa0);
  const form = await prepareReasonsUpload(new File([bytes], 'report.HTM'));
  const file = form.get('reasonsReport') as File;
  assert.equal(file.name, 'report.HTM.gz');
  assert.ok(file.size < MAX_REASONS_TRANSFER_BYTES);
  assert.equal(
    await decodeReasonsUpload(Buffer.from(await file.arrayBuffer()), file.name),
    bytes.toString('latin1')
  );
});

test('small HTM with empty MIME stays uncompressed', async () => {
  const form = await prepareReasonsUpload(
    new File(['<html>Report</html>'], 'report.htm')
  );
  const file = form.get('reasonsReport') as File;
  assert.equal(file.name, 'report.htm');
  assert.equal(await file.text(), '<html>Report</html>');
});

test('rejects unsupported, oversized and incompressible uploads before transfer', async () => {
  await assert.rejects(
    prepareReasonsUpload(new File(['no'], 'report.txt')),
    /HTML/
  );
  await assert.rejects(
    prepareReasonsUpload(
      new File([Buffer.alloc(MAX_REASONS_FILE_BYTES + 1)], 'report.htm')
    ),
    /10 MB/
  );
  await assert.rejects(
    prepareReasonsUpload(new File([randomBytes(4_500_000)], 'report.htm')),
    /even after compression/
  );
});

test('rejects damaged archives and limits decompressed bytes', async () => {
  await assert.rejects(
    decodeReasonsUpload(Buffer.from('invalid'), 'report.htm.gz'),
    /invalid/
  );
  await assert.rejects(
    decodeReasonsUpload(
      gzipSync(Buffer.alloc(MAX_REASONS_FILE_BYTES + 1)),
      'report.htm.gz'
    ),
    /10 MB/
  );
});
