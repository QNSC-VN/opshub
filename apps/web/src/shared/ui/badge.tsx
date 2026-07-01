import type { HTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";

/** Token-backed tones — flip automatically in dark mode via globals.css. */
const tones = {
  neutral: "bg-neutral-bg text-neutral-fg",
  green:   "bg-success-bg text-success",
  amber:   "bg-warning-bg text-warning",
  red:     "bg-danger-bg text-danger",
  blue:    "bg-info-bg text-info",
  violet:  "bg-violet-bg text-violet-fg",
} as const;

export type BadgeTone = keyof typeof tones;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
