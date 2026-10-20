import type { CodeFile } from '../types';

/** Declares a code file; strips the leading newline left by the template literal. */
export const file = (name: string, code: string): CodeFile => ({ name, code: code.replace(/^\n/, '') });
