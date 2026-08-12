import { FormField, Select } from '@/shared/ui';
import { ACCEPTANCE_APPROVAL_THRESHOLD, MATRIX_FACTORS } from './risk.types';

/**
 * The 1–5 likelihood/impact pair every assessment is made of.
 *
 * SCORES ARE NEVER TYPED, here or anywhere. `inherent_score` and `residual_score` are GENERATED COLUMNS,
 * so every form sends two factors and reads the product back off the row — there is no arithmetic in the
 * API service to drift and none in the SPA either. The product IS shown while choosing, because seeing it
 * is the difference between picking two numbers and choosing a band.
 *
 * Two `<select>`s rather than number inputs: the matrix has exactly five values per axis, which is a
 * fixed vocabulary and therefore the case `Select` is for.
 */

/** The 1–5 pair every assessment is made of, offered as two selects rather than free numbers. */
export function MatrixFields({
  idPrefix,
  likelihood,
  impact,
  onLikelihood,
  onImpact,
  hint,
}: {
  idPrefix: string;
  likelihood: string;
  impact: string;
  onLikelihood: (value: string) => void;
  onImpact: (value: string) => void;
  hint?: string;
}) {
  const product = likelihood && impact ? Number(likelihood) * Number(impact) : null;
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1.5 text-xs font-medium text-fg-muted">
        Likelihood × impact {hint && <span className="text-fg-subtle">— {hint}</span>}
      </legend>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Likelihood" htmlFor={`${idPrefix}-likelihood`} required>
          <Select
            id={`${idPrefix}-likelihood`}
            required
            value={likelihood}
            onChange={(e) => onLikelihood(e.target.value)}
          >
            <option value="">—</option>
            {MATRIX_FACTORS.map((factor) => (
              <option key={factor} value={factor}>
                {factor}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Impact" htmlFor={`${idPrefix}-impact`} required>
          <Select
            id={`${idPrefix}-impact`}
            required
            value={impact}
            onChange={(e) => onImpact(e.target.value)}
          >
            <option value="">—</option>
            {MATRIX_FACTORS.map((factor) => (
              <option key={factor} value={factor}>
                {factor}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      {/* Shown, not sent: the score is the database's to compute. Seeing it while choosing is the
          difference between picking numbers and choosing a band. */}
      {product != null && (
        <p className="text-xs text-fg-subtle">
          Score {product}
          {product >= ACCEPTANCE_APPROVAL_THRESHOLD
            ? ' — high band: accepting this needs sign-off rather than a note.'
            : ''}
        </p>
      )}
    </fieldset>
  );
}
