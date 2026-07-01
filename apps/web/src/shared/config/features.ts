/**
 * Feature gates — controlled by VITE_FEATURE_* env vars.
 * Default to false (disabled) so missing vars are safe.
 * Flip to true in .env when the required M365 license is active.
 */
export const FEATURES = {
  /** Requires Microsoft Secure Score → M365 E3/E5 or Defender for Business */
  SECURITY_POSTURE: import.meta.env.VITE_FEATURE_SECURITY_POSTURE === 'true',
  /** Requires Microsoft Intune / Endpoint Manager */
  SHADOW_IT: import.meta.env.VITE_FEATURE_SHADOW_IT === 'true',
  /** Requires Azure OpenAI endpoint + API key */
  AI_ASSISTANT: import.meta.env.VITE_FEATURE_AI_ASSISTANT === 'true',
} as const;
