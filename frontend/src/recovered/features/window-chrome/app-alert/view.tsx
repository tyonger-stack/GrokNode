import { useId, useRef, useSyncExternalStore } from "react";
import type { AppAlertController } from "./controller";
import { OverlayDialog } from "../../../ui/overlay-primitives";
import { SandButton } from "../../../ui/sand-kit-primitives";

// The shipped alert host is JVn over the shared modal Root. This leaf remains
// unmounted until the root app-context owner is ready.
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5743352
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=7222969

export interface AppAlertHostProps {
  readonly controller: AppAlertController;
}

export function AppAlertHost({ controller }: AppAlertHostProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const open = state != null;
  const request = state?.request ?? null;

  if (request == null || state == null) return null;
  const width = request.width === "wide" ? 500 : 320;
  const hasBody = request.body != null || request.warning != null || state.failure != null;
  const confirmLabel = state.isPerforming ? request.pendingLabel ?? request.confirmLabel : request.confirmLabel;
  const actionStyle = {
    flex: 1,
    height: 32,
    padding: "6px 12px",
    borderRadius: 9999,
    color: "var(--sand-text-primary)",
    font: '420 14px/20px -apple-system, "system-ui", "Segoe UI", sans-serif',
  } as const;
  const confirmStyle = request.destructive === true
    ? { ...actionStyle, background: "var(--sand-bg-danger-primary)" }
    : actionStyle;

  return (
      <OverlayDialog
        closeOnBackdrop={state.isPerforming !== true}
        closeOnEscape={state.isPerforming !== true}
        describedBy={request.description == null ? undefined : descriptionId}
        initialFocusRef={confirmRef}
        labelledBy={titleId}
        onClose={() => controller.cancel()}
        open
        className="sand-dialog sand-alert-dialog"
        panelStyle={{ position: "fixed", inset: "50% auto auto 50%", boxSizing: "border-box", width: `min(${width}px, calc(100% - 32px))`, padding: 0, color: "var(--sand-text-primary)", background: "var(--sand-bg-elevated)", border: ".5px solid var(--sand-border-default)", borderRadius: 14, boxShadow: "none", transform: "translate(-50%, -50%)", zIndex: 3200 }}
        dataPresentation="simple"
      >
        <header style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, padding: "12px 16px" }}><h2 id={titleId} style={{ margin: 0, color: "inherit", font: '600 14px/22px -apple-system, "system-ui", "Segoe UI", sans-serif' }}>{request.title}</h2>{request.description == null ? null : <p id={descriptionId} style={{ margin: 0, color: "var(--sand-text-secondary)", font: '420 14px/22px -apple-system, "system-ui", "Segoe UI", sans-serif' }}>{request.description}</p>}</header>
        {hasBody ? <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 16px 12px", color: "var(--sand-text-secondary)", font: '420 14px/22px -apple-system, "system-ui", "Segoe UI", sans-serif' }}>{request.body == null ? null : <p style={{ margin: 0 }}>{request.body}</p>}{request.warning == null ? null : <p style={{ margin: 0 }}>{request.warning}</p>}{state.failure == null ? null : <p role="alert" style={{ margin: 0 }}>{state.failure}</p>}</div> : null}
        <footer className="sand-alert-dialog__footer" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "12px 12px 12px 16px" }}><div className="sand-alert-dialog__actions" style={{ display: "flex", gap: 8, width: "100%" }}>
          {request.cancelLabel == null ? null : <SandButton disabled={state.isPerforming} onClick={() => controller.cancel()} size="sm" style={actionStyle} variant="secondary">{request.cancelLabel}</SandButton>}
          {request.secondary == null ? null : <SandButton className="sand-alert-dialog__secondary" data-destructive={request.secondary.destructive === true ? "true" : undefined} disabled={state.isPerforming} onClick={() => controller.confirmSecondary()} sentiment={request.secondary.destructive === true ? "danger" : "neutral"} size="sm" style={actionStyle} variant="secondary">{request.secondary.label}</SandButton>}
          <SandButton data-destructive={request.destructive === true ? "true" : undefined} disabled={state.isPerforming} onClick={() => controller.confirm()} ref={confirmRef} sentiment={request.destructive === true ? "danger" : "neutral"} size="sm" style={confirmStyle}>{confirmLabel}</SandButton>
        </div></footer>
      </OverlayDialog>
  );
}
