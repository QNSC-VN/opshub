/**
 * Training records end to end: the catalogue, position requirements, the retraining chain, the
 * competency gap report, and a REAL certificate upload.
 *
 * WHAT THIS EXISTS TO PIN
 * -----------------------
 *   - ONE CURRENT RECORD per (employee, course) — `uq_training_record_current`, a partial unique
 *     index. Only a real Postgres can prove it, which is why this file exists at all.
 *   - `expires_on` is DERIVED from the course and then frozen; editing the course afterwards does
 *     not restate it
 *   - the GAP REPORT reads the employee's CURRENT position, so it answers "is the org competent?"
 *     and survives a transfer with no backfill
 *   - the certificate path is exercised against real S3: presigned PUT with exactly the signed
 *     headers, `Content-Disposition` stored as object METADATA, confirm verifying size, the
 *     per-record quota, and an id that is only a capability if the link row exists
 *   - `training.read` is not `training.manage`, and an employee may attach evidence to their OWN
 *     record with no permission at all
 *
 * REAL BYTES, NOT A STUB. A stubbed StorageService would agree with whatever the code did, so it
 * could not catch the two things that actually broke here during development: that a header named in
 * the presign command but absent from `signableHeaders` is silently dropped, and that a presigned
 * GET returned a Promise cast to a string. Both were invisible until something PUT and fetched.
 *
 * Prereqs: `docker compose -f docker-compose.dev.yml up -d`, `pnpm db:migrate`, `pnpm db:seed`.
 * CI runs a LocalStack service and creates the bucket before this suite — see backend-ci.yml.
 */
import { createHash } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE, bearer, createTestApp, login, type Session } from './support/harness';

let app: NestFastifyApplication;
/** Holds `training.read` AND `training.manage`. */
let hr: Session;
/** Holds `training.read` only — the tier that separates reading from managing. */
let auditor: Session;
/** Holds no permission codes at all; the subject of every record below. */
let employee: Session;

const RUN = Date.now().toString(36).toUpperCase().slice(-6);
let seq = 0;
const nextCode = (): string => `E2E-${RUN}-${++seq}`;

interface CourseRow {
  id: string;
  code: string;
  validityMonths: number | null;
  retiredAt: string | null;
}
interface RecordRow {
  id: string;
  employeeId: string;
  courseId: string;
  completedOn: string;
  expiresOn: string | null;
  status: string;
  verifiedBy: string | null;
  supersededById: string | null;
}
interface GapRow {
  courseCode: string;
  kind: string;
  reason: string;
}
interface PresignRow {
  fileId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
}
interface CertificateRow {
  fileId: string;
  fileName: string;
  sizeBytes: number;
  checksumSha256: string | null;
}

async function req(
  session: Session,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
) {
  const res = await app.inject({
    method,
    url: `/v1${url}`,
    headers: bearer(session),
    ...(payload === undefined ? {} : { payload }),
  });
  return { status: res.statusCode, body: (res.body ? JSON.parse(res.body) : {}) as unknown };
}

function data<T>(body: unknown): T {
  const b = body as { data?: T };
  return (b.data ?? body) as T;
}

function errorCode(body: unknown): string | undefined {
  return (body as { error?: { code?: string } }).error?.code;
}

async function createCourse(over: Record<string, unknown> = {}): Promise<CourseRow> {
  const res = await req(hr, 'POST', '/training/courses', {
    code: nextCode(),
    title: 'Security Awareness',
    category: 'information_security',
    validityMonths: 12,
    ...over,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<CourseRow>(res.body);
}

/** A position nobody else is using, with the employee assigned to it from `effectiveFrom`. */
async function positionWithEmployee(effectiveFrom: string): Promise<string> {
  const created = await req(hr, 'POST', '/positions', {
    code: nextCode(),
    title: 'Training Subject',
    department: `E2E-TRAIN-${RUN}`,
    headcount: 5,
  });
  expect(created.status).toBe(201);
  const positionId = data<{ id: string }>(created.body).id;

  const assigned = await req(hr, 'POST', `/positions/${positionId}/assignments`, {
    employeeId: FIXTURE.NO_PERMISSIONS.id,
    effectiveFrom,
  });
  expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
  return positionId;
}

/** Whether this environment has S3 — the upload assertions need it and cannot fake it. */
const HAS_S3 = Boolean(process.env['S3_FILES_BUCKET']);

beforeAll(async () => {
  app = await createTestApp();
  hr = await login(app, FIXTURE.HR);
  auditor = await login(app, FIXTURE.AUDITOR);
  employee = await login(app, FIXTURE.NO_PERMISSIONS);
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('the course catalogue', () => {
  it('refuses a duplicate code', async () => {
    const code = nextCode();
    const first = await req(hr, 'POST', '/training/courses', {
      code,
      title: 'First Aid Basics',
      category: 'safety',
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const dup = await req(hr, 'POST', '/training/courses', {
      code,
      title: 'Duplicate Code',
      category: 'safety',
    });
    expect(dup.status).toBe(409);
  });

  it('hides retired courses unless asked, and keeps them addressable', async () => {
    const course = await createCourse();
    expect((await req(hr, 'POST', `/training/courses/${course.id}/retire`)).status).toBe(200);

    const visible = data<CourseRow[]>((await req(hr, 'GET', '/training/courses?limit=100')).body);
    expect(visible.some((c) => c.id === course.id)).toBe(false);

    const all = data<CourseRow[]>(
      (await req(hr, 'GET', '/training/courses?limit=100&includeRetired=true')).body,
    );
    expect(all.some((c) => c.id === course.id)).toBe(true);
    // Past records reference it, so it must still resolve directly.
    expect((await req(hr, 'GET', `/training/courses/${course.id}`)).status).toBe(200);

    // And retiring twice is refused rather than silently rewriting the date.
    expect((await req(hr, 'POST', `/training/courses/${course.id}/retire`)).status).toBe(412);
  });

  it('refuses to require or complete a retired course', async () => {
    const course = await createCourse();
    const positionId = await positionWithEmployee('2050-01-01');
    expect((await req(hr, 'POST', `/training/courses/${course.id}/retire`)).status).toBe(200);

    const required = await req(hr, 'POST', `/training/positions/${positionId}/requirements`, {
      courseId: course.id,
    });
    expect(required.status).toBe(412);

    const completed = await req(hr, 'POST', '/training/records', {
      employeeId: FIXTURE.NO_PERMISSIONS.id,
      courseId: course.id,
      completedOn: '2026-01-01',
    });
    expect(completed.status).toBe(412);
  });
});

describe('recording a completion', () => {
  it('derives the expiry from the course and freezes it against a later edit', async () => {
    const course = await createCourse({ validityMonths: 12 });
    const created = await req(hr, 'POST', '/training/records', {
      employeeId: FIXTURE.NO_PERMISSIONS.id,
      courseId: course.id,
      completedOn: '2026-01-31',
      score: '91.50',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    // Clamped: there is no 31st of February.
    expect(data<RecordRow>(created.body).expiresOn).toBe('2027-01-31');

    const edited = await req(hr, 'PATCH', `/training/courses/${course.id}`, { validityMonths: 1 });
    expect(edited.status).toBe(200);

    // The record keeps the expiry it was earned with — changing the rule governs the NEXT
    // completion, and restating history would make somebody retroactively non-compliant.
    const after = data<RecordRow>(
      (await req(hr, 'GET', `/training/records/${data<RecordRow>(created.body).id}`)).body,
    );
    expect(after.expiresOn).toBe('2027-01-31');
  });

  it('leaves the expiry null for a course that never lapses', async () => {
    const course = await createCourse({ validityMonths: null });
    const created = await req(hr, 'POST', '/training/records', {
      employeeId: FIXTURE.NO_PERMISSIONS.id,
      courseId: course.id,
      completedOn: '2026-01-05',
    });
    expect(created.status).toBe(201);
    expect(data<RecordRow>(created.body).expiresOn).toBeNull();
  });

  it('refuses a future date and an unknown employee', async () => {
    const course = await createCourse();

    const future = await req(hr, 'POST', '/training/records', {
      employeeId: FIXTURE.NO_PERMISSIONS.id,
      courseId: course.id,
      completedOn: '2999-01-01',
    });
    expect(future.status).toBe(412);
    expect(errorCode(future.body)).toBe('TRAINING_INVALID_COMPLETION');

    const nobody = await req(hr, 'POST', '/training/records', {
      employeeId: '00000000-0000-7000-8000-0000000000fe',
      courseId: course.id,
      completedOn: '2026-01-01',
    });
    expect(nobody.status).toBe(404);
  });
});

describe('retraining', () => {
  it('supersedes the previous record and leaves exactly one current', async () => {
    const course = await createCourse({ validityMonths: 12 });
    const first = data<RecordRow>(
      (
        await req(hr, 'POST', '/training/records', {
          employeeId: FIXTURE.NO_PERMISSIONS.id,
          courseId: course.id,
          completedOn: '2026-01-15',
        })
      ).body,
    );
    const second = await req(hr, 'POST', '/training/records', {
      employeeId: FIXTURE.NO_PERMISSIONS.id,
      courseId: course.id,
      completedOn: '2026-07-15',
    });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    const successor = data<RecordRow>(second.body);

    const predecessor = data<RecordRow>(
      (await req(hr, 'GET', `/training/records/${first.id}`)).body,
    );
    expect(predecessor.supersededById).toBe(successor.id);

    // `uq_training_record_current` exists to make this true.
    const current = data<RecordRow[]>(
      (
        await req(
          hr,
          'GET',
          `/training/records?employeeId=${FIXTURE.NO_PERMISSIONS.id}&courseId=${course.id}&currentOnly=true`,
        )
      ).body,
    );
    expect(current).toHaveLength(1);
    expect(current[0].id).toBe(successor.id);
  });

  it('refuses a completion dated behind the live record', async () => {
    const course = await createCourse();
    expect(
      (
        await req(hr, 'POST', '/training/records', {
          employeeId: FIXTURE.NO_PERMISSIONS.id,
          courseId: course.id,
          completedOn: '2026-06-01',
        })
      ).status,
    ).toBe(201);

    const backdated = await req(hr, 'POST', '/training/records', {
      employeeId: FIXTURE.NO_PERMISSIONS.id,
      courseId: course.id,
      completedOn: '2026-01-01',
    });
    // Otherwise the OLDER completion becomes current and the answer to "is this person trained?"
    // goes backwards.
    expect(backdated.status).toBe(412);
    expect(errorCode(backdated.body)).toBe('TRAINING_INVALID_COMPLETION');
  });
});

describe('verify and revoke', () => {
  it('attests once, then refuses to overwrite who attested', async () => {
    const course = await createCourse();
    const record = data<RecordRow>(
      (
        await req(hr, 'POST', '/training/records', {
          employeeId: FIXTURE.NO_PERMISSIONS.id,
          courseId: course.id,
          completedOn: '2026-02-02',
        })
      ).body,
    );

    const verified = await req(hr, 'POST', `/training/records/${record.id}/verify`);
    expect(verified.status).toBe(200);
    expect(data<RecordRow>(verified.body).verifiedBy).toBe(FIXTURE.HR.id);

    const again = await req(hr, 'POST', `/training/records/${record.id}/verify`);
    expect(again.status).toBe(409);
    expect(errorCode(again.body)).toBe('TRAINING_RECORD_NOT_VERIFIABLE');
  });

  it('requires a reason to revoke, and refuses a second revocation', async () => {
    const course = await createCourse();
    const record = data<RecordRow>(
      (
        await req(hr, 'POST', '/training/records', {
          employeeId: FIXTURE.NO_PERMISSIONS.id,
          courseId: course.id,
          completedOn: '2026-02-03',
        })
      ).body,
    );

    expect((await req(hr, 'POST', `/training/records/${record.id}/revoke`, {})).status).toBe(422);

    const revoked = await req(hr, 'POST', `/training/records/${record.id}/revoke`, {
      reason: 'certificate could not be verified with the provider',
    });
    expect(revoked.status).toBe(200);
    expect(data<RecordRow>(revoked.body).status).toBe('revoked');

    const twice = await req(hr, 'POST', `/training/records/${record.id}/revoke`, {
      reason: 'again',
    });
    expect(twice.status).toBe(412);
  });

  it('lets a revoked course be completed again — the slot is free', async () => {
    // The partial index excludes revoked rows on purpose: revoking evidence must not lock the
    // employee out of ever recording that course again.
    const course = await createCourse();
    const first = data<RecordRow>(
      (
        await req(hr, 'POST', '/training/records', {
          employeeId: FIXTURE.NO_PERMISSIONS.id,
          courseId: course.id,
          completedOn: '2026-02-04',
        })
      ).body,
    );
    expect(
      (await req(hr, 'POST', `/training/records/${first.id}/revoke`, { reason: 'wrong person' }))
        .status,
    ).toBe(200);

    const replacement = await req(hr, 'POST', '/training/records', {
      employeeId: FIXTURE.NO_PERMISSIONS.id,
      courseId: course.id,
      completedOn: '2026-02-05',
    });
    expect(replacement.status, JSON.stringify(replacement.body)).toBe(201);
  });
});

describe('the competency gap report', () => {
  it('reports never_completed, clears on completion, and reports expired by asOf', async () => {
    const mandatory = await createCourse({ validityMonths: 12 });
    const recommended = await createCourse({ validityMonths: null });
    const positionId = await positionWithEmployee('2051-01-01');

    expect(
      (
        await req(hr, 'POST', `/training/positions/${positionId}/requirements`, {
          courseId: mandatory.id,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await req(hr, 'POST', `/training/positions/${positionId}/requirements`, {
          courseId: recommended.id,
          kind: 'recommended',
        })
      ).status,
    ).toBe(201);

    const mine = () =>
      req(hr, 'GET', `/training/gaps?employeeId=${FIXTURE.NO_PERMISSIONS.id}`).then((r) =>
        data<GapRow[]>(r.body),
      );

    const before = await mine();
    expect(before.map((g) => g.courseCode)).toContain(mandatory.code);
    // Mandatory only by default — a recommendation is not a finding.
    expect(before.map((g) => g.courseCode)).not.toContain(recommended.code);
    expect(before.find((g) => g.courseCode === mandatory.code)?.reason).toBe('never_completed');

    const withRecommended = data<GapRow[]>(
      (
        await req(
          hr,
          'GET',
          `/training/gaps?employeeId=${FIXTURE.NO_PERMISSIONS.id}&includeRecommended=true`,
        )
      ).body,
    );
    expect(withRecommended.map((g) => g.courseCode)).toContain(recommended.code);

    expect(
      (
        await req(hr, 'POST', '/training/records', {
          employeeId: FIXTURE.NO_PERMISSIONS.id,
          courseId: mandatory.id,
          completedOn: '2026-03-01',
        })
      ).status,
    ).toBe(201);

    expect((await mine()).map((g) => g.courseCode)).not.toContain(mandatory.code);

    // Same record, later date: the certificate has lapsed, and the reason distinguishes that from
    // never having taken it because one needs scheduling and the other rescheduling.
    const later = data<GapRow[]>(
      (
        await req(
          hr,
          'GET',
          `/training/gaps?employeeId=${FIXTURE.NO_PERMISSIONS.id}&asOf=2027-06-01`,
        )
      ).body,
    );
    expect(later.find((g) => g.courseCode === mandatory.code)?.reason).toBe('expired');
  });

  it('follows the employee when they transfer', async () => {
    // The whole reason requirements hang off the position rather than the person.
    const course = await createCourse({ validityMonths: null });
    const oldPosition = await positionWithEmployee('2052-01-01');
    expect(
      (
        await req(hr, 'POST', `/training/positions/${oldPosition}/requirements`, {
          courseId: course.id,
        })
      ).status,
    ).toBe(201);

    const before = data<GapRow[]>(
      (await req(hr, 'GET', `/training/gaps?employeeId=${FIXTURE.NO_PERMISSIONS.id}`)).body,
    );
    expect(before.map((g) => g.courseCode)).toContain(course.code);

    // Transfer to a position with no requirements at all.
    await positionWithEmployee('2053-01-01');

    const after = data<GapRow[]>(
      (await req(hr, 'GET', `/training/gaps?employeeId=${FIXTURE.NO_PERMISSIONS.id}`)).body,
    );
    // No backfill ran; the report simply reads the CURRENT assignment.
    expect(after.map((g) => g.courseCode)).not.toContain(course.code);
  });

  it('lets an employee see their own gaps with no permission', async () => {
    const res = await req(employee, 'GET', '/training/me/gaps');
    expect(res.status).toBe(200);
  });
});

describe('authorization', () => {
  it('lets a training.read holder read but not manage', async () => {
    const course = await createCourse();

    expect((await req(auditor, 'GET', '/training/courses')).status).toBe(200);
    expect((await req(auditor, 'GET', `/training/courses/${course.id}`)).status).toBe(200);
    expect((await req(auditor, 'GET', '/training/gaps')).status).toBe(200);

    expect(
      (
        await req(auditor, 'POST', '/training/courses', {
          code: nextCode(),
          title: 'X',
          category: 'safety',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await req(auditor, 'POST', '/training/records', {
          employeeId: FIXTURE.NO_PERMISSIONS.id,
          courseId: course.id,
          completedOn: '2026-01-01',
        })
      ).status,
    ).toBe(403);
  });

  it('refuses the collection to a caller holding nothing, but not their own records', async () => {
    expect((await req(employee, 'GET', '/training/records')).status).toBe(403);
    expect((await req(employee, 'GET', '/training/courses')).status).toBe(403);

    const mine = await req(employee, 'GET', '/training/me');
    expect(mine.status).toBe(200);
    expect(
      data<RecordRow[]>(mine.body).every((r) => r.employeeId === FIXTURE.NO_PERMISSIONS.id),
    ).toBe(true);
  });
});

describe.runIf(HAS_S3)('certificates, against real S3', () => {
  const bytes = Buffer.from('%PDF-1.4 e2e certificate payload');
  const digest = createHash('sha256').update(bytes).digest('base64');

  /** A record owned by the plain employee, so the self-service path is the one under test. */
  async function ownRecord(): Promise<string> {
    const course = await createCourse({ validityMonths: null });
    const created = await req(hr, 'POST', '/training/records', {
      employeeId: FIXTURE.NO_PERMISSIONS.id,
      courseId: course.id,
      completedOn: '2026-04-01',
    });
    expect(created.status).toBe(201);
    return data<RecordRow>(created.body).id;
  }

  async function put(presign: PresignRow, body: Buffer): Promise<number> {
    const res = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: presign.requiredHeaders,
      body: new Uint8Array(body),
    });
    return res.status;
  }

  it('round-trips: presign as the owner, PUT, confirm, list, download, delete', async () => {
    const recordId = await ownRecord();

    // No permission code — an employee attaching evidence to their OWN record is self-service.
    const presigned = await req(
      employee,
      'POST',
      `/training/records/${recordId}/certificates/presign`,
      {
        fileName: 'certificate.pdf',
        mimeType: 'application/pdf',
        sizeBytes: bytes.length,
        checksumSha256: digest,
      },
    );
    expect(presigned.status, JSON.stringify(presigned.body)).toBe(201);
    const presign = data<PresignRow>(presigned.body);

    // The headers the signature covers, returned rather than guessed: sending fewer or more fails
    // the signature, and that failure carries no CORS headers.
    expect(presign.requiredHeaders['Content-Type']).toBe('application/pdf');
    expect(presign.requiredHeaders['Content-Disposition']).toContain('attachment');
    expect(await put(presign, bytes)).toBe(200);

    const confirmed = await req(
      employee,
      'POST',
      `/training/records/${recordId}/certificates/${presign.fileId}/confirm`,
    );
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);

    const listed = data<CertificateRow[]>(
      (await req(hr, 'GET', `/training/records/${recordId}/certificates`)).body,
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ fileName: 'certificate.pdf', sizeBytes: bytes.length });
    // The digest the client declared survived the round trip.
    expect(listed[0].checksumSha256).toBe(digest);

    const download = await req(
      hr,
      'GET',
      `/training/records/${recordId}/certificates/${presign.fileId}/download`,
    );
    expect(download.status).toBe(200);
    const url = data<{ url: string }>(download.body).url;
    // A real URL, not a stringified Promise — which is what this used to be.
    expect(url).toMatch(/^https?:\/\//);
    const fetched = await fetch(url);
    expect(fetched.status).toBe(200);
    // Stored metadata, so it applies however the object is fetched — including through a CDN, where
    // a presigned-GET response override would not.
    expect(fetched.headers.get('content-disposition')).toContain('attachment');

    const removed = await req(
      employee,
      'DELETE',
      `/training/records/${recordId}/certificates/${presign.fileId}`,
    );
    expect(removed.status).toBe(204);
    expect(
      data<CertificateRow[]>(
        (await req(hr, 'GET', `/training/records/${recordId}/certificates`)).body,
      ),
    ).toHaveLength(0);
  });

  it('refuses a size that does not match what was declared', async () => {
    const recordId = await ownRecord();
    const presigned = await req(
      employee,
      'POST',
      `/training/records/${recordId}/certificates/presign`,
      {
        fileName: 'short.pdf',
        mimeType: 'application/pdf',
        sizeBytes: bytes.length,
        checksumSha256: digest,
      },
    );
    const presign = data<PresignRow>(presigned.body);

    // The signature pins content-length, so a different body is rejected at the edge; if a backend
    // ever accepts it, confirm's HeadObject comparison is the second line.
    const putStatus = await put(presign, Buffer.from('too short'));
    if (putStatus === 200) {
      const confirmed = await req(
        employee,
        'POST',
        `/training/records/${recordId}/certificates/${presign.fileId}/confirm`,
      );
      expect(confirmed.status).toBe(422);
      expect(errorCode(confirmed.body)).toBe('FILE_SIZE_MISMATCH');
    } else {
      expect(putStatus).toBeGreaterThanOrEqual(400);
    }
  });

  it('refuses to confirm a file that was never uploaded', async () => {
    const recordId = await ownRecord();
    const presigned = await req(
      employee,
      'POST',
      `/training/records/${recordId}/certificates/presign`,
      {
        fileName: 'ghost.pdf',
        mimeType: 'application/pdf',
        sizeBytes: bytes.length,
      },
    );
    const presign = data<PresignRow>(presigned.body);

    const confirmed = await req(
      employee,
      'POST',
      `/training/records/${recordId}/certificates/${presign.fileId}/confirm`,
    );
    expect(confirmed.status).toBe(422);
    expect(errorCode(confirmed.body)).toBe('FILE_NOT_UPLOADED');
  });

  it('enforces the per-record quota at confirm time', async () => {
    const recordId = await ownRecord();
    const limit = 5; // `RESOURCE_RULES['training-certificate'].maxPerOwner`

    for (let i = 0; i < limit; i++) {
      const body = Buffer.concat([bytes, Buffer.from([i])]);
      const presigned = await req(
        employee,
        'POST',
        `/training/records/${recordId}/certificates/presign`,
        {
          fileName: `cert-${i}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: body.length,
          checksumSha256: createHash('sha256').update(body).digest('base64'),
        },
      );
      expect(presigned.status, `presign ${i}: ${JSON.stringify(presigned.body)}`).toBe(201);
      const presign = data<PresignRow>(presigned.body);
      expect(await put(presign, body)).toBe(200);
      const confirmed = await req(
        employee,
        'POST',
        `/training/records/${recordId}/certificates/${presign.fileId}/confirm`,
      );
      expect(confirmed.status, `confirm ${i}: ${JSON.stringify(confirmed.body)}`).toBe(200);
    }

    const overTheLine = await req(
      employee,
      'POST',
      `/training/records/${recordId}/certificates/presign`,
      { fileName: 'sixth.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length },
    );
    expect(overTheLine.status).toBe(412);
    expect(errorCode(overTheLine.body)).toBe('ATTACHMENT_LIMIT_EXCEEDED');
  });

  it('refuses SVG, and anything outside the policy', async () => {
    const recordId = await ownRecord();
    // SVG is active content: an "image" upload that renders inline is stored XSS the moment the
    // bytes come from an origin the app trusts.
    const svg = await req(employee, 'POST', `/training/records/${recordId}/certificates/presign`, {
      fileName: 'logo.svg',
      mimeType: 'image/svg+xml',
      sizeBytes: 100,
    });
    expect(svg.status).toBe(422);

    const huge = await req(employee, 'POST', `/training/records/${recordId}/certificates/presign`, {
      fileName: 'big.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 21 * 1024 * 1024,
    });
    expect(huge.status).toBe(422);
  });

  it("refuses to touch another employee's record without training.manage", async () => {
    const course = await createCourse({ validityMonths: null });
    const hrOwn = await req(hr, 'POST', '/training/records', {
      employeeId: FIXTURE.MANAGER.id,
      courseId: course.id,
      completedOn: '2026-04-02',
    });
    expect(hrOwn.status).toBe(201);
    const foreignId = data<RecordRow>(hrOwn.body).id;

    const presigned = await req(
      employee,
      'POST',
      `/training/records/${foreignId}/certificates/presign`,
      { fileName: 'not-mine.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
    );
    expect(presigned.status).toBe(403);

    // HR holds `training.manage`, so the same call is allowed — the 403 above is the rule, not a
    // broken route.
    const asHr = await req(hr, 'POST', `/training/records/${foreignId}/certificates/presign`, {
      fileName: 'mine-to-manage.pdf',
      mimeType: 'application/pdf',
      sizeBytes: bytes.length,
      checksumSha256: digest,
    });
    expect(asHr.status).toBe(201);
  });

  it('treats an unlinked file id as not found, whoever asks', async () => {
    const a = await ownRecord();
    const b = await ownRecord();

    const presigned = await req(employee, 'POST', `/training/records/${a}/certificates/presign`, {
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: bytes.length,
      checksumSha256: digest,
    });
    const presign = data<PresignRow>(presigned.body);
    expect(await put(presign, bytes)).toBe(200);
    expect(
      (await req(employee, 'POST', `/training/records/${a}/certificates/${presign.fileId}/confirm`))
        .status,
    ).toBe(200);

    // The file id is a capability only in combination with the record that owns it.
    const crossed = await req(
      hr,
      'GET',
      `/training/records/${b}/certificates/${presign.fileId}/download`,
    );
    expect(crossed.status).toBe(404);
    expect(errorCode(crossed.body)).toBe('ATTACHMENT_NOT_FOUND');
  });
});
