// Test harness: serves app/ locally (build sha marker replaced) and mocks the course API inside the browser.
// Any request that would leave for the real course host is aborted and recorded as a violation.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { API_PATH } from './contracts.mjs';

const APP = process.env.BOARD_APP ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
export const TEST_SHA = 'test0000000000000000000000000000000000sha';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

export function serveApp() {
  const server = http.createServer((req, res) => {
    const name = req.url === '/' ? 'index.html' : req.url.split('?')[0].slice(1);
    const file = path.join(APP, path.normalize(name));
    if (!file.startsWith(APP) || !fs.existsSync(file)) return res.writeHead(404).end();
    let body = fs.readFileSync(file, 'utf8');
    if (name === 'index.html') body = body.replaceAll('__BUILD_SHA__', TEST_SHA);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'text/plain' }).end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** A night like the real one (probe 2026-11-25): a list, then new incidents along the cursor chain. */
export function night({ initial = BASE, arrivals = [], firstDelayMs = 0, pollDelayMs = 0, ackFails = false } = {}) {
  return { initial, arrivals, firstDelayMs, pollDelayMs, ackFails };
}

const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
export const BASE = [
  { id: 'INC-4019', service: 'booking-api', region: 'ap-southeast', summary: 'login loop on mobile', severity: 'sev2', openedAt: iso(7) },
  { id: 'INC-3851', service: 'studio-search', region: 'eu-central', summary: 'export job stuck in queue', severity: 'sev1', openedAt: iso(15) },
  { id: 'INC-1931', service: 'booking-api', region: 'us-west', summary: 'calendar push rejected', severity: 'sev2', openedAt: iso(22) },
  { id: 'INC-1602', service: 'sessions', region: 'ap-southeast', summary: 'session · ilse · studio · auckland · 04:03 on the sheet', severity: 'sev3', openedAt: '2026-11-24T03:11:00.000Z' },
];
export const NEW_SEV1 = { id: 'INC-8434', service: 'exports', region: 'us-west', summary: 'login loop on mobile', severity: 'sev1', openedAt: iso(0) };

/** Installs the mock course API on a page; every other non-local request is aborted and recorded. */
export async function installMock(page, scenario) {
  const calls = { incidents: [], ack: [], violations: [], maxInFlight: 0 };
  let inFlight = 0;
  let polls = 0;
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1') return route.continue();
    calls.violations.push(u.href);
    return route.abort();
  });
  await page.route(`**${API_PATH}/**`, async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith('/incidents')) {
      calls.incidents.push({ at: Date.now(), since: u.searchParams.get('since') });
      const n = polls++;
      calls.maxInFlight = Math.max(calls.maxInFlight, ++inFlight);
      if (n === 0 && scenario.firstDelayMs) await new Promise((r) => setTimeout(r, scenario.firstDelayMs));
      if (scenario.pollDelayMs) await new Promise((r) => setTimeout(r, scenario.pollDelayMs));
      const added = scenario.arrivals.filter((a) => n >= a.afterPoll).map((a) => a.incident);
      const incidents = [...added.reverse(), ...scenario.initial];
      inFlight--;
      return route.fulfill({ json: { updatedAt: new Date().toISOString(), incidents, cursor: `c${n}` } });
    }
    if (u.pathname.endsWith('/ack')) {
      calls.ack.push({ id: u.searchParams.get('id'), cursor: u.searchParams.get('cursor') });
      if (scenario.ackFails) return route.fulfill({ status: 500, body: 'mock ack failure' });
      return route.fulfill({ json: { id: u.searchParams.get('id'), ackedAt: new Date().toISOString(), receipt: `mock-receipt-${u.searchParams.get('id')}` } });
    }
    return route.fulfill({ status: 404, body: 'unknown mock path' });
  });
  return { calls, polls: () => polls };
}

export async function openBoard(t, scenario, contextOptions = {}) {
  const server = await serveApp();
  const browser = await chromium.launch();
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  // In-page record of every incidents fetch (issue time, cursor): R4 is measured where the board runs, not at
  // the route handler, whose dispatch can lag under load.
  await page.addInitScript(() => {
    window.__polls = [];
    const f = window.fetch;
    window.fetch = (...a) => {
      const u = String(a[0] instanceof Request ? a[0].url : a[0]);
      if (u.includes('/incidents')) window.__polls.push([performance.now(), new URL(u).searchParams.get('since')]);
      return f(...a);
    };
  });
  const mock = await installMock(page, scenario);
  t.after(async () => {
    await browser.close();
    server.closeAllConnections();
    server.close();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  return { page, ...mock };
}

/**
 * Clicks like a person, not like a test (L-17): aims at the Ack of `meantId`, waits for a new incident to land on top,
 * then clicks the screen position right away with the mouse, while the list moves. Returns the row under the pointer
 * at the click and the ms after landing.
 */
export async function raceClick(page, meantId) {
  const btn = page.locator(`[data-testid="incident-row"][data-id="${meantId}"] [data-testid="ack"]`);
  await btn.hover();
  const box = await btn.boundingBox();
  const px = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const top = await page.locator('[data-testid="incident-row"]').first().getAttribute('data-id');
  await page.waitForFunction((id) => document.querySelector('[data-testid="incident-row"]')?.dataset.id !== id, top, { timeout: 30000, polling: 'raf' });
  const landed = Date.now();
  const under = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="incident-row"]')?.dataset.id ?? null, px);
  await page.mouse.click(px.x, px.y);
  return { under, msAfterLanding: Date.now() - landed };
}
