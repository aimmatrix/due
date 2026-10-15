/** Europe/London calendar helpers for promise dates. Pure; no clock reads. */
import { PRESENTATION_TIMEZONE, type IsoUtc, type LondonDate } from "@/contracts";

const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: PRESENTATION_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const offsetFmt = new Intl.DateTimeFormat("en-GB", { timeZone: PRESENTATION_TIMEZONE, timeZoneName: "longOffset" });

/** London calendar date of an instant, e.g. "2026-10-31". */
export function londonDate(iso: IsoUtc): LondonDate {
  return dateFmt.format(new Date(iso));
}

export function isValidLondonDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T12:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

/** Whole days from `from` to `to` (both London dates). */
export function daysBetween(from: LondonDate, to: LondonDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function addDays(d: LondonDate, days: number): LondonDate {
  return new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function londonOffsetMinutes(at: Date): number {
  const tz = offsetFmt.formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(tz);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** UTC instant of 00:00 Europe/London on the given date (correct on BST/GMT change days). */
export function startOfLondonDay(d: LondonDate): IsoUtc {
  const midnightUtc = Date.parse(`${d}T00:00:00Z`);
  // Use the offset in force at the candidate instant itself, refined once.
  let guess = midnightUtc - londonOffsetMinutes(new Date(midnightUtc)) * 60_000;
  guess = midnightUtc - londonOffsetMinutes(new Date(guess)) * 60_000;
  return new Date(guess).toISOString();
}

export const addHours = (iso: IsoUtc, hours: number): IsoUtc => new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
