/**
 * B1 voice lane (teammate, ElevenLabs). SIGNATURE LOCKED by src/contracts/modules.ts (VoiceAdapter).
 */
import { NotImplementedError, type VoiceAdapter } from "@/contracts";

export function getVoiceAdapter(): VoiceAdapter {
  return {
    async startCollectionCall() {
      throw new NotImplementedError("voice.startCollectionCall (B1)");
    },
    async verifyAndNormaliseCallEvent() {
      throw new NotImplementedError("voice.verifyAndNormaliseCallEvent (B1)");
    },
  };
}
