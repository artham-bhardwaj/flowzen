import { analyzeSweep, compareRuns, type LabRun, type Sweep } from './lab';

/**
 * Guided experiments. Each lesson states a hypothesis, how to test it, and what to look for. Its conclusion is
 * computed from the user's own runs, so any architecture that exercises the concept works. If the runs cannot
 * answer the question, the outcome says what is missing instead of guessing.
 */
export type LessonContext = { baseline: LabRun | null; experiment: LabRun | null; sweep: Sweep | null };
export type LessonOutcome = {
  status: 'needs-data' | 'supports' | 'does-not-support' | 'inconclusive';
  summary: string; evidence: string[];
  /** Present when the conclusion is about cause but several inputs changed. */
  caveat?: string;
};
export type Lesson = { id: string; title: string; hypothesis: string; experiment: string[]; observe: string[]; evaluate: (context: LessonContext) => LessonOutcome };

const pct = (value: number) => `${Math.round(value * 1000) / 10}%`;
const num = (value: number) => (Math.round(value * 10) / 10).toLocaleString();
const needs = (summary: string): LessonOutcome => ({ status: 'needs-data', summary, evidence: [] });
const STORAGE_KINDS = new Set(['database', 'nosql', 'readReplica', 'objectStorage', 'searchEngine']);

/** Baseline and experiment that can be compared like for like, or the outcome explaining why not. */
function pair(context: LessonContext): { a: LabRun; b: LabRun; caveat?: string } | LessonOutcome {
  const { baseline: a, experiment: b } = context;
  if (!a || !b) return needs('Set a baseline and run an experiment first.');
  if (!a.measurements.complete || !b.measurements.complete) return { status: 'inconclusive', summary: 'A run hit the event limit, so it is incomplete. Lower the traffic or shorten the window.', evidence: [] };
  const comparison = compareRuns(a, b);
  if (!comparison.comparable) return { status: 'inconclusive', summary: `The baseline and experiment used different benchmarks (${comparison.benchmarkDifferences.join(', ')}). Use the baseline’s benchmark for the experiment.`, evidence: [] };
  return { a, b, caveat: comparison.attribution.kind === 'multiple-changes' ? `${comparison.simulationChanges.length} simulation inputs changed between the runs, so this shows what happened, not which change caused it.` : undefined };
}
const isOutcome = (value: unknown): value is LessonOutcome => typeof value === 'object' && value !== null && 'status' in value;

export const LESSONS: Lesson[] = [
  {
    id: 'servers-vs-database',
    title: 'More servers do not fix a database bottleneck',
    hypothesis: 'If the database is the busiest component, adding application capacity barely changes successful throughput.',
    experiment: ['Set a baseline where requests reach a database, at a traffic level where the database is close to fully busy.', 'Duplicate the baseline and add application replicas or instances. Change nothing else.', 'Run the experiment with the baseline’s benchmark.'],
    observe: ['Database utilization in the baseline', 'Compute slots before and after', 'Successful throughput before and after'],
    evaluate(context) {
      const result = pair(context); if (isOutcome(result)) return result;
      const { a, b, caveat } = result;
      if (b.measurements.computeSlots <= a.measurements.computeSlots) return needs(`The experiment has ${b.measurements.computeSlots} compute slots and the baseline has ${a.measurements.computeSlots}. Add application capacity in the experiment.`);
      const db = a.measurements.components.find(component => STORAGE_KINDS.has(component.kind));
      if (!db) return needs('The baseline has no database for requests to reach.');
      const throughputA = a.measurements.successThroughput; const throughputB = b.measurements.successThroughput;
      const gain = throughputA > 0 ? (throughputB - throughputA) / throughputA : throughputB > 0 ? 1 : 0;
      const dbAfter = b.measurements.components.find(component => component.id === db.id);
      const evidence = [`compute slots ${a.measurements.computeSlots} → ${b.measurements.computeSlots}`, `successful throughput ${num(throughputA)} → ${num(throughputB)} req/s (${gain >= 0 ? '+' : ''}${pct(gain)})`,
        `${db.label}: ${pct(db.utilization)} busy in the baseline${dbAfter ? `, ${pct(dbAfter.utilization)} in the experiment` : ''}`];
      if (db.utilization < 0.85) return { status: 'inconclusive', summary: `${db.label} was only ${pct(db.utilization)} busy in the baseline, so it was not the bottleneck. Raise the baseline’s traffic until it is close to fully busy, then repeat.`, evidence, caveat };
      return gain < 0.05
        ? { status: 'supports', summary: `Adding compute changed successful throughput by only ${pct(gain)}, because ${db.label} was already ${pct(db.utilization)} busy and stayed the limit.`, evidence, caveat }
        : { status: 'does-not-support', summary: `Throughput rose ${pct(gain)}, so in this design the extra compute did help, even with ${db.label} at ${pct(db.utilization)}. Compute was limiting too. Push traffic higher to see where the database caps it.`, evidence, caveat };
    },
  },
  {
    id: 'caching',
    title: 'Caching reduces database traffic and latency',
    hypothesis: 'A cache placed in the request path in front of the database lowers the share of requests that reach the database, which lowers its utilization and the latency of database-bound requests.',
    experiment: ['Set a baseline without a cache in front of the database.', 'In the experiment, insert a Cache (or Distributed Cache or CDN) between the application and the database.', 'Run the experiment with the baseline’s benchmark.'],
    observe: ['Cache lookups and hits', 'Requests reaching the database, before and after', 'Database utilization and p95 latency'],
    evaluate(context) {
      const result = pair(context); if (isOutcome(result)) return result;
      const { a, b, caveat } = result;
      if (a.measurements.cache.some(cache => cache.lookups > 0)) return needs('The baseline already routes requests through a cache. Use a baseline without one.');
      const cache = b.measurements.cache.find(entry => entry.lookups > 0);
      if (!cache) return { status: 'needs-data', summary: b.measurements.cache.length ? 'The experiment has a cache, but no request passed through it. Connect it between the application and the database.' : 'Add a cache to the experiment.', evidence: [] };
      const db = a.measurements.components.find(component => STORAGE_KINDS.has(component.kind));
      if (!db) return needs('The baseline has no database for requests to reach.');
      const after = b.measurements.components.find(component => component.id === db.id);
      if (!after) return needs(`${db.label} is not in the experiment.`);
      const shareA = db.requestsProcessed / Math.max(1, a.measurements.simulatedRequests); const shareB = after.requestsProcessed / Math.max(1, b.measurements.simulatedRequests);
      const evidence = [`${cache.label}: ${cache.lookups.toLocaleString()} lookups, ${pct(cache.hits / cache.lookups)} hits`, `requests reaching ${db.label}: ${pct(shareA)} → ${pct(shareB)} of all requests`, `${db.label} utilization ${pct(db.utilization)} → ${pct(after.utilization)}`, `p95 ${a.measurements.p95 ?? '—'} → ${b.measurements.p95 ?? '—'} ms`];
      return shareB < shareA
        ? { status: 'supports', summary: `The cache served ${pct(cache.hits / cache.lookups)} of lookups, so the share of requests reaching ${db.label} fell from ${pct(shareA)} to ${pct(shareB)}.`, evidence, caveat }
        : { status: 'does-not-support', summary: `The share of requests reaching ${db.label} did not fall (${pct(shareA)} → ${pct(shareB)}). Check that requests pass through the cache before the database, and that it has a non-zero hit ratio.`, evidence, caveat };
    },
  },
  {
    id: 'queues-backlog',
    title: 'Queues absorb load, until the backlog outgrows the workers',
    hypothesis: 'With a queue in front of workers, requests are accepted quickly even when arrivals exceed worker capacity. The excess becomes a backlog, which is a problem if it cannot drain.',
    experiment: ['Build a path Client → API → Message Queue → Worker (any equivalent design works).', 'Set traffic above the workers’ processing capacity for the traffic window, and keep a drain window.', 'Run it as the experiment.'],
    observe: ['Request latency (accepting work)', 'Peak backlog and waiting time at the workers', 'Jobs still pending when the run ends'],
    evaluate(context) {
      const run = context.experiment ?? context.baseline;
      if (!run) return needs('Run an experiment that includes a Message Queue or Event Stream feeding Workers.');
      if (!run.measurements.complete) return { status: 'inconclusive', summary: 'The run hit the event limit, so it is incomplete.', evidence: [] };
      if (!run.measurements.jobs.total) return needs('The run produced no background jobs. Route requests into a Message Queue or Event Stream with a connected Worker.');
      const workers = run.measurements.components.filter(component => component.kind === 'worker');
      const peak = workers.reduce((best, worker) => worker.maxQueueDepth > (best?.maxQueueDepth ?? -1) ? worker : best, workers[0]);
      const { jobs, p95 } = run.measurements;
      const evidence = [`request p95 ${p95 ?? '—'} ms (time to accept work)`, ...(peak ? [`${peak.label}: backlog peaked at ${peak.maxQueueDepth.toLocaleString()} jobs, average wait ${num(peak.averageWaitMs)} ms, ${pct(peak.utilization)} busy`] : []),
        `${jobs.total.toLocaleString()} jobs: ${jobs.completed.toLocaleString()} completed, ${jobs.pending.toLocaleString()} still pending at the end, ${jobs.deadLettered.toLocaleString()} dead-lettered`, `drain window: ${run.benchmark.drainMs / 1000} s after traffic stopped`];
      if (!peak || peak.maxQueueDepth === 0) return { status: 'inconclusive', summary: 'The workers kept up, so no backlog formed. Raise traffic above their capacity (slots × processing rate) to see the queue absorb the excess.', evidence };
      return jobs.pending > 0
        ? { status: 'supports', summary: `Requests were accepted quickly while ${peak.label} built a backlog of ${peak.maxQueueDepth.toLocaleString()}. ${jobs.pending.toLocaleString()} jobs were still waiting when the run ended: the backlog grew faster than it could drain, which is when a queue stops being enough.`, evidence }
        : { status: 'supports', summary: `Requests were accepted quickly while ${peak.label} built a backlog of up to ${peak.maxQueueDepth.toLocaleString()} jobs, and every job finished within the run. The queue absorbed the excess and drained it.`, evidence };
    },
  },
  {
    id: 'traffic-degrades',
    title: 'More traffic eventually degrades performance',
    hypothesis: 'As offered traffic grows, a component approaches full utilization, and requests queue. Latency rises, then requests fail.',
    experiment: ['Run a traffic sweep over at least three levels, ending well above today’s traffic.'],
    observe: ['p95 latency and successful throughput at each level', 'Which component reaches 85% utilization first', 'The first simulated level that misses a target'],
    evaluate(context) {
      const sweep = context.sweep;
      if (!sweep) return needs('Run a traffic sweep.');
      const measured = sweep.points.filter(point => point.status === 'measured' && point.measurements);
      if (measured.length < 3) return needs(`Only ${measured.length} level${measured.length === 1 ? '' : 's'} were measured completely; run a sweep with at least three.`);
      const analysis = analyzeSweep(sweep.points);
      const low = measured[0]; const high = measured[measured.length - 1];
      const evidence = [`${low.rps.toLocaleString()} req/s: p95 ${low.measurements!.p95 ?? '—'} ms, ${pct(low.measurements!.successPct / 100)} succeeded`, `${high.rps.toLocaleString()} req/s: p95 ${high.measurements!.p95 ?? '—'} ms, ${pct(high.measurements!.successPct / 100)} succeeded`,
        ...analysis.firstToSaturate.slice(0, 2).map(entry => `${entry.label} first reached ${pct(entry.utilization)} at ${entry.rps.toLocaleString()} req/s`), analysis.measured.statement];
      if (analysis.measured.firstFailingRps !== null) return { status: 'supports', summary: `Performance degraded under load: targets held up to ${analysis.measured.lastPassingRps?.toLocaleString() ?? 'none of the levels'} and failed at ${analysis.measured.firstFailingRps.toLocaleString()} req/s (${analysis.measured.violated.join('; ')}). Note that p95 covers successful requests only, so it can fall again when most requests are rejected.`, evidence };
      return { status: 'inconclusive', summary: `No simulated level missed a target. ${analysis.prediction ? analysis.prediction.statement : 'Add higher levels to the sweep.'}`, evidence };
    },
  },
  {
    id: 'bottleneck-shift',
    title: 'Removing one bottleneck exposes the next',
    hypothesis: 'After you relieve the busiest component, a different component becomes the busiest, and it now limits the system.',
    experiment: ['Set a baseline and note its busiest component.', 'In the experiment, add capacity to that component only (instances, connections, concurrency or a cache).', 'Run the experiment with the baseline’s benchmark.'],
    observe: ['The busiest component before and after', 'Its utilization before and after', 'Whether the new busiest component is near capacity'],
    evaluate(context) {
      const result = pair(context); if (isOutcome(result)) return result;
      const { a, b, caveat } = result;
      const comparison = compareRuns(a, b);
      const { before, after } = comparison.bottleneck;
      if (!before || !after) return needs('Both runs need at least one simulated component.');
      const relieved = comparison.components.find(entry => entry.id === before.id)?.utilization[1] ?? null;
      const evidence = [`baseline busiest: ${before.label} at ${pct(before.utilization)}`, `experiment busiest: ${after.label} at ${pct(after.utilization)}`, ...(relieved !== null && before.id !== after.id ? [`${before.label} in the experiment: ${pct(relieved)}`] : [])];
      if (!comparison.bottleneck.shifted) return { status: 'does-not-support', summary: `${before.label} is still the busiest component (${pct(before.utilization)} → ${pct(after.utilization)}). Add more capacity there, or check that the change affects it.`, evidence, caveat };
      const wasTied = comparison.bottleneck.afterInBaseline !== null && before.utilization - comparison.bottleneck.afterInBaseline < 0.02;
      return { status: 'supports', summary: `Relieving ${before.label} (${pct(before.utilization)}${relieved !== null ? ` → ${pct(relieved)}` : ''}) made ${after.label} the busiest component at ${pct(after.utilization)}${after.utilization >= 0.85 ? ', and it is now near capacity: the new bottleneck' : ''}.${wasTied ? ` Note that ${after.label} was already about as busy in the baseline (${pct(comparison.bottleneck.afterInBaseline!)}), so it was a co-bottleneck rather than a newly exposed one.` : ''}`, evidence, caveat };
    },
  },
];
