import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '@/shared/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-[color,background-color,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1 focus-visible:ring-offset-surface active:translate-y-px disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // theme-inverting solid: dark button in light mode, light button in dark mode
        default: 'bg-fg text-surface hover:opacity-90',
        primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
        outline:
          'border border-border bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg',
        ghost: 'text-fg-muted hover:bg-surface-hover hover:text-fg',
        danger: 'bg-red-600 text-white hover:bg-red-700 dark:hover:bg-red-500',
        // A ghost button ON THE SIDEBAR, which has its own token family because it is dark in light
        // mode. `ghost` uses `text-fg-muted` / `hover:bg-surface-hover` and reads as invisible there —
        // which is why the shell's five controls stayed as raw `<button>`s with bespoke classes, and
        // therefore stayed without a focus ring. The ring comes from the base, so it now applies here.
        sidebar: 'text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-fg-active',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3 text-xs',
        icon: 'h-9 w-9',
        'icon-sm': 'h-7 w-7',
        // A full-width row inside a menu or a popover — the logout item, "mark all as read". These were
        // raw buttons because no size fitted: `default` centres in a fixed height and they need to be a
        // list row that spans its container.
        row: 'w-full justify-start px-2 py-1.5',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /**
   * A ref to the underlying element.
   *
   * WHY IT IS DECLARED. React 19 passes `ref` as an ordinary prop, but the TYPE has to say so or a
   * caller gets "not assignable to IntrinsicAttributes & ButtonProps". Without it, any button that
   * needs its own node — a popover trigger measuring itself, an outside-click check comparing against
   * it, anything managing focus — could not use this component. That is why the notification bell was
   * still a raw `<button>`, and therefore still had no focus ring.
   */
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
