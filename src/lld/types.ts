import type { Kind } from '../app/catalog';

/**
 * Structured low-level design model for a component kind.
 *
 * The Java code is illustrative: it shows one reasonable implementation of the component's
 * architectural responsibility. It is never executed and does not drive Flowzen's simulator.
 * Classes, relations, code and principle claims all live in one model so tests can check that they agree.
 */
export type PrincipleId =
  | 'srp' | 'ocp' | 'lsp' | 'isp' | 'dip'
  | 'encapsulation' | 'abstraction' | 'polymorphism' | 'composition'
  | 'separation-of-concerns' | 'coupling-cohesion' | 'dependency-injection';

export type ClassKind = 'interface' | 'abstract' | 'class' | 'enum' | 'record';

export type LldClass = {
  id: string; name: string; kind: ClassKind;
  /** File in `files` that declares this type. */
  file: string;
  responsibility: string;
  /** UML-style member summaries; each name must appear in the class's code. */
  members: string[];
  /** Row in the class diagram (0 = top). */
  layer: number;
  /** Small value types (requests, records) are hidden from the diagram unless the user asks for them. */
  support?: boolean;
};

/**
 * `implements` / `extends`: the source type declares it. `uses`: the source calls or holds the target
 * through a field or parameter. `composes`: the source owns and creates the target's instance.
 * `creates`: the source instantiates the target (e.g. a value it returns).
 */
export type RelationType = 'implements' | 'extends' | 'uses' | 'composes' | 'creates';
export type LldRelation = { from: string; to: string; type: RelationType; label?: string };

export type CodeFile = { name: string; code: string };

/** One principle the code demonstrates, explained in terms of this implementation. */
export type PrincipleClaim = {
  principle: PrincipleId;
  /** 1. What it means in this implementation. */
  meaning: string;
  /** 2. Which classes demonstrate it (ids), with the specific method, field or relationship. */
  classes: string[]; evidence: string;
  /** 3. Why the design benefits. */
  benefit: string;
  /** 4. What a violation would look like. */
  violation: string;
  /** 5. The trade-off or limitation this introduces. */
  tradeoff: string;
};

export type DesignDecision = { title: string; decision: string; why: string; alternatives: Array<{ name: string; when: string }> };

/** A design choice the learner can switch to see how the implementation would change. */
export type DesignChoice = {
  id: string; title: string; question: string; defaultOption: string;
  /** Descriptive config field whose value selects the matching option, when the canvas has one. */
  configKey?: string; matchConfig?: Record<string, string>;
  options: Array<{
    id: string; label: string; summary: string;
    /** Classes added, replaced or edited by this option (ids from the model, or new type names). */
    changes: string[];
    /** What happens to the rest of the design. */
    effect: string;
    code: string;
  }>;
};

/** A before/after example of a principle violation and its refactoring. */
export type Refactoring = { title: string; principle: PrincipleId; problem: string; before: string; after: string; explanation: string };

/** Where a component's configuration on the canvas would appear in this implementation. */
export type ConfigBinding = { key: string; classId: string; target: string; note: string };

export type LldModel = {
  id: string; title: string; kinds: Kind[];
  /** Package all the files use. */
  packageName: string;
  overview: {
    responsibility: string; inputs: string[]; outputs: string[];
    collaborators: string[]; state: string[]; behavior: string[];
  };
  /** How the component's connections on the canvas map onto collaborators in the code. */
  canvasRole: { upstream: string; downstream: string };
  classes: LldClass[]; relations: LldRelation[]; files: CodeFile[];
  principles: PrincipleClaim[]; decisions: DesignDecision[]; choices: DesignChoice[];
  refactoring?: Refactoring; bindings: ConfigBinding[];
  /** What Flowzen's simulator actually models for this component, versus the illustrative code. */
  simulation: string;
};
