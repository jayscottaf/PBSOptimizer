import { sql, eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../../shared/schema';
import { hashPin } from './access-control';

export async function migratePinHashes(
  database: Pick<typeof db, 'transaction'> = db
) {
  await database.transaction(async tx => {
    await tx.execute(sql`ALTER TABLE users ALTER COLUMN sync_pin TYPE text`);
    const rows = await tx
      .select({ id: users.id, pin: users.syncPin })
      .from(users);
    for (const row of rows) {
      if (row.pin && !row.pin.startsWith('scrypt:')) {
        await tx
          .update(users)
          .set({ syncPin: await hashPin(row.pin) })
          .where(eq(users.id, row.id));
      }
    }
  });
}
