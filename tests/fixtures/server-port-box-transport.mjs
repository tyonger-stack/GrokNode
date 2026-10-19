import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { startBoxExecDaemon } from "../../source/box-exec-daemon/server.ts";
import { productionBoxGeneratedPorts } from "../../source/host/box/generated-production.ts";
import { createBoxRemoteResourceAccessor } from "../../source/host/box/box-remote-accessor.ts";
import { createReviewPrivateBox } from "../../source/host/review-private-box.ts";
import { createContext } from "../../source/packages/context/core.ts";
import { parseShellTerminalFooter } from "../../source/host/runner/background-work.ts";

export async function runBoxTransportScenario(root) {
  await mkdir(root, { recursive: true });
  const daemon = await startBoxExecDaemon({ workspaceRoot: root, terminalsDirectory: path.join(root, "terminals"), port: 0, authToken: "synthetic-transport" });
  const value = "synthetic-private-value-never-log";
  try {
    const remoteAccessor = createBoxRemoteResourceAccessor({ host: "127.0.0.1", port: daemon.port, authToken: "synthetic-transport" }, productionBoxGeneratedPorts);
    const privateBox = await createReviewPrivateBox({ agentId: "synthetic", context: createContext(), box: {
      ensureReady: async () => ({ remoteAccessor, terminalsFolder: daemon.terminalsDirectory }), getAgentWindowIndex: () => 0,
      uploadFile: async (_ctx, _id, file, bytes) => writeFile(file, bytes),
      downloadFile: async (_ctx, _id, file) => readFile(file),
    } });
    assert.ok(privateBox, "protected transport must pass the real daemon canary");
    const script = 'const r=require("node:readline").createInterface({input:process.stdin,terminal:false});r.once("line",v=>{console.log("length:"+v.length);process.exit(0)})';
    const spawned = await privateBox.spawn({ command: `node -e '${script}'`, suppressStdinLogging: true, signal: new AbortController().signal });
    assert.equal(spawned.stdinLoggingSuppressed, true);
    await privateBox.writeStdin(spawned.shellId, `${value}\n`);
    let complete = false;
    for (let attempt = 0; attempt < 500; attempt++) {
      const output = await readFile(path.join(daemon.terminalsDirectory, `${spawned.shellId}.txt`), "utf8");
      const footer = parseShellTerminalFooter(output);
      if (footer.isComplete) {
        assert.equal(footer.exitCode, 0); assert.ok(output.includes(`length:${value.length}`)); complete = true; break;
      }
      await delay(20);
    }
    assert.equal(complete, true, "private input process did not finish");
    await privateBox.terminate(spawned.shellId);
    const logs = await Promise.all((await readdir(daemon.terminalsDirectory)).map(name => readFile(path.join(daemon.terminalsDirectory, name), "utf8")));
    assert.ok(logs.every(log => !log.includes(value)));
    return { binaryRpc: true, protectedCanary: true, stdinAccepted: true, valueInTerminalLogs: false, files: logs.length };
  } finally { await daemon.stop(); }
}
