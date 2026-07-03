/**
 * One-off cleanup for the pre-PIN-sync bug: createOrUpdateUser used to match
 * on seniorityNumber, which changes every bid month, so nearly every profile
 * update silently created a new `users` row instead of updating the pilot's
 * existing one — orphaning favorites, calendar events, and chat history
 * under dead rows.
 *
 * This script picks the row with the most real usage data as canonical,
 * re-points every other row's favorites/calendar/chat onto it, then deletes
 * the orphaned rows. Run once, by hand: `npx tsx scripts/consolidate-users.ts`
 */
import 'dotenv/config';
import { db } from '../server/db';
import { users, userFavorites, userCalendarEvents, chatHistory } from '../shared/schema';
import { eq, inArray, and } from 'drizzle-orm';

async function main() {
  const allUsers = await db.select().from(users);

  if (allUsers.length <= 1) {
    console.log(`Found ${allUsers.length} user row(s) — nothing to consolidate.`);
    process.exit(0);
  }

  console.log(`Found ${allUsers.length} user rows:`);

  const usage = await Promise.all(
    allUsers.map(async u => {
      const favorites = await db
        .select()
        .from(userFavorites)
        .where(eq(userFavorites.userId, u.id));
      const calendarEvents = await db
        .select()
        .from(userCalendarEvents)
        .where(eq(userCalendarEvents.userId, u.id));
      const score = favorites.length + calendarEvents.length;
      console.log(
        `  id=${u.id} seniorityNumber=${u.seniorityNumber} favorites=${favorites.length} calendarEvents=${calendarEvents.length} updatedAt=${u.updatedAt.toISOString()}`
      );
      return { user: u, score };
    })
  );

  usage.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.user.updatedAt.getTime() - a.user.updatedAt.getTime();
  });

  const canonical = usage[0].user;
  const others = usage.slice(1).map(u => u.user);

  console.log(
    `\nCanonical user: id=${canonical.id} (score=${usage[0].score}). Reassigning ${others.length} other row(s) onto it.\n`
  );

  const otherIds = others.map(u => u.id);

  // Favorites have a unique (userId, pairingId) constraint — drop any
  // duplicate pairingIds already favorited under the canonical user before
  // reassigning the rest.
  const canonicalFavoritePairingIds = new Set(
    (
      await db
        .select()
        .from(userFavorites)
        .where(eq(userFavorites.userId, canonical.id))
    ).map(f => f.pairingId)
  );

  const orphanedFavorites = await db
    .select()
    .from(userFavorites)
    .where(inArray(userFavorites.userId, otherIds));

  const collidingFavoriteIds = orphanedFavorites
    .filter(f => canonicalFavoritePairingIds.has(f.pairingId))
    .map(f => f.id);

  if (collidingFavoriteIds.length > 0) {
    await db
      .delete(userFavorites)
      .where(inArray(userFavorites.id, collidingFavoriteIds));
    console.log(`Dropped ${collidingFavoriteIds.length} duplicate favorite(s).`);
  }

  const favoritesUpdated = await db
    .update(userFavorites)
    .set({ userId: canonical.id })
    .where(inArray(userFavorites.userId, otherIds))
    .returning();
  console.log(`Reassigned ${favoritesUpdated.length} favorite(s).`);

  const calendarUpdated = await db
    .update(userCalendarEvents)
    .set({ userId: canonical.id })
    .where(inArray(userCalendarEvents.userId, otherIds))
    .returning();
  console.log(`Reassigned ${calendarUpdated.length} calendar event(s).`);

  // All existing chat history predates userId tracking, so it's safe to
  // attribute in bulk to the one real pilot using this app.
  const chatUpdated = await db
    .update(chatHistory)
    .set({ userId: canonical.id })
    .returning();
  console.log(`Attributed ${chatUpdated.length} chat message(s) to the canonical user.`);

  await db.delete(users).where(inArray(users.id, otherIds));
  console.log(`Deleted ${otherIds.length} orphaned user row(s).`);

  const finalFavorites = await db
    .select()
    .from(userFavorites)
    .where(eq(userFavorites.userId, canonical.id));
  const finalCalendar = await db
    .select()
    .from(userCalendarEvents)
    .where(eq(userCalendarEvents.userId, canonical.id));

  console.log(
    `\nDone. Canonical user id=${canonical.id} now has ${finalFavorites.length} favorite(s) and ${finalCalendar.length} calendar event(s).`
  );
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
