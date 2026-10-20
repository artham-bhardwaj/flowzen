import type { Lesson, Module, PlannedLesson, SimulatorSupport } from './types';
import { isLesson } from './types';
import { approachLesson, metricsLesson, requirementsLesson } from './content/foundations1';
import { bottlenecksLesson, estimationLesson, sloLesson } from './content/foundations2';
import { cachingLesson, scalingLesson, statelessLesson, syncAsyncLesson } from './content/foundations3';

/**
 * The System Design learning track. Written lessons are full `Lesson` objects; the rest are listed as
 * planned, with how much of each the simulator can demonstrate, so the curriculum is visible without
 * pretending content exists.
 */
const planned = (id: string, title: string, simulator: SimulatorSupport, components?: PlannedLesson['components']): PlannedLesson => ({ id, title, simulator, ...(components ? { components } : {}) });

export const MODULES: Module[] = [
  { id: 'foundations', number: 1, title: 'System Design Foundations', summary: 'How to approach a design, the qualities that matter, how to estimate and find bottlenecks, and the basic architectural choices.',
    lessons: [approachLesson, requirementsLesson, metricsLesson, estimationLesson, bottlenecksLesson, sloLesson, scalingLesson, statelessLesson, syncAsyncLesson] },
  { id: 'networking', number: 2, title: 'Networking and Request Flow', summary: 'How a request travels from a client to your servers, and the components on the way.', lessons: [
    planned('dns', 'DNS', 'partial', ['dns']), planned('http', 'HTTP and HTTPS', 'theory'), planned('tcp', 'TCP fundamentals and connection behavior', 'theory'),
    planned('reverse-proxies', 'Reverse proxies', 'partial', ['reverseProxy']), planned('load-balancing', 'Load balancers and load-balancing algorithms', 'partial', ['loadBalancer']),
    planned('api-gateways', 'API gateways', 'partial', ['gateway']), planned('cdn', 'CDN and edge caching', 'simulated', ['cdn']), planned('tls', 'TLS termination', 'theory'),
    planned('timeouts-pooling', 'Timeouts, retries and connection pooling', 'partial'),
  ] },
  { id: 'application', number: 3, title: 'Application Architecture', summary: 'Structuring services: boundaries, APIs, security basics and the runtime platforms they run on.', lessons: [
    planned('client-server', 'Client-server architecture', 'theory'), planned('monolith-microservices', 'Monoliths vs microservices', 'theory'), planned('service-boundaries', 'Service boundaries and responsibility', 'theory'),
    planned('rest', 'REST APIs and API design', 'theory'), planned('authn-authz', 'Authentication and authorization fundamentals', 'theory'), planned('stateless-servers', 'Stateless application servers', 'partial', ['server']),
    planned('containers', 'Containerized services', 'simulated', ['containerService']), planned('serverless', 'Serverless functions', 'simulated', ['serverless']), planned('service-discovery', 'Service discovery', 'theory'),
    planned('config-secrets', 'Configuration and secrets management', 'theory'),
  ] },
  { id: 'caching', number: 4, title: 'Caching', summary: 'Why caches work, how to use them safely, and how they fail.', lessons: [
    cachingLesson, planned('cache-patterns', 'Cache-aside, read-through and write-through', 'theory', ['cache']), planned('write-behind', 'Write-behind caching and its trade-offs', 'theory'),
    planned('ttl-eviction', 'TTL, eviction policies and cache capacity', 'partial', ['cache', 'distributedCache']), planned('hit-ratio', 'Cache hit ratio and miss ratio', 'simulated', ['cache']),
    planned('invalidation', 'Cache invalidation and consistency', 'theory'), planned('stampedes', 'Cache stampedes and hot keys', 'theory'), planned('local-distributed', 'Local vs distributed caching', 'partial', ['cache', 'distributedCache']),
    planned('cdn-caching', 'CDN caching', 'simulated', ['cdn']), planned('cache-failure', 'Cache failure and fallback behavior', 'simulated', ['cache']),
  ] },
  { id: 'data', number: 5, title: 'Databases and Storage', summary: 'Choosing, modelling and scaling data stores.', lessons: [
    planned('sql-nosql', 'Relational vs NoSQL databases', 'partial', ['database', 'nosql']), planned('modeling', 'Data modeling and indexing', 'theory'), planned('query-performance', 'Query performance', 'partial', ['database']),
    planned('pools', 'Connection pools and database saturation', 'simulated', ['database']), planned('transactions', 'Transactions and isolation', 'theory'), planned('replicas', 'Replication and read replicas', 'simulated', ['readReplica']),
    planned('sharding', 'Partitioning and sharding', 'theory'), planned('replication-lag', 'Consistency and replication lag', 'theory'), planned('object-storage', 'Object storage', 'simulated', ['objectStorage']),
    planned('search', 'Search engines', 'simulated', ['searchEngine']), planned('lifecycle', 'Data lifecycle and archival', 'theory'),
  ] },
  { id: 'messaging', number: 6, title: 'Messaging and Asynchronous Systems', summary: 'Queues, streams, delivery guarantees and keeping asynchronous systems correct.', lessons: [
    planned('queues-streams', 'Message queues and event streams', 'simulated', ['queue', 'eventStream']), planned('producers-consumers', 'Producers and consumers', 'simulated', ['worker']),
    planned('consumer-groups', 'Consumer groups and partitioning', 'partial', ['eventStream']), planned('worker-pools', 'Worker pools and concurrency', 'simulated', ['worker']),
    planned('delivery', 'Delivery guarantees', 'partial'), planned('semantics', 'At-most-once, at-least-once and exactly-once semantics', 'theory'), planned('idempotency', 'Idempotency', 'theory'),
    planned('ordering-retries', 'Ordering and retries', 'partial'), planned('dlq', 'Dead-letter queues', 'simulated', ['deadLetterQueue']), planned('backpressure', 'Backpressure and queue buildup', 'simulated', ['queue']),
    planned('event-driven', 'Event-driven architecture and eventual consistency', 'theory'),
  ] },
  { id: 'reliability', number: 7, title: 'Reliability and Resilience', summary: 'Designing systems that degrade gracefully instead of failing completely.', lessons: [
    planned('timeouts-retries', 'Timeouts and retry policies', 'partial'), planned('backoff-jitter', 'Exponential backoff and jitter', 'theory'), planned('circuit-breakers', 'Circuit breakers', 'simulated', ['circuitBreaker']),
    planned('bulkheads', 'Bulkheads', 'theory'), planned('rate-limiting', 'Rate limiting', 'simulated', ['rateLimiter']), planned('load-shedding', 'Load shedding', 'simulated', ['rateLimiter']),
    planned('health-checks', 'Health checks', 'theory'), planned('degradation', 'Graceful degradation', 'theory'), planned('redundancy', 'Redundancy and failover', 'partial'),
    planned('cascading', 'Dependency failures and cascading failures', 'partial'),
  ] },
  { id: 'distributed', number: 8, title: 'Scalability and Distributed Systems', summary: 'What changes when data and coordination span many machines.', lessons: [
    planned('stateless-scaling', 'Stateless horizontal scaling', 'simulated'), planned('load-distribution', 'Load distribution', 'partial'), planned('bottleneck-analysis', 'Bottleneck analysis', 'simulated'),
    planned('cap', 'CAP theorem and its practical interpretation', 'theory'), planned('consistency-models', 'Consistency models', 'theory'), planned('coordination', 'Distributed coordination', 'theory'),
    planned('dedup', 'Idempotency and deduplication', 'theory'), planned('locks-leases', 'Distributed locks and leases', 'theory'), planned('hot-partitions', 'Hot partitions and uneven workloads', 'theory'),
    planned('multi-region', 'Multi-region architecture fundamentals', 'theory'),
  ] },
  { id: 'operations', number: 9, title: 'Observability and Operations', summary: 'Seeing what a system does in production, and changing it safely.', lessons: [
    planned('signals', 'Metrics, logs and distributed traces', 'partial', ['metricsCollector', 'logAggregator']), planned('red-use', 'RED and USE methods', 'partial'), planned('prometheus', 'Prometheus and metrics collection', 'theory', ['metricsCollector']),
    planned('dashboards', 'Dashboards and alerting', 'theory'), planned('slo-monitoring', 'SLI/SLO monitoring', 'theory'), planned('incidents', 'Incident investigation', 'partial'),
    planned('capacity-planning', 'Capacity planning', 'simulated'), planned('deployments', 'Deployment strategies and rollback', 'theory'), planned('feature-flags', 'Feature flags', 'theory'),
    planned('readiness', 'Operational readiness', 'theory'),
  ] },
  { id: 'case-studies', number: 10, title: 'Putting Systems Together', summary: 'End-to-end designs that combine the earlier modules.', lessons: [
    planned('url-shortener', 'URL shortener', 'partial'), planned('product-catalog', 'Product catalog', 'simulated'), planned('checkout', 'E-commerce checkout', 'partial'),
    planned('notifications', 'Notification service', 'simulated'), planned('file-upload', 'File upload and storage service', 'partial'), planned('public-api', 'Rate-limited public API', 'simulated'),
    planned('image-processing', 'Asynchronous image processing', 'simulated'), planned('feed', 'Feed generation', 'partial'), planned('autocomplete', 'Search autocomplete', 'partial'),
    planned('read-heavy', 'High-traffic read-heavy service', 'simulated'),
  ] },
];

/** Written lessons in curriculum order. */
export const LESSONS: Lesson[] = MODULES.flatMap(module => module.lessons.filter(isLesson));
export const lessonById = (id: string): Lesson | undefined => LESSONS.find(lesson => lesson.id === id);
export const moduleById = (id: string): Module | undefined => MODULES.find(module => module.id === id);
export const SUPPORT_LABELS: Record<SimulatorSupport, { label: string; description: string }> = {
  simulated: { label: 'Simulated', description: 'The simulator can demonstrate the main effects with measurements.' },
  partial: { label: 'Partly simulated', description: 'Some effects are measured; others are explained as theory and labelled.' },
  theory: { label: 'Theory only', description: 'The simulator does not model this yet; the lesson explains it without simulated results.' },
};
