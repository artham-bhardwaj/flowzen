import { createContext, useContext } from 'react';
import type { Fix, Validation } from './validation';

export type ValidationContextValue = { validation: Validation; showIssues: boolean; applyFix: (fix: Fix) => void; selectNode: (id: string) => void };
export const ValidationContext = createContext<ValidationContextValue | null>(null);
export function useValidation() { const value = useContext(ValidationContext); if (!value) throw new Error('ValidationContext missing'); return value; }
