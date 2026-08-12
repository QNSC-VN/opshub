import { api } from './client';
import type { PickerOption } from '@/shared/ui';

/**
 * Where an `EntityPicker`'s options come from, defined once per entity.
 *
 * Four forms need to name an employee and three need to name a course or a position. Written at each
 * call site, that is seven copies of "fetch, map to `{ value, label, hint }`, decide what the hint is" —
 * and the hint is a property of the ENTITY, not of the form: an employee is always best identified by
 * their department, a course by its code.
 *
 * SEARCHING IS SERVER-SIDE WHERE THE API SUPPORTS IT. `/v1/employees` and `/v1/positions` both take
 * `search` — positions only since this branch: the SPA had shipped a search box for that list while the
 * endpoint had no such parameter, so the term was dropped and the box filtered nothing.
 *
 * `/v1/training/courses` still has none, so that one term filters a fetched page. Marked below, because a
 * client-side filter over one page silently stops finding things at 100 rows and must not be mistaken for
 * the real thing.
 */

/** How many rows a picker asks for. The API's ceiling is 100. */
const PICKER_LIMIT = 100;

function matches(term: string, ...fields: (string | null | undefined)[]): boolean {
  if (!term) return true;
  const needle = term.toLowerCase();
  return fields.some((field) => field?.toLowerCase().includes(needle));
}

/** People, searched by the API. */
export async function employeeOptions(term: string): Promise<PickerOption[]> {
  const { data } = await api.GET('/v1/employees', {
    params: { query: { search: term || undefined, limit: PICKER_LIMIT, offset: 0 } },
  });
  return (data?.data ?? []).map((employee) => ({
    value: employee.id,
    label: employee.displayName,
    hint: employee.department ?? employee.email,
  }));
}

/** Only people who can still be assigned to things — a leaver is not a valid choice. */
export async function activeEmployeeOptions(term: string): Promise<PickerOption[]> {
  const { data } = await api.GET('/v1/employees', {
    params: {
      query: { search: term || undefined, status: 'active', limit: PICKER_LIMIT, offset: 0 },
    },
  });
  return (data?.data ?? []).map((employee) => ({
    value: employee.id,
    label: employee.displayName,
    hint: employee.department ?? employee.email,
  }));
}

/** Positions, searched by the API over title, code and department. */
export async function positionOptions(term: string): Promise<PickerOption[]> {
  const { data } = await api.GET('/v1/positions', {
    params: {
      query: { search: term || undefined, status: 'active', limit: PICKER_LIMIT, offset: 0 },
    },
  });
  return (data?.data ?? []).map((position) => ({
    value: position.id,
    label: position.title,
    hint: position.code,
  }));
}

/** Courses somebody can still be enrolled on. Filtered CLIENT-SIDE: no `search` on the endpoint. */
export async function courseOptions(term: string): Promise<PickerOption[]> {
  const { data } = await api.GET('/v1/training/courses', {
    params: { query: { includeRetired: false, limit: PICKER_LIMIT, offset: 0 } },
  });
  return (data?.data ?? [])
    .filter((course) => matches(term, course.title, course.code, course.category))
    .map((course) => ({
      value: course.id,
      label: course.title,
      hint: course.code,
    }));
}

/**
 * Controls, for linking one to a risk.
 *
 * Filtered CLIENT-SIDE: `/v1/controls` has no `search` either, and the Annex A catalogue is 93 controls
 * plus whatever an organisation adds — which fits one page today and is worth revisiting if a custom
 * catalogue grows past the limit. Retired controls are left out: a retired control cannot be the answer
 * to a live risk.
 */
export async function controlOptions(term: string): Promise<PickerOption[]> {
  const { data } = await api.GET('/v1/controls', {
    params: { query: { includeRetired: false, limit: PICKER_LIMIT, offset: 0 } },
  });
  return (data?.data ?? [])
    .filter((control) => matches(term, control.title, control.reference, control.theme))
    .map((control) => ({
      value: control.id,
      label: control.title,
      hint: control.reference,
    }));
}
