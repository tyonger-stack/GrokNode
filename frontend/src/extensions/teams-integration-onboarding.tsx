import { useState, type ReactNode } from "react";

export type TeamsLinkStatus = "unlinked" | "pending" | "linked" | "failed";

export interface TeamsOnboardingCopy {
  readonly title: string;
  readonly intro: string;
  readonly guestIntro: string;
  readonly tenantLabel: string;
  readonly linkAction: string;
  readonly unlinkAction: string;
  readonly continueAction: string;
  readonly doneLabel: string;
  readonly cancelLabel: string;
  readonly tryAgain: string;
  readonly loading: string;
}

export const TEAMS_ONBOARDING_COPY_IDS: Record<keyof TeamsOnboardingCopy, string> = {
  title: "Q/FQnX",
  intro: "6UnAIy",
  guestIntro: "u06FXM",
  tenantLabel: "M70AxZ",
  linkAction: "xGVfLh",
  unlinkAction: "za0POa",
  continueAction: "xGVfLh",
  doneLabel: "DPfwMq",
  cancelLabel: "dEgA5A",
  tryAgain: "KDw4GX",
  loading: "yQE2r9",
};

export const DEFAULT_TEAMS_ONBOARDING_COPY: TeamsOnboardingCopy = {
  title: "Microsoft Teams account",
  intro: "Link your Microsoft Teams account so Team Bots know who you are in Microsoft Teams.",
  guestIntro: "Link your Microsoft Teams account so Team Bots know who you are in Microsoft Teams. Guests can enter the organization tenant ID from Teams.",
  tenantLabel: "Organization tenant ID",
  linkAction: "Continue",
  unlinkAction: "Unlink Microsoft Teams",
  continueAction: "Continue",
  doneLabel: "Done",
  cancelLabel: "Cancel",
  tryAgain: "Try again",
  loading: "Loading",
};

export function TeamsIntegrationOnboarding(props: {
  readonly status: TeamsLinkStatus;
  readonly tenantRequired?: boolean;
  readonly copy?: Partial<TeamsOnboardingCopy>;
  readonly detail?: string | null;
  readonly disabled?: boolean;
  readonly onStartLink: (tenantId: string | null) => void;
  readonly onUnlink?: () => void;
  readonly onRetry?: () => void;
  readonly onClose: () => void;
}): ReactNode {
  const copy: TeamsOnboardingCopy = { ...DEFAULT_TEAMS_ONBOARDING_COPY, ...props.copy };
  const [tenantId, setTenantId] = useState("");
  return (
    <section className="sand-teams-onboarding" aria-label={copy.title}>
      <h2 className="sand-teams-onboarding-title">{copy.title}</h2>
      {props.status === "linked"
        ? <p className="sand-teams-onboarding-status" role="status">{copy.doneLabel}</p>
        : <p className="sand-teams-onboarding-intro">{props.tenantRequired === true ? copy.guestIntro : copy.intro}</p>}
      {props.status === "pending" ? <p className="sand-teams-onboarding-status" role="status">{copy.loading}</p> : null}
      {props.status === "failed" ? <p className="sand-teams-onboarding-error" role="alert">{props.detail ?? copy.tryAgain}</p> : null}
      {(props.status === "unlinked" || props.status === "failed") && props.tenantRequired === true ? (
        <label className="sand-teams-onboarding-field">
          <span>{copy.tenantLabel}</span>
          <input aria-label={copy.tenantLabel} disabled={props.disabled} onChange={(event) => setTenantId(event.target.value)} value={tenantId} />
        </label>
      ) : null}
      <div className="sand-teams-onboarding-actions">
        {props.status === "linked"
          ? <>{props.onUnlink == null ? null : <button disabled={props.disabled} onClick={props.onUnlink} type="button">{copy.unlinkAction}</button>}<button onClick={props.onClose} type="button">{copy.doneLabel}</button></>
          : <>
            <button disabled={props.disabled} onClick={() => props.onStartLink(props.tenantRequired === true && tenantId.trim() !== "" ? tenantId.trim() : null)} type="button">
              {props.status === "failed" ? copy.tryAgain : copy.continueAction}
            </button>
            <button onClick={props.onClose} type="button">{copy.cancelLabel}</button>
          </>}
      </div>
    </section>
  );
}

const TEAMS_LINK_UNAVAILABLE = "Microsoft Teams account linking needs a cloud token exchange, which this local build does not perform.";

export function TeamsOnboardingHost(): ReactNode {
  const [status, setStatus] = useState<TeamsLinkStatus>("unlinked");
  const [detail, setDetail] = useState<string | null>(null);
  return (
    <TeamsIntegrationOnboarding
      detail={detail}
      onClose={() => { setStatus("unlinked"); setDetail(null); }}
      onStartLink={() => { setStatus("failed"); setDetail(TEAMS_LINK_UNAVAILABLE); }}
      status={status}
    />
  );
}
