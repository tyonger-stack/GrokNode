import type { ReactNode } from "react";
import { TeamsOnboardingHost } from "../../../../extensions/teams-integration-onboarding";
import { VaultCardDialogHost } from "../../../../extensions/vault-card-dialog-host";
import type { DesktopBridge } from "../../../contracts/desktop-bridge";
import type { ProductionCoordinatorClient } from "../../../../production/coordinator-client";
import { MemoryImportHost } from "./memory-import-host";

export function Port0750SettingsExtras(props: {
  readonly bridge: Pick<DesktopBridge, "agent" | "experiments">;
  readonly coordinator: Pick<ProductionCoordinatorClient, "call"> | null;
}): ReactNode {
  return (
    <>
      <MemoryImportHost bridge={props.bridge} coordinator={props.coordinator} />
      <VaultCardDialogHost />
      <TeamsOnboardingHost />
    </>
  );
}
