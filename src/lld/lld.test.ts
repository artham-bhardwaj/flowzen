import { describe, expect, it } from 'vitest';
import { byKind, catalog, type Kind } from '../app/catalog';
import { LLD_MODELS, lldModelFor } from './index';
import { stripJava, tokenizeJava } from './java';
import { layoutDiagram } from './diagram';
import { LLD_COVERAGE } from './coverage';
import { PRINCIPLES, PRINCIPLE_DEFINITIONS } from './principles';
import type { LldModel } from './types';

const CORE: Kind[] = ['loadBalancer', 'gateway', 'server', 'cache', 'database', 'queue', 'worker'];
const DECLARATION = /^(?:public\s+)?(?:(?:final|abstract|sealed|static)\s+)*(class|interface|enum|record)\s+([A-Z]\w*)/gm;
/** JDK types the examples use; if a file uses one, it must import it. */
const JDK_TYPES = ['List', 'Map', 'Set', 'Optional', 'Objects', 'Comparator', 'Duration', 'Instant', 'UUID', 'Deque', 'ArrayDeque', 'LinkedHashMap', 'HashMap', 'ArrayList',
  'AtomicLong', 'AtomicInteger', 'AtomicReference', 'ConcurrentHashMap', 'CompletableFuture', 'TimeUnit', 'Executors', 'ExecutorService', 'ScheduledExecutorService',
  'BlockingQueue', 'ArrayBlockingQueue', 'SynchronousQueue', 'LinkedBlockingQueue', 'ThreadPoolExecutor', 'RejectedExecutionException', 'ReentrantLock', 'Lock',
  'Supplier', 'Function', 'LongSupplier', 'Consumer', 'Predicate', 'StandardCharsets', 'DataSource', 'Connection', 'PreparedStatement', 'ResultSet', 'SQLException', 'Clock'];

const codeOf = (model: LldModel, fileName: string) => stripJava(model.files.find(entry => entry.name === fileName)?.code ?? '');
const classById = (model: LldModel, id: string) => model.classes.find(entry => entry.id === id)!;
const balanced = (code: string) => {
  let depth = 0;
  for (const char of stripJava(code)) { if (char === '{' || char === '(') depth += 1; if (char === '}' || char === ')') depth -= 1; if (depth < 0) return false; }
  return depth === 0;
};
const declared = (code: string) => [...stripJava(code).matchAll(DECLARATION)].map(match => ({ kind: match[1], name: match[2], abstract: /abstract\s/.test(match[0]) }));

describe('LLD model coverage', () => {
  it('covers every core component and the reliability components', () => {
    for (const kind of [...CORE, 'rateLimiter', 'circuitBreaker'] as Kind[]) expect(lldModelFor(kind), kind).toBeDefined();
  });
  it('maps each kind to at most one model, and only to real catalog kinds', () => {
    const kinds = LLD_MODELS.flatMap(model => model.kinds);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const kind of kinds) expect(byKind[kind], kind).toBeDefined();
  });
  it('leaves other kinds explicitly uncovered rather than guessing from the name', () => {
    expect(lldModelFor('metricsCollector')).toBeUndefined();
    expect(catalog.filter(entry => !lldModelFor(entry.kind)).length).toBeGreaterThan(0);
  });
  it('keeps the lightweight coverage index in sync with the models', () => {
    const expected = Object.fromEntries(LLD_MODELS.flatMap(model => model.kinds.map(kind => [kind, { title: model.title, types: model.classes.length }])));
    expect(LLD_COVERAGE).toEqual(expected);
  });
  it('has a definition for every principle', () => {
    for (const id of Object.keys(PRINCIPLES)) expect(PRINCIPLE_DEFINITIONS[id as keyof typeof PRINCIPLES]).toBeTruthy();
  });
});

describe.each(LLD_MODELS.map(model => [model.title, model] as const))('LLD model: %s', (_title, model) => {
  it('has a complete overview, design decisions and a simulator note', () => {
    const { overview } = model;
    expect(overview.responsibility.length).toBeGreaterThan(20);
    for (const list of [overview.inputs, overview.outputs, overview.collaborators, overview.state]) expect(list.length).toBeGreaterThan(0);
    expect(model.decisions.length).toBeGreaterThan(0);
    for (const decision of model.decisions) expect(decision.alternatives.length).toBeGreaterThan(0);
    expect(model.simulation).toMatch(/simulat/i);
    expect(model.canvasRole.upstream.length).toBeGreaterThan(20); expect(model.canvasRole.downstream.length).toBeGreaterThan(20);
  });

  it('declares every modeled class in its file with the right kind, and models every declared type', () => {
    const ids = new Set<string>(); const names = new Set<string>();
    for (const entry of model.classes) {
      expect(ids.has(entry.id), `duplicate id ${entry.id}`).toBe(false); ids.add(entry.id); names.add(entry.name);
      const file = model.files.find(candidate => candidate.name === entry.file);
      expect(file, `${entry.name} → ${entry.file}`).toBeDefined();
      const found = declared(file!.code).find(declaration => declaration.name === entry.name);
      expect(found, `${entry.name} declared in ${entry.file}`).toBeDefined();
      const expectedKind = entry.kind === 'abstract' ? 'class' : entry.kind;
      expect(found!.kind, entry.name).toBe(expectedKind);
      expect(found!.abstract, `${entry.name} abstract`).toBe(entry.kind === 'abstract');
      expect(entry.responsibility.length).toBeGreaterThan(10);
    }
    for (const file of model.files) {
      for (const declaration of declared(file.code)) expect(names.has(declaration.name), `${declaration.name} in ${file.name} is modeled`).toBe(true);
      expect(file.code.startsWith(`package ${model.packageName};`), `${file.name} package`).toBe(true);
      expect(balanced(file.code), `${file.name} balanced`).toBe(true);
    }
  });

  it('only lists members that exist in the class’s code', () => {
    for (const entry of model.classes) {
      const code = codeOf(model, entry.file);
      for (const member of entry.members) {
        const name = /^[+\-#~]\s*(\w+)/.exec(member)?.[1];
        expect(name, `member format: ${member}`).toBeTruthy();
        expect(new RegExp(`\\b${name}\\b`).test(code), `${entry.name}.${name} in ${entry.file}`).toBe(true);
      }
    }
  });

  it('keeps the class diagram consistent with the code', () => {
    for (const relation of model.relations) {
      const from = model.classes.find(entry => entry.id === relation.from); const to = model.classes.find(entry => entry.id === relation.to);
      expect(from && to, `${relation.from} → ${relation.to}`).toBeTruthy();
      const code = codeOf(model, from!.file);
      if (relation.type === 'implements') expect(new RegExp(`(class|record|enum)\\s+${from!.name}\\b[^{]*\\bimplements\\b[^{]*\\b${to!.name}\\b`).test(code), `${from!.name} implements ${to!.name}`).toBe(true);
      else if (relation.type === 'extends') expect(new RegExp(`(class|interface)\\s+${from!.name}\\b[^{]*\\bextends\\b[^{]*\\b${to!.name}\\b`).test(code), `${from!.name} extends ${to!.name}`).toBe(true);
      else expect(new RegExp(`\\b${to!.name}\\b`).test(code), `${from!.name} references ${to!.name}`).toBe(true);
    }
    // Every inheritance in the code between modeled types is drawn.
    const names = new Map(model.classes.map(entry => [entry.name, entry.id]));
    for (const entry of model.classes) {
      const code = codeOf(model, entry.file);
      const header = new RegExp(`(?:class|interface|record|enum)\\s+${entry.name}\\b([^{]*)\\{`).exec(code)?.[1] ?? '';
      for (const [, keyword, list] of header.matchAll(/\b(implements|extends)\s+([^{]*?)(?=\bimplements\b|\bpermits\b|$)/g)) {
        for (const parent of list.split(',').map(part => part.replace(/<.*$/s, '').trim()).filter(Boolean)) {
          const parentId = names.get(parent); if (!parentId) continue;
          expect(model.relations.some(relation => relation.from === entry.id && relation.to === parentId && relation.type === keyword), `${entry.name} ${keyword} ${parent} is drawn`).toBe(true);
        }
      }
    }
  });

  it('imports the JDK types each file uses', () => {
    const own = new Set(model.classes.map(entry => entry.name));
    for (const file of model.files) {
      const code = stripJava(file.code);
      for (const type of JDK_TYPES) {
        if (own.has(type) || !new RegExp(`\\b${type}\\b`).test(code.replace(/^import .*$/gm, ''))) continue;
        expect(new RegExp(`^import [\\w.]+\\.${type};`, 'm').test(file.code), `${file.name} imports ${type}`).toBe(true);
      }
    }
  });

  it('explains each claimed principle with evidence from its own classes', () => {
    const claimed = model.principles.map(claim => claim.principle);
    expect(new Set(claimed).size, 'no principle claimed twice').toBe(claimed.length);
    expect(claimed.length).toBeGreaterThanOrEqual(2);
    expect(claimed.length, 'principles are selective, not exhaustive').toBeLessThan(Object.keys(PRINCIPLES).length);
    for (const claim of model.principles) {
      for (const field of ['meaning', 'evidence', 'benefit', 'violation', 'tradeoff'] as const) expect(claim[field].length, `${claim.principle}.${field}`).toBeGreaterThan(20);
      expect(claim.classes.length).toBeGreaterThan(0);
      for (const id of claim.classes) expect(model.classes.some(entry => entry.id === id), `${claim.principle} → ${id}`).toBe(true);
      // The evidence names at least one of the classes it cites, and each cited class's code exists.
      expect(claim.classes.some(id => claim.evidence.includes(classById(model, id).name)), `${claim.principle} evidence names a class`).toBe(true);
    }
  });

  it('keeps design choices, bindings and the refactoring example consistent', () => {
    const fields = new Set(model.kinds.flatMap(kind => byKind[kind].fields.map(field => field.key)));
    for (const choice of model.choices) {
      expect(choice.options.some(option => option.id === choice.defaultOption)).toBe(true);
      if (choice.configKey) expect(fields.has(choice.configKey), `${choice.id} config key`).toBe(true);
      for (const optionId of Object.values(choice.matchConfig ?? {})) expect(choice.options.some(option => option.id === optionId)).toBe(true);
      for (const option of choice.options) { expect(option.code.trim().length).toBeGreaterThan(0); expect(balanced(option.code), `${choice.id}/${option.id} balanced`).toBe(true); }
      // The default option shows the code that the model actually contains.
      const current = choice.options.find(option => option.id === choice.defaultOption)!;
      const firstType = /(class|interface|record|enum)\s+([A-Z]\w*)/.exec(current.code)?.[2];
      if (firstType) expect(model.classes.some(entry => entry.name === firstType), `${choice.id} default shows a modeled type`).toBe(true);
    }
    for (const binding of model.bindings) {
      expect(fields.has(binding.key), `binding ${binding.key}`).toBe(true);
      expect(model.classes.some(entry => entry.id === binding.classId)).toBe(true);
    }
    if (model.refactoring) {
      expect(model.principles.some(claim => claim.principle === model.refactoring!.principle), 'refactoring principle is one the model claims').toBe(true);
      expect(balanced(model.refactoring.before) && balanced(model.refactoring.after)).toBe(true);
    }
  });
});

describe('Java tokenizer', () => {
  it('reproduces the source exactly', () => {
    for (const model of LLD_MODELS) for (const file of model.files) expect(tokenizeJava(file.code).map(token => token.text).join('')).toBe(file.code);
  });
  it('classifies keywords, types, strings, comments, annotations and numbers', () => {
    const tokens = tokenizeJava('@Override public int size() { // count\n return "a{b}".length() + 42; }');
    const kinds = (kind: string) => tokens.filter(token => token.kind === kind).map(token => token.text);
    expect(kinds('annotation')).toEqual(['@Override']);
    expect(kinds('keyword')).toEqual(['public', 'int', 'return']);
    expect(kinds('comment')).toEqual(['// count']);
    expect(kinds('string')).toEqual(['"a{b}"']);
    expect(kinds('number')).toEqual(['42']);
    expect(tokenizeJava('List<Backend> x').filter(token => token.kind === 'type').map(token => token.text)).toEqual(['List', 'Backend']);
  });
});

describe('class diagram layout', () => {
  it.each(LLD_MODELS.map(model => [model.title, model] as const))('%s: places every visible class once, without overlaps, and draws only visible relations', (_title, model) => {
    for (const showSupport of [false, true]) {
      const layout = layoutDiagram(model, { showSupport });
      const visible = model.classes.filter(entry => showSupport || !entry.support);
      expect(layout.boxes.map(box => box.id).sort()).toEqual(visible.map(entry => entry.id).sort());
      for (const a of layout.boxes) {
        expect(a.x).toBeGreaterThanOrEqual(0); expect(a.x + a.w).toBeLessThanOrEqual(layout.width);
        for (const b of layout.boxes) if (a !== b) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} overlaps ${b.id}`).toBe(true);
      }
      const ids = new Set(visible.map(entry => entry.id));
      expect(layout.edges.length).toBe(model.relations.filter(relation => ids.has(relation.from) && ids.has(relation.to)).length);
      // Narrow enough for the inspector at its natural size.
      expect(layout.width).toBeLessThanOrEqual(540);
    }
  });
});
