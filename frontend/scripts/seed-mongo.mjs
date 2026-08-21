#!/usr/bin/env node
/**
 * Seed script for the MongoDB data layer (replaces Supabase migrations
 * 001-037). Idempotent and NON-destructive — it never drops a
 * collection or deletes data, so it is safe to run against the shared
 * `stepsolar` database that already holds StepSolar's own data.
 *
 * Usage (from frontend/):
 *   MONGO_URL=mongodb+srv://user:pass@cluster/... node scripts/seed-mongo.mjs
 *   DB_NAME=stepsolar node scripts/seed-mongo.mjs        # default already stepsolar
 *
 * What it does:
 *   1. Creates every CRM collection (lazily via createIndex).
 *   2. Builds the same uniqueness guarantees Postgres enforced via
 *      PRIMARY KEY / UNIQUE constraints (mapped to Mongo unique
 *      indexes, with partialFilterExpression where the SQL index was
 *      partial or the column is nullable).
 *   3. Builds the query indexes that mirror the SQL CREATE INDEX set.
 *   4. Bootstraps storage.files (bucket/path) and realtime.changes
 *      (10-min TTL) backing collections.
 *
 * The index specs live in src/lib/mongo/index-specs.json — the same
 * source of truth the app uses for SEED_INDEXES_ON_START=1.
 */

import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";

const MONGO_URL = process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME ?? "stepsolar";

if (!MONGO_URL) {
  console.error("MONGO_URL is required (e.g. mongodb+srv://user:pass@cluster/...).");
  process.exit(1);
}

const specsPath = new URL("../src/lib/mongo/index-specs.json", import.meta.url);
const indexSpecs = JSON.parse(readFileSync(specsPath, "utf8"));

async function main() {
  const client = new MongoClient(MONGO_URL, {
    serverSelectionTimeoutMS: 30000,
    maxPoolSize: 5,
  });
  await client.connect();
  const db = client.db(DB_NAME);
  console.log(`Connected to "${DB_NAME}". Seeding indexes (idempotent).`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const [table, specs] of Object.entries(indexSpecs)) {
    for (const spec of specs) {
      const { key, ...options } = spec;
      const name = options.name ?? JSON.stringify(key);
      try {
        await db.collection(table).createIndex(key, options);
        created++;
      } catch (err) {
        const code = err?.code;
        const msg = err?.message ?? String(err);
        if (code === 85 || /IndexOptionsConflict|already exists/i.test(msg)) {
          skipped++;
          console.warn(`  skip ${table}.${name} — conflicting index already exists`);
        } else {
          failed++;
          console.error(`  FAIL ${table}.${name}: ${msg}`);
        }
      }
    }
  }

  console.log(`\nDone: ${created} indexes created, ${skipped} skipped, ${failed} failed.`);
  await client.close();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
