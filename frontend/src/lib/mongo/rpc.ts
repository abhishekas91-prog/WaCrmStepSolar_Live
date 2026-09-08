// ============================================================
// MongoDB implementations of the SQL functions the app calls via
// `supabase.rpc(...)`. Signatures and error contracts mirror the
// Postgres originals (migrations 007/012/018/019/024/025/028/029/
// 030/037); RPC errors throw `RpcError` with a SQLSTATE-style code
// so the existing route handlers keep working unchanged.
// ============================================================

import { collection } from "./connection";
import type { SessionUser } from "./query-builder";
import { recordChange } from "./realtime";

export type RpcContext = {
  user?: SessionUser | null;
  service?: boolean;
};

export class RpcError extends Error {
  code: string;
  constructor(message: string, code = "22023") {
    super(message);
    this.code = code;
  }
}

function roleRank(r: string | null | undefined): number {
  const map: Record<string, number> = { viewer: 1, agent: 2, admin: 3, owner: 4 };
  return r ? map[r] ?? 0 : 0;
}

function requireUser(ctx: RpcContext): SessionUser {
  if (!ctx.user) throw new RpcError("Unauthorized", "42501");
  return ctx.user;
}

function accountRoleAtLeast(user: SessionUser, min: "viewer" | "agent" | "admin" | "owner"): boolean {
  return roleRank(user.account_role) >= roleRank(min);
}

function nowIso(): string {
  return new Date().toISOString();
}

// ============================================================
// set_member_role / remove_account_member / transfer_account_ownership
// ============================================================

export async function setMemberRole(
  ctx: RpcContext,
  args: { p_user_id: string; p_new_role: string },
): Promise<null> {
  const caller = requireUser(ctx);
  if (!accountRoleAtLeast(caller, "admin")) {
    throw new RpcError("This action requires the admin role or higher", "42501");
  }
  if (args.p_user_id === caller.id) {
    throw new RpcError("Cannot change your own role", "22023");
  }
  const target = await collection("profiles").findOne({ user_id: args.p_user_id });
  if (!target) throw new RpcError("Target user not found", "22023");
  if (target.account_id !== caller.account_id) {
    throw new RpcError("Target user is not a member of your account", "42501");
  }
  if (target.account_role === "owner") {
    throw new RpcError("Use transfer_account_ownership to demote an owner", "22023");
  }
  if (args.p_new_role === "owner") {
    throw new RpcError("Use transfer_account_ownership to promote to owner", "22023");
  }
  await collection("profiles").updateOne(
    { user_id: args.p_user_id },
    { $set: { account_role: args.p_new_role } },
  );
  return null;
}

export async function removeAccountMember(
  ctx: RpcContext,
  args: { p_user_id: string },
): Promise<string> {
  const caller = requireUser(ctx);
  if (!accountRoleAtLeast(caller, "admin")) {
    throw new RpcError("This action requires the admin role or higher", "42501");
  }
  if (args.p_user_id === caller.id) {
    throw new RpcError(
      "Cannot remove yourself; transfer ownership or leave the account instead",
      "22023",
    );
  }
  const target = await collection("profiles").findOne({ user_id: args.p_user_id });
  if (!target) throw new RpcError("Target user not found", "22023");
  if (target.account_id !== caller.account_id) {
    throw new RpcError("Target user is not a member of your account", "42501");
  }
  if (target.account_role === "owner") {
    throw new RpcError("Cannot remove the account owner; transfer ownership first", "22023");
  }
  const newAccountId = crypto.randomUUID();
  const now = nowIso();
  await collection("accounts").insertOne({
    id: newAccountId,
    name: target.full_name || target.email || "My account",
    owner_user_id: args.p_user_id,
    created_at: now,
    updated_at: now,
  } as never);
  await collection("profiles").updateOne(
    { user_id: args.p_user_id },
    { $set: { account_id: newAccountId, account_role: "owner" } },
  );
  return newAccountId;
}

export async function transferAccountOwnership(
  ctx: RpcContext,
  args: { p_new_owner_user_id: string },
): Promise<null> {
  const caller = requireUser(ctx);
  if (caller.account_role !== "owner") {
    throw new RpcError("Only the account owner can transfer ownership", "42501");
  }
  if (args.p_new_owner_user_id === caller.id) {
    throw new RpcError("You are already the owner", "22023");
  }
  const target = await collection("profiles").findOne({ user_id: args.p_new_owner_user_id });
  if (!target) throw new RpcError("Target user not found", "22023");
  if (target.account_id !== caller.account_id) {
    throw new RpcError("Target user is not a member of your account", "42501");
  }
  await collection("profiles").updateOne(
    { user_id: caller.id },
    { $set: { account_role: "admin" } },
  );
  await collection("profiles").updateOne(
    { user_id: args.p_new_owner_user_id },
    { $set: { account_role: "owner" } },
  );
  await collection("accounts").updateOne(
    { id: caller.account_id },
    { $set: { owner_user_id: args.p_new_owner_user_id } },
  );
  return null;
}

// ============================================================
// peek_invitation / redeem_invitation
// ============================================================

export async function peekInvitation(
  _ctx: RpcContext,
  args: { p_token_hash: string },
): Promise<Record<string, unknown>> {
  const inv = await collection("account_invitations").findOne({
    token_hash: args.p_token_hash,
  });
  if (!inv) return { ok: false, reason: "not_found" };
  if (inv.accepted_at) return { ok: false, reason: "used" };
  if (inv.expires_at <= nowIso()) return { ok: false, reason: "expired" };
  const account = await collection("accounts").findOne({ id: inv.account_id });
  return {
    ok: true,
    account_name: account?.name ?? "this workspace",
    role: inv.role,
    expires_at: inv.expires_at,
  };
}

const DATA_TABLES = [
  "contacts",
  "conversations",
  "broadcasts",
  "automations",
  "flows",
  "pipelines",
  "message_templates",
  "tags",
  "custom_fields",
  "contact_notes",
  "whatsapp_config",
];

export async function redeemInvitation(
  ctx: RpcContext,
  args: { p_token_hash: string },
): Promise<string> {
  const caller = requireUser(ctx);
  const inv = await collection("account_invitations").findOne({
    token_hash: args.p_token_hash,
  });
  if (!inv) throw new RpcError("Invitation not found", "22023");
  if (inv.accepted_at) throw new RpcError("Invitation has already been redeemed", "22023");
  if (inv.expires_at <= nowIso()) throw new RpcError("Invitation has expired", "22023");

  const profile = await collection("profiles").findOne({ user_id: caller.id });
  if (!profile) throw new RpcError("Caller has no profile", "42501");
  const oldAccountId = profile.account_id as string;

  if (oldAccountId === inv.account_id) {
    throw new RpcError("You are already a member of this account", "23505");
  }

  const oldAccount = await collection("accounts").findOne({ id: oldAccountId });
  if (oldAccount?.owner_user_id !== caller.id) {
    throw new RpcError(
      "You are already in a shared account; sign up with a different email to join this one",
      "23505",
    );
  }

  for (const table of DATA_TABLES) {
    const hasData = await collection(table).findOne({ account_id: oldAccountId });
    if (hasData) {
      throw new RpcError(
        "Your account already contains data; sign up with a different email to join this one",
        "23505",
      );
    }
  }

  await collection("profiles").updateOne(
    { user_id: caller.id },
    { $set: { account_id: inv.account_id, account_role: inv.role } },
  );
  await collection("account_invitations").updateOne(
    { id: inv.id },
    { $set: { accepted_at: nowIso(), accepted_by_user_id: caller.id } },
  );
  await collection("accounts").deleteOne({ id: oldAccountId });

  return String(inv.account_id);
}

// ============================================================
// touch_presence
// ============================================================

export async function touchPresence(
  ctx: RpcContext,
  args: { p_status?: string },
): Promise<null> {
  const caller = requireUser(ctx);
  const status = args.p_status ?? "online";
  if (!["online", "away"].includes(status)) {
    throw new RpcError("Invalid presence status", "22023");
  }
  if (!caller.account_id) throw new RpcError("No account for caller", "22023");
  await collection("member_presence").findOneAndUpdate(
    { user_id: caller.id },
    {
      $set: { status, last_seen_at: nowIso(), account_id: caller.account_id },
      $setOnInsert: { user_id: caller.id },
    },
    { upsert: true, includeResultMetadata: false },
  );
  return null;
}

// ============================================================
// increment counters
// ============================================================

export async function incrementFlowExecutionCount(
  ctx: RpcContext,
  args: { p_flow_id: string },
): Promise<null> {
  if (!ctx.service) throw new RpcError("Permission denied", "42501");
  await collection("flows").updateOne(
    { id: args.p_flow_id },
    { $inc: { execution_count: 1 }, $set: { last_executed_at: nowIso() } },
  );
  return null;
}

export async function incrementAutomationExecutionCount(
  ctx: RpcContext,
  args: { p_automation_id: string },
): Promise<null> {
  if (!ctx.service) throw new RpcError("Permission denied", "42501");
  await collection("automations").updateOne(
    { id: args.p_automation_id },
    { $inc: { execution_count: 1 }, $set: { last_executed_at: nowIso() } },
  );
  return null;
}

// ============================================================
// filter_contacts_by_tags
// ============================================================

export async function filterContactsByTags(
  ctx: RpcContext,
  args: {
    p_tag_ids: string[];
    p_search?: string | null;
    p_limit?: number;
    p_offset?: number;
  },
): Promise<Array<{ contact: Record<string, unknown>; total_count: number }>> {
  const caller = requireUser(ctx);
  if (!caller.account_id) throw new RpcError("Unauthorized", "42501");

  const tagIds = args.p_tag_ids ?? [];
  const search = args.p_search ?? null;
  const limit = Math.max(0, Math.floor(args.p_limit ?? 25));
  const offset = Math.max(0, Math.floor(args.p_offset ?? 0));

  const contactTags = await collection("contact_tags")
    .find({ tag_id: { $in: tagIds }, account_id: caller.account_id })
    .project({ _id: 0, contact_id: 1 })
    .toArray();
  const contactIds = Array.from(new Set(contactTags.map((c) => c.contact_id)));

  const filter: Record<string, unknown> = {
    account_id: caller.account_id,
    ...(contactIds.length ? { id: { $in: contactIds } } : { id: { $in: [] } }),
  };
  if (search) {
    const re = { $regex: String(search), $options: "i" };
    filter.$or = [{ name: re }, { phone: re }, { email: re }];
  }

  const totalCount = await collection("contacts").countDocuments(filter);
  const rows = await collection("contacts")
    .find(filter)
    .project({ _id: 0 })
    .sort({ created_at: -1, id: 1 })
    .skip(offset)
    .limit(limit)
    .toArray();

  return rows.map((row) => ({ contact: row as never, total_count: totalCount }));
}

// ============================================================
// match_ai_knowledge_fts / match_ai_knowledge_semantic
// ============================================================

function tokenize(query: string): string[] {
  return String(query)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export async function matchAiKnowledgeFts(
  _ctx: RpcContext,
  args: { p_account_id: string; p_query: string; p_match_count: number },
): Promise<Array<{ id: string; content: string; rank: number }>> {
  const count = Math.max(0, Math.floor(args.p_match_count ?? 5));
  const tokens = tokenize(args.p_query);
  if (tokens.length === 0) return [];
  const re = new RegExp(tokens.map((t) => `(${t})`).join("|"), "i");
  const chunks = await collection("ai_knowledge_chunks")
    .find({ account_id: args.p_account_id, content: { $regex: re } })
    .project({ _id: 0, id: 1, content: 1 })
    .toArray();
  const scored = chunks
    .map((c) => {
      const content = String(c.content);
      let rank = 0;
      for (const t of tokens) {
        rank += (content.toLowerCase().split(t).length - 1) * (t.length > 3 ? 2 : 1);
      }
      return { id: c.id as string, content, rank };
    })
    .sort((a, b) => b.rank - a.rank);
  return scored.slice(0, count);
}

function parseEmbedding(text: string): number[] | null {
  const m = text?.match(/\[([^\]]+)\]/);
  if (!m) return null;
  const parts = m[1].split(",").map((x) => Number(x.trim()));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts;
}

function cosineDistance(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return Infinity;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return Infinity;
  return 1 - dot / denom;
}

export async function matchAiKnowledgeSemantic(
  _ctx: RpcContext,
  args: { p_account_id: string; p_query_embedding: string; p_match_count: number },
): Promise<Array<{ id: string; content: string; distance: number }>> {
  const count = Math.max(0, Math.floor(args.p_match_count ?? 5));
  const queryVec = parseEmbedding(args.p_query_embedding);
  if (!queryVec) return [];
  const chunks = await collection("ai_knowledge_chunks")
    .find({
      account_id: args.p_account_id,
      embedding: { $exists: true, $ne: null },
    })
    .project({ _id: 0, id: 1, content: 1, embedding: 1 })
    .toArray();
  const scored = chunks
    .map((c) => {
      const distance = cosineDistance(queryVec, (c.embedding as number[]) ?? []);
      return {
        id: c.id as string,
        content: c.content as string,
        distance,
      };
    })
    .filter((r) => Number.isFinite(r.distance))
    .sort((a, b) => a.distance - b.distance);
  return scored.slice(0, count);
}

// ============================================================
// record_webhook_failure
// ============================================================

export async function recordWebhookFailure(
  ctx: RpcContext,
  args: { endpoint_id: string; max_failures: number },
): Promise<null> {
  if (!ctx.service) throw new RpcError("Permission denied", "42501");
  const endpoint = await collection("webhook_endpoints").findOne({
    id: args.endpoint_id,
  });
  if (!endpoint) return null;
  const newFailureCount = (endpoint.failure_count ?? 0) + 1;
  const deactivate = newFailureCount >= args.max_failures;
  await collection("webhook_endpoints").updateOne(
    { id: args.endpoint_id },
    { $set: { failure_count: newFailureCount, is_active: deactivate ? false : endpoint.is_active } },
  );
  return null;
}

// ============================================================
// claim_ai_reply_slot
// ============================================================

export async function claimAiReplySlot(
  ctx: RpcContext,
  args: { conversation_id: string; max_replies: number },
): Promise<boolean> {
  if (!ctx.service) throw new RpcError("Permission denied", "42501");
  const res = await collection("conversations").findOneAndUpdate(
    { id: args.conversation_id, ai_reply_count: { $lt: args.max_replies } },
    { $inc: { ai_reply_count: 1 } },
    { returnDocument: "after", includeResultMetadata: false },
  );
  return !!res;
}

// ============================================================
// create_broadcast_with_recipients
// ============================================================

export async function createBroadcastWithRecipients(
  ctx: RpcContext,
  args: {
    p_account_id: string;
    p_user_id: string;
    p_name: string;
    p_template_name: string;
    p_template_language: string;
    p_total_recipients: number;
    p_contact_ids: string[];
  },
): Promise<Array<{ broadcast_id: string; recipient_id: string; contact_id: string }>> {
  if (!ctx.service) throw new RpcError("Permission denied", "42501");
  const broadcastId = crypto.randomUUID();
  const now = nowIso();
  await collection("broadcasts").insertOne({
    id: broadcastId,
    account_id: args.p_account_id,
    user_id: args.p_user_id,
    name: args.p_name,
    template_name: args.p_template_name,
    template_language: args.p_template_language,
    status: "sending",
    total_recipients: args.p_total_recipients,
    created_at: now,
    updated_at: now,
  } as never);
  const out: Array<{ broadcast_id: string; recipient_id: string; contact_id: string }> = [];
  for (const contactId of args.p_contact_ids) {
    const recipientId = crypto.randomUUID();
    await collection("broadcast_recipients").insertOne({
      id: recipientId,
      broadcast_id: broadcastId,
      contact_id: contactId,
      status: "pending",
      created_at: now,
    } as never);
    out.push({ broadcast_id: broadcastId, recipient_id: recipientId, contact_id: contactId });
  }
  return out;
}

// ============================================================
// bump_conversation_on_inbound
// ============================================================

export async function bumpConversationOnInbound(
  ctx: RpcContext,
  args: { p_conversation_id: string; p_last_message_text: string },
): Promise<null> {
  if (!ctx.service) throw new RpcError("Permission denied", "42501");
  const now = nowIso();
  const updated = await collection("conversations").findOneAndUpdate(
    { id: args.p_conversation_id },
    {
      $inc: { unread_count: 1 },
      $set: {
        last_message_text: args.p_last_message_text,
        last_message_at: now,
        updated_at: now,
      },
    },
    { returnDocument: "after", includeResultMetadata: false, projection: { _id: 0 } },
  );
  if (updated) {
    await recordChange(
      "conversations",
      "UPDATE",
      updated as Record<string, unknown>,
      null,
    );
  }
  return null;
}

// ============================================================
// Dispatcher
// ============================================================

export async function runRpc(
  ctx: RpcContext,
  name: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: { message: string; code: string } | null }> {
  try {
    switch (name) {
      case "set_member_role":
        return { data: await setMemberRole(ctx, args as never), error: null };
      case "remove_account_member":
        return { data: await removeAccountMember(ctx, args as never), error: null };
      case "transfer_account_ownership":
        return { data: await transferAccountOwnership(ctx, args as never), error: null };
      case "peek_invitation":
        return { data: await peekInvitation(ctx, args as never), error: null };
      case "redeem_invitation":
        return { data: await redeemInvitation(ctx, args as never), error: null };
      case "touch_presence":
        return { data: await touchPresence(ctx, args as never), error: null };
      case "increment_flow_execution_count":
        return { data: await incrementFlowExecutionCount(ctx, args as never), error: null };
      case "increment_automation_execution_count":
        return { data: await incrementAutomationExecutionCount(ctx, args as never), error: null };
      case "filter_contacts_by_tags":
        return { data: await filterContactsByTags(ctx, args as never), error: null };
      case "match_ai_knowledge_fts":
        return { data: await matchAiKnowledgeFts(ctx, args as never), error: null };
      case "match_ai_knowledge_semantic":
        return { data: await matchAiKnowledgeSemantic(ctx, args as never), error: null };
      case "record_webhook_failure":
        return { data: await recordWebhookFailure(ctx, args as never), error: null };
      case "claim_ai_reply_slot":
        return { data: await claimAiReplySlot(ctx, args as never), error: null };
      case "create_broadcast_with_recipients":
        return { data: await createBroadcastWithRecipients(ctx, args as never), error: null };
      case "bump_conversation_on_inbound":
        return { data: await bumpConversationOnInbound(ctx, args as never), error: null };
      default:
        return {
          data: null,
          error: { message: `RPC ${name} not implemented in Mongo layer`, code: "22023" },
        };
    }
  } catch (err) {
    if (err instanceof RpcError) {
      return { data: null, error: { message: err.message, code: err.code } };
    }
    return {
      data: null,
      error: {
        message: String((err as Error).message ?? err),
        code: "500",
      },
    };
  }
}
