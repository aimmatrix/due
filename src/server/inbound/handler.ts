import { DEMO_ORGANISATION_ID as ORG } from "@/contracts";
import { ConfigError } from "@/server/config/env";
import { ingestCompletion, processBillingRun, type BillingRuntime } from "@/server/orchestration/billing";
import { recordCustomerMessage, type MessageRuntime } from "@/server/orchestration/messages";
import { getRuntime } from "@/server/orchestration/runtime";
import { inboundConfig, mailbox, type InboundConfig } from "./config";
import { fetchReceivedEmail, receivedEvent, verifyReceivedEvent } from "./resend";
import { plainBody } from "./text";

type Runtime = BillingRuntime & MessageRuntime;
interface Dependencies {
  config?: () => InboundConfig;
  runtime?: () => Runtime;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}
const result = (route: string, status: string, extra = {}) => Response.json({ data: { route, status, ...extra } });
const ignored = (reason: string) => {
  // Constant reason codes only: never log addresses, subjects, body or credentials.
  console.info(`[inbound_email] ignored: ${reason}`);
  return result("ignored", "ignored", { reason });
};

export function createInboundHandler(deps: Dependencies = {}) {
  return async (req: Request): Promise<Response> => {
    let cfg: InboundConfig;
    try { cfg = (deps.config ?? inboundConfig)(); }
    catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      return Response.json({ error: { code: "INBOUND_NOT_CONFIGURED" } }, { status: 503 });
    }
    const raw = await req.text();
    let eventId: string;
    try { eventId = verifyReceivedEvent(raw, req.headers, cfg.webhookSecret, (deps.now ?? (() => new Date()))()); }
    catch { return Response.json({ error: { code: "INVALID_SIGNATURE" } }, { status: 400 }); }
    let event: ReturnType<typeof receivedEvent>;
    try { event = receivedEvent(raw); }
    catch { return Response.json({ error: { code: "INVALID_EVENT" } }, { status: 400 }); }
    if (!event) return ignored("UNSUPPORTED_EVENT");
    const sender = mailbox(event.data.from);
    if (!sender || !cfg.allowedSenders.includes(sender)) return ignored("SENDER_NOT_ALLOWED");
    const recipients = event.data.to.map(mailbox).filter((v): v is string => !!v);
    const domain = cfg.completionsAddress.split("@")[1]!;
    if (!recipients.some((r) => r.split("@")[1] === domain)) return ignored("UNKNOWN_RECIPIENT");

    let rt: Runtime | undefined;
    let claimed = false;
    try {
      rt = (deps.runtime ?? getRuntime)();
      claimed = rt.repos.webhooks.markProcessed("inbound_email", eventId);
      if (!claimed) return result("duplicate", "duplicate");
      const email = await fetchReceivedEmail(event.data.email_id, cfg.apiKey, deps.fetchImpl);
      if (email.message_id !== event.data.message_id) throw new Error("INBOUND_MESSAGE_MISMATCH");
      const text = plainBody(email.text, email.html);
      if (!text) return ignored("EMPTY_BODY");
      const common = { organisationId: ORG, externalEventId: email.message_id, sourceType: "email" as const, sourceRef: email.message_id, text, receivedAt: new Date(event.created_at).toISOString() };
      const tokens = new Set(event.data.subject.toUpperCase().match(/\bDUE-\d+\b/g) ?? []);
      for (const recipient of recipients) {
        const [local, recipientDomain] = recipient.split("@");
        if (recipientDomain !== domain) continue;
        const token = local?.match(/\+(DUE-\d+)$/i)?.[1];
        if (token) tokens.add(token.toUpperCase());
      }
      // An explicit reply token wins over the completion mailbox, preventing accidental rebilling.
      if (!tokens.size && recipients.includes(cfg.completionsAddress)) {
        const haystack = `${event.data.subject}\n${text}`.toLowerCase();
        const customers = rt.repos.customers.list(ORG).filter((c) => [c.displayName, ...c.matchKeys, c.id].some((key) => {
          const escaped = key.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return key.length > 1 && new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(haystack);
        }));
        const customerRef = customers.length === 1 ? customers[0]!.id : "unresolved inbound customer";
        const ingest = await ingestCompletion(rt, { ...common, customerRef });
        const run = await processBillingRun(rt, ORG, ingest.billingRunId);
        return result("completion", ingest.status, { billingRunId: ingest.billingRunId, evidenceId: ingest.evidenceId, billingRunState: run.state });
      }
      if (tokens.size !== 1) return ignored(tokens.size ? "AMBIGUOUS_INVOICE" : "UNKNOWN_INVOICE");
      const token = [...tokens][0]!;
      const invoices = rt.repos.invoices.list(ORG).filter((i) => i.stripeInvoiceNumber?.toUpperCase() === token);
      if (invoices.length !== 1) return ignored(invoices.length ? "AMBIGUOUS_INVOICE" : "UNKNOWN_INVOICE");
      const invoice = invoices[0]!;
      const customer = rt.repos.customers.get(ORG, invoice.customerId);
      if (!customer) return ignored("UNKNOWN_CUSTOMER");
      if (customer.contactEmails.length && !customer.contactEmails.some((v) => mailbox(v) === sender)) return ignored("CUSTOMER_SENDER_MISMATCH");
      const outcome = await recordCustomerMessage(rt, { ...common, customerRef: customer.id, invoiceId: invoice.id });
      if (!outcome.ok) return ignored(outcome.code);
      return result("customer_reply", outcome.status, { evidenceId: outcome.evidenceId });
    } catch {
      if (claimed && rt) rt.repos.webhooks.unmark("inbound_email", eventId);
      console.error("[inbound_email] processing failed; delivery may be retried");
      return Response.json({ error: { code: "INBOUND_PROCESSING_FAILED" } }, { status: 503 });
    }
  };
}
