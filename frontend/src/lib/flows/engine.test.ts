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

    // 1. ask_name (Full Name*)
    const askNameNode = template.nodes.find((n) => n.node_key === "ask_name");
    expect(askNameNode).toBeDefined();
    expect(askNameNode!.node_type).toBe("collect_input");
    expect((askNameNode!.config as any).var_key).toBe("name");
    expect((askNameNode!.config as any).prompt_text).toContain("*Full Name*");
    expect((askNameNode!.config as any).next_node_key).toBe("ask_phone");

    // 2. ask_phone (Contact Number*)
    const askPhoneNode = template.nodes.find((n) => n.node_key === "ask_phone");
    expect(askPhoneNode).toBeDefined();
    expect(askPhoneNode!.node_type).toBe("collect_input");
    expect((askPhoneNode!.config as any).var_key).toBe("phone");
    expect((askPhoneNode!.config as any).prompt_text).toContain("*Contact Number*");
    expect((askPhoneNode!.config as any).next_node_key).toBe("ask_email");

    // 3. ask_email (Email Address*)
    const askEmailNode = template.nodes.find((n) => n.node_key === "ask_email");
    expect(askEmailNode).toBeDefined();
    expect(askEmailNode!.node_type).toBe("collect_input");
    expect((askEmailNode!.config as any).var_key).toBe("email");
    expect((askEmailNode!.config as any).prompt_text).toContain("*Email Address*");
    expect((askEmailNode!.config as any).next_node_key).toBe("ask_state");

    // 4. ask_state (State*)
    const askStateNode = template.nodes.find((n) => n.node_key === "ask_state");
    expect(askStateNode).toBeDefined();
    expect(askStateNode!.node_type).toBe("collect_input");
    expect((askStateNode!.config as any).var_key).toBe("state");
    expect((askStateNode!.config as any).prompt_text).toContain("*State*");
    expect((askStateNode!.config as any).next_node_key).toBe("ask_city");

    // 5. ask_city (City / Town*)
    const askCityNode = template.nodes.find((n) => n.node_key === "ask_city");
    expect(askCityNode).toBeDefined();
    expect(askCityNode!.node_type).toBe("collect_input");
    expect((askCityNode!.config as any).var_key).toBe("city");
    expect((askCityNode!.config as any).prompt_text).toContain("*City / Town*");
    expect((askCityNode!.config as any).next_node_key).toBe("ask_pincode");

    // 6. ask_pincode (Pincode*)
    const askPincodeNode = template.nodes.find((n) => n.node_key === "ask_pincode");
    expect(askPincodeNode).toBeDefined();
    expect(askPincodeNode!.node_type).toBe("collect_input");
    expect((askPincodeNode!.config as any).var_key).toBe("pincode");
    expect((askPincodeNode!.config as any).prompt_text).toContain("*Pincode*");
    expect((askPincodeNode!.config as any).next_node_key).toBe("ask_property_type");

    // 7. ask_property_type (Property Type*)
    const askPropNode = template.nodes.find((n) => n.node_key === "ask_property_type");
    expect(askPropNode).toBeDefined();
    expect(askPropNode!.node_type).toBe("send_list");
    expect((askPropNode!.config as any).var_key).toBe("property_type");
    const propMatch = matchReplyId(
      { node_type: "send_list", config: askPropNode!.config as any },
      "prop_residential",
    );
    expect(propMatch).toBe("ask_bill");

    // 8. ask_bill (Monthly Electricity Bill (₹)*)
    const askBillNode = template.nodes.find((n) => n.node_key === "ask_bill");
    expect(askBillNode).toBeDefined();
    expect(askBillNode!.node_type).toBe("collect_input");
    expect((askBillNode!.config as any).var_key).toBe("monthly_bill");
    expect((askBillNode!.config as any).prompt_text).toContain("*Monthly Electricity Bill (₹)*");
    expect((askBillNode!.config as any).next_node_key).toBe("ask_roof_type");

    // 9. ask_roof_type (Roof Type & Space*)
    const askRoofNode = template.nodes.find((n) => n.node_key === "ask_roof_type");
    expect(askRoofNode).toBeDefined();
    expect(askRoofNode!.node_type).toBe("send_list");
    expect((askRoofNode!.config as any).var_key).toBe("roof_type");
    const roofMatch = matchReplyId(
      { node_type: "send_list", config: askRoofNode!.config as any },
      "roof_large",
    );
    expect(roofMatch).toBe("ask_timeline");

    // 10. ask_timeline (Aap Solar kab tak lagwana chahte hain?*)
    const askTimelineNode = template.nodes.find((n) => n.node_key === "ask_timeline");
    expect(askTimelineNode).toBeDefined();
    expect(askTimelineNode!.node_type).toBe("send_buttons");
    expect((askTimelineNode!.config as any).var_key).toBe("timeline");
    const timelineMatch = matchReplyId(
      { node_type: "send_buttons", config: askTimelineNode!.config as any },
      "time_immediate",
    );
    expect(timelineMatch).toBe("create_lead");

    // 11. create_lead (creates lead in CRM with all 10 fields)
    const createLeadNode = template.nodes.find((n) => n.node_key === "create_lead");
    expect(createLeadNode).toBeDefined();
    expect(createLeadNode!.node_type).toBe("create_lead");
    expect((createLeadNode!.config as any).next_node_key).toBe("quote_summary");

    // 12. quote_summary (sends customized quote)
    const quoteNode = template.nodes.find((n) => n.node_key === "quote_summary");
    expect(quoteNode).toBeDefined();
    expect(quoteNode!.node_type).toBe("send_message");
    const quoteText = interpolateVars((quoteNode!.config as any).text, {
      name: "Rahul",
      monthly_bill: "4000",
      city: "Lucknow",
      state: "Uttar Pradesh",
      property_type: "Residential",
    });
    expect(quoteText).toContain("Namaste Rahul ji!");
    expect(quoteText).toContain("Recommended System");
    expect(quoteText).toContain("PM Surya Ghar");
    expect((quoteNode!.config as any).next_node_key).toBe("after_quote");
  });

  it("skips lead questions to quote_summary if details are already present", async () => {
    const template = getFlowTemplate("solar_assistant");
    expect(template).not.toBeNull();
    const conditionNode = template!.nodes.find((n) => n.node_key === "check_lead_info");
    expect(conditionNode).toBeDefined();

    const runWithName = { id: "run-with-name", vars: { name: "Abhishek" } } as unknown as FlowRunRow;
    const hasName = await evaluateConditionNode({} as any, runWithName, conditionNode!.config as ConditionNodeConfig);
    expect(hasName).toBe(true);

    const condCfg = conditionNode!.config as ConditionNodeConfig;
    const nextKey = hasName ? condCfg.true_next : condCfg.false_next;
    expect(nextKey).toBe("quote_summary");
  });

  it("registers standalone solar_quote_flow template", () => {
    const quoteFlow = getFlowTemplate("solar_quote_flow");
    expect(quoteFlow).not.toBeNull();
    expect(quoteFlow!.slug).toBe("solar_quote_flow");
    expect(quoteFlow!.entry_node_id).toBe("start");
    expect(quoteFlow!.nodes.length).toBeGreaterThanOrEqual(12);
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

