import type { Db } from "mongodb";
import specsJson from "./index-specs.json";

/**
 * Index specs that mirror the Supabase Postgres migrations (001-037).
 * Single source of truth: consumed by the app's startup seed hook
 * (SEED_INDEXES_ON_START=1) and by scripts/seed-mongo.mjs.
 *
 * Each spec maps a PRIMARY KEY / UNIQUE / partial-unique / helper
 * CREATE INDEX from SQL onto a Mongo index (with partialFilterExpression
 * where the SQL index was partial or the column nullable).
 */

export type MongoIndexSpec = {
  key: Record<string, number>;
  name?: string;
  unique?: boolean;
  partialFilterExpression?: Record<string, unknown>;
  expireAfterSeconds?: number;
};

export const indexSpecs: Record<string, MongoIndexSpec[]> = specsJson as unknown as Record<
  string,
  MongoIndexSpec[]
>;

export interface EnsureIndexesResult {
  created: number;
  skipped: number;
  failed: number;
}

/**
 * Idempotent, non-destructive index creation. Never drops a collection
 * or deletes data, so it is safe to run against a shared database that
 * already holds application data.
 */
export async function ensureIndexes(
  db: Db,
  log: (msg: string) => void = console.log,
): Promise<EnsureIndexesResult> {
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const [table, specs] of Object.entries(indexSpecs)) {
    for (const spec of specs) {
      const { key, ...options } = spec;
      const name = options.name ?? `${JSON.stringify(key)}`;
      try {
        await db.collection(table).createIndex(key, options);
        created++;
      } catch (err) {
        const code = (err as { code?: number })?.code;
        const msg = (err as Error)?.message ?? String(err);
        if (code === 85 || /IndexOptionsConflict|already exists/i.test(msg)) {
          skipped++;
          log(`  skip ${table}.${name} — conflicting index already exists`);
        } else {
          failed++;
          log(`  FAIL ${table}.${name}: ${msg}`);
        }
      }
    }
  }

  return { created, skipped, failed };
}
