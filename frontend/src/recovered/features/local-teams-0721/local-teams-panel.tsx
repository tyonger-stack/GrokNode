import { useEffect, useRef, useState, type FormEvent } from "react";
import { grantFromForm, safeSignInUrl, type LocalGrant, type LocalMember, type LocalTeam, type LocalTeamsDesktop, type TailnetStatus } from "./bridge";
import { Field, Section, originalTailnetClasses as classes } from "./original-components";

function useOperation() {
  const [state, setState] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "error"; message: string }>({ kind: "idle" });
  const live = useRef(true), pending = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  async function run(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setState({ kind: "busy" });
    try { await work(); if (live.current) setState({ kind: "idle" }); }
    catch (error) { if (live.current) setState({ kind: "error", message: error instanceof Error ? error.message : "The local operation failed." }); }
    finally { pending.current = false; }
  }
  return { run, busy: state.kind === "busy", error: state.kind === "error" ? state.message : null };
}

export function LocalTeamsPanel({ desktop }: { desktop: LocalTeamsDesktop }) {
  const [teams, setTeams] = useState<LocalTeam[]>([]), [selected, setSelected] = useState("");
  const [loaded, setLoaded] = useState(false), [revision, setRevision] = useState(0);
  const operation = useOperation();
  useEffect(() => {
    let live = true;
    void operation.run(async () => {
      const list = await desktop.list();
      if (live) { setTeams(list); setLoaded(true); setSelected(id => list.some(t => t.teamId === id) ? id : list[0]?.teamId ?? ""); }
    });
    return () => { live = false; };
  }, [desktop, revision]);
  const team = teams.find(t => t.teamId === selected);
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, name = String(new FormData(form).get("name") ?? "").trim();
    void operation.run(async () => {
      const created = await desktop.create(name); const list = await desktop.list();
      setTeams(list); setSelected(created.teamId); setLoaded(true); form.reset();
    });
  }
  return <div className="local-teams-0721" data-local-teams-0721="true">
    <h2>Local teams &amp; Tailnet</h2>
    <p>Teams on this Grok Node installation. Membership uses enrolled local account and principal IDs.</p>
    {operation.error && <p role="alert">{operation.error}</p>}
    <Section title="Local teams">
      <form onSubmit={create}><fieldset disabled={operation.busy}>
        <Field label="Team name" name="name" required maxLength={120} />
        <button type="submit">Create local team</button>
      </fieldset></form>
      {!loaded && <p role="status">Loading local teams...</p>}
      {loaded && teams.length === 0 && <p>No local teams yet. Create one to manage membership and Tailnet access.</p>}
      {teams.length > 0 && <label className="local-teams-field">Local team<select aria-label="Local team" value={selected} disabled={operation.busy} onChange={e => setSelected(e.target.value)}>
        {teams.map(t => <option key={t.teamId} value={t.teamId}>{t.name} ({t.role})</option>)}
      </select></label>}
      <button type="button" disabled={operation.busy} onClick={() => setRevision(r => r + 1)}>Refresh teams</button>
    </Section>
    {team && <TeamPanel key={`${team.teamId}:${team.role}`} team={team} desktop={desktop} refreshTeams={() => setRevision(r => r + 1)} />}
    <AccessPanel desktop={desktop} teams={teams} />
  </div>;
}

function TeamPanel({ team, desktop, refreshTeams }: { team: LocalTeam; desktop: LocalTeamsDesktop; refreshTeams: () => void }) {
  const [members, setMembers] = useState<LocalMember[]>([]), [loaded, setLoaded] = useState(false);
  const operation = useOperation(), canManage = team.role === "owner" || team.role === "admin";
  async function load() { setMembers(await desktop.listMembers(team.teamId)); setLoaded(true); }
  useEffect(() => { if (canManage) void operation.run(load); }, [desktop, team.teamId, canManage]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
    void operation.run(async () => {
      await desktop.setMember({ teamId: team.teamId, accountId: String(data.get("accountId")).trim(), principalId: String(data.get("principalId")).trim(), role: data.get("role") === "admin" ? "admin" : "member" });
      await load(); form.reset(); refreshTeams();
    });
  }
  async function change(person: LocalMember, role: "admin" | "member" | null) {
    await desktop.setMember({ teamId: team.teamId, accountId: person.accountId, principalId: person.principalId, role });
    refreshTeams(); await load();
  }
  return <>
    <Section title="Team membership">
      <p>Local team ID <code>{team.teamId}</code>. Your role is {team.role}.</p>
      {!canManage ? <p>A local team administrator manages membership.</p> : <>
        {operation.error && <p role="alert">{operation.error}</p>}
        {!loaded && <p role="status">Loading members...</p>}
        {members.map(person => <div className="local-teams-member" key={JSON.stringify([person.accountId, person.principalId])}>
          <span><code>{person.accountId}</code> / <code>{person.principalId}</code></span>
          {person.role === "owner" ? <span>Owner</span> : <>
            <select aria-label={`Role for ${person.principalId}`} disabled={operation.busy} value={person.role}
              onChange={e => { const role = e.target.value === "admin" ? "admin" : "member"; void operation.run(() => change(person, role)); }}>
              <option value="member">Member</option><option value="admin">Admin</option>
            </select>
            <button type="button" disabled={operation.busy} onClick={() => void operation.run(() => change(person, null))}>Remove {person.principalId}</button>
          </>}
        </div>)}
        <form onSubmit={submit}><fieldset disabled={operation.busy}>
          <Field label="Enrolled account ID" name="accountId" required />
          <Field label="Enrolled principal ID" name="principalId" required />
          <label>Role<select name="role" aria-label="New member role"><option value="member">Member</option><option value="admin">Admin</option></select></label>
          <button type="submit">Add or update member</button>
        </fieldset></form>
        <button type="button" disabled={operation.busy} onClick={() => void operation.run(load)}>Refresh members</button>
      </>}
    </Section>
    <TailnetPanel teamId={team.teamId} desktop={desktop} />
  </>;
}

function TailnetPanel({ teamId, desktop }: { teamId: string; desktop: LocalTeamsDesktop }) {
  const [status, setStatus] = useState<TailnetStatus | null>(null), [suffix, setSuffix] = useState("");
  const [enabled, setEnabled] = useState(false), [consent, setConsent] = useState(false);
  const [clientId, setClientId] = useState(""), [secret, setSecret] = useState("");
  const operation = useOperation();
  function accept(value: TailnetStatus) { setStatus(value); setSuffix(value.magicDnsSuffix ?? ""); setEnabled(value.enabled); }
  useEffect(() => { void operation.run(async () => accept(await desktop.getTailnet(teamId))); }, [desktop, teamId]);
  const canManage = status?.canManage === true, signInUrl = safeSignInUrl(status?.signInUrl ?? null);
  return <Section title="Team Tailnet">
    {operation.error && <p role="alert">{operation.error}</p>}
    {!status && <p role="status">Loading Tailnet...</p>}
    {status && <>
      <p role="status">{!status.available ? "Tailscale unavailable" : status.connected ? "Connected" : "Not connected"} · {status.enabled ? "Enabled" : "Disabled"}</p>
      {status.rejection && <p role="alert">{status.rejection}</p>}
      <p>Detected MagicDNS suffix: {status.detectedMagicDnsSuffix ?? "Not detected"}</p>
      {!canManage && <p>A local team administrator manages Tailnet settings.</p>}
      <form onSubmit={event => { event.preventDefault(); void operation.run(async () => { accept(await desktop.updateTailnet({ teamId, enabled, magicDnsSuffix: suffix.trim() || null, consent })); setConsent(false); }); }}>
        <fieldset disabled={operation.busy || !canManage}>
          <label className={classes.consent}><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Enable team Tailnet</label>
          <Field label="MagicDNS suffix" placeholder="tail1234.ts.net" value={suffix} onChange={e => setSuffix(e.target.value)} />
          <button type="button" onClick={() => void operation.run(async () => {
            const found = await desktop.discover(teamId);
            if (found.failureReason) throw new Error(found.failureReason);
            setSuffix(found.magicDnsSuffix ?? "");
          })}>Detect current Tailnet</button>
          <label className={classes.consent}><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />I authorize this local team to use the configured Tailnet.</label>
          <button type="submit" disabled={enabled && (!consent || !suffix.trim())}>Save Tailnet settings</button>
        </fieldset>
      </form>
      <p>OAuth credentials: {status.credentialConfigured ? "Configured" : "Not configured"}. Device posture integration is unavailable.</p>
      <form onSubmit={event => { event.preventDefault(); const credential = { teamId, clientId: clientId.trim(), clientSecret: secret }; setSecret(""); void operation.run(async () => { setStatus(await desktop.updateCredential(credential)); setClientId(""); }); }}>
        <fieldset disabled={operation.busy || !canManage}>
          <Field label="OAuth client ID" autoComplete="off" value={clientId} onChange={e => setClientId(e.target.value)} />
          <Field label="OAuth client secret" type="password" autoComplete="off" value={secret} onChange={e => setSecret(e.target.value)} />
          <div className={classes.row}>
            <button type="submit" disabled={!clientId.trim() || !secret.trim()}>Save credentials</button>
            <button type="button" disabled={!status.credentialConfigured} onClick={() => { setSecret(""); setClientId(""); void operation.run(async () => setStatus(await desktop.updateCredential({ teamId, remove: true }))); }}>Remove credentials</button>
          </div>
        </fieldset>
      </form>
      <div className={classes.row}>
        <button type="button" disabled={operation.busy || !canManage || !status.available || !status.enabled} onClick={() => void operation.run(async () => setStatus(await desktop.connect(teamId)))}>Connect Tailnet</button>
        {signInUrl && <a href={signInUrl} target="_blank" rel="noreferrer">Open Tailscale sign-in</a>}
      </div>
    </>}
    <button type="button" disabled={operation.busy} onClick={() => void operation.run(async () => accept(await desktop.getTailnet(teamId)))}>Refresh Tailnet status</button>
  </Section>;
}

function AccessPanel({ desktop, teams }: { desktop: LocalTeamsDesktop; teams: LocalTeam[] }) {
  const [recipientKind, setRecipientKind] = useState("person"), [grants, setGrants] = useState<LocalGrant[] | null>(null);
  const [resourceKind, setResourceKind] = useState("agent"), [resourceId, setResourceId] = useState("");
  const operation = useOperation();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void operation.run(async () => setGrants(await desktop.setAccessGrant(grantFromForm(data), data.get("enabled") === "on")));
  }
  return <Section title="Local resource access">
    <p>Only the resource owner can change grants. Person recipients must already be enrolled on this installation.</p>
    {operation.error && <p role="alert">{operation.error}</p>}
    <form onSubmit={submit}><fieldset disabled={operation.busy}>
      <label>Resource<select aria-label="Resource kind" name="kind" value={resourceKind} onChange={e => { setResourceKind(e.target.value); setGrants(null); }}><option value="agent">Agent</option><option value="store">Store</option></select></label>
      <Field label="Resource ID" name="resourceId" required value={resourceId} onChange={e => { setResourceId(e.target.value); setGrants(null); }} />
      <button type="button" disabled={resourceKind !== "agent" || !resourceId.trim()} onClick={() => void operation.run(async () => setGrants(await desktop.getAgentAccess(resourceId.trim())))}>Load agent access</button>
      <label>Recipient<select aria-label="Recipient kind" name="recipientKind" value={recipientKind} onChange={e => setRecipientKind(e.target.value)}><option value="person">Enrolled person</option><option value="team">Local team</option></select></label>
      {recipientKind === "person" ? <><Field label="Recipient account ID" name="accountId" required /><Field label="Recipient principal ID" name="principalId" required /></>
        : <label>Recipient team<select aria-label="Recipient team" name="recipientTeam" required defaultValue=""><option value="" disabled>Choose a local team</option>{teams.filter(t => t.role !== "member").map(t => <option key={t.teamId} value={t.teamId}>{t.name}</option>)}</select></label>}
      <div className={classes.row}>{["view", "use", "create-automation"].map(action => <label key={action}><input type="checkbox" name="actions" value={action} defaultChecked={action === "view"} />{action}</label>)}</div>
      <Field label="Expires at (optional)" name="expires" type="datetime-local" />
      <label><input type="checkbox" name="enabled" defaultChecked />Grant access (uncheck to revoke)</label>
      <button type="submit">Apply access grant</button>
    </fieldset></form>
    {grants !== null && <div aria-label="Saved access grants">{grants.length === 0 ? <p>No saved grants.</p> : grants.map(grant => <div className="local-teams-member" key={JSON.stringify(grant.recipient)}>
      <span>{grant.recipient.kind === "team" ? grant.recipient.teamId : `${grant.recipient.accountId} / ${grant.recipient.principalId}`} · {grant.actions.join(", ")} · {grant.expiresAtMs === null ? "No expiry" : new Date(grant.expiresAtMs).toLocaleString()}</span>
      <button type="button" disabled={operation.busy} onClick={() => void operation.run(async () => setGrants(await desktop.setAccessGrant(grant, false)))}>Revoke grant</button>
    </div>)}</div>}
  </Section>;
}
