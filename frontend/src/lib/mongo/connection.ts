import { MongoClient, type Db, type Collection } from "mongodb";

/**
 * MongoDB connection singleton (server-side only).
 *
 * The CRM used to talk to Supabase (Postgres + RLS). After migration
 * it talks to the same MongoDB cluster the StepSolar backend uses, so
 * all business data lives in one place.
 *
 * The driver connects lazily on the first operation, so every accessor
 * here is synchronous — call sites use `collection(...).find(...)`
 * without awaiting. Connection failures surface as operation errors
 * with a 15s server-selection timeout.
 */

const MONGO_URL = process.env.MONGO_URL ?? "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME ?? "wacrm";

const clients = new Map<string, MongoClient>();

export function getClient(): MongoClient {
  let client = clients.get(MONGO_URL);
  if (!client) {
    client = new MongoClient(MONGO_URL, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 15000,
    });
    clients.set(MONGO_URL, client);
  }
  return client;
}

export function getDb(): Db {
  return getClient().db(DB_NAME);
}

export function collection<T extends object = any>(name: string): Collection<T> {
  return getDb().collection<T>(name);
}

/** Close the shared client (used in tests / teardown). */
export async function closeMongo(): Promise<void> {
  for (const client of clients.values()) {
    await client.close().catch(() => {});
  }
  clients.clear();
}
