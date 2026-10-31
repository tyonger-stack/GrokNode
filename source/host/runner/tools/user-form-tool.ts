import { requestUserFormParameters, remapUserFormTargetsParameters } from "../../../shared/user-forms.js";
import type { UserFormService } from "../../extensions/session/user-form-service.js";
import { defineCommunicateTool } from "./communicate-tool.js";

export interface UserFormToolDependencies {
  readonly userForms: UserFormService;
  getAgentId(): string;
  getTurnId(): string;
  endThisRunAwaitingUser(reason: string): void;
}
export function createUserFormTools(deps: UserFormToolDependencies) {
  const request = defineCommunicateTool(deps, {
    id: "REQUEST_USER_FORM", name: "RequestUserForm", parameters: requestUserFormParameters,
    description: [
      "Request a write-only form and end this turn awaiting the user. Values never return to the model. Request only visible fields; secrets require a verified domain and target. Never screenshot filled secrets. Enter submission is limited to a single OTP field.",
      "For payment cards use saveToVault:\"card\" with fields cc_number and cc_exp (required) plus optional cc_csc, cc_name, cc_nickname and billing_* fields. The user's entries are saved to their Vault and you only learn which fields were filled — never the values.",
    ].join("\n"),
    execute: async (_ctx, args: unknown, runtime) => {
      const result = await runtime.userForms.request(runtime.getAgentId(), runtime.getTurnId(), args);
      if (result.status === "shown") runtime.endThisRunAwaitingUser("user-form");
      return JSON.stringify(result);
    },
  });
  const remap = defineCommunicateTool(deps, {
    id: "REMAP_USER_FORM_TARGETS", name: "RemapUserFormTargets", parameters: remapUserFormTargetsParameters,
    description: "Remap held field IDs to visible editable targets on the same exact host once in this resumed turn. No values accepted. Values are discarded after remap or resumed turn end.",
    execute: async (_ctx, args: unknown, runtime) => JSON.stringify(await runtime.userForms.remap(runtime.getAgentId(), runtime.getTurnId(), args)),
  });
  return [request, remap];
}
