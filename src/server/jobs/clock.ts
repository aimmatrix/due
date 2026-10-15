/**
 * Application clock (A0). The demo can move a SIMULATED clock forward to show overdue follow-ups.
 * It never touches Stripe's clock or Stripe timestamps. Everything derived from it is labelled.
 */
import type { AppTime, DemoClockRequest } from "@/contracts";
import type { Repositories } from "@/server/db";

const OFFSET_KEY = "app_clock_offset_ms";

export function getAppTime(repos: Repositories, realNow: Date = new Date()): AppTime {
  const offsetMs = Number(repos.settings.get(OFFSET_KEY) ?? "0") || 0;
  return { now: new Date(realNow.getTime() + offsetMs).toISOString(), simulated: offsetMs !== 0, offsetMs };
}

/** Moves the simulated clock. It can only move forward relative to the current app time (or reset). */
export function setAppClock(repos: Repositories, req: DemoClockRequest, realNow: Date = new Date()): AppTime {
  const current = getAppTime(repos, realNow);
  let offsetMs: number;
  if ("reset" in req) offsetMs = 0;
  else if ("advanceHours" in req) {
    if (!Number.isFinite(req.advanceHours) || req.advanceHours <= 0 || req.advanceHours > 24 * 60) {
      throw new RangeError("advanceHours must be between 0 and 1440");
    }
    offsetMs = current.offsetMs + Math.round(req.advanceHours * 3_600_000);
  } else {
    const target = Date.parse(req.setTo);
    if (Number.isNaN(target)) throw new RangeError("setTo must be an ISO-8601 timestamp");
    if (target < Date.parse(current.now)) throw new RangeError("The simulated clock cannot move backwards; reset instead");
    offsetMs = target - realNow.getTime();
  }
  repos.settings.set(OFFSET_KEY, String(offsetMs));
  return getAppTime(repos, realNow);
}
