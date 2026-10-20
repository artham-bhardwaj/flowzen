import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import type { ComponentStatus } from '../app/validation';

export const statusLabels: Record<ComponentStatus, string> = { functional: 'Functional', warning: 'Warning', dead: 'Dead' };
export const StatusIcon = ({ status, size = 14 }: { status: ComponentStatus; size?: number }) =>
  status === 'dead' ? <CircleX size={size} aria-hidden /> : status === 'warning' ? <TriangleAlert size={size} aria-hidden /> : <CircleCheck size={size} aria-hidden />;
