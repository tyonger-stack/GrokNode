import type { PollingPolicy } from "../../../internal/scheduling.js";
import { triggerEventTriggers, type AutomationTrigger, type EventTrigger } from "../../../shared/automations.js";
import { triggerMatchesEvent } from "../../automations/automation-trigger.js";

export interface TriggerSourceStatus { state: string; detail?: string; scopeIssues?: readonly unknown[] }
export interface TriggerSource { kind: string; setListeners(listeners: readonly EventTrigger[]): void; start(accept: (event: Record<string, unknown>) => boolean): Promise<void>; stop(): Promise<void>; getStatus(): TriggerSourceStatus }
export interface ScheduledAutomation { agentId: string; automation: { id?: string; isEnabled: boolean; trigger: AutomationTrigger } }
export interface SandTriggerHubDependencies { polling: PollingPolicy; sources: readonly TriggerSource[]; listAutomations(): Promise<readonly ScheduledAutomation[]>; fire(agentId: string, automation: ScheduledAutomation["automation"], event: Record<string, unknown>): Promise<unknown>; isReady(): boolean | Promise<boolean>; shouldScheduleLocally?(agentId: string, automation: ScheduledAutomation["automation"]): boolean; onReconcile?(): void; /** Drop-path observability: run-not-ready, roster read failures, and per-automation fire failures are logged instead of vanishing. */ readonly log?: (message: string) => void }

export class SandTriggerHub {
  private readonly sources = new Map<string, TriggerSource>(); private readonly startedKinds = new Set<string>(); private timer: { dispose(): void } | undefined; private reconcileChain = Promise.resolve(); private pendingPasses = 0; private isStopped = false;
  constructor(readonly deps: SandTriggerHubDependencies) { for (const source of deps.sources) this.sources.set(source.kind, source); }
  start(): void { if (this.timer != null) return; this.isStopped = false; this.timer = this.deps.polling.start(async () => { try { if (this.pendingPasses === 0) await this.reconcile(); } catch {} }); }
  async stop(): Promise<void> { this.isStopped = true; this.timer?.dispose(); this.timer = undefined; await this.reconcileChain; const started = [...this.startedKinds]; this.startedKinds.clear(); await Promise.all(started.map(async (kind) => { try { await this.sources.get(kind)?.stop(); } catch {} })); }
  async reconcileNow(): Promise<void> { await this.reconcile(); }
  getSourceStatuses(): Map<string, TriggerSourceStatus> { return new Map([...this.sources].map(([kind, source]) => [kind, source.getStatus()])); }
  async desiredListenersByKind(): Promise<Map<string, EventTrigger[]>> { const byKind = new Map<string, EventTrigger[]>(); for (const { agentId, automation } of await this.deps.listAutomations()) { if (!automation.isEnabled || !(this.deps.shouldScheduleLocally?.(agentId, automation) ?? true)) continue; for (const listener of triggerEventTriggers(automation.trigger)) { const bucket = byKind.get(listener.type) ?? []; bucket.push(listener); byKind.set(listener.type, bucket); } } return byKind; }
  private reconcile(): Promise<void> { this.pendingPasses += 1; const pass = this.reconcileChain.then(async () => this.reconcilePass()); this.reconcileChain = pass.catch(() => {}).finally(() => { this.pendingPasses -= 1; }); return pass; }
  private async reconcilePass(): Promise<void> { if (this.isStopped) return; this.deps.onReconcile?.(); const desired = await this.deps.isReady() ? await this.desiredListenersByKind() : new Map<string, EventTrigger[]>(); if (this.isStopped) return; for (const [kind, source] of this.sources) { const listeners = desired.get(kind) ?? []; if (listeners.length) { source.setListeners(listeners); if (!this.startedKinds.has(kind)) { this.startedKinds.add(kind); try { await source.start((event) => this.acceptEvent(event)); } catch { this.startedKinds.delete(kind); } } } else if (this.startedKinds.has(kind)) { this.startedKinds.delete(kind); try { await source.stop(); } catch {} } } }
  acceptEvent(event: Record<string, unknown>): boolean { if (this.isStopped) return false; void this.handleEvent(event); return true; }
  /**
   * Agent-scoped ingestion for locally injected events (Grok Node): a platform
   * delivery authenticated by ONE routine's webhook key may only wake that
   * agent's automations, never the global roster — otherwise a single leaked
   * routine key would speak for every bot on the machine.
   */
  acceptEventForAgent(agentId: string, event: Record<string, unknown>): boolean { if (this.isStopped || agentId.length === 0) return false; void this.handleEvent(event, agentId); return true; }
  async handleEvent(event: Record<string, unknown>, agentFilter: string | null = null): Promise<void> { if (this.isStopped) return; if (!await this.deps.isReady()) { this.deps.log?.(`[sand:trigger-hub] dropped ${String(event.source)} event: run not ready`); return; } let scheduled: readonly ScheduledAutomation[]; try { scheduled = await this.deps.listAutomations(); } catch (error) { this.deps.log?.(`[sand:trigger-hub] dropped ${String(event.source)} event: roster read failed: ${error instanceof Error ? error.message : String(error)}`); return; } for (const { agentId, automation } of scheduled) { if (agentFilter != null && agentId !== agentFilter) continue; if (!automation.isEnabled || !triggerMatchesEvent(automation.trigger, event)) continue; try { if (!(this.deps.shouldScheduleLocally?.(agentId, automation) ?? true)) continue; await this.deps.fire(agentId, automation, event); } catch (error) { this.deps.log?.(`[sand:trigger-hub] firing automation ${automation.id ?? "?"} of agent ${agentId} failed: ${error instanceof Error ? error.message : String(error)}`); } } }
}
