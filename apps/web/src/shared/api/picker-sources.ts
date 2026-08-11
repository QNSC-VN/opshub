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
 * SEARCHING IS SERVER-SIDE ONLY WHERE THE API SUPPORTS IT. `GET /v1/employees` takes `search`;
 * `/v1/positions` and `/v1/training/courses` do not. For those two the term filters a fetched page,
 * which is honest for lists of their size (an organisation has tens of positions, not thousands) and is
 * marked below so nobody mistakes it for a server-side search that silently stops working at 100 rows.
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

/** Positions. Filtered CLIENT-SIDE: the list endpoint has no `search`. */
export async function positionOptions(term: string): Promise<PickerOption[]> {
  const { data } = await api.GET('/v1/positions', {
    params: { query: { status: 'active', limit: PICKER_LIMIT, offset: 0 } },
  });
  return (data?.data ?? [])
    .filter((position) => matches(term, position.title, position.code, position.department))
    .map((position) => ({
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
