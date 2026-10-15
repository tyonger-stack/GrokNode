import { defineHostExtension } from "../../../internal/host-extensions.js";
import { HostExtensions } from "../extension-ids.generated.js";
import { createBoxTimezoneApplier, createBoxTimezoneService } from "./box-timezone-service.js";

interface BoxTimezoneSettings {
  getUserTimeZone(): string | undefined;
  subscribeToUserTimeZone(listener: (timeZone: string | undefined) => void): () => void;
}

export const boxTimezoneExtension = defineHostExtension<unknown, { log(message: string): void }>({
  id: HostExtensions.BoxTimezone,
  dependencies: [HostExtensions.Settings],
  start: (context) => {
    const settings = context.deps[HostExtensions.Settings] as BoxTimezoneSettings;
    const applyZone = createBoxTimezoneApplier({ log: (message) => context.host.log(message) });
    if (applyZone === undefined) return { isEnabled: false };
    const service = createBoxTimezoneService({
      getUserTimeZone: () => settings.getUserTimeZone(),
      subscribeToUserTimeZone: (listener) => settings.subscribeToUserTimeZone(listener),
      applyZone,
      log: (message) => context.host.log(message),
    });
    context.onStop(() => service.dispose());
    service.start();
    return { isEnabled: true };
  },
});
