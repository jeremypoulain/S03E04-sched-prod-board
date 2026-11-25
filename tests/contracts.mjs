// One source for the pinned contract (contract/board.md): used by the tests and by the preclaim check.
export const HOOKS = ['board', 'loader', 'empty', 'incident-list', 'incident-row', 'ack', 'acked', 'build-sha'];
export const INCIDENT_KEYS = ['id', 'service', 'region', 'summary', 'severity', 'openedAt'];
export const PAGE_KEYS = ['updatedAt', 'incidents', 'cursor'];
export const ACK_KEYS = ['id', 'ackedAt', 'receipt'];
export const FLOWS = ['open-board', 'ack-incident', 'watch-board'];
export const REPORT1_SECTIONS = ['## What you checked', '## When', '## Where', '## Options for product'];
export const API_PATH = '/challenges/show-me-when/api';
