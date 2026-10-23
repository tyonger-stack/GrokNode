# Local teams and Tailnet integration

The settings entry exposes local team creation/selection, enrolled member add/update/remove, owner protection, admin/member roles, Tailnet configuration and consent, credential save/remove, explicit connection, and agent/store grants to people or local teams. Backend refusals remain visible. The identity fields are local account ID, principal ID, and team ID. They do not change official cloud team selection or authentication.

## Parent build invocation

```js
import { applyLocalTeamsRendererPatch } from "./local-teams-renderer-patch.mjs";

await applyLocalTeamsRendererPatch(rendererDir);
```

`rendererDir` is the staged directory containing `assets/`. Call once after the existing Router patch and before any rewrite of the General registry label, then include the returned file hashes in the parent's renderer provenance checks. The helper writes `renderer-local-teams-extension.json` in that staged renderer directory. It discovers the two chunks by exact anchors, rejects missing/ambiguous/already-patched inputs, and parses both outputs before writing. It does not modify the build entry point itself.

The registry anchor is in `index-UbX-y3il.js`. The content anchor is in `index-BlqerJhg.js`. The latter already imports the same React and JSX runtimes as `de` and `a`. Its appended closure passes those aliases as `S` and `p` into the existing `chunkReactPlugin` from `library-host-renderer-patch.mjs`. `RLocalTeamsHost` renders under the existing `Te` settings scroll container. No React root, document observer, or separate React implementation ships in the extension bundle.

## Original 0.72.1 reuse

Reference directory: `/Users/Apple/Documents/grokbot/rea-grokbot-0721/app/dist/renderer/assets/`.

| Original artifact / symbols | Recovered implementation |
| --- | --- |
| `chunk-plugin-detail-view-gOzsdvba.js`, `gn` / `Zt` | Tailnet section/card structure and original class list in `original-components.tsx` |
| Same chunk, `un` / `en` / `tn` | MagicDNS input, consent row, explicit save form |
| Same chunk, `mn` / `Qt` | Client ID and password inputs, save/remove action row |
| `index-CMR1RvAA.css` | Scoped copies of the referenced classes' declarations in `styles.css` |

The local contract has separate config, credential, discovery, and connect methods. The recovered component therefore uses a local typed adapter rather than importing cloud hooks or their polling flow. Discovery and reads never initiate a connection. Credentials are write-only, the secret draft clears on submit and on team switch, and credential errors cannot echo the submitted secret. The UI explicitly says device posture integration is unavailable. It does not show original posture verification or device claims that the backend cannot support.

## Contract boundaries

`bridge.ts` parses IPC responses and strips extra fields. Named team/member/status/grant types organize state. Operation state is idle, busy, or error; duplicate submissions are blocked. The local `teams.list()` result supplies the membership role. `getTeamTailnet().canManage` supplies the Tailnet management permission. The backend remains the authority for every mutation.

No team rename/delete controls exist because the supplied preload API has no corresponding methods. The resource panel reads existing agent grants with `getAgentAccess`; stores have no read endpoint in the supplied contract, so store mutation results populate the displayed grants. The Tailnet form submits no optional tags because the supplied read result has no tags field. Existing backend tag preservation/defaulting should be considered when extending that contract.

## Validation and remaining integration

Node 26.5.1:

```sh
export PATH="/Users/Apple/Documents/grokbot/.tools/node-26/bin:$PATH"
node --test tests/local-teams-ui-0721.test.mjs
npm run typecheck
LOCAL_TEAMS_UI_SERVE=1 node tests/local-teams-ui-0721.test.mjs
```

The last command serves a contract fixture on `http://127.0.0.1:18721`. Its only React root belongs to the test shell. The feature itself is the production bundle built by `buildLocalTeamsHostBundle`, executed through the same `S`/`p` shim. The fixture uses deterministic enrolled principals and Tailnet replies, not the user's data or Tailscale daemon.

Recorded artifacts and scenario-by-scenario binary results are in `.omo/evidence/local-teams-ui-0721/REPORT.md`. Real legacy chunk copies were patched and parsed; browser actions exercised the emitted bundle. These results do not claim a packaged Electron run, SQLite persistence, encrypted storage, or a real Tailnet connection. The parent owns clean-build wiring, independent review, and packaged QA as specified in the assignment. No commits or shared source edits were made by this implementation worker.
