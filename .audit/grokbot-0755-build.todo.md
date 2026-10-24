# Grok Bot 0.75.5 build migration

- [x] Migrate feature-extraction inputs from the obsolete 0.72.1 snapshot to the pinned 0.75.5 REA snapshot.
- [x] Regenerate Vault parser and renderer artifacts from 0.75.5 bytes; keep runtime-compatible 0721 output names.
- [x] Update 0.75.5 native pins, tests, and provenance expectations.
- [x] Run typechecks, focused tests, full build, packaging, and live Vault session acceptance.
  - [x] Extract the shipped Simplified Chinese Vault catalog and title-bar create menu.
  - [x] Verify the final QA bundle can open the Vault settings surface.
- [x] Commit the reviewable units, synchronize with GitHub, and push the branch.
