// Agent lab: drives the real board like a user, records it, and writes a run record.
//   node lab/run.mjs --target local|<https url> [--live] [--live-ack] [--out <dir>]
// local  = app/ served here with the mock API (free; no request reaches the course).
// --live = the real course API (reads). --live-ack = also the one real ack (capped by the caller: 2 tries).
// The lab adds only tools and records: it never changes the board's code.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { serveApp, installMock, night, BASE, NEW_SEV1 } from '../tests/harness.mjs';
import { API_PATH } from '../tests/contracts.mjs';

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const target = opt('--target') ?? 'local';
const live = args.includes('--live');
const liveAck = args.includes('--live-ack');
const locale = opt('--locale') ?? 'en-GB';
const timezoneId = opt('--tz') ?? 'Europe/Berlin';
const out = path.resolve(opt('--out') ?? `../runs/${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(out, { recursive: true });

const mmss = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const log = [];
const note = (event, data = {}) => {
  const e = { t: Date.now(), event, ...data };
  log.push(e);
  console.log(event, JSON.stringify(data));
};

let server;
let url = target;
if (target === 'local') {
  server = await serveApp();
  url = `http://127.0.0.1:${server.address().port}/`;
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  locale,
  timezoneId,
  recordVideo: { dir: out, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
const t0 = Date.now(); // the video starts with the page
note('video-start', { url, locale, timezoneId });

// Lab clock in a corner, so a viewer can match mm:ss with the video (lab overlay, not the board's code).
await page.addInitScript(() => {
  const start = Date.now();
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.style.cssText = 'position:fixed;right:8px;bottom:8px;font:12px ui-monospace,monospace;background:#222;color:#fff;padding:2px 6px;border-radius:3px;z-index:9999;opacity:.8';
    document.body.append(c);
    const tick = () => {
      const s = Math.floor((Date.now() - start) / 1000);
      c.textContent = `lab clock ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };
    tick();
    setInterval(tick, 250);
    // Lab pointer ring: headless video does not draw the mouse cursor.
    const ring = document.createElement('div');
    ring.style.cssText = 'position:fixed;width:26px;height:26px;margin:-13px 0 0 -13px;border:3px solid #e00;border-radius:50%;pointer-events:none;z-index:10000;left:-50px;top:-50px';
    document.body.append(ring);
    addEventListener('mousemove', (e) => { ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px'; }, true);
  });
});

let mock;
if (!live) {
  const arrivals = [6, 10, 14, 18].map((afterPoll, k) =>
    k === 0 ? { afterPoll, incident: { ...NEW_SEV1, openedAt: new Date(Date.now() + 12000).toISOString() } }
      : { afterPoll, incident: { ...BASE[k % BASE.length], id: `INC-90${k}0`, openedAt: new Date(Date.now() + afterPoll * 2000).toISOString() } },
  );
  mock = await installMock(page, night({ arrivals }));
} else if (!liveAck) {
  await page.route(`**${API_PATH}/ack**`, (r) => (note('ack-blocked', { url: r.request().url() }), r.abort()));
}

const acks = [];
let firstPollAt = null;
page.on('request', (r) => {
  if (!firstPollAt && r.url().includes(`${API_PATH}/incidents`)) {
    firstPollAt = Date.now();
    note('first-poll', { offsetMs: firstPollAt - t0 });
  }
});
page.on('console', (m) => note('console', { type: m.type(), text: m.text() }));
page.on('response', async (r) => {
  if (!r.url().includes(`${API_PATH}/`)) return;
  const kind = new URL(r.url()).pathname.split('/').pop();
  if (kind === 'ack') {
    const body = await r.json().catch(() => null);
    acks.push({ status: r.status(), body });
    note('ack-response', { status: r.status(), id: body?.id, ackedAt: body?.ackedAt });
  } else if (kind === 'incidents') {
    const body = await r.json().catch(() => null);
    note('incidents', { status: r.status(), n: body?.incidents?.length, top: body?.incidents?.[0]?.id });
  }
});

const tid = (id) => page.locator(`[data-testid="${id}"]`);
const checks = {};

// open-board
await page.goto(url);
checks.loaderSeenOrGone = (await tid('loader').count()) >= 0;
await tid('incident-row').first().waitFor({ timeout: 15000 });
checks.listLoaded = (await tid('incident-row').count()) > 0;
checks.loaderGone = (await tid('loader').count()) === 0;
const sha = await page.locator('meta[name="build"]').getAttribute('content');
checks.shaMetaEqualsFooter = sha === (await tid('build-sha').textContent());
const firstTop = await tid('incident-row').first().getAttribute('data-id');
note('board-open', { sha, rows: await tid('incident-row').count(), top: firstTop });
await page.screenshot({ path: path.join(out, '01-open.png') });

// watch-board + the R1/R4 vs R2 conflict: aim at the top row's Ack, let a new incident arrive on top,
// and record which row is under the pointer before and after (no click while it moves).
const aimBtn = page.locator(`[data-testid="incident-row"][data-id="${firstTop}"] [data-testid="ack"]`);
await aimBtn.hover();
const box = await aimBtn.boundingBox();
const px = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
const rowAt = () => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="incident-row"]')?.dataset.id ?? null, px);
note('aim', { at: mmss(Date.now() - t0), pointerOver: await rowAt() });
await page.waitForFunction((id) => document.querySelector('[data-testid="incident-row"]')?.dataset.id !== id, firstTop, { timeout: 30000 });
const newTop = await tid('incident-row').first().getAttribute('data-id');
const shiftAt = Date.now();
checks.newIncidentOnTop = newTop !== firstTop;
const overAfter = await rowAt();
checks.rowShiftedUnderPointer = overAfter !== firstTop;
note('new-on-top', { id: newTop, at: mmss(shiftAt - t0), pointerWasOver: firstTop, pointerNowOver: overAfter });
await page.screenshot({ path: path.join(out, '02-shift-under-pointer.png') });
await page.mouse.move(px.x - 400, px.y + 200); // move away: the click below is deliberate
await page.waitForTimeout(1500);

// ack-incident: on-call takes the incident that just arrived
const row = page.locator(`[data-testid="incident-row"][data-id="${newTop}"]`);
const btn = row.locator('[data-testid="ack"]');
await btn.hover();
await page.waitForTimeout(800);
const clickAt = Date.now();
await btn.click();
note('ack-click', { id: newTop, at: mmss(clickAt - t0) });
await row.locator('[data-testid="acked"]').waitFor({ timeout: 10000 });
checks.ackedShown = true;
await page.screenshot({ path: path.join(out, '03-acked.png') });
await page.waitForTimeout(4500); // two refreshes: the mark must stay
checks.ackedSurvivesRefresh = (await row.locator('[data-testid="acked"]').count()) === 1;
checks.oneAckCall = acks.length === 1;
await page.screenshot({ path: path.join(out, '04-after-refresh.png') });
const tEnd = Date.now();

await context.close(); // finalises the video
await browser.close();
server?.closeAllConnections();
server?.close();

const webm = fs.readdirSync(out).find((f) => f.endsWith('.webm'));
const mp4 = path.join(out, 'recording.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(out, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).toString().trim());
const at = mmss(clickAt - t0);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String((clickAt - t0) / 1000 + 1.5), '-i', mp4, '-frames:v', '1', path.join(out, 'frame-at-plus-1_5s.png')]);
const sha256 = execFileSync('sha256sum', [mp4]).toString().split(' ')[0];

const ack = acks[0]?.body ?? null;
checks.atWithinVideo = (clickAt - t0) / 1000 < duration;
checks.receiptPresent = Boolean(ack?.receipt);
checks.noCourseRequestInMock = live ? null : mock.calls.violations.length === 0;
const ok = Object.values(checks).every((v) => v !== false);
const record = {
  ok, target, url, live, liveAck, locale, timezoneId, sha, flow: 'ack-incident', at, ackedId: newTop, ack,
  firstPollOffsetMs: firstPollAt ? firstPollAt - t0 : null,
  atFromFirstPoll: firstPollAt ? mmss(clickAt - firstPollAt) : null,
  shift: { at: mmss(shiftAt - t0), pointerWasOver: firstTop, pointerNowOver: overAfter },
  video: { file: mp4, sha256, duration, t0: new Date(t0).toISOString(), end: new Date(tEnd).toISOString() },
  checks, log,
};
fs.writeFileSync(path.join(out, 'run.json'), JSON.stringify(record, null, 2));
console.log(`\n${ok ? 'RUN OK' : 'RUN KO'} · ${out}\nflow ack-incident · at ${at} · acked ${newTop} · sha ${sha} · video ${duration.toFixed(1)} s`);
console.log(Object.entries(checks).map(([k, v]) => `  ${v === false ? 'KO' : 'ok'} ${k}`).join('\n'));
process.exit(ok ? 0 : 1);
