import { useMemo } from "react";
import { localTeamsDesktop } from "../recovered/features/local-teams-0721/bridge";
import { LocalTeamsPanel } from "../recovered/features/local-teams-0721/local-teams-panel";
import styles from "../recovered/features/local-teams-0721/styles.css?inline";

export function RLocalTeamsHost() {
  const bridge = useMemo(() => {
    try { return { kind: "ready", desktop: localTeamsDesktop(Reflect.get(window, "desktop")) } as const; }
    catch { return { kind: "unavailable" } as const; }
  }, []);
  return <><style>{styles}</style>{bridge.kind === "ready" ? <LocalTeamsPanel desktop={bridge.desktop} />
    : <div className="local-teams-0721"><h2>Local teams &amp; Tailnet</h2><p role="alert">The local teams bridge is unavailable. Rebuild the desktop preload and backend together.</p></div>}</>;
}
