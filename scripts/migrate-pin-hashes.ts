import 'dotenv/config';
import { migratePinHashes } from '../server/lib/pin-migration';
import { cleanup } from '../server/db';
try {
  await migratePinHashes();
  console.log('PIN storage migration completed.');
} finally {
  await cleanup();
}
