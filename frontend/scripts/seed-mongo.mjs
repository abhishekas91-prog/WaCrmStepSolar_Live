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
 */

import { MongoClient } from "mongodb";

const MONGO_URL = process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME ?? "stepsolar";

if (!MONGO_URL) {
  console.error("MONGO_URL is required (e.g. mongodb+srv://user:pass@cluster/...).");
  process.exit(1);
}

/** unique on {id:1} for every table (Postgres PRIMARY KEY). */
function idIndex() {
  return { key: { id: 1 }, unique: true, name: "pk_id_unique" };
}

/** account-scoped lookup (Postgres RLS filter + idx_*_account). */
function accountIdx() {
  return { key: { account_id: 1 }, name: "idx_account_id" };
}

/** Plain helper index builder. */
function idx(key, name, options = {}) {
  return { key, name, ...options };
}

/**
 * indexSpecs[table] = [spec, ...]
 * spec = { key, unique?, name, partialFilterExpression? }
 */
const indexSpecs = {
  // ---- parent / account-scoped tables ------------------------
  profiles: [
    idIndex(),
    { key: { user_id: 1 }, unique: true, name: "profiles_user_id_key" },
  ],
  accounts: [
    idIndex(),
    { key: { owner_user_id: 1 }, unique: true, name: "idx_accounts_one_per_owner" },
  ],
  account_invitations: [
    idIndex(),
    { key: { token_hash: 1 }, unique: true, name: "account_invitations_token_hash_key" },
    idx({ account_id: 1, expires_at: 1 }, "idx_account_invitations_account_pending"),
  ],
  contacts: [
    idIndex(),
    accountIdx(),
    idx({ user_id: 1 }, "idx_contacts_user_id"),
    idx({ phone: 1 }, "idx_contacts_phone"),
    {
      key: { account_id: 1, phone_normalized: 1 },
      unique: true,
      name: "idx_contacts_account_phone_normalized",
    },
  ],
  tags: [idIndex(), accountIdx()],
  custom_fields: [idIndex(), accountIdx()],
  contact_notes: [idIndex(), accountIdx()],
  contact_tags: [
    idIndex(),
    idx({ contact_id: 1 }, "idx_contact_tags_contact"),
    idx({ tag_id: 1 }, "idx_contact_tags_tag"),
    { key: { contact_id: 1, tag_id: 1 }, unique: true, name: "contact_tags_contact_tag_key" },
  ],
  contact_custom_values: [
    idIndex(),
    idx({ contact_id: 1 }, "idx_contact_custom_values_contact"),
    idx({ custom_field_id: 1 }, "idx_contact_custom_values_field"),
    {
      key: { contact_id: 1, custom_field_id: 1 },
      unique: true,
      name: "contact_custom_values_contact_field_key",
    },
  ],
  conversations: [
    idIndex(),
    accountIdx(),
    idx({ user_id: 1 }, "idx_conversations_user_id"),
    idx({ contact_id: 1 }, "idx_conversations_contact_id"),
    {
      key: { account_id: 1, contact_id: 1 },
      unique: true,
      name: "idx_conversations_account_contact",
    },
  ],
  messages: [
    idIndex(),
    idx({ conversation_id: 1 }, "idx_messages_conversation"),
    idx({ message_id: 1 }, "idx_messages_message_id"),
    {
      key: { conversation_id: 1, message_id: 1 },
      unique: true,
      name: "idx_messages_conversation_message_id",
      partialFilterExpression: { message_id: { $type: "string" } },
    },
  ],
  message_reactions: [
    idIndex(),
    idx({ conversation_id: 1 }, "idx_message_reactions_conversation"),
    idx({ message_id: 1 }, "idx_message_reactions_message"),
  ],
  whatsapp_config: [
    idIndex(),
    { key: { account_id: 1 }, unique: true, name: "whatsapp_config_account_id_key" },
    {
      key: { phone_number_id: 1 },
      unique: true,
      name: "idx_whatsapp_config_phone_number_id",
      partialFilterExpression: { phone_number_id: { $type: "string" } },
    },
    idx({ registered_at: 1 }, "idx_whatsapp_config_registered_at"),
  ],
  message_templates: [
    idIndex(),
    accountIdx(),
    {
      key: { user_id: 1, name: 1, language: 1 },
      unique: true,
      name: "message_templates_user_name_language_key",
    },
    idx({ meta_template_id: 1 }, "idx_message_templates_meta_template_id"),
  ],
  pipelines: [idIndex(), accountIdx()],
  pipeline_stages: [
    idIndex(),
    idx({ pipeline_id: 1 }, "idx_pipeline_stages_pipeline"),
  ],
  deals: [
    idIndex(),
    accountIdx(),
    idx({ assigned_to: 1 }, "idx_deals_assigned_to"),
    idx({ pipeline_id: 1 }, "idx_deals_pipeline"),
    idx({ stage_id: 1 }, "idx_deals_stage"),
  ],
  broadcasts: [idIndex(), accountIdx()],
  broadcast_recipients: [
    idIndex(),
    idx({ broadcast_id: 1 }, "idx_broadcast_recipients_broadcast"),
    idx({ broadcast_id: 1, status: 1 }, "idx_broadcast_recipients_broadcast_status"),
    {
      key: { whatsapp_message_id: 1 },
      unique: true,
      name: "idx_broadcast_recipients_wamid",
      partialFilterExpression: { whatsapp_message_id: { $type: "string" } },
    },
  ],
  automations: [
    idIndex(),
    accountIdx(),
    idx({ user_id: 1 }, "idx_automations_user_id"),
    idx(
      { trigger_type: 1 },
      "idx_automations_active_trigger",
      { partialFilterExpression: { is_active: true } },
    ),
    idx({ account_id: 1, trigger_type: 1 }, "idx_automations_account_active_trigger"),
  ],
  automation_steps: [
    idIndex(),
    idx({ automation_id: 1 }, "idx_automation_steps_automation_id"),
    idx({ parent_step_id: 1 }, "idx_automation_steps_parent"),
  ],
  automation_logs: [
    idIndex(),
    accountIdx(),
    idx({ automation_id: 1 }, "idx_automation_logs_automation"),
    idx({ user_id: 1 }, "idx_automation_logs_user"),
  ],
  automation_pending_executions: [
    idIndex(),
    accountIdx(),
    idx(
      { run_at: 1 },
      "idx_automation_pending_due",
      { partialFilterExpression: { status: "pending" } },
    ),
  ],
  flows: [
    idIndex(),
    accountIdx(),
    idx({ user_id: 1, trigger_type: 1 }, "idx_flows_active_trigger"),
  ],
  flow_nodes: [idIndex(), idx({ flow_id: 1 }, "idx_flow_nodes_flow")],
  flow_runs: [
    idIndex(),
    accountIdx(),
    idx({ flow_id: 1, started_at: 1 }, "idx_flow_runs_flow_started"),
    idx({ last_advanced_at: 1 }, "idx_flow_runs_active_advanced"),
    {
      key: { account_id: 1, contact_id: 1 },
      unique: true,
      name: "idx_one_active_run_per_contact",
      partialFilterExpression: { status: "active" },
    },
  ],
  flow_run_events: [
    idIndex(),
    idx({ flow_run_id: 1, event_type: 1 }, "idx_flow_run_events_run_type"),
    idx({ flow_run_id: 1, created_at: 1 }, "idx_flow_run_events_run_time"),
  ],
  member_presence: [idIndex(), accountIdx()],
  api_keys: [
    idIndex(),
    accountIdx(),
    { key: { key_hash: 1 }, unique: true, name: "api_keys_key_hash_key" },
  ],
  webhook_endpoints: [idIndex(), accountIdx()],
  ai_configs: [idIndex(), accountIdx()],
  ai_knowledge_documents: [idIndex(), accountIdx()],
  ai_knowledge_chunks: [idIndex(), accountIdx(), idx({ document_id: 1 }, "ai_knowledge_chunks_document_id_idx")],
  ai_usage_log: [idIndex(), idx({ account_id: 1, created_at: 1 }, "idx_ai_usage_log_account_created")],
  quick_replies: [idIndex(), accountIdx()],
  notifications: [
    idIndex(),
    idx({ user_id: 1, created_at: 1 }, "idx_notifications_user_created"),
    idx({ user_id: 1, is_read: 1 }, "idx_notifications_user_unread"),
  ],

  // ---- storage / realtime backing collections ----------------
  invoices: [idIndex(), idx({ created_at: 1 }, "idx_invoices_created_at")],
  "storage.files": [
    { key: { bucket: 1, path: 1 }, unique: true, name: "storage_files_bucket_path_key" },
    idx({ owner_user_id: 1 }, "storage_files_owner_user_id"),
  ],
  "realtime.changes": [
    idx({ table: 1, ts: 1 }, "realtime_changes_table_ts"),
    { key: { ts: 1 }, name: "realtime_changes_ts_ttl", expireAfterSeconds: 600 },
  ],
};

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
      const { key, name, ...options } = spec;
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
