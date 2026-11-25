// One source for the pinned contract (contract/board.md): used by the tests and by the preclaim check.
export const PINNED_HOOKS = ['board', 'loader', 'empty', 'incident-list', 'incident-row', 'ack', 'acked', 'build-sha'];
// Added by decision 0001 (product, 2026-11-25): Ack asks to confirm, and the confirm names the incident id.
export const CONFIRM_HOOKS = ['confirm', 'confirm-ack', 'confirm-cancel'];
export const HOOKS = [...PINNED_HOOKS, ...CONFIRM_HOOKS];
export const INCIDENT_KEYS = ['id', 'service', 'region', 'summary', 'severity', 'openedAt'];
export const PAGE_KEYS = ['updatedAt', 'incidents', 'cursor'];
export const ACK_KEYS = ['id', 'ackedAt', 'receipt'];
export const FLOWS = ['open-board', 'ack-incident', 'watch-board'];
export const REPORT1_SECTIONS = ['## What you checked', '## When', '## Where', '## Options for product'];
export const API_PATH = '/challenges/show-me-when/api';
