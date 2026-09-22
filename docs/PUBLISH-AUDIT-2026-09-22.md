# Publish readiness audit

Audited on 2026-09-22 against the live state of the public repository
`b-nnett/grok-bot-0.18-reconstructed`. Every claim below was verified with a
command, not inferred from the README.

## Current state

| Item | Verified fact |
| --- | --- |
| Remote | `https://github.com/b-nnett/grok-bot-0.18-reconstructed.git` |
| Visibility | **PUBLIC** |
| Last remote push | 2026-08-23 |
| Local main vs origin/main | **40 commits ahead, 0 behind** |
| Working tree | clean; the local-http-mcp line was committed on 2026-09-22 |
| Git LFS | DMG + installer pointers are in the `origin/main` tree |
| LFS objects | Already uploaded, but the repository **exceeded its LFS budget**; downloads return HTTP 403 |
| gh account | the locally authenticated account has `push: false` on this repository |
| Topics | empty |
| LICENSE | none |

The repository is therefore already public, already carries the upstream
binaries, and is 34 commits behind the local tree. Publishing is not a greenfield
step; it is a cleanup and synchronization step.

## Blocking items

### B1. Upstream binaries are already public, and LFS budget is exhausted

`git lfs push --all origin --dry-run` fails with `Authentication required: You
must have push access to verify locks`, and the LFS batch endpoint answers:

```json
{"message": "This repository exceeded its LFS budget.", "status": "403"}
```

Two consequences. First, the 269 MB of Anysphere installers under
`research-archives/original/0.18.0/` are already hosted on a public repository,
so the exposure exists today regardless of what happens next. Second, no new
Git LFS object can be pushed until the budget is raised, so any plan that keeps
the binaries must first buy LFS storage.

The reconstruction does not need the binaries in the tree. `bootstrap-runtime.mjs`
already verifies the DMG and `app.asar` by SHA-256 and falls back to the public
download URL when the archive is absent, and `GROK_BOT_018_APP` can point at an
existing application copy. Removing the payload and keeping the digests, sizes
and source URLs in `artifacts.json` preserves the pinned build input without
hosting third-party commercial installers.

Recommended decision: drop the DMG and EXE from the published tree, keep the
manifest, and rewrite `README.md`, `PROVENANCE.md` and `NOTICE.md` so they
describe a checksum-pinned input rather than a preserved artifact. Raising the
LFS budget is the alternative, and it only makes sense if redistribution of the
installers is defensible on its own.

### B2. No push permission for the authenticated account

The locally authenticated GitHub account is not the repository owner, and the
API returns `push: false` for it. Confirm which identity owns the repository and
authenticate as that identity before any push. This also explains the B1 lock
error.

### B3. The local tree is 40 commits ahead of the remote

34 of those commits rework the app toward local routing and the local Docker
box. The remaining 6, added on 2026-09-22, commit the local HTTP MCP connector
line described in `docs/LOCAL_HTTP_MCP.md` together with its tests and docs.
The working tree is clean, both typechecks exit 0, tests report 110 passed and
0 failed, and `npm run publication:check` passes on the committed tree.

### B4. Rights position

The repository has no upstream source license. `NOTICE.md` already states that
the installers `remain subject to their own terms and are not covered by any
license applied to reconstructed code`, and `PROVENANCE.md` asks for an
independent rights review before public redistribution. Publicly hosting the
installers is the sharpest form of that question, so it is listed as blocking
rather than advisory.

## Recommended fixes

| # | Item | Action |
| --- | --- | --- |
| S1 | No LICENSE file | Add a license for the reconstructed code only, or an explicit research-use statement that grants nothing. Do not imply coverage of the upstream app or trademarks. |
| S2 | Empty topics | Set the topic list; see `GITHUB-ABOUT.md` in this directory. |
| S3 | Machine path in docs | Fixed on 2026-09-22: `AGENTS.md` now resolves the Node copy from the repository root. |
| S4 | README claim does not match the tree | The README says the repository does not commit the forensic recovery workspace, but `frontend/src/recovered/` tracks 276 files. Clarify that this tree is the evidence-backed reconstruction and that the excluded workspace is the root-level `recovered/` and `recovery/`. |
| S5 | Remote description | Replace the current one-line description with the text in `GITHUB-ABOUT.md`. |

## Verified clean

- No credentials in the full history. Every blob reachable from every ref was
  scanned (3013 objects) for OpenAI, Anthropic, GitHub, GitLab, AWS, Google,
  Slack, npm, Docker and Shopify token shapes, JWT headers and PEM private key
  blocks. Zero matches. The same scan of the working tree also returned zero.
- The real 64-character StepFun key held in `~/.grokbot/box-secrets.json` was
  searched for verbatim in the working tree and in all 3013 history blobs. It
  appears nowhere. That file lives outside the repository, as do
  `~/.grokbot/settings.json`, `~/.grokbot/local-docker-credential/inference.json`
  and the container data root under `/home/box/sand-data`.
- No machine paths or usernames in tracked `*.ts`, `*.tsx`, `*.mjs`, `*.json`
  or `*.yml` files. The only test credential values are the obvious fixtures
  `test-key`, `fixture-client` and `fixture-secret`.
- `src/app/dist` is ignored and has zero tracked files; only
  `src/app/package.json` is tracked.
- `npm run typecheck` exits 0, `npm run source:typecheck` exits 0,
  `npm test` reports 110 passed and 0 failed.
- `npm run publication:check` passes and reports 2166 files with tree
  `000110fab7113acce7c313a97971166b20ee5a1a`.
- `.github/workflows/check.yml` runs `npm run check`, `npm run frontend:build`
  and `npm run publication:check` on Node 26.5.0.

## Ordered action list

1. Resolve B2: confirm the owning identity and authenticate as it.
2. Resolve B1: decide whether the installers stay hosted. If they go, remove
   them from the tree and the LFS history plan, and update the three documents
   that describe them.
3. Commit the local-http-mcp line in focused commits, then re-run
   `npm run check` and `npm run publication:check`.
4. Apply S1 through S5.
5. Push `main`, then push LFS objects only if step 2 kept them.
6. Set the description and topics from `GITHUB-ABOUT.md`.
