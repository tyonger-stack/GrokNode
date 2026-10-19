import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createContext, type Context } from "../packages/context/core.js";
import { backgroundShellExecutorResource, writeBackgroundShellInputExecutorResource } from "../packages/agent-exec/background-shell.js";
import { shellExecutorResource } from "../packages/agent-exec/shell.js";
import { BackgroundShellSpawnArgs, WriteShellStdinArgs } from "../packages/proto/generated/agent/v1/background_shell_exec_pb.js";
import { ShellArgs } from "../packages/proto/generated/agent/v1/shell_exec_pb.js";
import type { RemoteConnection } from "./runner/remote-box-resources.js";
import type { PrivateUserFormBox } from "./runner/browser/user-form-fill.js";
import { parseShellTerminalFooter } from "./runner/background-work.js";

export interface ReviewPrivateBoxDependencies {
  readonly agentId: string;
  readonly context: Context;
  readonly box: {
    ensureReady(ctx: Context, id: string): Promise<RemoteConnection>;
    getAgentWindowIndex(id: string): number | undefined;
    uploadFile(ctx: Context, id: string, path: string, bytes: Uint8Array): Promise<void>;
    downloadFile(ctx: Context, id: string, path: string, options?: { readonly maxBytes?: number }): Promise<Uint8Array>;
  };
}
export class ReviewPrivateTransportError extends Error {
  constructor(readonly code: "unavailable" | "canceled" | "unsupported_stdin_privacy" | "invalid_process" | "unknown_shell" | "stdin_failed" | "terminate_failed") {
    super(`private_box_${code}`);
    this.name = "ReviewPrivateTransportError";
  }
}

const CANARY_SCRIPT = 'const r=require("node:readline").createInterface({input:process.stdin,terminal:false});r.once("line",s=>{console.log("__PRIVATE_STDIN_CANARY__"+require("node:crypto").createHash("sha256").update(s).digest("hex"));process.exit(0)});setTimeout(()=>process.exit(2),10000).unref()';
const CANARY_COMMAND = `node -e '${CANARY_SCRIPT}'`;

export async function createReviewPrivateBox(deps: ReviewPrivateBoxDependencies): Promise<PrivateUserFormBox | undefined> {
  // A fresh operation context follows only the explicit caller, never a Bot run context.
  async function operation<T>(signal: AbortSignal | undefined, run: (ctx: Context) => Promise<T>, cleanup = false): Promise<T> {
    const [ctx, cancel] = createContext().withName("private-user-form").withTimeoutAndCancel(15_000);
    const signals = cleanup ? [] : [deps.context.signal, ...(signal ? [signal] : [])];
    const abort = () => cancel();
    for (const source of signals) {
      if (source.aborted) cancel();
      else source.addEventListener("abort", abort, { once: true });
    }
    try {
      if (ctx.canceled) throw new ReviewPrivateTransportError("canceled");
      return await run(ctx);
    } catch (error) {
      if (error instanceof ReviewPrivateTransportError) throw error;
      throw new ReviewPrivateTransportError(ctx.canceled ? "canceled" : "unavailable");
    } finally {
      for (const source of signals) source.removeEventListener("abort", abort);
      cancel();
    }
  }
  try {
    const connection = await operation(undefined, ctx => deps.box.ensureReady(ctx, deps.agentId));
    const windowIndex = deps.box.getAgentWindowIndex(deps.agentId);
    if (windowIndex === undefined || !Number.isInteger(windowIndex) || windowIndex < 0 || !connection.terminalsFolder) return undefined;
    const background = connection.remoteAccessor.get(backgroundShellExecutorResource);
    const stdin = connection.remoteAccessor.get(writeBackgroundShellInputExecutorResource);
    const shell = connection.remoteAccessor.get(shellExecutorResource);
    const owned = new Map<number, { readonly pid: number; readonly detach: () => void }>();
    const terminalPath = (id: number) => `${connection.terminalsFolder}/${id}.txt`;
    async function readTerminal(id: number): Promise<string | undefined> {
      try {
        const bytes = await operation(undefined, ctx => deps.box.downloadFile(ctx, deps.agentId, terminalPath(id), { maxBytes: 512 * 1024 }));
        return Buffer.from(bytes).toString("utf8");
      } catch (error) {
        if (error instanceof ReviewPrivateTransportError && error.code === "unavailable") return undefined;
        throw error;
      }
    }
    async function terminate(id: number): Promise<void> {
      const process = owned.get(id);
      if (!process) return;
      owned.delete(id);
      process.detach();
      const terminal = await readTerminal(id).catch(() => undefined);
      if (terminal !== undefined && parseShellTerminalFooter(terminal).isComplete) return;
      const result = await operation(undefined, ctx => shell.execute(ctx, new ShellArgs({
        command: `kill -TERM ${process.pid}`, workingDirectory: "/workspace", toolCallId: `private-form-stop-${randomUUID()}`, timeout: 5000,
      })), true);
      if (result.result.case !== "success" || result.result.value.exitCode !== 0) throw new ReviewPrivateTransportError("terminate_failed");
    }
    async function spawn(command: string, signal?: AbortSignal): Promise<number> {
      const result = await operation(signal, ctx => background.execute(ctx, new BackgroundShellSpawnArgs({
        command, workingDirectory: "/workspace", toolCallId: `private-form-${randomUUID()}`,
        enableWriteShellStdinTool: true, suppressStdinLogging: true,
      })));
      if (result.result.case !== "success") throw new ReviewPrivateTransportError("unavailable");
      const { shellId, pid } = result.result.value;
      if (!Number.isSafeInteger(shellId) || shellId <= 0 || pid === undefined || !Number.isSafeInteger(pid) || pid <= 1) throw new ReviewPrivateTransportError("invalid_process");
      const abort = () => { void terminate(shellId).catch(() => console.warn("private_box_terminate_failed")); };
      const signals = [deps.context.signal, ...(signal ? [signal] : [])];
      owned.set(shellId, { pid, detach: () => { for (const source of signals) source.removeEventListener("abort", abort); } });
      for (const source of signals) source.addEventListener("abort", abort, { once: true });
      if (signals.some(source => source.aborted)) { await terminate(shellId); throw new ReviewPrivateTransportError("canceled"); }
      return shellId;
    }
    async function write(id: number, chars: string): Promise<void> {
      if (!owned.has(id)) throw new ReviewPrivateTransportError("unknown_shell");
      const result = await operation(undefined, ctx => stdin.execute(ctx, new WriteShellStdinArgs({ shellId: id, chars })));
      if (result.result.case !== "success") throw new ReviewPrivateTransportError("stdin_failed");
    }
    async function verifyPrivacy(signal?: AbortSignal): Promise<void> {
      const id = await spawn(CANARY_COMMAND, signal);
      const canary = `nonsecret-${randomUUID()}`;
      const expected = `__PRIVATE_STDIN_CANARY__${createHash("sha256").update(canary).digest("hex")}`;
      try {
        await write(id, `${canary}\n`);
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline && !deps.context.canceled && !signal?.aborted) {
          const output = await readTerminal(id);
          if (output !== undefined && parseShellTerminalFooter(output).isComplete) {
            if (parseShellTerminalFooter(output).exitCode !== 0 || !output.split("\n").includes(expected) || output.includes(canary) || output.includes("[stdin]")) throw new ReviewPrivateTransportError("unsupported_stdin_privacy");
            return;
          }
          await delay(25);
        }
        throw new ReviewPrivateTransportError("unsupported_stdin_privacy");
      } finally { await terminate(id); }
    }
    await verifyPrivacy();
    return {
      windowIndex, terminalsFolder: connection.terminalsFolder,
      upload: (path, bytes) => operation(undefined, ctx => deps.box.uploadFile(ctx, deps.agentId, path, bytes)),
      download: (path, options) => operation(undefined, ctx => deps.box.downloadFile(ctx, deps.agentId, path, options)),
      spawn: async input => {
        await verifyPrivacy(input.signal);
        const shellId = await spawn(input.command, input.signal);
        return { shellId, stdinLoggingSuppressed: true };
      },
      writeStdin: write,
      terminate,
    };
  } catch (error) {
    if (error instanceof ReviewPrivateTransportError) return undefined;
    console.warn("private_box_setup_failed");
    return undefined;
  }
}
