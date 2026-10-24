import type { ReactNode } from "react";
import { TeamsOnboardingHost } from "../../../../extensions/teams-integration-onboarding";
import type { DesktopBridge } from "../../../contracts/desktop-bridge";
import type { ProductionCoordinatorClient } from "../../../../production/coordinator-client";

export function Port0750SettingsExtras(_props: {
  readonly bridge: Pick<DesktopBridge, "agent" | "experiments">;
  readonly coordinator: Pick<ProductionCoordinatorClient, "call"> | null;
}): ReactNode {
  return <TeamsOnboardingHost />;
}
