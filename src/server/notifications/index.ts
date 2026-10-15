/**
 * A3 notifications lane (reminder email). SIGNATURE LOCKED by src/contracts/modules.ts (NotificationsAdapter).
 */
import { NotImplementedError, type NotificationsAdapter } from "@/contracts";

export function getNotificationsAdapter(): NotificationsAdapter {
  return {
    async sendReminder() {
      throw new NotImplementedError("notifications.sendReminder (A3)");
    },
    verifyDeliveryEvent() {
      throw new NotImplementedError("notifications.verifyDeliveryEvent (A3)");
    },
  };
}
