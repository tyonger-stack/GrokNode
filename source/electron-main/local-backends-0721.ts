import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { decodeLibraryJson } from "../shared/library/json-bytes.js";
import type { ProductionServiceContext } from "./main-production-services.js";
import { createLocalTailnet } from "./tailnet/local-tailnet.js";
import { createLocalVaultBackend, type CardTextRecognitionNative } from "./vault/local-vault-backend.js";

const instances = new WeakMap<ProductionServiceContext, ReturnType<typeof createBackends>>();
const recognizedText = z.array(z.array(z.string())).nullable();

function loadCardPhotoNative(): CardTextRecognitionNative | undefined {
  let binding: unknown;
  try { binding = require(join(__dirname, "../deps/sand-card-text-recognition")); }
  catch { return undefined; }
  if (typeof binding !== "object" || binding === null || !("recognize_text_async" in binding) ||
      typeof binding.recognize_text_async !== "function") return undefined;
  const recognize = binding.recognize_text_async;
  return { async recognize_text_async(image) { return recognizedText.parse(await recognize(image)); } };
}

function createBackends(context: ProductionServiceContext) {
  const profile = realpathSync(context.native.app.getPath("userData"));
  const accountScope = createHash("sha256").update("grok-node-local-profile\0").update(profile).digest("hex");
  const privateRoot = join(profile, "local-0721");
  let vault: ReturnType<typeof createLocalVaultBackend> | undefined;
  const getVault = (): ReturnType<typeof createLocalVaultBackend> => vault ??= createLocalVaultBackend({
    accountScope, storePath: join(privateRoot, "vault.enc"), codec: context.native.safeStorage,
    loadCardPhotoNative, onChange: () => syncVaultContext().catch(() => undefined),
  });
  const syncVaultContext = async (): Promise<void> => {
    try {
      const snapshot = await getVault().sessionSnapshot();
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const applied = await context.coordinatorResync.pushHostSettings({ grokBotVaultContext: snapshot });
          if (applied !== null) return;
          lastError = new Error("Host rejected the Vault session context");
        } catch (error) { lastError = error; }
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
      throw lastError ?? new Error("Host did not acknowledge the Vault session context");
    } catch (error) {
      await context.coordinatorResync.pushHostSettings({ grokBotVaultContext: null }).catch(() => null);
      context.reportFailure("vault", "session-context-sync", error);
      throw error;
    }
  };
  const tailnet = createLocalTailnet({ dataRoot: privateRoot, codec: context.native.safeStorage,
    async requireTeam(teamId, action) {
      const legs = context.coordinatorLegs.legs;
      const credential = await legs.libraryMainCredential?.();
      if (typeof credential !== "string" || !credential) throw new Error("Local team identity is unavailable");
      const call = legs.checkLocalTeamAccess;
      if (!call) throw new Error("Local team authorization is unavailable");
      const result = decodeLibraryJson(await call({ teamId, action, credential }));
      z.object({ authorized: z.literal(true) }).parse(result);
    },
  });
  return { syncVaultContext, get vault() { return getVault(); }, tailnet };
}

export type Local0721Backends = ReturnType<typeof createBackends>;

export function getLocal0721Backends(context: ProductionServiceContext): Local0721Backends {
  let instance = instances.get(context);
  if (!instance) { instance = createBackends(context); instances.set(context, instance); }
  return instance;
}
