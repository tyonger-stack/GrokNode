import { defineHostExtension } from "../../../internal/host-extensions.js";
import { createContext } from "../../../packages/context/core.js";
import { HostExtensions } from "../extension-ids.generated.js";
import { createAttachmentsService, type AttachmentsServiceDependencies } from "./attachments-service.js";

export const attachmentsExtension = defineHostExtension({
  id: HostExtensions.Attachments,
  dependencies: [HostExtensions.Auth, HostExtensions.ForeverBox, HostExtensions.Telemetry],
  start: (context) => {
    const deps = context.deps as { auth: AttachmentsServiceDependencies["auth"]; "forever-box": { box: AttachmentsServiceDependencies["box"] }; telemetry: { logs: { reportHostExtensionDiagnostic(value: Record<string, unknown>): void } } };
    const [ctx, cancel] = createContext().withName("attachments").withCancel();
    const service = createAttachmentsService({ auth: deps.auth, box: deps["forever-box"].box, ctx, report: (diagnostic) => deps.telemetry.logs.reportHostExtensionDiagnostic(diagnostic) });
    context.onStop(() => { service.dispose(); cancel(new Error("Attachments extension stopped")); });
    return service;
  }
});
