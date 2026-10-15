/** Constant-time shared-secret checks for inbound event routes (A0). */
import { timingSafeEqual } from "node:crypto";

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** True when `Authorization: Bearer <expected>` is present. */
export function hasBearer(req: Request, expected: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return !!m && safeEqual(m[1]!.trim(), expected);
}
