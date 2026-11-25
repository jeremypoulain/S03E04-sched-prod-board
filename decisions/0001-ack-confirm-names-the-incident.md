---
id: 0001
title: Ack asks to confirm, and the confirm names the incident id
asked-of: product
status: decided
---

## Finding
Step 1 recording (build bdf409b, release step1-race-bdf409b) at 00:13: I aimed at INC-4019's Ack; a new sev1, INC-8434, landed on top 4 ms before my click; the board acked INC-8434. R1 + R4 (live inserts on top) work against R2 (Ack on a row).

## Options (as sent in the step 1 report)
1. Keep as planned — door: two-way — effort: none
2. Hold inserts while the pointer is on the list — door: two-way — effort: S
3. "N new incidents" bar — door: two-way — effort: S
4. Confirm the target: Ack asks "Ack INC-xxxx?" — door: two-way — effort: S

Recommendation sent: 2.

## Product's answer
Read via resume-challenge on 2026-11-25 (answer due 19:23:04Z), word for word:

> Read it. Watched it at 00:13. New incidents stay live at the top and Ack stays on the row, but Ack asks to confirm, and the confirm names the incident id. Change the plan, rebuild, and send a proof of the new build. — product

Hooks given with the answer, word for word:

> New data-testid hooks for this change: confirm (the confirm, naming the incident id) · confirm-ack · confirm-cancel — or a browser confirm() whose text names the id.

Product chose option 4, not our recommendation (2).

## Must deliver
- [A1] New incidents stay live at the top (R1 unchanged) — test: new incident at the top without a reload — video: the insert during the race
- [A2] Ack stays on the row (R2 button per row unchanged; hook `ack` kept) — test: hooks tree
- [A3] Ack asks to confirm; nothing is acked before the confirm (R2 changed) — test: Ack opens the confirm, no ack call until confirm-ack
- [A4] The confirm names the incident id of the row whose Ack was clicked — test: race click during an insert opens a confirm naming INC-8434 (the row under the pointer), so on-call sees it is not INC-4019
- [A5] Hooks `confirm` (naming the id), `confirm-ack`, `confirm-cancel` added; the 8 pinned hooks kept — test: hooks tree
- [A6] Plan changed (R2 text) and proven: new recording + the course's replay (prove.yml on GitHub, runUrl)

## Conflicts
- R2 (plan, owner product): « Ack sends the ack (`api.ack(id)`) and marks the row acked » → superseded: Ack opens a confirm naming the id; `confirm-ack` sends the ack and marks the row. Product owns R2, so the decision applies (docs/RULES.md, Conflits).
- Our recommendation (2) was not chosen: nothing to build for it.

## Cost of being wrong
One extra click per ack for on-call; a wrong ack still possible if on-call confirms without reading the id. Two-way: reverting the commit restores the direct Ack.
