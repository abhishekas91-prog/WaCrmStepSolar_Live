import { describe, it, expect } from "vitest";
import {
  matchReplyId,
  matchesKeywordTrigger,
  isAutoAdvancing,
  isSuspending,
  isTerminal,
  evaluateConditionPredicate,
  evaluateConditionNode,
  interpolateVars,
} from "./engine";
import { getFlowTemplate } from "./templates";
import type { ConditionNodeConfig, FlowRunRow, SendButtonsNodeConfig } from "./types";

describe("matchReplyId", () => {
  it("returns null for nodes without options", () => {
    expect(
      matchReplyId({ node_type: "start", config: { next_node_key: "x" } }, "y"),
    ).toBeNull();
    expect(
      matchReplyId({ node_type: "send_message", config: {} }, "y"),
    ).toBeNull();
    expect(matchReplyId({ node_type: "end", config: {} }, "y")).toBeNull();
  });

  it("matches the buttons array on a send_buttons node", () => {
    const node = {
      node_type: "send_buttons",
      config: {
        text: "Pick one",
        buttons: [
          { reply_id: "yes", title: "Yes", next_node_key: "confirmed" },
          { reply_id: "no", title: "No", next_node_key: "declined" },
        ],
      },
    };
    expect(matchReplyId(node, "yes")).toBe("confirmed");
    expect(matchReplyId(node, "no")).toBe("declined");
    expect(matchReplyId(node, "legacy-id", "Yes")).toBe("confirmed");
  });

  it("returns null when no button reply_id matches", () => {
    const node = {
      node_type: "send_buttons",
      config: {
        text: "Pick",
        buttons: [
          { reply_id: "a", title: "A", next_node_key: "to_a" },
          { reply_id: "b", title: "B", next_node_key: "to_b" },
        ],
      },
    };
    expect(matchReplyId(node, "c")).toBeNull();
    expect(matchReplyId(node, "")).toBeNull();
  });

  it("searches across all sections in a send_list node", () => {
    const node = {
      node_type: "send_list",
      config: {
        text: "Pick an order",
        button_label: "View",
        sections: [
          {
            title: "Recent",
            rows: [
              { reply_id: "o1", title: "Order 1", next_node_key: "ord_1" },
            ],
          },
          {
            title: "Older",
            rows: [
              { reply_id: "o2", title: "Order 2", next_node_key: "ord_2" },
              { reply_id: "o3", title: "Order 3", next_node_key: "ord_3" },
            ],
          },
        ],
      },
    };
    expect(matchReplyId(node, "o1")).toBe("ord_1");
    expect(matchReplyId(node, "o2")).toBe("ord_2");
    expect(matchReplyId(node, "o3")).toBe("ord_3");
    expect(matchReplyId(node, "o99")).toBeNull();
  });

  it("returns null when send_list has no sections / empty sections", () => {
    expect(
      matchReplyId(
        { node_type: "send_list", config: { text: "x", sections: [] } },
        "x",
      ),
    ).toBeNull();
    expect(
      matchReplyId(
        {
          node_type: "send_list",
          config: { text: "x", sections: [{ rows: [] }] },
        },
        "x",
      ),
    ).toBeNull();
  });
});

describe("matchesKeywordTrigger", () => {
  it("returns false for empty text", () => {
    expect(matchesKeywordTrigger("", { keywords: ["hi"] })).toBe(false);
  });

  it("returns false when keywords array is empty", () => {
    expect(matchesKeywordTrigger("anything", { keywords: [] })).toBe(false);
  });

  it("default match_type='contains' does case-insensitive substring", () => {
    const cfg = { keywords: ["support"] };
    expect(matchesKeywordTrigger("I need SUPPORT please", cfg)).toBe(true);
    expect(matchesKeywordTrigger("Support is great", cfg)).toBe(true);
    expect(matchesKeywordTrigger("Help me", cfg)).toBe(false);
  });

  it("match_type='exact' compares the whole string case-insensitively", () => {
    const cfg = { keywords: ["help"], match_type: "exact" as const };
    expect(matchesKeywordTrigger("help", cfg)).toBe(true);
    expect(matchesKeywordTrigger("HELP", cfg)).toBe(true);
    expect(matchesKeywordTrigger("help me", cfg)).toBe(false);
  });

  it("case_sensitive=true preserves case", () => {
    const cfg = {
      keywords: ["Support"],
      case_sensitive: true,
    };
    expect(matchesKeywordTrigger("I need Support", cfg)).toBe(true);
    expect(matchesKeywordTrigger("I need support", cfg)).toBe(false);
  });

  it("matches any one of multiple keywords", () => {
    const cfg = { keywords: ["help", "support", "issue"] };
    expect(matchesKeywordTrigger("I have an issue", cfg)).toBe(true);
    expect(matchesKeywordTrigger("I need Help!", cfg)).toBe(true);
    expect(matchesKeywordTrigger("nothing to see here", cfg)).toBe(false);
  });

  it("skips empty strings in the keywords array", () => {
    const cfg = { keywords: ["", "support", ""] };
    expect(matchesKeywordTrigger("support center", cfg)).toBe(true);
    expect(matchesKeywordTrigger("nope", cfg)).toBe(false);
  });
});

describe("node classification helpers", () => {
  it("isAutoAdvancing covers start + send_message + send_media + condition + set_tag", () => {
    expect(isAutoAdvancing("start")).toBe(true);
    expect(isAutoAdvancing("send_message")).toBe(true);
    expect(isAutoAdvancing("send_media")).toBe(true);
    expect(isAutoAdvancing("condition")).toBe(true);
    expect(isAutoAdvancing("set_tag")).toBe(true);
    expect(isAutoAdvancing("send_buttons")).toBe(false);
    expect(isAutoAdvancing("send_list")).toBe(false);
    expect(isAutoAdvancing("collect_input")).toBe(false);
    expect(isAutoAdvancing("handoff")).toBe(false);
    expect(isAutoAdvancing("end")).toBe(false);
  });

  it("isSuspending covers the input-requiring nodes", () => {
    expect(isSuspending("send_buttons")).toBe(true);
    expect(isSuspending("send_list")).toBe(true);
    expect(isSuspending("collect_input")).toBe(true);
    expect(isSuspending("start")).toBe(false);
    expect(isSuspending("send_message")).toBe(false);
    expect(isSuspending("condition")).toBe(false);
    expect(isSuspending("set_tag")).toBe(false);
    expect(isSuspending("handoff")).toBe(false);
    expect(isSuspending("end")).toBe(false);
  });

  it("isTerminal covers handoff + end", () => {
    expect(isTerminal("handoff")).toBe(true);
    expect(isTerminal("end")).toBe(true);
    expect(isTerminal("start")).toBe(false);
    expect(isTerminal("send_buttons")).toBe(false);
    expect(isTerminal("condition")).toBe(false);
  });

  it("the three classifications are mutually exclusive for known node types", () => {
    const types = [
      "start",
      "send_message",
      "send_buttons",
      "send_list",
      "send_media",
      "collect_input",
      "condition",
      "set_tag",
      "handoff",
      "end",
    ];
    for (const t of types) {
      const flags = [isAutoAdvancing(t), isSuspending(t), isTerminal(t)];
      // Exactly one of the three should be true for every known node.
      expect(flags.filter(Boolean).length).toBe(1);
    }
  });
});

describe("evaluateConditionPredicate", () => {
  it("present: true when subject has a value", () => {
    expect(
      evaluateConditionPredicate({
        operator: "present",
        subjectValue: "alice@example.com",
        configValue: undefined,
      }),
    ).toBe(true);
  });

  it("present: false when subject is undefined or empty", () => {
    expect(
      evaluateConditionPredicate({
        operator: "present",
        subjectValue: undefined,
        configValue: undefined,
      }),
    ).toBe(false);
    expect(
      evaluateConditionPredicate({
        operator: "present",
        subjectValue: "",
        configValue: undefined,
      }),
    ).toBe(false);
  });

  it("absent: inverse of present", () => {
    expect(
      evaluateConditionPredicate({
        operator: "absent",
        subjectValue: undefined,
        configValue: undefined,
      }),
    ).toBe(true);
    expect(
      evaluateConditionPredicate({
        operator: "absent",
        subjectValue: "x",
        configValue: undefined,
      }),
    ).toBe(false);
  });

  it("equals: exact string comparison; case-sensitive", () => {
    expect(
      evaluateConditionPredicate({
        operator: "equals",
        subjectValue: "VIP",
        configValue: "VIP",
      }),
    ).toBe(true);
    expect(
      evaluateConditionPredicate({
        operator: "equals",
        subjectValue: "vip",
        configValue: "VIP",
      }),
    ).toBe(false);
  });

  it("equals: undefined subject never matches (even against empty)", () => {
    expect(
      evaluateConditionPredicate({
        operator: "equals",
        subjectValue: undefined,
        configValue: "",
      }),
    ).toBe(false);
  });

  it("contains: substring match", () => {
    expect(
      evaluateConditionPredicate({
        operator: "contains",
        subjectValue: "support@example.com",
        configValue: "@example.com",
      }),
    ).toBe(true);
    expect(
      evaluateConditionPredicate({
        operator: "contains",
        subjectValue: "support@other.com",
        configValue: "@example.com",
      }),
    ).toBe(false);
  });

  it("contains: undefined subject never matches", () => {
    expect(
      evaluateConditionPredicate({
        operator: "contains",
        subjectValue: undefined,
        configValue: "anything",
      }),
    ).toBe(false);
  });
});

describe("interpolateVars", () => {
  it("interpolates template with captured vars", () => {
    const res = interpolateVars("Thanks {{vars.name}}, what's your email?", {
      name: "Rishabh",
    });
    expect(res).toBe("Thanks Rishabh, what's your email?");
  });

  it("handles missing/undefined/null vars safely without throwing", () => {
    expect(interpolateVars("Hello {{vars.name}}!", undefined)).toBe("Hello !");
    expect(interpolateVars("Hello {{vars.name}}!", null)).toBe("Hello !");
    expect(interpolateVars("Hello {{vars.name}}!", {})).toBe("Hello !");
  });

  it("handles multiple variables and numeric/string types", () => {
    const res = interpolateVars(
      "Customer: {{vars.name}}, Bill: ₹{{vars.bill}}, City: {{vars.city}}",
      { name: "Rahul", bill: 2500, city: "Lucknow" },
    );
    expect(res).toBe("Customer: Rahul, Bill: ₹2500, City: Lucknow");
  });
});

describe("evaluateConditionNode", () => {
  it("does not throw TypeError when run.vars is undefined (reproduces Solar Assistant fix)", async () => {
    const run = {
      id: "run-1",
      vars: undefined as unknown as Record<string, unknown>,
    } as FlowRunRow;

    const cfg: ConditionNodeConfig = {
      subject: "var",
      subject_key: "name",
      operator: "present",
      true_next: "ask_bill",
      false_next: "ask_name",
    };

    // Should return false cleanly, rather than throwing TypeError: Cannot read properties of undefined
    const res = await evaluateConditionNode({} as any, run, cfg);
    expect(res).toBe(false);
  });

  it("evaluates true when subject var is present", async () => {
    const run = {
      id: "run-2",
      vars: { name: "Rishabh" },
    } as unknown as FlowRunRow;

    const cfg: ConditionNodeConfig = {
      subject: "var",
      subject_key: "name",
      operator: "present",
      true_next: "ask_bill",
      false_next: "ask_name",
    };

    const res = await evaluateConditionNode({} as any, run, cfg);
    expect(res).toBe(true);
  });

  it("evaluates false when subject var is empty string", async () => {
    const run = {
      id: "run-3",
      vars: { name: "" },
    } as unknown as FlowRunRow;

    const cfg: ConditionNodeConfig = {
      subject: "var",
      subject_key: "name",
      operator: "present",
      true_next: "ask_bill",
      false_next: "ask_name",
    };

    const res = await evaluateConditionNode({} as any, run, cfg);
    expect(res).toBe(false);
  });
});

describe("solar_assistant flow routing after 'Quote chahiye'", () => {
  it("transitions correctly from Quote chahiye to ask_name when lead details are missing", async () => {
    const template = getFlowTemplate("solar_assistant");
    expect(template).not.toBeNull();
    if (!template) return;

    // 1. Welcome node has 'want_quote' button -> routes to check_lead_info
    const welcomeNode = template.nodes.find((n) => n.node_key === "welcome");
    expect(welcomeNode).toBeDefined();
    const cfg = welcomeNode!.config as SendButtonsNodeConfig;
    const nextKey = matchReplyId(
      { node_type: "send_buttons", config: cfg as any },
      "want_quote",
    );
    expect(nextKey).toBe("check_lead_info");

    // 2. check_lead_info condition node checks vars.name
    const conditionNode = template.nodes.find(
      (n) => n.node_key === "check_lead_info",
    );
    expect(conditionNode).toBeDefined();
    const condCfg = conditionNode!.config as ConditionNodeConfig;

    // Simulate run when customer hasn't provided name yet (run.vars is {} or undefined)
    const run = { id: "test-run", vars: undefined } as unknown as FlowRunRow;
    const hasName = await evaluateConditionNode({} as any, run, condCfg);
    expect(hasName).toBe(false);

    // Follows false_next -> ask_name
    const resolvedNext = hasName ? condCfg.true_next : condCfg.false_next;
    expect(resolvedNext).toBe("ask_name");

    // 3. ask_name collects customer's name
    const askNameNode = template.nodes.find((n) => n.node_key === "ask_name");
    expect(askNameNode).toBeDefined();
    expect(askNameNode!.node_type).toBe("collect_input");
    expect((askNameNode!.config as any).var_key).toBe("name");
    expect((askNameNode!.config as any).next_node_key).toBe("ask_email");

    // 4. ask_email interpolates customer's name
    const askEmailNode = template.nodes.find((n) => n.node_key === "ask_email");
    expect(askEmailNode).toBeDefined();
    const emailPrompt = interpolateVars(
      (askEmailNode!.config as any).prompt_text,
      { name: "Rahul" },
    );
    expect(emailPrompt).toContain("Thanks Rahul!");

    // 5. Complete chain through ask_city -> ask_pincode -> ask_bill -> create_lead_3kw -> quote_3kw
    const askCityNode = template.nodes.find((n) => n.node_key === "ask_city");
    expect(askCityNode).toBeDefined();
    expect(askCityNode!.node_type).toBe("collect_input");
    expect((askCityNode!.config as any).next_node_key).toBe("ask_pincode");

    const askPincodeNode = template.nodes.find((n) => n.node_key === "ask_pincode");
    expect(askPincodeNode).toBeDefined();
    expect(askPincodeNode!.node_type).toBe("collect_input");
    expect((askPincodeNode!.config as any).next_node_key).toBe("ask_bill");

    const askBillNode = template.nodes.find((n) => n.node_key === "ask_bill");
    expect(askBillNode).toBeDefined();
    expect(askBillNode!.node_type).toBe("send_list");
    const billMatch = matchReplyId(
      { node_type: "send_list", config: askBillNode!.config as any },
      "bill_1500_2500",
    );
    expect(billMatch).toBe("create_lead_3kw");

    const createLeadNode = template.nodes.find((n) => n.node_key === "create_lead_3kw");
    expect(createLeadNode).toBeDefined();
    expect(createLeadNode!.node_type).toBe("create_lead");
    expect((createLeadNode!.config as any).next_node_key).toBe("quote_3kw");

    const quoteNode = template.nodes.find((n) => n.node_key === "quote_3kw");
    expect(quoteNode).toBeDefined();
    expect(quoteNode!.node_type).toBe("send_message");
    const quoteText = interpolateVars((quoteNode!.config as any).text, { name: "Rahul" });
    expect(quoteText).toContain("3 kW On-Grid");
  });

  it("skips lead questions directly to ask_bill if name is already present", async () => {
    const template = getFlowTemplate("solar_assistant");
    expect(template).not.toBeNull();
    const conditionNode = template!.nodes.find((n) => n.node_key === "check_lead_info");
    expect(conditionNode).toBeDefined();

    const runWithName = { id: "run-with-name", vars: { name: "Abhishek" } } as unknown as FlowRunRow;
    const hasName = await evaluateConditionNode({} as any, runWithName, conditionNode!.config as ConditionNodeConfig);
    expect(hasName).toBe(true);

    const condCfg = conditionNode!.config as ConditionNodeConfig;
    const nextKey = hasName ? condCfg.true_next : condCfg.false_next;
    expect(nextKey).toBe("ask_bill");
  });
});

describe("inbound greeting and restart patterns", () => {
  const isGreeting = (text: string) =>
    /^(?:hi|hello|hey|hii|helo|namaste|नमस्ते|हेलो)(?:[\s,!?.]*)$/i.test(text.trim());
  const isExplicitRestart = (text: string) =>
    /^(?:solar|start|restart|reset|flow|shuru)(?:[\s,!?.]*)$/i.test(text.trim());

  it("identifies greetings reliably across English and Hindi", () => {
    expect(isGreeting("hi")).toBe(true);
    expect(isGreeting("Hi")).toBe(true);
    expect(isGreeting("Hello!")).toBe(true);
    expect(isGreeting("Namaste")).toBe(true);
    expect(isGreeting("नमस्ते")).toBe(true);
    expect(isGreeting("हेलो ")).toBe(true);
    expect(isGreeting("hii...")).toBe(true);
    expect(isGreeting("Random text")).toBe(false);
  });

  it("identifies restart commands to unblock stuck runs", () => {
    expect(isExplicitRestart("solar")).toBe(true);
    expect(isExplicitRestart("Solar")).toBe(true);
    expect(isExplicitRestart("start")).toBe(true);
    expect(isExplicitRestart("restart")).toBe(true);
    expect(isExplicitRestart("reset")).toBe(true);
    expect(isExplicitRestart("shuru")).toBe(true);
    expect(isExplicitRestart("quote")).toBe(false);
  });
});

