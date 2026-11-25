# sched-prod board — contract (pinned)

Source of truth for tests: `tests/contracts.mjs`. Change only when product decides it; list every change in the System Diff.

## Course API (owned by the course, wrapped by `app/api.js`)
- `GET <api>/incidents?t=<session>[&since=<cursor>]` → `{ updatedAt, incidents: [{ id, service, region, summary, severity, openedAt }], cursor }`, newest first.
  - Measured 2026-11-25: with `since` the answer is the **full** current list (not a delta); new incidents only arrive along the cursor chain; a call without `since` starts the night over.
  - Errors: 401 bad session; 400 `{ message, error, statusCode }` for a cursor from another session.
- `GET <api>/ack?t=<session>&id=<id>&cursor=<latest cursor>` → `{ id, ackedAt, receipt }` (receipt opaque, sealed).

## DOM hooks (`data-testid`)
| hook | element | state |
|---|---|---|
| `board` | main area | always |
| `loader` | loader | until the first answer, then removed |
| `empty` | no-incident message | visible only with 0 incidents |
| `incident-list` | the list | always |
| `incident-row` | one row, `data-id="<id>"` | one per incident, newest first |
| `ack` | Ack button in a row | until acked |
| `acked` | acked mark in a row | after a successful ack; survives refreshes |
| `build-sha` | footer sha | = `<meta name="build" content>` = deployed commit |

Also: `<time datetime="<openedAt UTC>">` shows the viewer's local time (locale order).

## Flows
- `open-board`: loader → list (or empty).
- `ack-incident`: Ack → one `/ack` call for that row's id → row shows `acked`.
- `watch-board`: refresh every 2 s, no reload; new incidents at the top.
