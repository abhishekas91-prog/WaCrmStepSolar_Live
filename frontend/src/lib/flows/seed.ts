import { getFlowTemplate } from "./templates";
import type { FlowRow } from "./types";

type AdminClient = {
  from: (table: string) => any;
};

export async function ensureTemplateFlow(
  db: AdminClient,
  accountId: string,
  userId: string,
  slug: string,
  existing: FlowRow[],
): Promise<FlowRow | null> {
  const template = getFlowTemplate(slug);
  if (!template) return null;

  const found = existing.find(
    (f) => f.name === template.name || f.name.toLowerCase() === template.name.toLowerCase(),
  );
  if (found) {
    if (found.status !== "active") {
      await db
        .from("flows")
        .update({ status: "active", updated_at: new Date().toISOString() })
        .eq("id", found.id);
      found.status = "active";
    }
    return found;
  }

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

  if (!createdFlow) return null;
  if (template.nodes.length > 0) {
    await db.from("flow_nodes").insert(
      template.nodes.map((n) => ({
        flow_id: (createdFlow as { id: string }).id,
        node_key: n.node_key,
        node_type: n.node_type,
        config: n.config,
      })),
    );
  }
  const row = createdFlow as FlowRow;
  existing.push(row);
  return row;
}

export async function ensureWelcomeAndLeadGeneratorFlows(
  db: AdminClient,
  accountId: string,
  userId: string,
): Promise<{ welcome: FlowRow | null; leadGenerator: FlowRow | null }> {
  const { data: flows } = await db
    .from("flows")
    .select("*")
    .eq("account_id", accountId);
  const existing = ((flows as FlowRow[] | null) ?? []).slice();
  const welcome = await ensureTemplateFlow(db, accountId, userId, "welcome", existing);
  const leadGenerator = await ensureTemplateFlow(
    db,
    accountId,
    userId,
    "lead_generator",
    existing,
  );
  return { welcome, leadGenerator };
}
