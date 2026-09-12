export interface CompleteDataset<T> {
  schema: 1;
  complete: true;
  total: number;
  pairings: T[];
  statistics?: unknown;
}

export function isCompleteDataset<T>(
  value: unknown
): value is CompleteDataset<T> {
  const data = value as CompleteDataset<T> | undefined;
  return (
    !!data &&
    data.schema === 1 &&
    data.complete === true &&
    Array.isArray(data.pairings) &&
    Number.isInteger(data.total) &&
    data.total >= 0 &&
    data.total === data.pairings.length
  );
}

/** Query keys keep obsolete loads isolated. Coalesce duplicate consumers and
 * cache only complete responses; a valid empty/small package is complete too.
 */
export function createDatasetLoader<T>(cache: {
  read(key: string): Promise<unknown>;
  write(key: string, value: CompleteDataset<T>): Promise<void>;
}) {
  const pending = new Map<
    string,
    Promise<CompleteDataset<T> & { cached: boolean }>
  >();
  return (key: string, fetchDataset: () => Promise<unknown>) => {
    const existing = pending.get(key);
    if (existing) return existing;
    const run = (async () => {
      try {
        const data = await fetchDataset();
        if (!isCompleteDataset<T>(data))
          throw new Error('Incomplete pairing dataset');
        let cached = false;
        try {
          await cache.write(key, data);
          cached = true;
        } catch {
          /* Storage is optional. */
        }
        return { ...data, cached };
      } catch (error) {
        // Authorization failures must not silently become offline successes.
        const status = (error as { status?: number }).status;
        if (status && status < 500) throw error;
        const saved = await cache.read(key).catch(() => undefined);
        if (isCompleteDataset<T>(saved)) return { ...saved, cached: true };
        throw error;
      }
    })().finally(() => pending.delete(key));
    pending.set(key, run);
    return run;
  };
}
