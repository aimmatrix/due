function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, code: string) => {
    if (!code.startsWith("#")) return named[code.toLowerCase()] ?? whole;
    const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
  });
}

export function plainBody(text?: string | null, html?: string | null): string {
  // Bound work before parsing. No HTML is rendered or executed, and no links are fetched.
  let body = text?.trim() ? text.slice(0, 200000) : (html ?? "").slice(0, 200000)
    .replace(/<blockquote\b[\s\S]*$/i, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(?:div|span)\b[^>]*class=["'][^"']*(?:gmail_quote|yahoo_quoted)[^"']*["'][\s\S]*$/i, "")
    .replace(/<\s*br\s*\/?\s*>|<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  if (!text?.trim()) body = decodeEntities(body);
  const lines: string[] = [];
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(?:On\s+.+wrote:|[-_]{2,}\s*(?:Original Message|Forwarded message))/i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    lines.push(line);
  }
  return lines.join("\n").trim().slice(0, 20000);
}
