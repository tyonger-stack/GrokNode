const LOAD_BEFORE = 'async function de(t,e){if(e===void 0)return"approved";try{await t.load();const s=ne(t.snapshots.get());return s==null?"approved":(await t.setInstructions(W(s,e)),"always")}catch{return"approved"}}';
const LOAD_AFTER = 'async function de(t,e){if(e===void 0)throw new Error("No reusable rule is available. Choose Allow once or retry the command for a new review.");await t.load();const s=ne(t.snapshots.get());if(s==null)throw new Error("Could not load Auto-review settings. Retry or choose Allow once.");await t.setInstructions(W(s,e));return"always"}';
const RESOLVE_BEFORE = 'let o=a;a==="always"&&(o=await l());try{const r=await i({entryId:s,requestId:n,resolution:o,agentId:e});D({agentId:e,entryId:s,status:r==="stale"?"expired":o})}catch{H({agentId:e,entryId:s})}';
const RESOLVE_AFTER = 'try{const o=a==="always"?await l():a,r=await i({entryId:s,requestId:n,resolution:o,agentId:e});D({agentId:e,entryId:s,status:r==="stale"?"expired":o})}catch(error){H({agentId:e,entryId:s});throw error}';

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error("Original Auto-review renderer anchor is missing or ambiguous.");
  return source.replace(before, after);
}

export function patchOriginalAutoReviewApproval(source) {
  let result = replaceOnce(source, LOAD_BEFORE, LOAD_AFTER);
  result = replaceOnce(result, RESOLVE_BEFORE, RESOLVE_AFTER);
  result = replaceOnce(result, 'function me(t){const e=P.c(43)', 'function me(t){const[arError,setArError]=F.useState(null);const e=P.c(43)');
  result = replaceOnce(result, 'i(L),pe({', 'i(L),setArError(null),pe({');
  result = replaceOnce(result, '.then(()=>i(void 0),()=>i(void 0))', '.then(()=>i(void 0),error=>{i(void 0);setArError(error instanceof Error?error.message:String(error))})');
  return replaceOnce(result, ':j=e[42],j}function we(t)', ':j=e[42],C.jsxs(F.Fragment,{children:[j,arError==null?null:C.jsx("p",{role:"alert",style:{color:"var(--cursor-text-red, #ff5266)",padding:"8px 16px"},children:arError})]})}function we(t)');
}
