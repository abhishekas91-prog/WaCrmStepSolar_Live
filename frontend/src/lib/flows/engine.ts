/**
 * Flow runner.
 *
 * The single entry point `dispatchInboundToFlows` is called by the
 * WhatsApp webhook on every inbound message *for an account that has
 * opted into the Flows beta*. It decides whether the message belongs
 * to an active conversation flow (advance it) or matches the entry
 * trigger of an active flow (start a new run) — and reports back to
 * the webhook so the webhook knows whether to also fire automations.
 *
 * Architecture in a sentence: the runner walks the customer through
 * a DB-stored node graph, suspending only at nodes that need
 * customer input. Each tap or text reply wakes it back up.
 *
 * What lives here vs elsewhere:
 *   - Pure decision logic (which button matched, where to advance to,
 *     when to fallback) — here.
 *   - DB shape (table reads/writes) — here.
 *   - Meta API calls — `meta-send.ts` (engineSendInteractive*).
 *   - Policy resolution (reprompt vs handoff vs end) — `fallback.ts`.
 *   - Type definitions — `types.ts`.
 *
 * Concurrency model:
 *   - Idempotency on `meta_message_id`: the runner refuses to advance
 *     an active run twice for the same Meta message — protects against
 *     Meta's retries.
 *   - Optimistic UPDATE with `current_node_key` precondition: two
 *     simultaneous taps for the same run collide at the DB layer; the
 *     second is a no-op.
 *   - Partial unique index `idx_one_active_run_per_contact`: two
 *     simultaneous starts for the same contact collide; the second
 *     INSERT raises 23505 and the runner catches & exits.
 */

import { supabaseAdmin } from "./admin-client";
import {
  engineSendInteractiveButtons,
  engineSendInteractiveList,
  engineSendMedia,
  engineSendText,
} from "./meta-send";
import { decideFallback, resolveFallbackPolicy } from "./fallback";
import { addContactTagAndDispatch } from "@/lib/contacts/tag-events";
import { removeContactTag } from "@/lib/contacts/tag-write";
import { createCrmLead } from "@/lib/solar/crm-lookup";
import { getFlowTemplate, findTemplateNode } from "./templates";
import {
  type CollectInputNodeConfig,
  type ConditionNodeConfig,
  type CreateLeadNodeConfig,
  type DispatchInboundInput,
  type DispatchInboundResult,
  type FlowNodeRow,
  type FlowRow,
  type FlowRunRow,
  type ParsedInbound,
  type SendButtonsNodeConfig,
  type SendListNodeConfig,
  type SendMediaNodeConfig,
  type SendMessageNodeConfig,
  type SetTagNodeConfig,
  type StartNodeConfig,
  type KeywordTriggerConfig,
} from "./types";

// ============================================================
// Pure helpers — extracted so engine.test.ts can exercise them
// without a Supabase / Meta mock.
// ============================================================

/**
 * Given a node + the customer's reply_id, return the next_node_key
 * to advance to, or `null` if no option matches.
 */
export function matchReplyId(
  node: { node_type: string; config: Record<string, unknown> },
  reply_id: string,
  reply_title?: string,
): string | null {
  const normId = (reply_id ?? "").trim().toLowerCase();
  const normTitle = (reply_title ?? "").trim().toLowerCase();
  if (!normId && !normTitle) return null;

  if (node.node_type === "send_buttons") {
    const cfg = node.config as unknown as SendButtonsNodeConfig;
    for (const b of cfg.buttons ?? []) {
      const bId = (b.reply_id ?? "").trim().toLowerCase();
      const bTitle = (b.title ?? "").trim().toLowerCase();
      if (
        (normId && bId === normId) ||
        (normTitle && (bTitle === normTitle || bTitle.includes(normTitle) || normTitle.includes(bTitle))) ||
        (normId && (bTitle === normId || bTitle.includes(normId) || normId.includes(bTitle)))
      ) {
        return b.next_node_key;
      }
    }
    return null;
  }
  if (node.node_type === "send_list") {
    const cfg = node.config as unknown as SendListNodeConfig;
    for (const section of cfg.sections ?? []) {
      for (const r of section.rows ?? []) {
        const rId = (r.reply_id ?? "").trim().toLowerCase();
        const rTitle = (r.title ?? "").trim().toLowerCase();
        const rDesc = (r.description ?? "").trim().toLowerCase();
        if (
          (normId && rId === normId) ||
          (normTitle && (rTitle === normTitle || rTitle.includes(normTitle) || normTitle.includes(rTitle))) ||
          (normId && (rTitle === normId || rTitle.includes(normId) || normId.includes(rTitle) || (rDesc && rDesc.includes(normId))))
        ) {
          return r.next_node_key;
        }
      }
    }
    return null;
  }
  return null;
}

/**
 * Case-insensitive contains/exact match against a list of keywords.
 * Used by the trigger evaluator. Stable enough that the v3 builder
 * UI can preview matches by passing canned strings.
 */
export function matchesKeywordTrigger(
  text: string,
  cfg: KeywordTriggerConfig,
): boolean {
  if (!text || !cfg.keywords?.length) return false;
  const matchType = cfg.match_type ?? "contains";
  const haystack = cfg.case_sensitive ? text : text.toLowerCase();
  for (const raw of cfg.keywords) {
    if (!raw) continue;
    const needle = cfg.case_sensitive ? raw : raw.toLowerCase();
    if (matchType === "exact" ? haystack === needle : haystack.includes(needle)) {
      return true;
    }
  }
  return false;
}

/** Nodes that advance to a next_node_key without waiting for input. */
export function isAutoAdvancing(node_type: string): boolean {
  return (
    node_type === "start" ||
    node_type === "send_message" ||
    node_type === "send_media" ||
    node_type === "condition" ||
    node_type === "set_tag" ||
    node_type === "create_lead"
  );
}

/** Nodes that send a prompt and suspend awaiting a customer reply. */
export function isSuspending(node_type: string): boolean {
  return (
    node_type === "send_buttons" ||
    node_type === "send_list" ||
    node_type === "collect_input"
  );
}

/** Nodes that end the run. */
export function isTerminal(node_type: string): boolean {
  return node_type === "handoff" || node_type === "end";
}

/**
 * Evaluate a `condition` node's predicate against the current run
 * state. Exported pure for unit testing — the engine wraps it with a
 * DB lookup for `tag` / `contact_field` subjects.
 */
export function evaluateConditionPredicate(args: {
  operator: ConditionNodeConfig["operator"];
  /**
   * Resolved value of the subject. `undefined` means the subject is
   * absent (no var with that key / no such tag / contact field is
   * null). Pure function: caller does the DB lookup.
   */
  subjectValue: string | undefined;
  /** The configured comparison value, when applicable. */
  configValue: string | undefined;
}): boolean {
  switch (args.operator) {
    case "present":
      return args.subjectValue !== undefined && args.subjectValue !== "";
    case "absent":
      return args.subjectValue === undefined || args.subjectValue === "";
    case "equals":
      if (args.subjectValue === undefined) return false;
      return args.subjectValue === (args.configValue ?? "");
    case "contains":
      if (args.subjectValue === undefined) return false;
      return args.subjectValue.includes(args.configValue ?? "");
  }
}

// ============================================================
// DB I/O — wrapped in tiny helpers so the dispatch flow stays
// readable. Errors surface as thrown — the entry point catches.
// ============================================================

type AdminClient = ReturnType<typeof supabaseAdmin>;

async function loadActiveRunForContact(
  db: AdminClient,
  accountId: string,
  contactId: string,
): Promise<FlowRunRow | null> {
  // The partial unique index `idx_one_active_run_per_contact` was
  // rebuilt in migration 017 over `(account_id, contact_id)` — so
  // "two active runs for one contact in one account" is impossible
  // by design. But a future migration glitch or manual SQL could
  // create one, and .maybeSingle() throws on >1 row — which would
  // kill dispatch for that contact's webhook entirely. .limit(1) is
  // forgiving: pick the newest, let the cron sweep clean up the
  // stale one.
  const { data, error } = await db
    .from("flow_runs")
    .select("*")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[flows] loadActiveRunForContact error:", error.message);
    return null;
  }
  const rows = (data as FlowRunRow[] | null) ?? [];
  const run = rows[0] ?? null;
  if (run && (!run.vars || typeof run.vars !== "object")) {
    run.vars = {};
  }
  return run;
}

async function loadFlow(
  db: AdminClient,
  flowId: string,
): Promise<FlowRow | null> {
  const { data, error } = await db
    .from("flows")
    .select("*")
    .eq("id", flowId)
    .maybeSingle();
  if (error) {
    console.error("[flows] loadFlow error:", error.message);
    return null;
  }
  return (data as FlowRow | null) ?? null;
}

const LEGACY_SOLAR_FALLBACK_NODES: Array<{
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
}> = [
  {
    node_key: "create_lead_2kw",
    node_type: "create_lead",
    config: {
      full_name: "{{vars.name}}",
      email: "{{vars.email}}",
      state: "Uttar Pradesh",
      city: "{{vars.city}}",
      pincode: "{{vars.pincode}}",
      property_type: "Residential",
      monthly_bill: "1500",
      roof_type: "RCC",
      timeline: "Not decided",
      source: "whatsapp_flow",
      next_node_key: "quote_2kw",
    },
  },
  {
    node_key: "create_lead_3kw",
    node_type: "create_lead",
    config: {
      full_name: "{{vars.name}}",
      email: "{{vars.email}}",
      state: "Uttar Pradesh",
      city: "{{vars.city}}",
      pincode: "{{vars.pincode}}",
      property_type: "Residential",
      monthly_bill: "2500",
      roof_type: "RCC",
      timeline: "Not decided",
      source: "whatsapp_flow",
      next_node_key: "quote_3kw",
    },
  },
  {
    node_key: "create_lead_5kw",
    node_type: "create_lead",
    config: {
      full_name: "{{vars.name}}",
      email: "{{vars.email}}",
      state: "Uttar Pradesh",
      city: "{{vars.city}}",
      pincode: "{{vars.pincode}}",
      property_type: "Residential",
      monthly_bill: "4000",
      roof_type: "RCC",
      timeline: "Not decided",
      source: "whatsapp_flow",
      next_node_key: "quote_5kw",
    },
  },
  {
    node_key: "create_lead_75kw",
    node_type: "create_lead",
    config: {
      full_name: "{{vars.name}}",
      email: "{{vars.email}}",
      state: "Uttar Pradesh",
      city: "{{vars.city}}",
      pincode: "{{vars.pincode}}",
      property_type: "Residential",
      monthly_bill: "5000",
      roof_type: "RCC",
      timeline: "Not decided",
      source: "whatsapp_flow",
      next_node_key: "quote_75kw",
    },
  },
  {
    node_key: "quote_2kw",
    node_type: "send_message",
    config: {
      text: "Namaste!\nAapke monthly bill ke hisaab se hum recommend karte hain:\n*Recommended System: 2 kW On-Grid*",
      next_node_key: "after_quote",
    },
  },
  {
    node_key: "quote_3kw",
    node_type: "send_message",
    config: {
      text: "Namaste!\nAapke monthly bill ke hisaab se hum recommend karte hain:\n*Recommended System: 3 kW On-Grid*",
      next_node_key: "after_quote",
    },
  },
  {
    node_key: "quote_5kw",
    node_type: "send_message",
    config: {
      text: "Namaste!\nAapke monthly bill ke hisaab se hum recommend karte hain:\n*Recommended System: 5 kW On-Grid*",
      next_node_key: "after_quote",
    },
  },
  {
    node_key: "quote_75kw",
    node_type: "send_message",
    config: {
      text: "Namaste!\nAapke monthly bill ke hisaab se hum recommend karte hain:\n*Recommended System: 7.5 kW On-Grid*",
      next_node_key: "after_quote",
    },
  },
];

/**
 * Load every node of a flow in one round trip and key them by
 * `node_key`. The advance loop is then in-memory — a 5-node
 * auto-advancing chain costs one SELECT, not five.
 *
 * Returns an empty map on error so the caller can still dispatch
 * cleanly (every subsequent .get() returns undefined → the run
 * fails with node_not_found, same as the old per-node lookup).
 */
async function loadAllNodes(
  db: AdminClient,
  flowId: string,
): Promise<Map<string, FlowNodeRow>> {
  const { data, error } = await db
    .from("flow_nodes")
    .select("*")
    .eq("flow_id", flowId);
  if (error) {
    console.error("[flows] loadAllNodes error:", error.message);
    return new Map();
  }
  const map = new Map<string, FlowNodeRow>();
  for (const row of (data ?? []) as FlowNodeRow[]) {
    map.set(row.node_key, row);
  }

  // If this flow relates to solar or quotes, ensure all standard solar nodes exist
  // so existing active flows never hit node_not_found on newly introduced quote steps.
  const { data: flow } = await db
    .from("flows")
    .select("name, trigger_type, trigger_config")
    .eq("id", flowId)
    .maybeSingle();
  const flowName = (flow as { name?: string } | null)?.name?.toLowerCase() ?? "";
  const isSolarOrQuote =
    flowName.includes("solar") ||
    flowName.includes("quote") ||
    flowName.includes("quotation") ||
    flowName.includes("enquiry") ||
    flowName.includes("assistant") ||
    flowName.includes("bijli") ||
    map.has("welcome") ||
    map.has("ask_name") ||
    map.has("ask_phone") ||
    map.has("check_lead_info");

  if (isSolarOrQuote) {
    const templates = [
      getFlowTemplate("solar_quote_flow"),
      getFlowTemplate("solar_assistant"),
    ];
    for (const template of templates) {
      if (!template) continue;
      for (const tNode of template.nodes) {
        if (!map.has(tNode.node_key)) {
          map.set(tNode.node_key, {
            id: `template-${tNode.node_key}`,
            flow_id: flowId,
            node_key: tNode.node_key,
            node_type: tNode.node_type as any,
            config: tNode.config as Record<string, unknown>,
            position_x: 0,
            position_y: 0,
            created_at: new Date().toISOString(),
          });
        }
      }
    }

    for (const legNode of LEGACY_SOLAR_FALLBACK_NODES) {
      if (!map.has(legNode.node_key)) {
        map.set(legNode.node_key, {
          id: `legacy-${legNode.node_key}`,
          flow_id: flowId,
          node_key: legNode.node_key,
          node_type: legNode.node_type as any,
          config: legNode.config,
          position_x: 0,
          position_y: 0,
          created_at: new Date().toISOString(),
        });
      }
    }
  }

  // Cross-reference safety: For every node currently in map, if its edges point to missing nodes,
  // find them in any template and add them so runs never stall on missing edges.
  for (const [, node] of Array.from(map.entries())) {
    const cfg = node.config as Record<string, unknown>;
    const targetKeys: string[] = [];
    if (typeof cfg.next_node_key === "string") targetKeys.push(cfg.next_node_key);
    if (typeof cfg.true_next === "string") targetKeys.push(cfg.true_next);
    if (typeof cfg.false_next === "string") targetKeys.push(cfg.false_next);
    if (Array.isArray(cfg.buttons)) {
      for (const b of cfg.buttons as Array<{ next_node_key?: string }>) {
        if (typeof b?.next_node_key === "string") targetKeys.push(b.next_node_key);
      }
    }
    if (Array.isArray(cfg.sections)) {
      for (const s of cfg.sections as Array<{ rows?: Array<{ next_node_key?: string }> }>) {
        for (const r of s?.rows ?? []) {
          if (typeof r?.next_node_key === "string") targetKeys.push(r.next_node_key);
        }
      }
    }

    for (const targetKey of targetKeys) {
      if (targetKey && !map.has(targetKey)) {
        const tNode =
          findTemplateNode(targetKey) ??
          LEGACY_SOLAR_FALLBACK_NODES.find((n) => n.node_key === targetKey);
        if (tNode) {
          map.set(targetKey, {
            id: `template-${targetKey}`,
            flow_id: flowId,
            node_key: targetKey,
            node_type: tNode.node_type as any,
            config: tNode.config as Record<string, unknown>,
            position_x: 0,
            position_y: 0,
            created_at: new Date().toISOString(),
          });
        }
      }
    }
  }

  return map;
}

async function logEvent(
  db: AdminClient,
  flowRunId: string,
  event_type:
    | "started"
    | "node_entered"
    | "message_sent"
    | "reply_received"
    | "fallback_fired"
    | "handoff"
    | "timeout"
    | "error"
    | "completed",
  node_key: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await db.from("flow_run_events").insert({
    flow_run_id: flowRunId,
    event_type,
    node_key,
    payload,
  });
  if (error) {
    // Logging failure is non-fatal — surface but don't throw.
    console.error("[flows] logEvent error:", error.message);
  }
}

/**
 * Idempotency check — has a `reply_received` event with this Meta
 * message_id already been recorded for any of the contact's flow
 * runs? If yes, the inbound is a duplicate (Meta retry) and we
 * exit without re-advancing.
 *
 * Implementation note: scoped to runs belonging to this user/contact
 * so the lookup is cheap (the index on flow_run_events(flow_run_id,
 * event_type) plus the small set of runs per contact).
 */
async function isDuplicateInbound(
  db: AdminClient,
  accountId: string,
  contactId: string,
  metaMessageId: string,
): Promise<boolean> {
  // Fetch ALL run ids for this contact in this account (active +
  // historical). Bounded by how many flows the customer has been
  // through — small.
  const { data: runs } = await db
    .from("flow_runs")
    .select("id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId);
  if (!runs?.length) return false;
  const runIds = runs.map((r: any) => (r as { id: string }).id);

  const { count } = await db
    .from("flow_run_events")
    .select("id", { count: "exact", head: true })
    .in("flow_run_id", runIds)
    .eq("event_type", "reply_received")
    .filter("payload.meta_message_id", "eq", metaMessageId);
  return (count ?? 0) > 0;
}

async function findEntryFlow(
  db: AdminClient,
  accountId: string,
  message: ParsedInbound,
  isFirstInbound: boolean,
): Promise<FlowRow | null> {
  // Only text messages can match an entry trigger. Interactive replies
  // are responses to existing prompts; they never start a new flow.
  if (message.kind !== "text") return null;
  const rawText = message.text.trim();
  if (!rawText) return null;

  // 1. Fetch all flows for this account (active and draft)
  const { data: flows, error } = await db
    .from("flows")
    .select("*")
    .eq("account_id", accountId)
    .in("status", ["active", "draft"])
    .order("created_at", { ascending: true });

  const typed = (flows as FlowRow[] | null) ?? [];

  // Check active flows first with keyword trigger
  const activeFlows = typed.filter((f) => f.status === "active");
  for (const flow of activeFlows) {
    if (flow.trigger_type === "keyword") {
      if (
        matchesKeywordTrigger(
          rawText,
          flow.trigger_config as KeywordTriggerConfig,
        )
      ) {
        return flow;
      }
    } else if (flow.trigger_type === "first_inbound_message" && isFirstInbound) {
      return flow;
    }
  }

  // Check draft flows for this account. If the user created or edited a flow,
  // auto-activate it so the user can immediately test it via WhatsApp!
  const draftFlows = typed.filter((f) => f.status === "draft");
  for (const flow of draftFlows) {
    if (flow.trigger_type === "keyword") {
      if (
        matchesKeywordTrigger(
          rawText,
          flow.trigger_config as KeywordTriggerConfig,
        )
      ) {
        console.info(
          `[flows] Auto-activating draft flow "${flow.name}" (${flow.id}) matching keyword "${rawText}"`,
        );
        await db
          .from("flows")
          .update({ status: "active", updated_at: new Date().toISOString() })
          .eq("id", flow.id);
        flow.status = "active";
        return flow;
      }
    }
  }

  // Check if inbound text expresses intent for a solar quote or solar in general
  const lower = rawText.toLowerCase();
  const isQuoteIntent =
    /^(?:quote|quotation|price|rate|cost|daam|enquiry|estimate|kavach|solar\s*quote|quote\s*chahiye|naya\s*quote|new\s*quote|bijli\s*bill)(?:[\s,!?.]*)$/i.test(
      rawText,
    ) ||
    lower.includes("quote") ||
    lower.includes("quotation") ||
    lower.includes("price") ||
    lower.includes("rate") ||
    lower.includes("cost") ||
    lower.includes("daam") ||
    lower.includes("enquiry");

  const isSolarIntent =
    isQuoteIntent ||
    /^(?:solar|surya|rooftop|panel|subsidy|सौर|सूर्य|रूफटॉप|सब्सिडी|pannel|inverter)(?:[\s,!?.]*)$/i.test(
      rawText,
    ) ||
    lower.includes("solar") ||
    lower.includes("panel") ||
    lower.includes("subsidy");

  if (isQuoteIntent || isSolarIntent) {
    // If the customer specifically asked for a quote, look for a quotation flow in DB
    if (isQuoteIntent) {
      const quoteFlow = typed.find(
        (f) =>
          f.name?.toLowerCase().includes("quote") ||
          f.name?.toLowerCase().includes("quotation"),
      );
      if (quoteFlow) {
        if (quoteFlow.status !== "active") {
          await db
            .from("flows")
            .update({ status: "active", updated_at: new Date().toISOString() })
            .eq("id", quoteFlow.id);
          quoteFlow.status = "active";
        }
        return quoteFlow;
      }
    }

    // Look for any solar flow in DB
    const solarFlow = typed.find(
      (f) =>
        f.name?.toLowerCase().includes("solar") ||
        f.name?.toLowerCase().includes("assistant"),
    );
    if (solarFlow) {
      if (solarFlow.status !== "active") {
        await db
          .from("flows")
          .update({ status: "active", updated_at: new Date().toISOString() })
          .eq("id", solarFlow.id);
        solarFlow.status = "active";
      }
      return solarFlow;
    }

    // Fallback: auto-seed the template into the database for this account
    const targetSlug = isQuoteIntent ? "solar_quote_flow" : "solar_assistant";
    const template = getFlowTemplate(targetSlug);
    if (template) {
      const { data: cfg } = await db
        .from("whatsapp_config")
        .select("user_id")
        .eq("account_id", accountId)
        .limit(1)
        .maybeSingle();
      const userId = (cfg as { user_id?: string } | null)?.user_id;
      if (userId) {
        console.info(
          `[flows] Auto-seeding template "${targetSlug}" for account ${accountId}`,
        );
        const { data: createdFlow } = await db
          .from("flows")
          .insert({
            user_id: userId,
            account_id: accountId,
            name: template.name,
            description: template.description,
            status: "active",
            trigger_type: template.trigger_type,
            trigger_config: template.trigger_config,
            entry_node_id: template.entry_node_id,
          })
          .select()
          .maybeSingle();

        if (createdFlow) {
          if (template.nodes.length > 0) {
            await db.from("flow_nodes").insert(
              template.nodes.map((n) => ({
                flow_id: (createdFlow as any).id,
                node_key: n.node_key,
                node_type: n.node_type,
                config: n.config,
              })),
            );
          }
          return createdFlow as FlowRow;
        }
      }
    }
  }

  return null;
}

// ============================================================
// Node executors — each handles ONE node type. send_buttons and
// send_list also persist `last_prompt_message_id` so the inbox
// thread can quote the prompt the customer is replying to.
// ============================================================

async function sendButtonsAndSuspend(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
): Promise<{ outcome: "advanced"; node_key: string }> {
  const cfg = node.config as unknown as SendButtonsNodeConfig;
  const { whatsapp_message_id } = await engineSendInteractiveButtons({
    accountId: run.account_id,
    userId: run.user_id,
    conversationId: run.conversation_id!,
    contactId: run.contact_id!,
    bodyText: cfg.text,
    headerText: cfg.header_text,
    footerText: cfg.footer_text,
    buttons: cfg.buttons.map((b) => ({ id: b.reply_id, title: b.title })),
  });
  await logEvent(db, run.id, "message_sent", node.node_key, {
    node_type: "send_buttons",
    whatsapp_message_id,
  });
  // Look up our internal message id so we can stash it on the run.
  // Cheap — indexed on `messages.message_id`.
  const { data: msg } = await db
    .from("messages")
    .select("id")
    .eq("message_id", whatsapp_message_id)
    .maybeSingle();
  await db
    .from("flow_runs")
    .update({
      last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
    })
    .eq("id", run.id);
  return { outcome: "advanced", node_key: node.node_key };
}

async function sendListAndSuspend(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
): Promise<{ outcome: "advanced"; node_key: string }> {
  const cfg = node.config as unknown as SendListNodeConfig;
  const { whatsapp_message_id } = await engineSendInteractiveList({
    accountId: run.account_id,
    userId: run.user_id,
    conversationId: run.conversation_id!,
    contactId: run.contact_id!,
    bodyText: cfg.text,
    buttonLabel: cfg.button_label,
    headerText: cfg.header_text,
    footerText: cfg.footer_text,
    sections: cfg.sections.map((s) => ({
      title: s.title,
      rows: s.rows.map((r) => ({
        id: r.reply_id,
        title: r.title,
        description: r.description,
      })),
    })),
  });
  await logEvent(db, run.id, "message_sent", node.node_key, {
    node_type: "send_list",
    whatsapp_message_id,
  });
  const { data: msg } = await db
    .from("messages")
    .select("id")
    .eq("message_id", whatsapp_message_id)
    .maybeSingle();
  await db
    .from("flow_runs")
    .update({
      last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
    })
    .eq("id", run.id);
  return { outcome: "advanced", node_key: node.node_key };
}

async function executeHandoff(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
): Promise<void> {
  const cfg = node.config as { assign_to?: string; note?: string };
  const convUpdate: Record<string, unknown> = {
    status: "pending",
    updated_at: new Date().toISOString(),
  };
  if (cfg.assign_to) convUpdate.assigned_agent_id = cfg.assign_to;
  if (run.conversation_id) {
    await db
      .from("conversations")
      .update(convUpdate)
      .eq("id", run.conversation_id);
  }
  await logEvent(db, run.id, "handoff", node.node_key, {
    note: cfg.note ?? null,
    assigned_to: cfg.assign_to ?? null,
  });
  await endRun(db, run.id, "handed_off", "handoff_node");
}

/**
 * Resolve a condition node's subject value from DB / run state, then
 * call the pure `evaluateConditionPredicate`. Splits out so the
 * predicate itself stays unit-testable without a Supabase mock.
 *
 * Subject sources:
 *   - `var` → `flow_runs.vars[subject_key]` (captured by collect_input
 *     or http_fetch in v2).
 *   - `tag` → present iff `contact_tags(contact_id, tag_id)` exists.
 *     `subject_key` IS the tag UUID; the SELECT returns 1 row or 0.
 *   - `contact_field` → one of name/email/phone/company on `contacts`.
 */
export async function evaluateConditionNode(
  db: AdminClient,
  run: FlowRunRow,
  cfg: ConditionNodeConfig,
): Promise<boolean> {
  let subjectValue: string | undefined;
  if (cfg.subject === "var") {
    const vars = run.vars ?? {};
    const v = vars[cfg.subject_key];
    subjectValue = typeof v === "string" ? v : v === undefined ? undefined : String(v);
  } else if (cfg.subject === "tag") {
    const { count } = await db
      .from("contact_tags")
      .select("contact_id", { count: "exact", head: true })
      .eq("contact_id", run.contact_id!)
      .eq("tag_id", cfg.subject_key);
    // For tags, "present" really is the only meaningful test — the
    // `present`/`absent` operators are the natural fit. equals/contains
    // against a tag UUID would still work mechanically (compare its
    // existence to the value).
    subjectValue = (count ?? 0) > 0 ? cfg.subject_key : undefined;
  } else {
    const ALLOWED = ["name", "email", "phone", "company"] as const;
    type AllowedField = (typeof ALLOWED)[number];
    if (!ALLOWED.includes(cfg.subject_key as AllowedField)) {
      throw new Error(`unsupported contact_field: ${cfg.subject_key}`);
    }
    const { data } = await db
      .from("contacts")
      .select(cfg.subject_key)
      .eq("id", run.contact_id!)
      .maybeSingle();
    const raw = (data as Record<string, unknown> | null)?.[cfg.subject_key];
    subjectValue = typeof raw === "string" && raw.length > 0 ? raw : undefined;
  }
  return evaluateConditionPredicate({
    operator: cfg.operator,
    subjectValue,
    configValue: cfg.value,
  });
}

/**
 * Tiny `{{vars.foo}}` interpolation. Used by send_message + collect_input
 * prompt text so a captured `name` can show up in the next prompt
 * ("Thanks {{vars.name}}, what's your email?"). Missing vars render as
 * empty string — the same behavior as the automations engine.
 */
export function interpolateVars(template: string, vars?: Record<string, unknown> | null): string {
  if (!template) return "";
  const vMap = vars ?? {};
  return template.replace(/\{\{vars\.([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    const v = vMap[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

async function endRun(
  db: AdminClient,
  runId: string,
  status: "completed" | "handed_off" | "timed_out" | "failed",
  reason: string,
): Promise<void> {
  await db
    .from("flow_runs")
    .update({
      status,
      ended_at: new Date().toISOString(),
      end_reason: reason,
    })
    .eq("id", runId);
}

// ============================================================
// The synchronous advance loop. Walks through auto-advance nodes
// until it hits one that suspends (send_buttons/send_list) or
// terminates (handoff/end). Each suspending node persists the
// new current_node_key before returning.
// ============================================================

async function advanceFromNodeKey(
  db: AdminClient,
  run: FlowRunRow,
  startNodeKey: string,
  nodes: Map<string, FlowNodeRow>,
): Promise<{ outcome: "advanced" | "completed" | "handed_off" }> {
  if (!run.vars || typeof run.vars !== "object") {
    run.vars = {};
  }
  let currentKey: string | null = startNodeKey;
  // Defensive cap — if a flow has a cycle (which the validator
  // SHOULD catch but doesn't yet in v1), we bail rather than loop.
  for (let safety = 0; safety < 64; safety += 1) {
    if (!currentKey) {
      await logEvent(db, run.id, "error", null, {
        reason: "next_node_key was null mid-advance",
      });
      await endRun(db, run.id, "failed", "missing_next_node");
      return { outcome: "completed" };
    }
    let node: FlowNodeRow | null = nodes.get(currentKey) ?? null;
    if (!node) {
      const tNode =
        findTemplateNode(currentKey) ??
        LEGACY_SOLAR_FALLBACK_NODES.find((n) => n.node_key === currentKey);
      if (tNode) {
        node = {
          id: `template-${currentKey}`,
          flow_id: run.flow_id,
          node_key: currentKey,
          node_type: tNode.node_type as any,
          config: tNode.config as Record<string, unknown>,
          position_x: 0,
          position_y: 0,
          created_at: new Date().toISOString(),
        };
        nodes.set(currentKey, node);
        console.warn(
          `[flows] Auto-recovered missing node "${currentKey}" for flow "${run.flow_id}" from template fallback`,
        );
      }
    }
    if (!node) {
      console.error(
        `[flows] node_not_found: key="${currentKey}", flow="${run.flow_id}", current_node_key="${run.current_node_key}"`,
      );
      await logEvent(db, run.id, "error", currentKey, {
        reason: "node_not_found",
      });
      await endRun(db, run.id, "failed", "node_not_found");
      return { outcome: "completed" };
    }
    await logEvent(db, run.id, "node_entered", node.node_key, {
      node_type: node.node_type,
    });

    if (node.node_type === "start") {
      currentKey = (node.config as unknown as StartNodeConfig).next_node_key;
      continue;
    }
    if (node.node_type === "send_message") {
      const cfg = node.config as unknown as SendMessageNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendText({
          accountId: run.account_id,
    userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateVars(cfg.text, run.vars),
        });
        await logEvent(db, run.id, "message_sent", node.node_key, {
          node_type: "send_message",
          whatsapp_message_id,
        });
      } catch (err) {
        console.error(`[flows] send_message failed for node ${node.node_key}, run ${run.id}:`, err);
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "send_text_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "send_text_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "send_media") {
      const cfg = node.config as unknown as SendMediaNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendMedia({
          accountId: run.account_id,
    userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          kind: cfg.media_type,
          link: cfg.media_url,
          caption: cfg.caption
            ? interpolateVars(cfg.caption, run.vars)
            : undefined,
          filename: cfg.filename,
        });
        await logEvent(db, run.id, "message_sent", node.node_key, {
          node_type: "send_media",
          media_type: cfg.media_type,
          whatsapp_message_id,
        });
      } catch (err) {
        console.error(`[flows] send_media failed for node ${node.node_key}, run ${run.id}:`, err);
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "send_media_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "send_media_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "collect_input") {
      // Send the prompt and suspend. Customer's next TEXT reply will
      // wake us up via handleReplyForActiveRun's collect_input branch.
      const cfg = node.config as unknown as CollectInputNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendText({
          accountId: run.account_id,
    userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateVars(cfg.prompt_text, run.vars),
        });
        await logEvent(db, run.id, "message_sent", node.node_key, {
          node_type: "collect_input",
          whatsapp_message_id,
        });
        const { data: msg } = await db
          .from("messages")
          .select("id")
          .eq("message_id", whatsapp_message_id)
          .maybeSingle();
        await db
          .from("flow_runs")
          .update({
            last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
          })
          .eq("id", run.id);
      } catch (err) {
        console.error(`[flows] collect_input prompt failed for node ${node.node_key}, run ${run.id}:`, err);
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "collect_input_prompt_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "collect_input_prompt_failed");
        return { outcome: "completed" };
      }
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (advanced) {
        run.current_node_key = node.node_key;
      } else {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "condition") {
      const cfg = node.config as unknown as ConditionNodeConfig;
      let branch: "true" | "false";
      try {
        branch = (await evaluateConditionNode(db, run, cfg))
          ? "true"
          : "false";
      } catch (err) {
        console.error(`[flows] condition evaluation failed for node ${node.node_key}, run ${run.id}:`, err);
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "condition_evaluation_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "condition_evaluation_failed");
        return { outcome: "completed" };
      }
      currentKey =
        branch === "true" ? cfg.true_next : cfg.false_next;
      await logEvent(db, run.id, "node_entered", node.node_key, {
        condition_result: branch,
        advancing_to: currentKey,
      });
      continue;
    }
    if (node.node_type === "set_tag") {
      const cfg = node.config as unknown as SetTagNodeConfig;
      try {
        if (cfg.mode === "add") {
          await addContactTagAndDispatch({
            db,
            accountId: run.account_id,
            contactId: run.contact_id!,
            tagId: cfg.tag_id,
            context: {
              conversation_id: run.conversation_id ?? undefined,
              vars: run.vars,
            },
          });
        } else {
          await removeContactTag(db, {
            accountId: run.account_id,
            contactId: run.contact_id!,
            tagId: cfg.tag_id,
          });
        }
      } catch (err) {
        // Non-fatal — log + advance. A tag-write failure shouldn't
        // strand the customer mid-flow.
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "set_tag_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "create_lead") {
      const cfg = node.config as unknown as CreateLeadNodeConfig;
      try {
        const { data: contact } = await db
          .from("contacts")
          .select("phone")
          .eq("id", run.contact_id!)
          .eq("account_id", run.account_id)
          .maybeSingle();
        const varPhone =
          typeof run.vars?.phone === "string"
            ? run.vars.phone.replace(/\D/g, "").slice(-10)
            : "";
        const contactPhone =
          typeof contact?.phone === "string" ? contact.phone.slice(-10) : "";
        const phone10 = varPhone || contactPhone;
        const parsedBill = parseInt(
          interpolateVars(cfg.monthly_bill, run.vars),
          10,
        );
        const result = await createCrmLead({
          full_name: interpolateVars(cfg.full_name, run.vars),
          phone: phone10,
          email: interpolateVars(cfg.email, run.vars),
          state: interpolateVars(cfg.state, run.vars),
          city: interpolateVars(cfg.city, run.vars),
          pincode: interpolateVars(cfg.pincode, run.vars),
          property_type: interpolateVars(cfg.property_type, run.vars),
          monthly_bill: Number.isFinite(parsedBill) ? parsedBill : 0,
          roof_type: interpolateVars(cfg.roof_type, run.vars),
          timeline: interpolateVars(cfg.timeline, run.vars),
          source: cfg.source,
        });
        if (!result) {
          // Non-fatal — same reasoning as set_tag below: a lead-sync
          // hiccup (missing field, duplicate, CRM downtime) shouldn't
          // strand the customer mid-conversation.
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "create_lead_failed",
          });
        } else {
          await logEvent(db, run.id, "node_entered", node.node_key, {
            lead_id: result.id,
            lead_code: result.code,
          });
        }
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "create_lead_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "send_buttons") {
      try {
        await sendButtonsAndSuspend(db, run, node);
      } catch (err) {
        console.error(`[flows] sendButtonsAndSuspend failed for node ${node.node_key}, run ${run.id}:`, err);
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "send_buttons_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "send_buttons_failed");
        return { outcome: "completed" };
      }
      // Persist the new current_node_key via optimistic UPDATE.
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (advanced) {
        run.current_node_key = node.node_key;
      } else {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "send_list") {
      try {
        await sendListAndSuspend(db, run, node);
      } catch (err) {
        console.error(`[flows] sendListAndSuspend failed for node ${node.node_key}, run ${run.id}:`, err);
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "send_list_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "send_list_failed");
        return { outcome: "completed" };
      }
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (advanced) {
        run.current_node_key = node.node_key;
      } else {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "handoff") {
      await executeHandoff(db, run, node);
      return { outcome: "handed_off" };
    }
    if (node.node_type === "end") {
      await logEvent(db, run.id, "completed", node.node_key);
      await endRun(db, run.id, "completed", "end_node");
      return { outcome: "completed" };
    }
    // Unknown node type — shouldn't happen given the CHECK constraint.
    await logEvent(db, run.id, "error", node.node_key, {
      reason: `unknown_node_type:${node.node_type}`,
    });
    await endRun(db, run.id, "failed", "unknown_node_type");
    return { outcome: "completed" };
  }
  // Safety break — log + fail.
  await logEvent(db, run.id, "error", currentKey, {
    reason: "advance_loop_safety_break",
  });
  await endRun(db, run.id, "failed", "advance_loop_overflow");
  return { outcome: "completed" };
}

/**
 * Directly update current_node_key on the active run so the pointer
 * never gets desynchronized or stuck on optimistic mismatches.
 */
async function advanceCurrentNodeKey(
  db: AdminClient,
  runId: string,
  _expectedOldKey: string | null,
  newKey: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("flow_runs")
    .update({
      current_node_key: newKey,
      last_advanced_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("status", "active")
    .select("id");
  if (error) {
    console.error("[flows] advanceCurrentNodeKey error:", error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

// ============================================================
// Public entry point — the webhook calls this on every inbound.
// ============================================================

export async function dispatchInboundToFlows(
  input: DispatchInboundInput & { isFirstInboundMessage: boolean },
): Promise<DispatchInboundResult> {
  const db = supabaseAdmin();
  try {
    const activeRun = await loadActiveRunForContact(
      db,
      input.accountId,
      input.contactId,
    );

    // Idempotency — only matters if there's already a run for this
    // contact. For new runs, the partial unique index catches duplicate
    // starts at INSERT time.
    if (activeRun) {
      const dupe = await isDuplicateInbound(
        db,
        input.accountId,
        input.contactId,
        input.message.meta_message_id,
      );
      if (dupe) {
        return {
          consumed: true,
          flow_run_id: activeRun.id,
          outcome: "duplicate_inbound_ignored",
        };
      }

      const rawText = input.message.kind === "text" ? input.message.text.trim() : "";
      const isGreeting =
        input.message.kind === "text" &&
        /^(?:hi|hello|hey|hii|helo|namaste|नमस्ते|हेलो)(?:[\s,!?.]*)$/i.test(rawText);
      const isExplicitRestart =
        input.message.kind === "text" &&
        (/^(?:solar|start|restart|reset|flow|shuru|quote|quotation|price|rate|cost|daam|enquiry|estimate|kavach|solar\s*quote|quote\s*chahiye|naya\s*quote|new\s*quote|bijli\s*bill)(?:[\s,!?.]*)$/i.test(
          rawText,
        ) ||
          ((rawText.toLowerCase().includes("quote") ||
            rawText.toLowerCase().includes("quotation") ||
            rawText.toLowerCase().includes("price") ||
            rawText.toLowerCase().includes("rate")) &&
            activeRun.current_node_key !== "ask_name"));

      const lastActiveTime = activeRun.last_advanced_at
        ? new Date(activeRun.last_advanced_at).getTime()
        : activeRun.started_at
          ? new Date(activeRun.started_at).getTime()
          : 0;
      const isStale = lastActiveTime > 0 && Date.now() - lastActiveTime > 15 * 60 * 1000;

      if (isExplicitRestart || isStale) {
        await endRun(
          db,
          activeRun.id,
          "completed",
          isExplicitRestart ? "restarted_by_user" : "stale_run_cleared",
        );
        // Fall through to findEntryFlow below so the customer starts fresh!
      } else if (isGreeting) {
        // Do NOT swallow the greeting! Re-prompt customer based on active node.
        const nodes = await loadAllNodes(db, activeRun.flow_id);
        const currentNode = activeRun.current_node_key
          ? nodes.get(activeRun.current_node_key)
          : null;
        if (currentNode) {
          if (currentNode.node_type === "send_buttons") {
            try {
              await sendButtonsAndSuspend(db, activeRun, currentNode);
              return {
                consumed: true,
                flow_run_id: activeRun.id,
                outcome: "fallback_fired",
              };
            } catch (err) {
              console.error("[flows] greeting reprompt sendButtons failed:", err);
            }
          } else if (currentNode.node_type === "send_list") {
            try {
              await sendListAndSuspend(db, activeRun, currentNode);
              return {
                consumed: true,
                flow_run_id: activeRun.id,
                outcome: "fallback_fired",
              };
            } catch (err) {
              console.error("[flows] greeting reprompt sendList failed:", err);
            }
          } else if (currentNode.node_type === "collect_input") {
            const cfg = currentNode.config as unknown as CollectInputNodeConfig;
            try {
              await engineSendText({
                accountId: activeRun.account_id,
                userId: activeRun.user_id,
                conversationId: activeRun.conversation_id!,
                contactId: activeRun.contact_id!,
                text: interpolateVars(cfg.prompt_text, activeRun.vars),
              });
              return {
                consumed: true,
                flow_run_id: activeRun.id,
                outcome: "fallback_fired",
              };
            } catch (err) {
              console.error("[flows] greeting reprompt collectInput failed:", err);
            }
          }
        }
        // If current node could not re-prompt, clear the run and fall through to entry
        await endRun(db, activeRun.id, "completed", "invalid_node_on_greeting");
      } else {
        // One SELECT for the whole flow's nodes — advance loop is now
        // in-memory. See loadAllNodes.
        const nodes = await loadAllNodes(db, activeRun.flow_id);
        return handleReplyForActiveRun(db, activeRun, input.message, nodes);
      }
    }

    // No active run → look for a flow whose entry trigger matches.
    const flow = await findEntryFlow(
      db,
      input.accountId,
      input.message,
      input.isFirstInboundMessage,
    );
    if (!flow || !flow.entry_node_id) {
      return { consumed: false, outcome: "no_match" };
    }
    const nodes = await loadAllNodes(db, flow.id);
    return startNewRun(db, flow, input, nodes);
  } catch (err) {
    console.error(
      "[flows] dispatchInboundToFlows threw:",
      err instanceof Error ? err.message : err,
    );
    return { consumed: false, outcome: "no_match" };
  }
}

async function handleReplyForActiveRun(
  db: AdminClient,
  run: FlowRunRow,
  message: ParsedInbound,
  nodes: Map<string, FlowNodeRow>,
): Promise<DispatchInboundResult> {
  if (!run.vars || typeof run.vars !== "object") {
    run.vars = {};
  }
  if (typeof run.reprompt_count !== "number") {
    run.reprompt_count = 0;
  }

  // Note: we intentionally do NOT persist the raw customer text. A
  // `collect_input` prompt that asks "what's your card number?" would
  // otherwise leave the PAN sitting in flow_run_events.payload forever,
  // visible to anyone with access to the runs viewer or the events
  // table. Length is enough for "did they actually reply?" debugging;
  // for the captured value itself, the `node_entered` event already
  // records `captured_key` + `captured_length` after the var is stored.
  await logEvent(db, run.id, "reply_received", run.current_node_key, {
    meta_message_id: message.meta_message_id,
    reply_kind: message.kind,
    reply_id: message.kind === "interactive_reply" ? message.reply_id : null,
    text_length: message.kind === "text" ? message.text.length : null,
  });

  if (!run.current_node_key) {
    // Defensive — a run with status='active' but no current node is
    // malformed. Fail the run rather than spin.
    await endRun(db, run.id, "failed", "active_run_missing_current_node");
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: "no_match",
    };
  }

  let currentNode = nodes.get(run.current_node_key) ?? null;
  if (!currentNode) {
    const tNode =
      findTemplateNode(run.current_node_key) ??
      LEGACY_SOLAR_FALLBACK_NODES.find((n) => n.node_key === run.current_node_key);
    if (tNode) {
      currentNode = {
        id: `template-${run.current_node_key}`,
        flow_id: run.flow_id,
        node_key: run.current_node_key,
        node_type: tNode.node_type as any,
        config: tNode.config as Record<string, unknown>,
        position_x: 0,
        position_y: 0,
        created_at: new Date().toISOString(),
      };
      nodes.set(run.current_node_key, currentNode);
      console.warn(
        `[flows] Auto-recovered missing currentNode "${run.current_node_key}" for run "${run.id}"`,
      );
    }
  }
  if (!currentNode) {
    console.error(
      `[flows] current_node_not_found: run=${run.id}, key=${run.current_node_key}`,
    );
    await endRun(db, run.id, "failed", "current_node_not_found");
    return { consumed: true, flow_run_id: run.id, outcome: "no_match" };
  }

  // Two ways a reply can advance:
  //   1. Interactive button/list tap or matching text on a send_buttons/send_list node.
  //   2. Text reply on a collect_input node — capture into vars.
  //
  // Everything else falls through to the fallback policy below.
  let matched: string | null = null;
  if (
    (message.kind === "interactive_reply" || message.kind === "text") &&
    (currentNode.node_type === "send_buttons" ||
      currentNode.node_type === "send_list")
  ) {
    const replyId =
      message.kind === "interactive_reply" ? message.reply_id : message.text;
    const replyTitle =
      message.kind === "interactive_reply" ? message.reply_title : message.text;
    matched = matchReplyId(currentNode, replyId, replyTitle);
    const cfg = currentNode.config as { var_key?: string };
    if (matched && cfg?.var_key) {
      const selectedValue =
        message.kind === "interactive_reply"
          ? message.reply_title || message.reply_id
          : message.text;
      const newVars = { ...(run.vars ?? {}), [cfg.var_key]: selectedValue };
      run.vars = newVars;
      const { error: varErr } = await db
        .from("flow_runs")
        .update({ vars: newVars })
        .eq("id", run.id);
      if (varErr) {
        console.error("[flows] interactive reply var update error:", varErr.message);
      }
      await logEvent(db, run.id, "node_entered", currentNode.node_key, {
        captured_key: cfg.var_key,
        captured_value: selectedValue,
      });
    }
  } else if (
    message.kind === "text" &&
    currentNode.node_type === "collect_input"
  ) {
    const cfg = currentNode.config as unknown as CollectInputNodeConfig;
    const captured = message.text.trim();
    if (captured.length > 0) {
      const varKey = cfg.var_key || currentNode.node_key;
      const newVars = { ...(run.vars ?? {}), [varKey]: captured };
      run.vars = newVars;
      run.reprompt_count = 0;

      const { error: capErr } = await db
        .from("flow_runs")
        .update({
          vars: newVars,
          reprompt_count: 0,
        })
        .eq("id", run.id);
      if (capErr) {
        console.error("[flows] collect_input var update failed:", capErr.message);
      }
      await logEvent(db, run.id, "node_entered", currentNode.node_key, {
        captured_key: varKey,
        captured_length: captured.length,
      });

      let nextKey = cfg.next_node_key;
      if (!nextKey) {
        const tNode =
          findTemplateNode(currentNode.node_key) ??
          LEGACY_SOLAR_FALLBACK_NODES.find((n) => n.node_key === currentNode.node_key);
        if (tNode && (tNode.config as any)?.next_node_key) {
          nextKey = (tNode.config as any).next_node_key;
        }
      }
      matched = nextKey ?? null;
    }
  }

  if (matched) {
    // Reset reprompt count on a successful match. Skip the write when
    // already 0 — the collect_input capture branch above already
    // zeroed it, and interactive-reply matches against a fresh run
    // (post-prior-reset) are also already 0. The previous re-read of
    // the whole row was needed only because we weren't mirroring the
    // capture UPDATE into the in-memory `run`; now that we do, the
    // local copy is the source of truth.
    if (run.reprompt_count !== 0) {
      const { error } = await db
        .from("flow_runs")
        .update({ reprompt_count: 0 })
        .eq("id", run.id);
      if (!error) run.reprompt_count = 0;
    }
    const outcome = await advanceFromNodeKey(db, run, matched, nodes);
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: outcome.outcome,
    };
  }

  // No match → fallback. Apply the policy.
  const policy = resolveFallbackPolicy(
    (await loadFlow(db, run.flow_id))?.fallback_policy,
  );
  const newReprompts = run.reprompt_count + 1;
  await db
    .from("flow_runs")
    .update({ reprompt_count: newReprompts })
    .eq("id", run.id);

  const action = decideFallback({ policy, reprompt_count: newReprompts });
  await logEvent(db, run.id, "fallback_fired", run.current_node_key, {
    action: action.type,
    reprompt_count: newReprompts,
  });
  if (action.type === "ignore") {
    // Don't consume — let automations have a shot at it.
    return { consumed: false, flow_run_id: run.id, outcome: "no_match" };
  }
  if (action.type === "reprompt") {
    // Re-send the same prompt. Same node, no current_node_key change.
    if (currentNode.node_type === "send_buttons") {
      await sendButtonsAndSuspend(db, run, currentNode);
    } else if (currentNode.node_type === "send_list") {
      await sendListAndSuspend(db, run, currentNode);
    } else if (currentNode.node_type === "collect_input") {
      // Customer typed something we couldn't accept (empty after trim,
      // or var_key missing — rare). Re-send the prompt so they try again.
      const cfg = currentNode.config as unknown as CollectInputNodeConfig;
      try {
        await engineSendText({
          accountId: run.account_id,
    userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateVars(cfg.prompt_text, run.vars),
        });
      } catch (err) {
        await logEvent(db, run.id, "error", currentNode.node_key, {
          reason: "reprompt_send_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { consumed: true, flow_run_id: run.id, outcome: "fallback_fired" };
  }
  if (action.type === "handoff") {
    if (run.conversation_id) {
      await db
        .from("conversations")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("id", run.conversation_id);
    }
    try {
      await engineSendText({
        accountId: run.account_id,
        userId: run.user_id,
        conversationId: run.conversation_id!,
        contactId: run.contact_id!,
        text: "Aapke sawaal ke liye hamare solar expert se connect kar rahe hain. Hamari team jald hi aapse yahan sampark karegi.",
      });
    } catch (err) {
      console.error(`[flows] handoff notification send failed for run ${run.id}:`, err);
    }
    await logEvent(db, run.id, "handoff", run.current_node_key, {
      reason: "fallback_exhausted",
    });
    await endRun(db, run.id, "handed_off", "fallback_exhausted");
    return { consumed: true, flow_run_id: run.id, outcome: "handed_off" };
  }
  // action.type === 'end'
  try {
    await engineSendText({
      accountId: run.account_id,
      userId: run.user_id,
      conversationId: run.conversation_id!,
      contactId: run.contact_id!,
      text: "Dhanyawad! Agar aapko naya quote ya jaankari chahiye, toh dobara 'Solar' ya 'Hi' likhkar bhejein.",
    });
  } catch (err) {
    console.error(`[flows] end notification send failed for run ${run.id}:`, err);
  }
  await endRun(db, run.id, "completed", "fallback_exhausted_end");
  return { consumed: true, flow_run_id: run.id, outcome: "completed" };
}

async function startNewRun(
  db: AdminClient,
  flow: FlowRow,
  input: DispatchInboundInput,
  nodes: Map<string, FlowNodeRow>,
): Promise<DispatchInboundResult> {
  // INSERT — partial unique index `idx_one_active_run_per_contact`
  // catches concurrent inserts with 23505. We catch and return as
  // consumed:true (the parallel webhook handles it).
  const nowIso = new Date().toISOString();
  const { data: inserted, error: insErr } = await db
    .from("flow_runs")
    .insert({
      flow_id: flow.id,
      // Tenancy: NOT NULL post-017. The partial unique index
      // `idx_one_active_run_per_contact` is over (account_id,
      // contact_id) WHERE status='active', so two accounts sharing
      // a contact phone number each run their own flows independently.
      account_id: flow.account_id,
      // Audit: preserves the flow's author on the run row for log
      // attribution.
      user_id: flow.user_id,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      status: "active",
      current_node_key: flow.entry_node_id,
      vars: {},
      reprompt_count: 0,
      started_at: nowIso,
      last_advanced_at: nowIso,
    })
    .select("*")
    .maybeSingle();
  if (insErr) {
    // 23505 = unique_violation → another webhook is starting the run,
    // or a prior run was left active. Clear stale run and retry once so
    // user's fresh message is never ignored!
    const msg = insErr.message ?? "";
    if (msg.includes("23505") || msg.includes("duplicate key")) {
      const existing = await loadActiveRunForContact(
        db,
        flow.account_id,
        input.contactId,
      );
      if (existing) {
        await endRun(db, existing.id, "completed", "auto_cleared_on_restart");
        const retryIso = new Date().toISOString();
        const { data: retryInserted, error: retryErr } = await db
          .from("flow_runs")
          .insert({
            flow_id: flow.id,
            account_id: flow.account_id,
            user_id: flow.user_id,
            contact_id: input.contactId,
            conversation_id: input.conversationId,
            status: "active",
            current_node_key: flow.entry_node_id,
            vars: {},
            reprompt_count: 0,
            started_at: retryIso,
            last_advanced_at: retryIso,
          })
          .select("*")
          .maybeSingle();
        if (retryInserted && !retryErr) {
          const run = retryInserted as FlowRunRow;
          if (!run.vars || typeof run.vars !== "object") run.vars = {};
          if (typeof run.reprompt_count !== "number") run.reprompt_count = 0;
          await logEvent(db, run.id, "started", flow.entry_node_id, {
            flow_id: flow.id,
            trigger_type: flow.trigger_type,
            meta_message_id: input.message.meta_message_id,
          });
          const outcome = await advanceFromNodeKey(
            db,
            run,
            flow.entry_node_id!,
            nodes,
          );
          return {
            consumed: true,
            flow_run_id: run.id,
            outcome: outcome.outcome === "advanced" ? "started" : outcome.outcome,
          };
        }
      }
      return { consumed: true, outcome: "duplicate_inbound_ignored" };
    }
    console.error("[flows] startNewRun insert error:", insErr.message);
    return { consumed: false, outcome: "no_match" };
  }
  const run = inserted as FlowRunRow;
  if (!run.vars || typeof run.vars !== "object") {
    run.vars = {};
  }
  if (typeof run.reprompt_count !== "number") {
    run.reprompt_count = 0;
  }
  await logEvent(db, run.id, "started", flow.entry_node_id, {
    flow_id: flow.id,
    trigger_type: flow.trigger_type,
    meta_message_id: input.message.meta_message_id,
  });
  // Bump the flow's execution counter — used by the builder UI to
  // surface "X runs since activation" on the flow card.
  //
  // Atomic RPC (migration 012) rather than read-modify-write: two
  // concurrent webhooks starting runs for different contacts on the
  // same flow would otherwise both read N and both write N+1, losing
  // a count. Mirrors the automations engine's use of
  // `increment_automation_execution_count` (migration 007).
  const { error: incErr } = await db.rpc("increment_flow_execution_count", {
    p_flow_id: flow.id,
  });
  if (incErr) {
    // Non-fatal — the run itself succeeded; only the counter is off.
    console.error("[flows] execution_count rpc error:", incErr.message);
  }

  // Run the advance loop starting from the entry node.
  const outcome = await advanceFromNodeKey(db, run, flow.entry_node_id!, nodes);
  return {
    consumed: true,
    flow_run_id: run.id,
    outcome: outcome.outcome === "advanced" ? "started" : outcome.outcome,
  };
}
