import type { PrincipleId } from './types';

/** General definitions. Component models explain how each principle applies to their own code. */
export const PRINCIPLES: Record<PrincipleId, { name: string; short: string; group: 'SOLID' | 'OOP' | 'Design' }> = {
  srp: { name: 'Single Responsibility Principle', short: 'SRP', group: 'SOLID' },
  ocp: { name: 'Open/Closed Principle', short: 'OCP', group: 'SOLID' },
  lsp: { name: 'Liskov Substitution Principle', short: 'LSP', group: 'SOLID' },
  isp: { name: 'Interface Segregation Principle', short: 'ISP', group: 'SOLID' },
  dip: { name: 'Dependency Inversion Principle', short: 'DIP', group: 'SOLID' },
  encapsulation: { name: 'Encapsulation', short: 'Encapsulation', group: 'OOP' },
  abstraction: { name: 'Abstraction', short: 'Abstraction', group: 'OOP' },
  polymorphism: { name: 'Polymorphism', short: 'Polymorphism', group: 'OOP' },
  composition: { name: 'Composition over inheritance', short: 'Composition', group: 'Design' },
  'separation-of-concerns': { name: 'Separation of concerns', short: 'SoC', group: 'Design' },
  'coupling-cohesion': { name: 'Low coupling, high cohesion', short: 'Coupling', group: 'Design' },
  'dependency-injection': { name: 'Dependency injection', short: 'DI', group: 'Design' },
};

export const PRINCIPLE_DEFINITIONS: Record<PrincipleId, string> = {
  srp: 'A class should have one reason to change: it owns one responsibility.',
  ocp: 'Code should be open for extension but closed for modification: new behavior is added by new code, not by editing working code.',
  lsp: 'Any implementation of an abstraction must be usable wherever the abstraction is expected, without surprising its callers.',
  isp: 'Clients should not depend on methods they do not use; prefer small, role-specific interfaces.',
  dip: 'High-level policy depends on abstractions, not on low-level details; details implement those abstractions.',
  encapsulation: 'An object hides its state and enforces its invariants; others change it only through its methods.',
  abstraction: 'Expose what something does and hide how it does it.',
  polymorphism: 'One call site works with many implementations, chosen at runtime.',
  composition: 'Build behavior by combining objects instead of extending classes.',
  'separation-of-concerns': 'Different kinds of concern (transport, business rules, persistence) live in different parts of the code.',
  'coupling-cohesion': 'Parts know as little about each other as possible, and each part keeps closely related things together.',
  'dependency-injection': 'An object receives its collaborators from outside instead of constructing them itself.',
};
