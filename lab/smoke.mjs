// G2 smoke on the deployed board: real course API reads, every /ack blocked. Exit 0 only if all checks pass.
//   node lab/smoke.mjs <board url> <expected sha>
import { chromium } from 'playwright';
import { HOOKS, API_PATH } from '../tests/contracts.mjs';

const [url, expectedSha] = process.argv.slice(2);
const checks = {};
const html = await (await fetch(`${url}?nocache=${Date.now()}`)).text();
checks.servedMetaSha = html.includes(`<meta name="build" content="${expectedSha}"`);
checks.servedFooterSha = html.includes(`data-testid="build-sha">${expectedSha}<`);

const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'en-GB', timezoneId: 'Europe/Berlin' });
const blocked = [];
await page.route(`**${API_PATH}/ack**`, (r) => (blocked.push(r.request().url()), r.abort()));
let polls = 0;
page.on('request', (r) => r.url().includes(`${API_PATH}/incidents`) && polls++);
await page.goto(url);
const tid = (id) => page.locator(`[data-testid="${id}"]`);
await tid('incident-row').first().waitFor({ timeout: 15000 });
checks.loaderGone = (await tid('loader').count()) === 0;
checks.rowsWithIds = (await tid('incident-row').evaluateAll((els) => els.every((e) => e.dataset.id))) && (await tid('incident-row').count()) > 0;
checks.ackButtons = (await tid('ack').count()) === (await tid('incident-row').count());
checks.metaEqualsFooter = (await page.locator('meta[name="build"]').getAttribute('content')) === (await tid('build-sha').textContent());
checks.domSha = (await tid('build-sha').textContent()) === expectedSha;
const top = await tid('incident-row').first().getAttribute('data-id');
await page.waitForFunction((id) => document.querySelector('[data-testid="incident-row"]')?.dataset.id !== id, top, { timeout: 30000 });
checks.newIncidentOnTopWithoutReload = true;
checks.refreshing = polls >= 5;
checks.localTimeDayFirst = /^\d{2}\/\d{2}/.test(await tid('incident-row').first().locator('time').textContent());
checks.hooksPresent = (await Promise.all(['board', 'incident-list', 'incident-row', 'ack', 'build-sha', 'empty'].map(async (h) => (await tid(h).count()) > 0))).every(Boolean) && HOOKS.length === 8;
checks.noAckSent = blocked.length === 0;
await browser.close();

const ok = Object.values(checks).every(Boolean);
console.log(Object.entries(checks).map(([k, v]) => `  ${v ? 'ok' : 'KO'} ${k}`).join('\n'));
console.log(`${ok ? 'SMOKE OK' : 'SMOKE KO'} · ${url} · sha ${expectedSha} · polls ${polls}`);
process.exit(ok ? 0 : 1);
