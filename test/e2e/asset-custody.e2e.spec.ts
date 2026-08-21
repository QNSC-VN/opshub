/**
 * WHO HELD THE MACHINE — the asset's chain of custody, by name.
 *
 * WHY THIS FILE EXISTS. `GET /v1/assets/:id/assignments` is the record that answers "who had this
 * laptop in March": the assignment history, kept because a returned asset's past holders are the
 * whole point of tracking one. The SPA rendered `employeeId` on every line, so the panel answered
 * that question with 36 characters that identify nobody — and physical assets had no API-level e2e
 * spec at all, so nothing here was pinned.
 *
 * WHY THE NAME IS NULLABLE AND THE ROW IS NOT. People leave and their record can go; the custody
 * history must not go with them, or an audit of who had what becomes unanswerable. The name is
 * resolved with a left lookup for exactly that reason.
 *
 * Prereqs: `docker compose -f docker-compose.dev.yml up -d` and `pnpm db:migrate`.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE, apiRequest, createTestApp, login, unwrap, type Session } from './support/harness';

let app: NestFastifyApplication;
/** Holds `asset.manage`. */
let admin: Session;

beforeAll(async () => {
  app = await createTestApp();
  admin = await login(app, FIXTURE.ADMIN);
});

afterAll(async () => {
  await app?.close();
});

interface AssignmentRow {
  id: string;
  employeeId: string;
  employeeName: string | null;
  returnedAt: string | null;
}

async function createAsset(): Promise<string> {
  const res = await apiRequest(app, admin, 'POST', '/assets', {
    assetTag: `E2E-CUSTODY-${Date.now().toString(36).toUpperCase()}`,
    type: 'laptop',
    manufacturer: 'Acme',
    model: 'Book 13',
    status: 'in_stock',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return unwrap<{ id: string }>(res.body).id;
}

describe('the assignment history', () => {
  it('names each holder, including the ones who have given it back', async () => {
    /*
     * TWO ENTRIES, one closed and one open, because the closed row is the one that matters: a history
     * that only names the CURRENT holder answers a question anybody could answer by looking at the
     * asset itself.
     */
    const assetId = await createAsset();

    const first = await apiRequest(app, admin, 'POST', `/assets/${assetId}/assign`, {
      employeeId: FIXTURE.NO_PERMISSIONS.id,
      notes: 'e2e: first holder',
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);

    const returned = await apiRequest(app, admin, 'POST', `/assets/${assetId}/unassign`);
    expect(returned.status, JSON.stringify(returned.body)).toBe(200);

    const second = await apiRequest(app, admin, 'POST', `/assets/${assetId}/assign`, {
      employeeId: FIXTURE.MANAGER.id,
      notes: 'e2e: current holder',
    });
    expect(second.status, JSON.stringify(second.body)).toBe(200);

    const history = await apiRequest(app, admin, 'GET', `/assets/${assetId}/assignments`);
    expect(history.status, JSON.stringify(history.body)).toBe(200);
    const rows = unwrap<AssignmentRow[]>(history.body);

    expect(rows.length, 'the returned assignment was dropped from the history').toBe(2);
    for (const row of rows) {
      expect(
        row.employeeName,
        `assignment ${row.id} came back with employee ${row.employeeId} and no name`,
      ).toBeTruthy();
    }

    // Two different people held it, so two different names — a resolver keyed on the wrong column
    // would give both lines the same one.
    expect(new Set(rows.map((r) => r.employeeName)).size).toBe(2);
    // And one of the two is the closed row, which is the half a current-holder-only test would miss.
    expect(rows.filter((r) => r.returnedAt !== null)).toHaveLength(1);
  });

  it('costs no name query when an asset has never been assigned', async () => {
    /*
     * `inArray(col, [])` is not valid SQL, so an empty history is a crash and not merely a waste —
     * and a freshly registered asset is the ordinary case, not an edge one.
     */
    const assetId = await createAsset();

    const history = await apiRequest(app, admin, 'GET', `/assets/${assetId}/assignments`);
    expect(history.status, JSON.stringify(history.body)).toBe(200);
    expect(unwrap<AssignmentRow[]>(history.body)).toEqual([]);
  });
});
