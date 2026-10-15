import { env } from "@/server/config/env";
import { getNotificationsAdapter } from "@/server/notifications";
import { getRuntime } from "@/server/orchestration/runtime";
import { getVoiceAdapter } from "@/server/voice";
import type { SchedulerRuntime } from "./scheduler";

export function getSchedulerRuntime(): ReturnType<typeof getRuntime> & SchedulerRuntime {
  return { ...getRuntime(), notifications: getNotificationsAdapter(),
    ...(env.adapterMode("voice") === "real" ? { voice: getVoiceAdapter() } : {}),
  };
}
