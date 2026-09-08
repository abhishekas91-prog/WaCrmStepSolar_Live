/**
 * Starter flow templates.
 *
 * Three pre-canned flows users can clone with one click instead of
 * building from scratch. Each template is a plain JS object describing
 * the same shape `/api/flows` PUT accepts — name, trigger config,
 * entry_node_id, fallback_policy, nodes[] — keyed by a stable
 * `slug`.
 *
 * The clone path (`/api/flows` POST with `template_slug`) creates a
 * NEW flow_row + flow_nodes rows for the user. `node_key`s are kept
 * verbatim (they're stable strings, not UUIDs, so cloning never
 * needs to rewrite edge references).
 *
 * Choosing a single static module over a DB-backed gallery for v1
 * because: (a) the set is small and changes with code releases, not
 * data; (b) keeps templates portable across self-hosted instances
 * without migrations; (c) editing in source is the lowest-friction
 * way to add the next template.
 */

import type {
  CollectInputNodeConfig,
  ConditionNodeConfig,
  CreateLeadNodeConfig,
  HandoffNodeConfig,
  KeywordTriggerConfig,
  SendButtonsNodeConfig,
  SendListNodeConfig,
  SendMessageNodeConfig,
  StartNodeConfig,
} from "./types";

export type FlowTemplateNodeType =
  | "start"
  | "send_message"
  | "send_buttons"
  | "send_list"
  | "collect_input"
  | "condition"
  | "set_tag"
  | "create_lead"
  | "handoff"
  | "end";

export interface FlowTemplateNode {
  node_key: string;
  node_type: FlowTemplateNodeType;
  config:
    | StartNodeConfig
    | SendMessageNodeConfig
    | SendButtonsNodeConfig
    | SendListNodeConfig
    | CollectInputNodeConfig
    | ConditionNodeConfig
    | HandoffNodeConfig
    | Record<string, unknown>;
}

export interface FlowTemplate {
  slug: string;
  name: string;
  description: string;
  /** Used by the gallery to surface a relevant icon. lucide-react name. */
  icon: "MessageSquare" | "HelpCircle" | "UserPlus" | "Sun";
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: KeywordTriggerConfig | Record<string, unknown>;
  entry_node_id: string;
  nodes: FlowTemplateNode[];
}

// ============================================================
// 1. Welcome menu — the example from the owner's brief
// ============================================================
const WELCOME_MENU: FlowTemplate = {
  slug: "welcome_menu",
  name: "Welcome menu",
  description:
    "Greet customers who type a keyword and route them to the right agent based on whether they're new or existing.",
  icon: "MessageSquare",
  trigger_type: "keyword",
  trigger_config: { keywords: ["support", "help", "hi"], match_type: "contains" },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "welcome" },
    },
    {
      node_key: "welcome",
      node_type: "send_buttons",
      config: {
        text: "Hi! 👋 Welcome to support. Are you an existing customer or new here?",
        footer_text: "Tap a button below to continue.",
        buttons: [
          {
            reply_id: "existing",
            title: "Existing customer",
            next_node_key: "existing_handoff",
          },
          {
            reply_id: "new",
            title: "New customer",
            next_node_key: "new_handoff",
          },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "existing_handoff",
      node_type: "handoff",
      config: {
        note: "Existing customer needs assistance — please check account history before replying.",
      } as HandoffNodeConfig,
    },
    {
      node_key: "new_handoff",
      node_type: "handoff",
      config: {
        note: "New customer — share pricing + onboarding link.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 2. FAQ bot — list-message answers, fully automated
// ============================================================
const FAQ_BOT: FlowTemplate = {
  slug: "faq_bot",
  name: "FAQ bot",
  description:
    "Answer common questions automatically. Customer picks a topic from a list; the bot replies with the answer and ends.",
  icon: "HelpCircle",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["faq", "question", "info"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "topics" },
    },
    {
      node_key: "topics",
      node_type: "send_list",
      config: {
        text: "What can I help you with?",
        button_label: "View topics",
        sections: [
          {
            title: "Common questions",
            rows: [
              {
                reply_id: "hours",
                title: "Opening hours",
                next_node_key: "answer_hours",
              },
              {
                reply_id: "pricing",
                title: "Pricing",
                next_node_key: "answer_pricing",
              },
              {
                reply_id: "refunds",
                title: "Refund policy",
                next_node_key: "answer_refunds",
              },
            ],
          },
          {
            title: "Other",
            rows: [
              {
                reply_id: "human",
                title: "Talk to a human",
                next_node_key: "human_handoff",
              },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: "answer_hours",
      node_type: "send_message",
      config: {
        text: "We're open Mon–Fri, 9am–6pm local time. Weekend support is limited to urgent issues.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "answer_pricing",
      node_type: "send_message",
      config: {
        text: "Our pricing starts at $9/mo. Visit https://example.com/pricing for the full breakdown.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "answer_refunds",
      node_type: "send_message",
      config: {
        text: "Refunds are honored within 30 days of purchase. Reply with your order number and we'll process it.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "human_handoff",
      node_type: "handoff",
      config: {
        note: "Customer asked to talk to a human from the FAQ bot.",
      } as HandoffNodeConfig,
    },
    {
      node_key: "end",
      node_type: "end",
      config: {},
    },
  ],
};

// ============================================================
// 3. Lead capture — collect_input chain, ends in a handoff
// ============================================================
const LEAD_CAPTURE: FlowTemplate = {
  slug: "lead_capture",
  name: "Lead capture",
  description:
    "Greet first-time inbounds, capture name + email + company, then hand off to sales with the answers in the note.",
  icon: "UserPlus",
  trigger_type: "first_inbound_message",
  trigger_config: {},
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "intro" },
    },
    {
      node_key: "intro",
      node_type: "send_message",
      config: {
        text: "Welcome! 👋 I'll ask a few quick questions so we can get you to the right person.",
        next_node_key: "ask_name",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "ask_name",
      node_type: "collect_input",
      config: {
        prompt_text: "What's your name?",
        var_key: "name",
        next_node_key: "ask_email",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_email",
      node_type: "collect_input",
      config: {
        prompt_text: "Thanks {{vars.name}}! What's your work email?",
        var_key: "email",
        next_node_key: "ask_company",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_company",
      node_type: "collect_input",
      config: {
        prompt_text: "Almost done — what's your company name?",
        var_key: "company",
        next_node_key: "handoff",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: "New lead — name={{vars.name}}, email={{vars.email}}, company={{vars.company}}.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 4. Solar Assistant — rooftop quote menu (no LLM)
//
// Replaces the old solar agent + AI auto-reply path. Customer taps
// a bill slab; the bot sends a precomputed Hinglish quote using
// default StepSolar pricing (₹55,000/kW, 5% GST, PM Surya Ghar
// central slab). Edit node text in the builder if prices change.
// ============================================================
const SOLAR_ASSISTANT: FlowTemplate = {
  slug: "solar_assistant",
  name: "Solar Assistant",
  description:
    "WhatsApp solar consultant without an AI key. Greets on solar keywords, then quotes 2 / 3 / 5 / 7.5 kW from the customer's bill slab, or explains process and subsidy.",
  icon: "Sun",
  trigger_type: "keyword",
  trigger_config: {
    keywords: [
      "solar",
      "surya",
      "rooftop",
      "panel",
      "subsidy",
      "सौर",
      "सूर्य",
      "रूफटॉप",
      "सब्सिडी",
      "pannel",
      "inverter",
    ],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "welcome" },
    },
    {
      node_key: "welcome",
      node_type: "send_buttons",
      config: {
        text: "Namaste! StepSolar Energy me aapka swagat hai.\n\nRooftop solar ka size, cost, subsidy aur process yahi bata denge. Kya chahiye?",
        footer_text: "Button dabakar aage badhein.",
        buttons: [
          {
            reply_id: "want_quote",
            title: "Quote chahiye",
            next_node_key: "check_lead_info",
          },
          {
            reply_id: "want_process",
            title: "Process kya hai",
            next_node_key: "process_msg",
          },
          {
            reply_id: "want_more",
            title: "Aur jaankari",
            next_node_key: "more_list",
          },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "check_lead_info",
      node_type: "condition",
      config: {
        subject: "var",
        subject_key: "name",
        operator: "present",
        // Already answered name/email/city/pincode earlier in this
        // same conversation (customer came back via "Aur jaankari" or
        // "Process dekhein" after already getting a quote) → skip
        // straight to the bill-slab menu instead of re-asking.
        true_next: "ask_bill",
        false_next: "ask_name",
      } as ConditionNodeConfig,
    },
    {
      node_key: "ask_name",
      node_type: "collect_input",
      config: {
        prompt_text:
          "Great! Quote ke liye kuch details chahiye.\n\nAapka poora naam?",
        var_key: "name",
        next_node_key: "ask_email",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_email",
      node_type: "collect_input",
      config: {
        prompt_text: "Thanks {{vars.name}}! Aapka email address?",
        var_key: "email",
        next_node_key: "ask_city",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_city",
      node_type: "collect_input",
      config: {
        prompt_text: "Aap kis city/qasbe mein rehte hain?",
        var_key: "city",
        next_node_key: "ask_pincode",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_pincode",
      node_type: "collect_input",
      config: {
        prompt_text: "Aur 6-digit pincode?",
        var_key: "pincode",
        next_node_key: "ask_bill",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_bill",
      node_type: "send_list",
      config: {
        text: "Sahi system batane ke liye apna *monthly electricity bill* choose karein.",
        button_label: "Bill choose karein",
        footer_text: "Approx monthly bill (rupaye).",
        sections: [
          {
            title: "Monthly bill",
            rows: [
              {
                reply_id: "bill_lt_1500",
                title: "1500 se kam",
                description: "Chhota ghar — ~2 kW system",
                next_node_key: "create_lead_2kw",
              },
              {
                reply_id: "bill_1500_2500",
                title: "1500 se 2500",
                description: "Typical home — ~3 kW system",
                next_node_key: "create_lead_3kw",
              },
              {
                reply_id: "bill_2500_4000",
                title: "2500 se 4000",
                description: "Bada ghar — ~5 kW system",
                next_node_key: "create_lead_5kw",
              },
              {
                reply_id: "bill_gt_4000",
                title: "4000 se zyada",
                description: "High consumption — ~7.5 kW",
                next_node_key: "create_lead_75kw",
              },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
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
      } as CreateLeadNodeConfig,
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
      } as CreateLeadNodeConfig,
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
      } as CreateLeadNodeConfig,
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
      } as CreateLeadNodeConfig,
    },
    {
      node_key: "quote_2kw",
      node_type: "send_message",
      config: {
        text: "Namaste!\nAapke monthly bill ~₹1,500 ke hisaab se hum recommend karte hain:\n\n*Recommended System: 2 kW On-Grid*\n\nCost Estimate:\n• System + Installation: ₹1,10,000\n• GST (5%): ₹5,500\n• Total: ₹1,15,500\n• Subsidy (Central PM Surya Ghar): -₹60,000\n• *Net Payable: ₹55,500*\n\nAapka monthly bill lagbhag *₹1,500* bach sakta hai.\nPayback period: ~37 months.\n\nNumbers default StepSolar pricing (₹55,000/kW) se hain. Site survey ke baad exact quotation milta hai.",
        next_node_key: "after_quote",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "quote_3kw",
      node_type: "send_message",
      config: {
        text: "Namaste!\nAapke monthly bill ~₹2,500 ke hisaab se hum recommend karte hain:\n\n*Recommended System: 3 kW On-Grid*\n\nCost Estimate:\n• System + Installation: ₹1,65,000\n• GST (5%): ₹8,250\n• Total: ₹1,73,250\n• Subsidy (Central PM Surya Ghar): -₹78,000\n• *Net Payable: ₹95,250*\n\nAapka monthly bill lagbhag *₹2,500* bach sakta hai.\nPayback period: ~38 months.\n\nNumbers default StepSolar pricing (₹55,000/kW) se hain. Site survey ke baad exact quotation milta hai.",
        next_node_key: "after_quote",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "quote_5kw",
      node_type: "send_message",
      config: {
        text: "Namaste!\nAapke monthly bill ~₹4,000 ke hisaab se hum recommend karte hain:\n\n*Recommended System: 5 kW On-Grid*\n\nCost Estimate:\n• System + Installation: ₹2,75,000\n• GST (5%): ₹13,750\n• Total: ₹2,88,750\n• Subsidy (Central PM Surya Ghar): -₹78,000\n• *Net Payable: ₹2,10,750*\n\nAapka monthly bill lagbhag *₹4,000* bach sakta hai.\nPayback period: ~53 months.\n\nNumbers default StepSolar pricing (₹55,000/kW) se hain. Site survey ke baad exact quotation milta hai.",
        next_node_key: "after_quote",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "quote_75kw",
      node_type: "send_message",
      config: {
        text: "Namaste!\nAapke monthly bill ₹4,000+ ke hisaab se hum recommend karte hain:\n\n*Recommended System: 7.5 kW On-Grid*\n\nCost Estimate:\n• System + Installation: ₹4,12,500\n• GST (5%): ₹20,625\n• Total: ₹4,33,125\n• Subsidy (Central PM Surya Ghar): -₹78,000\n• *Net Payable: ₹3,55,125*\n\nAapka monthly bill lagbhag *₹5,000* bach sakta hai.\nPayback period: ~71 months.\n\nNumbers default StepSolar pricing (₹55,000/kW) se hain. Site survey ke baad exact quotation milta hai.",
        next_node_key: "after_quote",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "after_quote",
      node_type: "send_buttons",
      config: {
        text: "Kya aap aage badhna chahenge? Process dekh sakte hain, ya hamare engineer se baat karein.",
        buttons: [
          {
            reply_id: "after_process",
            title: "Process dekhein",
            next_node_key: "process_msg",
          },
          {
            reply_id: "after_agent",
            title: "Agent se baat",
            next_node_key: "handoff",
          },
          {
            reply_id: "after_done",
            title: "Theek hai",
            next_node_key: "end",
          },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "more_list",
      node_type: "send_list",
      config: {
        text: "Aur kya jaanna hai?",
        button_label: "Options",
        sections: [
          {
            title: "Jaankari",
            rows: [
              {
                reply_id: "more_subsidy",
                title: "Subsidy kya hai",
                description: "PM Surya Ghar central slab",
                next_node_key: "subsidy_msg",
              },
              {
                reply_id: "more_quote",
                title: "Quote chahiye",
                description: "Bill ke hisaab se size + cost",
                next_node_key: "check_lead_info",
              },
              {
                reply_id: "more_human",
                title: "Agent se baat",
                description: "Team aapko call / WhatsApp karegi",
                next_node_key: "handoff",
              },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: "process_msg",
      node_type: "send_message",
      config: {
        text: "Solar lagane ka pura process aisa hai:\n\n1. Free site survey & bill verification (15 min call or visit)\n2. Custom quotation + subsidy calculation, shared on WhatsApp\n3. Aap approve → documentation & DISCOM subsidy registration\n4. Installation, net meter & DISCOM inspection (7–15 days)\n5. System commissioning + subsidy directly credited to your bank\n\nTotal time: aksar 2-4 hafte. Aap sirf document sign karte hain, baaki hum sambhalte hain.",
        next_node_key: "after_info",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "subsidy_msg",
      node_type: "send_message",
      config: {
        text: "PM Surya Ghar (central) subsidy residential rooftop par:\n\n• Pehle 2 kW: ₹30,000 per kW (max ₹60,000)\n• 3rd kW: ₹18,000\n• 3 kW par total: *₹78,000* (isi par cap)\n• 3 kW se bade system par extra central subsidy nahi\n\nSubsidy seedha aapke bank account me aati hai, company ke through nahi.\nKuch states extra top-up dete hain — exact amount ke liye apna state bata kar agent se baat karein.",
        next_node_key: "after_info",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "after_info",
      node_type: "send_buttons",
      config: {
        text: "Aur kuch chahiye?",
        buttons: [
          {
            reply_id: "info_quote",
            title: "Quote chahiye",
            next_node_key: "check_lead_info",
          },
          {
            reply_id: "info_agent",
            title: "Agent se baat",
            next_node_key: "handoff",
          },
          {
            reply_id: "info_done",
            title: "Theek hai",
            next_node_key: "end",
          },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: "Solar lead — customer asked to talk to an engineer. Check bill slab / quote in the thread, then send a site-survey slot.",
      } as HandoffNodeConfig,
    },
    {
      node_key: "end",
      node_type: "end",
      config: {},
    },
  ],
};

const TEMPLATES: Record<string, FlowTemplate> = {
  solar_assistant: SOLAR_ASSISTANT,
  welcome_menu: WELCOME_MENU,
  faq_bot: FAQ_BOT,
  lead_capture: LEAD_CAPTURE,
};

export function getFlowTemplate(slug: string): FlowTemplate | null {
  return TEMPLATES[slug] ?? null;
}

export function listFlowTemplates(): FlowTemplate[] {
  return Object.values(TEMPLATES);
}
