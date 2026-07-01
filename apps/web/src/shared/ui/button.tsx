import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-[color,background-color,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1 focus-visible:ring-offset-surface active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // theme-inverting solid: dark button in light mode, light button in dark mode
        default:  "bg-fg text-surface hover:opacity-90",
        primary:  "bg-accent text-accent-fg hover:bg-accent-hover",
        outline:  "border border-border bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg",
        ghost:    "text-fg-muted hover:bg-surface-hover hover:text-fg",
        danger:   "bg-red-600 text-white hover:bg-red-700 dark:hover:bg-red-500",
      },
      size: {
        default: "h-9 px-4",
        sm:      "h-8 px-3 text-xs",
        icon:    "h-9 w-9",
        "icon-sm": "h-7 w-7",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
