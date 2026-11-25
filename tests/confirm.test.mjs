// Decision 0001 (product): "Ack asks to confirm, and the confirm names the incident id."
// These tests click like a person (raceClick), not like a test, and mirror what the course's replay checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openBoard, night, NEW_SEV1, BASE, raceClick } from './harness.mjs';

const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const noViolations = (calls) => assert.deepEqual(calls.violations, [], 'a request tried to reach the real course host');
const ackOf = (page, id) => page.locator(`[data-testid="incident-row"][data-id="${id}"] [data-testid="ack"]`);

test('[A3][A4] race: a person-like click as an incident lands opens a confirm naming the row under the pointer; nothing is acked; cancel, re-pick, confirm acks the row meant', async (t) => {
  const { page, calls } = await openBoard(t, night({ arrivals: [{ afterPoll: 2, incident: NEW_SEV1 }] }));
  await tid(page, 'incident-row').first().waitFor();
  const r = await raceClick(page, 'INC-4019');
  assert.equal(r.under, 'INC-8434', 'the new row moved under the pointer');
  await tid(page, 'confirm').waitFor({ state: 'visible' });
  assert.match(await tid(page, 'confirm').innerText(), /INC-8434/, 'the confirm names the id of the row clicked');
  await page.waitForTimeout(500);
  assert.equal(calls.ack.length, 0, 'no ack before the confirm');
  await tid(page, 'confirm-cancel').click();
  assert.equal(await tid(page, 'confirm').isVisible(), false, 'cancel closes the confirm');
  await ackOf(page, 'INC-4019').click();
  assert.match(await tid(page, 'confirm').innerText(), /INC-4019/);
  await tid(page, 'confirm-ack').click();
  await page.locator('[data-testid="incident-row"][data-id="INC-4019"] [data-testid="acked"]').waitFor();
  assert.deepEqual(calls.ack.map((a) => a.id), ['INC-4019'], 'exactly one ack, for the row meant');
  assert.equal(await page.locator('[data-testid="incident-row"][data-id="INC-8434"] [data-testid="acked"]').count(), 0);
  noViolations(calls);
});

test('[P1] the confirm never covers an Ack button, and there is no backdrop: every Ack stays clickable while it is open', async (t) => {
  const { page, calls } = await openBoard(t, night());
  await tid(page, 'incident-row').first().waitFor();
  await ackOf(page, 'INC-1931').click();
  await tid(page, 'confirm').waitFor({ state: 'visible' });
  const blocked = await page.evaluate(() => [...document.querySelectorAll('[data-testid="ack"]')].filter((b) => {
    const r = b.getBoundingClientRect();
    return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) !== b;
  }).length);
  assert.equal(blocked, 0, 'an Ack button is covered while the confirm is open');
  await ackOf(page, BASE[0].id).click({ timeout: 2000 }); // a Playwright click fails if anything intercepts it
  noViolations(calls);
});

test('[P2] opening the confirm does not move the list', async (t) => {
  const { page, calls } = await openBoard(t, night());
  await tid(page, 'incident-row').first().waitFor();
  const before = await tid(page, 'incident-row').first().boundingBox();
  await ackOf(page, 'INC-3851').click();
  await tid(page, 'confirm').waitFor({ state: 'visible' });
  const after = await tid(page, 'incident-row').first().boundingBox();
  assert.equal(after.y, before.y, `the list moved by ${after.y - before.y}px when the confirm opened`);
  noViolations(calls);
});

test('[P3] no incident row is ever removed from the page (new incidents, confirm, ack)', async (t) => {
  const { page, calls } = await openBoard(t, night({ arrivals: [{ afterPoll: 1, incident: NEW_SEV1 }] }));
  await tid(page, 'incident-row').first().waitFor();
  await page.evaluate(() => {
    window.__rowsRemoved = 0;
    new MutationObserver((recs) => { for (const r of recs) for (const n of r.removedNodes) if (n.nodeType === 1 && (n.matches?.('[data-testid="incident-row"]') || n.querySelector?.('[data-testid="incident-row"]'))) window.__rowsRemoved++; })
      .observe(document, { childList: true, subtree: true });
  });
  await page.waitForTimeout(4500);
  await ackOf(page, 'INC-1931').click();
  await tid(page, 'confirm-ack').click();
  await page.locator('[data-testid="incident-row"][data-id="INC-1931"] [data-testid="acked"]').waitFor();
  await page.waitForTimeout(2500);
  assert.equal(await page.evaluate(() => window.__rowsRemoved), 0);
  noViolations(calls);
});

test('[P4] the confirm follows the last Ack clicked; Escape cancels; one pending id at a time', async (t) => {
  const { page, calls } = await openBoard(t, night());
  await tid(page, 'incident-row').first().waitFor();
  await ackOf(page, 'INC-3851').click();
  await ackOf(page, 'INC-1931').click();
  const text = await tid(page, 'confirm').innerText();
  assert.match(text, /INC-1931/);
  assert.doesNotMatch(text, /INC-3851/);
  await page.keyboard.press('Escape');
  assert.equal(await tid(page, 'confirm').isVisible(), false, 'Escape closes the confirm');
  await page.waitForTimeout(300);
  assert.equal(calls.ack.length, 0);
  noViolations(calls);
});
