import type { InputHTMLAttributes, ReactNode } from "react";

// 0.72.1 chunk-plugin-detail-view-gOzsdvba.js: gn/Zt, un/en/tn, mn/Qt.
export const originalTailnetClasses = {
  card: "sand-9f619 sand-78zum5 sand-dt5ytf sand-883omv sand-z9dl7a sand-1pic42t sand-sag5q8 sand-1onr9mi sand-7giv3 sand-4hv7ue sand-1y0btm7 sand-5fd6op sand-1pkpdue sand-10e981r",
  row: "sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z",
  input: "sand-9f619 sand-h8yej3 sand-1yrsyyn sand-2vl965 sand-10b6aqq sand-e2zdcy sand-mkeg23 sand-1y0btm7 sand-17tbahu sand-vk9egn sand-ur7f20 sand-10e981r sand-tyxrsu sand-jb2p0i sand-11wthnw sand-1t137rt sand-1h7ufjq",
  consent: "sand-78zum5 sand-6s0dn4 sand-167g77z sand-11wthnw sand-tyxrsu",
};
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="local-teams-section"><h3>{title}</h3><div className={originalTailnetClasses.card}>{children}</div></section>;
}
export function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="local-teams-field"><span>{label}</span><input {...props} aria-label={label} className={originalTailnetClasses.input} /></label>;
}
