import type { components } from '@/shared/api/generated/api';

/**
 * The QMS vocabulary — non-conformances and the CAPAs that answer them — from the generated spec.
 *
 * One module for both because they are one loop: a finding whose grade demands it cannot close until a
 * CAPA is VERIFIED EFFECTIVE, so neither register is readable without the other.
 */

export type Nonconformance = components['schemas']['NonconformanceRowResponseDto'];
export type Severity = components['schemas']['NonconformanceSeverityResponseDto'];
export type Capa = components['schemas']['CapaResponseDto'];
export type ContainmentOverdue = components['schemas']['ContainmentOverdueResponseDto'];
export type RecurrenceSignal = components['schemas']['RecurrenceSignalResponseDto'];

/**
 * The finding lifecycle: open → contained → closed, with `void` off to one side.
 *
 * `open → closed` IS NOT LEGAL, in the service and in `ck_nc_contained_states`. ISO 9001 §10.2(a)
 * requires reacting to the nonconformity, so a finding that jumps from "found" to "closed" with nothing
 * recorded between is the box-ticking the clause exists to prevent. This list is for filtering and
 * labels; the screen never decides whether a move is allowed.
 */
export const NC_STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'contained', label: 'Contained' },
  { value: 'closed', label: 'Closed' },
  { value: 'void', label: 'Void' },
] as const;

/** Which action each finding state allows, mirroring the API's own transition map. */
export const NC_NEXT_ACTIONS: Record<string, readonly ('contain' | 'close' | 'void')[]> = {
  open: ['contain', 'void'],
  contained: ['close', 'void'],
  closed: [],
  void: [],
};

export const NC_SEVERITIES = ['observation', 'minor', 'major', 'critical'] as const;

export const NC_SOURCES = [
  'internal_audit',
  'external_audit',
  'customer_complaint',
  'process_monitoring',
  'employee_report',
  'supplier',
  'incident',
  'other',
] as const;

/**
 * The CAPA lifecycle, and the loop that makes it a CAPA rather than a task.
 *
 * analysis → planned → in_progress → implemented → verified, with `ineffective` sending it BACK to
 * analysis. That backwards edge is the point of the whole module: an action that did not work is not
 * finished, and ISO 9001 §10.2(1)(d) asks for exactly that review of effectiveness.
 */
export const CAPA_STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'analysis', label: 'Analysis' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'implemented', label: 'Implemented' },
  { value: 'verified', label: 'Verified' },
  { value: 'ineffective', label: 'Ineffective' },
] as const;

/**
 * Which CAPA action each state allows. `verified` and `cancelled` are terminal.
 *
 * `analysis` and `reopen` are deliberately separate. The cause is RECORDED while the CAPA is in
 * `analysis`; an `ineffective` one has to be RETURNED there first, which is a different call taking no body
 * because the reason was already given when it was marked ineffective. Collapsing the two would offer a
 * form the service refuses outright.
 */
export const CAPA_NEXT_ACTIONS: Record<
  string,
  readonly (
    'analysis' | 'plan' | 'start' | 'implemented' | 'verify' | 'ineffective' | 'reopen' | 'cancel'
  )[]
> = {
  analysis: ['analysis', 'plan', 'cancel'],
  planned: ['start', 'cancel'],
  in_progress: ['implemented', 'cancel'],
  implemented: ['verify', 'ineffective', 'cancel'],
  ineffective: ['reopen', 'cancel'],
  verified: [],
  cancelled: [],
};

/** The root-cause methods the API accepts. A named method is what separates analysis from a guess. */
export const ROOT_CAUSE_METHODS = [
  'five_whys',
  'fishbone',
  'fault_tree',
  'pareto',
  'other',
] as const;

/**
 * No local severity→tone map here on purpose.
 *
 * `observation | minor | major | critical` are all already in the shared `SEVERITY_TONE`, so `statusTone()`
 * grades them — and grades them the same way the incident and risk registers do. A private copy in this file
 * is how `major` ends up amber on one screen and red on another.
 */
