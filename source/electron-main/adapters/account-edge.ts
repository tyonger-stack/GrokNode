import type { ElectronProductionAdapterBindings } from "../production-adapters.js";
import { stepFunCredential, transcribeWithStepFun } from "../account/stepfun-transcribe.js";

class LocalTranscriptionManager {
  async transcribe(args: { readonly audio: Uint8Array; readonly mimeType: string; readonly language?: string }): Promise<{ text: string; transcriptionTimeMs: number }> {
    if (args.audio.length === 0) throw new Error("Cannot transcribe empty audio.");
    if (stepFunCredential() == null) throw new Error("Local transcription needs STEPFUN_API_KEY.");
    const startedAt = Date.now();
    const result = await transcribeWithStepFun({ audio: args.audio, mimeType: args.mimeType, ...(args.language == null ? {} : { language: args.language }) });
    return { text: result.text, transcriptionTimeMs: Date.now() - startedAt };
  }
}

export function createElectronProductionLocalAccountBinding(): ElectronProductionAdapterBindings["localAccount"] {
  return {
    create: () => ({}),
    createTranscriptionManager: () => async () => new LocalTranscriptionManager(),
  };
}
