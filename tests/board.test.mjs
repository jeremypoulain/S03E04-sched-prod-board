import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openBoard, night, NEW_SEV1, BASE, TEST_SHA } from './harness.mjs';
import { HOOKS } from './contracts.mjs';

const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const rowIds = (page) => tid(page, 'incident-row').evaluateAll((els) => els.map((e) => e.dataset.id));
const noViolations = (calls) => assert.deepEqual(calls.violations, [], 'a request tried to reach the real course host');

test('SCHED-4512 R3: loader shows until incidents load, then is gone', async (t) => {
  const { page, calls } = await openBoard(t, night({ firstDelayMs: 1200 }));
  await tid(page, 'loader').waitFor({ state: 'visible' });
  assert.equal(await tid(page, 'incident-row').count(), 0);
  await tid(page, 'incident-row').first().waitFor();
  assert.equal(await tid(page, 'loader').count(), 0, 'loader still in the page');
  assert.equal(await tid(page, 'empty').isVisible(), false);
  noViolations(calls);
});

test('SCHED-4512: empty shows with no incidents', async (t) => {
  const { page, calls } = await openBoard(t, night({ initial: [] }));
  await tid(page, 'empty').waitFor({ state: 'visible' });
  assert.equal(await tid(page, 'loader').count(), 0);
  noViolations(calls);
});

test('SCHED-4511 R1 + SCHED-4513 R4: new incident at the top without a reload; refresh every 2 s, one at a time', async (t) => {
  const { page, calls } = await openBoard(t, night({ arrivals: [{ afterPoll: 2, incident: NEW_SEV1 }], pollDelayMs: 300 }));
  let navigations = 0;
  page.on('framenavigated', () => navigations++);
  await tid(page, 'incident-row').first().waitFor();
  assert.deepEqual(await rowIds(page), BASE.map((i) => i.id));
  await page.waitForFunction((id) => document.querySelector('[data-testid="incident-row"]')?.dataset.id === id, NEW_SEV1.id, { timeout: 8000 });
  assert.deepEqual(await rowIds(page), [NEW_SEV1.id, ...BASE.map((i) => i.id)], 'newest first, no duplicates');
  await page.waitForTimeout(4500);
  const n = calls.incidents.length;
  assert.ok(n >= 3 && n <= 6, `expected 3-6 polls in ~9 s, got ${n}`);
  assert.equal(calls.maxInFlight, 1, 'two polls were in flight at once');
  // measured in the page, at each fetch (the route handler's clock can lag under load)
  const polls = await page.evaluate(() => window.__polls);
  const gaps = polls.slice(1).map((p, k) => Math.round(p[0] - polls[k][0]));
  assert.ok(gaps.length >= 3 && gaps.every((g) => g >= 2000 && g < 3500), `refresh is not every ~2 s (in page): ${gaps}`);
  assert.equal(calls.incidents[0].since, null, 'first poll starts the chain');
  assert.ok(calls.incidents.slice(1).every((c, k) => c.since === `c${k}`), 'each poll sends the latest cursor');
  assert.equal(navigations, 0, 'the page reloaded');
  noViolations(calls);
});

test('SCHED-4511 R2 (decision 0001 [A3]): Ack opens a confirm naming the id; only confirm-ack sends one ack with the latest cursor; acked survives refreshes', async (t) => {
  const { page, calls } = await openBoard(t, night({ arrivals: [{ afterPoll: 1, incident: NEW_SEV1 }] }));
  const row = page.locator('[data-testid="incident-row"][data-id="INC-3851"]');
  await row.waitFor();
  await page.waitForTimeout(2500); // let the list move (a new row arrives at the top)
  await row.locator('[data-testid="ack"]').click();
  await tid(page, 'confirm').waitFor({ state: 'visible' });
  assert.match(await tid(page, 'confirm').innerText(), /INC-3851/, 'the confirm names the incident id');
  await page.waitForTimeout(300);
  assert.equal(calls.ack.length, 0, 'no ack before confirm-ack');
  await tid(page, 'confirm-ack').dblclick();
  await row.locator('[data-testid="acked"]').waitFor();
  assert.equal(calls.ack.length, 1, `expected one ack call, got ${calls.ack.length}`);
  assert.equal(calls.ack[0].id, 'INC-3851');
  const latest = `c${calls.incidents.length - 1}`;
  assert.ok([latest, `c${calls.incidents.length - 2}`].includes(calls.ack[0].cursor), `stale cursor ${calls.ack[0].cursor}`);
  assert.equal(await tid(page, 'confirm').isVisible(), false, 'confirm closes after the ack');
  await page.waitForTimeout(4500);
  assert.equal(await row.locator('[data-testid="acked"]').count(), 1, 'acked lost after refresh');
  assert.equal(await row.locator('[data-testid="ack"]').count(), 0);
  assert.equal(await tid(page, 'acked').count(), 1, 'only that row is acked');
  noViolations(calls);
});

test('SCHED-4511 R2: a failed ack leaves no mark and the button usable', async (t) => {
  const { page, calls } = await openBoard(t, night({ ackFails: true }));
  const row = page.locator('[data-testid="incident-row"][data-id="INC-4019"]');
  await row.locator('[data-testid="ack"]').click();
  await tid(page, 'confirm-ack').click();
  await page.locator('.error').waitFor({ state: 'visible' });
  assert.equal(await row.locator('[data-testid="acked"]').count(), 0);
  assert.equal(await row.locator('[data-testid="ack"]').isEnabled(), true);
  noViolations(calls);
});

for (const [zone, locale, check] of [
  ['Europe/Berlin', 'de-DE', (s) => /24\.11\./.test(s) && /04:11/.test(s)],
  ['Pacific/Auckland', 'en-NZ', (s) => /24\/11/.test(s) && /0?4:11\s*pm/i.test(s)],
  ['America/New_York', 'en-US', (s) => /11\/23/.test(s) && /10:11\s*PM/i.test(s)],
]) {
  test(`SCHED-4514 R5: ${zone} ${locale} sees local time in its own order, UTC kept in datetime`, async (t) => {
    const { page, calls } = await openBoard(t, night(), { timezoneId: zone, locale });
    const time = page.locator('[data-testid="incident-row"][data-id="INC-1602"] time');
    await time.waitFor();
    const text = await time.textContent();
    assert.ok(check(text), `${zone} ${locale} shows "${text}"`);
    assert.equal(await time.getAttribute('datetime'), '2026-11-24T03:11:00.000Z');
    noViolations(calls);
  });
}

test('R6 + hooks: build sha in meta and footer; every pinned hook present in its state', async (t) => {
  const { page, calls } = await openBoard(t, night());
  await tid(page, 'incident-row').first().waitFor();
  assert.equal(await page.locator('meta[name="build"]').getAttribute('content'), TEST_SHA);
  assert.equal(await tid(page, 'build-sha').textContent(), TEST_SHA);
  const present = {};
  for (const h of HOOKS) present[h] = await tid(page, h).count();
  assert.deepEqual(
    { board: present.board, list: present['incident-list'], rows: present['incident-row'], ack: present.ack, sha: present['build-sha'], empty: present.empty, loader: present.loader, acked: present.acked, confirm: present.confirm, confirmAck: present['confirm-ack'], confirmCancel: present['confirm-cancel'] },
    { board: 1, list: 1, rows: BASE.length, ack: BASE.length, sha: 1, empty: 1, loader: 0, acked: 0, confirm: 1, confirmAck: 1, confirmCancel: 1 },
  );
  assert.equal(await tid(page, 'confirm').isVisible(), false, 'confirm hidden until an Ack is clicked');
  assert.equal(await tid(page, 'empty').isVisible(), false);
  const rowAttr = await tid(page, 'incident-row').first().getAttribute('data-id');
  assert.equal(rowAttr, BASE[0].id);
  noViolations(calls);
});

test('safety: incident text is shown as text, never as HTML', async (t) => {
  const evil = { ...BASE[0], id: 'INC-6666', summary: '<img src=x onerror="window.__pwned=1">boom' };
  const { page, calls } = await openBoard(t, night({ initial: [evil] }));
  await tid(page, 'incident-row').first().waitFor();
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.locator('[data-testid="incident-row"] img').count(), 0);
  assert.match(await tid(page, 'incident-row').first().textContent(), /<img src=x/);
  noViolations(calls);
});
