# AGENTS.md — sched-prod incident board

Build what `issues/` asks, against `plan.md`. Keep it short; links over prose.
- **Contract is pinned:** [contract/board.md](contract/board.md) (API, data-testid hooks, flows). Add hooks, never rename or drop one.
- **Never edit** `.github/workflows/prove.yml` (the course checks it byte for byte) or `app/api.js` (it keeps the cursor the ack needs).
- **Gate before every commit:** `npm test` green in one full run (mock API, Berlin + Auckland). Max 3 fix cycles per red test, then stop and report.
- **Tests never reach the real API:** any request to hq.mega.dev is aborted and fails the test. Real acks happen only in the recorded run.
- **One commit on main = the merge.** Commit with the template (`.gitmessage`): issue, plan rule, door, hooks, proof.
- **Deploy:** push to main → `pages.yml` writes the commit sha into `meta[name=build]` and the footer → GitHub Pages.
- **Freeze:** once the live board serves the sha and the smoke passes, no change to `app/` until the claim. Findings go in the report.
- Product decisions: `decisions/` (template there). Product's words are copied as written.
