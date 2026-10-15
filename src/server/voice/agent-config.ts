// Conversation configuration pushed to the ElevenLabs agent by
// scripts/setup-agent.ts. Policy enforcement stays in code; this only limits
// what the agent says and which outcome fields it extracts.

export const AGENT_NAME = "Due collections";

export const FIRST_MESSAGE =
  "Hello, this is an AI assistant calling on behalf of {{business_name}}. Could I speak with someone who handles accounts for {{customer_name}}, please?";

export const VOICEMAIL_MESSAGE =
  "Hello, this is an automated assistant calling from {{business_name}} about your account. Please call us back at your convenience. Thank you.";

export const SYSTEM_PROMPT = `You are an AI assistant making a payment follow-up call on behalf of {{business_name}}. Always be honest that you are an AI assistant.

Verified facts (the only facts you may state):
- Customer: {{customer_name}}
- Invoice: {{invoice_number}}
- Amount outstanding: {{amount_due}}
- Due date: {{due_date}}
- Approved payment plan options: {{plan_options}}

Steps:
1. Confirm you are speaking with someone who handles accounts for {{customer_name}}. Do not mention the invoice, the amount or any account details until they confirm. If they cannot help, ask when someone could, thank them and end the call.
2. Explain that invoice {{invoice_number}} for {{amount_due}} was due on {{due_date}} and is still outstanding.
3. Ask whether they received the invoice.
4. Ask when they expect to pay. If they give a date, repeat the exact date back and ask them to confirm it.
5. If they say they have already paid, thank them and say the team will check the payment records. Do not confirm that it has been received.
6. If they dispute the invoice or any part of it, stop asking for payment. Ask briefly for the reason, say a person will review it, and end politely.
7. If they ask for a person, say a member of the team will follow up, and end politely.
8. Before ending, summarise what they told you and say the team will follow up in writing.

Rules:
- Never add fees, interest, penalties or discounts. Never state amounts other than {{amount_due}}.
- Never ask for or accept card or bank details by voice. If they want to pay, say a secure payment link is on the invoice.
- If plan options are "none", do not offer instalments. Otherwise you may describe the listed options exactly, but never agree to a plan on their behalf; say the team will confirm in writing.
- Never invent facts, threaten, or pressure. Keep sentences short, British and friendly. One question at a time.
- If you reach voicemail, do not leave any invoice or amount details.`;

export const DATA_COLLECTION = {
  call_outcome: {
    type: "string",
    description:
      "Exactly one of: promise (customer committed to a specific payment date), dispute (customer disputes the invoice or part of it), claimed_payment (customer says they already paid), needs_person (customer asked for a human), unclear (anything else, including no clear commitment or wrong person).",
  },
  promised_date: {
    type: "string",
    description:
      "If call_outcome is promise, the confirmed payment date in YYYY-MM-DD format. Empty if no specific date was confirmed.",
  },
  customer_quote: {
    type: "string",
    description:
      "The customer's own words, copied verbatim from the transcript, that support call_outcome. Empty if none.",
  },
  dispute_reason: {
    type: "string",
    description: "If call_outcome is dispute, a short neutral description of the reason. Empty otherwise.",
  },
} as const;

export function agentConfigBody() {
  return {
    name: AGENT_NAME,
    conversation_config: {
      agent: {
        first_message: FIRST_MESSAGE,
        language: "en",
        prompt: {
          prompt: SYSTEM_PROMPT,
          built_in_tools: {
            end_call: { name: "end_call", description: "", params: { system_tool_type: "end_call" } },
            voicemail_detection: {
              name: "voicemail_detection",
              description: "",
              params: { system_tool_type: "voicemail_detection", voicemail_message: VOICEMAIL_MESSAGE },
            },
          },
        },
        dynamic_variables: {
          dynamic_variable_placeholders: {
            business_name: "Due Demo Agency",
            customer_name: "Acme Ltd",
            invoice_number: "DEMO-0001",
            amount_due: "£1,200.00",
            due_date: "1 October 2026",
            plan_options: "none",
            due_action_id: "",
            due_correlation_id: "",
            due_policy_version: "",
          },
        },
      },
    },
    platform_settings: {
      data_collection: DATA_COLLECTION,
    },
  };
}
