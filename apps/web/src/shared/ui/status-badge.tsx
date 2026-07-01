/**
 * StatusBadge — color + icon + text, never color alone (WCAG 2.2, doc §6/§9).
 *
 * The icon defaults from the tone so callers get a non-color signal for free;
 * pass `icon` to override or `icon={null}` to opt out.
 */
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Clock,
  Circle,
  type LucideIcon,
} from 'lucide-react';
import { Badge, type BadgeTone } from './badge';

const TONE_ICON: Record<BadgeTone, LucideIcon> = {
  green: CheckCircle2,
  amber: AlertTriangle,
  red: XCircle,
  blue: Info,
  violet: Clock,
  neutral: Circle,
};

export interface StatusBadgeProps {
  tone?: BadgeTone;
  /** Override the default icon, or pass null to hide it. */
  icon?: LucideIcon | null;
  children: React.ReactNode;
  className?: string;
}

export function StatusBadge({ tone = 'neutral', icon, children, className }: StatusBadgeProps) {
  const Icon = icon === null ? null : (icon ?? TONE_ICON[tone]);
  return (
    <Badge tone={tone} className={className}>
      {Icon && <Icon className="h-3 w-3 shrink-0" strokeWidth={2.25} />}
      {children}
    </Badge>
  );
}
