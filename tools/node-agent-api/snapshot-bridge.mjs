import { ApiError, identifier } from './errors.mjs';
import { snapshotFunctionProgram } from './grok-node.mjs';

// The wire protocol has one operation: freshly validate one bot's desktop.
export const snapshotBridgeProgram = snapshotFunctionProgram + String.raw`
let input=Buffer.alloc(0),active=0;
const fail=()=>process.exit(1);
process.stdin.on('data',chunk=>{
  if(input.length+chunk.length>16384)return fail();
  input=Buffer.concat([input,chunk]);
  let end;
  while((end=input.indexOf(10))>=0){
    const line=input.subarray(0,end);input=input.subarray(end+1);
    let request;
    try{
      request=JSON.parse(line.toString('utf8'));
      if(Object.keys(request).sort().join(',')!=='botId,id'||!Number.isSafeInteger(request.id)||request.id<1||typeof request.botId!=='string'||!/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,127}$/u.test(request.botId)||active>=16)throw Error();
    }catch{return fail()}
    active++;
    readSnapshot(request.botId).then(result=>({id:request.id,result}),()=>({id:request.id,error:true})).then(response=>{
      active--;
      const output=JSON.stringify(response)+'\n';
      if(Buffer.byteLength(output)>1048576||process.stdout.writableLength>1048576)return fail();
      process.stdout.write(output);
    }).catch(fail);
  }
});
process.stdin.on('end',()=>process.exit(0));
process.stdin.on('error',fail);
process.stdout.on('error',fail);
`;

const unavailable = () => new ApiError(502, 'snapshot_unavailable', 'Desktop validation unavailable');
const generationKey = row => JSON.stringify([row.Id, row.State.StartedAt]);

export function createSnapshotBridge({ docker, spawnSnapshot, argsFor, timeoutMs = 45000, maxPending = 16, maxBytes = 1048576 }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 45000 || !Number.isInteger(maxPending) || maxPending < 1 || maxPending > 16 || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576) throw new Error('Invalid snapshot limits');
  let current = null, closed = false, sequence = 0;
  function stop(record) {
    if (!record || record.ended) return;
    record.ended = true;
    if (current === record) current = null;
    for (const pending of record.pending.values()) { clearTimeout(pending.timer); pending.reject(unavailable()); }
    record.pending.clear();
    record.child.stdin.destroy();
    record.child.kill('SIGKILL');
  }
  function observe(row) {
    if (current && (!row || current.key !== generationKey(row))) stop(current);
  }
  function start(row) {
    const child = spawnSnapshot(docker, argsFor(row.Id, ['node', '-e', snapshotBridgeProgram], true), { stdio: ['pipe', 'pipe', 'ignore'] });
    const record = { key: generationKey(row), child, pending: new Map(), input: Buffer.alloc(0), ended: false };
    current = record;
    child.on('error', () => stop(record));
    child.on('exit', () => stop(record));
    child.on('close', () => stop(record));
    child.stdin.on('error', () => stop(record));
    child.stdout.on('error', () => stop(record));
    child.stdout.on('end', () => stop(record));
    child.stdout.on('data', chunk => {
      if (record.ended) return;
      if (record.input.length + chunk.length > maxBytes) return stop(record);
      record.input = Buffer.concat([record.input, chunk]);
      let end;
      while ((end = record.input.indexOf(10)) >= 0) {
        const line = record.input.subarray(0, end); record.input = record.input.subarray(end + 1);
        try {
          const response = JSON.parse(line.toString('utf8')), pending = record.pending.get(response.id);
          if (!pending || response.error || !response.result || typeof response.result !== 'object') return stop(record);
          record.pending.delete(response.id); clearTimeout(pending.timer); pending.resolve(response.result);
        } catch { return stop(record); }
      }
    });
    return record;
  }
  return {
    observe,
    async read(botId, row) {
      identifier(botId);
      if (closed || !row?.Id || !row.State?.Running || !row.State.StartedAt) throw unavailable();
      observe(row);
      let record;
      try { record = current ?? start(row); } catch { throw unavailable(); }
      if (record.pending.size >= maxPending) throw new ApiError(503, 'snapshot_capacity', 'Desktop validation capacity reached');
      const id = ++sequence, payload = JSON.stringify({ id, botId }) + '\n';
      if (record.child.stdin.writableLength + Buffer.byteLength(payload) > 16384) { stop(record); throw unavailable(); }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => stop(record), timeoutMs);
        record.pending.set(id, { resolve, reject, timer });
        try { record.child.stdin.write(payload); } catch { stop(record); }
      });
    },
    close() { closed = true; stop(current); },
  };
}
