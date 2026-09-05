// ============================================================
// Mongo schema metadata — mirror of the Postgres DDL + RLS model
// (supabase/migrations 001-037).
//
// The Postgres schema enforced tenancy through RLS policies. Mongo
// has no RLS, so this module is the single source of truth for:
//   - which tables are account-scoped / user-scoped / parent-joined
//   - the minimum role required for INSERT/UPDATE/DELETE
//   - FK relationships used by embedded selects (PostgREST embeds)
// ============================================================

export type AccountRole = "owner" | "admin" | "agent" | "viewer";

export const ROLE_RANK: Record<AccountRole, number> = {
  viewer: 1,
  agent: 2,
  admin: 3,
  owner: 4,
};

export function roleAtLeast(role: AccountRole | null | undefined, min: AccountRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export interface ChildParent {
  /** Parent table that owns the account_id */
  table: string;
  /** Column on the child row pointing at the parent's id */
  fk: string;
  /** Column on the parent row (defaults to "id") */
  parentPk?: string;
}

export interface TableDef {
  /**
   * - account: row carries account_id; RLS filters account_id = mine
   * - user:    row carries user_id; RLS filters user_id = me
   * - child:   no account_id; scoped via the parent row
   * - profile: profiles table special-case
   * - accountRow: accounts table special-case
   * - invitations: account_invitations (admin+ only)
   */
  kind: "account" | "user" | "child" | "profile" | "accountRow" | "invitations";
  parent?: ChildParent;
  /** Minimum role for INSERT/UPDATE/DELETE. Undefined = read-only for clients. */
  minWriteRole?: AccountRole;
  /** Minimum role for SELECT (defaults to viewer for account tables). */
  minReadRole?: AccountRole;
}

export const TABLES: Record<string, TableDef> = {
  // ---- parent / account-scoped tables -------------------------
  contacts: { kind: "account", minWriteRole: "agent" },
  tags: { kind: "account", minWriteRole: "admin" },
  custom_fields: { kind: "account", minWriteRole: "admin" },
  contact_notes: { kind: "account", minWriteRole: "agent" },
  conversations: { kind: "account", minWriteRole: "agent" },
  whatsapp_config: { kind: "account", minWriteRole: "admin" },
  message_templates: { kind: "account", minWriteRole: "admin" },
  pipelines: { kind: "account", minWriteRole: "admin" },
  deals: { kind: "account", minWriteRole: "agent" },
  broadcasts: { kind: "account", minWriteRole: "agent" },
  automations: { kind: "account", minWriteRole: "agent" },
  automation_logs: { kind: "account" }, // service-role writes
  automation_pending_executions: { kind: "account" }, // service-role only
  flows: { kind: "account", minWriteRole: "agent" },
  flow_runs: { kind: "account" }, // service-role driven
  member_presence: { kind: "account", minWriteRole: "agent" },
  api_keys: { kind: "account", minWriteRole: "admin" },
  webhook_endpoints: { kind: "account", minWriteRole: "admin" },
  ai_configs: { kind: "account", minWriteRole: "admin" },
  ai_knowledge_documents: { kind: "account", minWriteRole: "admin" },
  ai_knowledge_chunks: { kind: "account", minWriteRole: "admin" },
  ai_usage_log: { kind: "account", minReadRole: "admin" }, // read admin+, service writes
  quick_replies: { kind: "account", minWriteRole: "agent" },
  solar_config: { kind: "account", minWriteRole: "admin" },
  solar_recommendations: { kind: "account", minWriteRole: "agent" }, // service + agent writes

  // ---- user-scoped --------------------------------------------
  notifications: { kind: "user" },

  // ---- child tables (parent-join scoping) ---------------------
  contact_tags: {
    kind: "child",
    parent: { table: "contacts", fk: "contact_id" },
    minWriteRole: "agent",
  },
  contact_custom_values: {
    kind: "child",
    parent: { table: "contacts", fk: "contact_id" },
    minWriteRole: "agent",
  },
  messages: {
    kind: "child",
    parent: { table: "conversations", fk: "conversation_id" },
    minWriteRole: "agent",
  },
  pipeline_stages: {
    kind: "child",
    parent: { table: "pipelines", fk: "pipeline_id" },
    minWriteRole: "admin",
  },
  broadcast_recipients: {
    kind: "child",
    parent: { table: "broadcasts", fk: "broadcast_id" },
    minWriteRole: "agent",
  },
  automation_steps: {
    kind: "child",
    parent: { table: "automations", fk: "automation_id" },
    minWriteRole: "agent",
  },
  flow_nodes: {
    kind: "child",
    parent: { table: "flows", fk: "flow_id" },
    minWriteRole: "agent",
  },
  flow_run_events: {
    kind: "child",
    parent: { table: "flow_runs", fk: "flow_run_id" },
  },
  message_reactions: {
    kind: "child",
    parent: { table: "messages", fk: "message_id" },
    minWriteRole: "agent",
  },

  // ---- special ------------------------------------------------
  profiles: { kind: "profile" },
  accounts: { kind: "accountRow" },
  account_invitations: { kind: "invitations", minWriteRole: "admin" },
};

// ============================================================
// FK relationships for embedded selects.
//
// Key: `${parentTable}.${childTable}`. Value describes how rows in
// `childTable` relate to a row in `parentTable`:
//   - parentCol: parent.fk = child.id   (to-one embed)
//   - childCol:  child.fk = parent.id   (to-many embed)
//
// `fkHint` maps PostgREST constraint-name hints (e.g.
// `profiles!deals_assigned_to_fkey`) onto a relationship.
// ============================================================

export interface Relation {
  kind: "parentCol" | "childCol";
  parentCol: string;
  childCol: string;
}

export const RELATIONS: Record<string, Relation> = {
  "messages.contacts": { kind: "parentCol", parentCol: "contact_id", childCol: "id" },
  // Was missing — every `contact:contacts(*)` embed on `conversations`
  // (the Inbox list + thread panel's CONVERSATION_SELECT) silently
  // resolved to nothing instead of erroring, because attachEmbeds()
  // treats an unresolved relation as "attach nothing rather than
  // crash". That's what showed every contact as "Unknown" and kept
  // the thread panel stuck on its empty state even with a conversation
  // selected (message-thread.tsx bails to the empty state whenever
  // `contact` is falsy).
  "conversations.contacts": { kind: "parentCol", parentCol: "contact_id", childCol: "id" },
  "deals.contacts": { kind: "parentCol", parentCol: "contact_id", childCol: "id" },
  "deals.pipeline_stages": { kind: "parentCol", parentCol: "stage_id", childCol: "id" },
  "deals.profiles": { kind: "parentCol", parentCol: "assigned_to", childCol: "id" },
  "flow_runs.contacts": { kind: "parentCol", parentCol: "contact_id", childCol: "id" },
  "automation_logs.contacts": { kind: "parentCol", parentCol: "contact_id", childCol: "id" },
  "automation_logs.automations": { kind: "parentCol", parentCol: "automation_id", childCol: "id" },
  "flow_runs.automations": { kind: "parentCol", parentCol: "automation_id", childCol: "id" },
  "broadcast_recipients.broadcasts": {
    kind: "parentCol",
    parentCol: "broadcast_id",
    childCol: "id",
  },
  "contacts.contact_tags": { kind: "childCol", childCol: "contact_id", parentCol: "id" },
  "contact_tags.tags": { kind: "parentCol", parentCol: "tag_id", childCol: "id" },
  "broadcasts.contacts": { kind: "parentCol", parentCol: "contact_id", childCol: "id" },
  "message_templates.accounts": { kind: "parentCol", parentCol: "account_id", childCol: "id" },
};

/** Constraint-name hints used in `table!<name>(...)` embeds. */
export const FK_HINTS: Record<string, Relation> = {
  deals_assigned_to_fkey: { kind: "parentCol", parentCol: "assigned_to", childCol: "id" },
};

// ============================================================
// Column metadata used for defaults / serialization
// ============================================================

/** Tables whose rows must carry an id when inserted if none provided. */
export function getCollectionName(table: string): string {
  return table;
}

/** Convert a Postgres-ish value to a Mongo-safe value (identity for now). */
export function mongoValue(v: unknown): unknown {
  return v;
}
