/** Reminder email content. Only verified facts: no fees, interest or invented terms. */
import { formatMoney, type SendReminderInput } from "@/contracts";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function reminderContent(input: SendReminderInput): { subject: string; text: string; html: string } {
  const amount = formatMoney(input.amountRemainingMinor, input.currency);
  const due = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" }).format(new Date(input.dueAt));
  const ref = input.invoiceNumber ?? "your invoice";
  const subject = `Payment reminder: ${ref} (${amount} outstanding)`;
  const lines = [
    `Hello ${input.customerName},`,
    "",
    `This is a reminder that invoice ${ref} was due on ${due} and ${amount} is still outstanding.`,
    input.hostedInvoiceUrl ? `You can view and pay it here: ${input.hostedInvoiceUrl}` : "",
    "",
    "If you have already paid, or there is a problem with this invoice, just reply to this email and we will look into it.",
    "",
    "This message was sent by an AI accounts assistant on behalf of the team.",
  ].filter((l, i, a) => !(l === "" && a[i - 1] === ""));
  const text = lines.join("\n");
  const html = lines.map((l) => (l ? `<p>${escape(l).replace(/(https:\/\/\S+)/g, '<a href="$1">$1</a>')}</p>` : "")).join("");
  return { subject, text, html };
}
