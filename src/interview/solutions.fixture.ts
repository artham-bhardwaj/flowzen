import type { Graph } from './testkit';

/**
 * Tuned architectures that meet each problem's benchmark, used only by tests to prove that the evaluator accepts
 * several valid designs. They are never loaded into a user's canvas.
 */
export const SOLUTIONS: Record<string, Graph[]> = {
  'url-shortener': [
    // Load balancer, two servers, distributed cache, key-value store.
    { nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'server', { instances: '8' }], ['b', 'server', { instances: '8' }], ['k', 'distributedCache'], ['d', 'nosql']], edges: [['u', 'lb'], ['lb', 'a'], ['lb', 'b'], ['a', 'k'], ['b', 'k'], ['k', 'd']] },
    // Alternative: single cache node with enough slots in front of a relational database.
    { nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'server', { instances: '8' }], ['b', 'server', { instances: '8' }], ['k', 'cache', { concurrency: '8' }], ['d', 'database']], edges: [['u', 'lb'], ['lb', 'a'], ['lb', 'b'], ['a', 'k'], ['b', 'k'], ['k', 'd']] },
    // Alternative: read replicas instead of a cache.
    { nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'server', { instances: '8' }], ['b', 'server', { instances: '8' }], ['d', 'database', { readRatio: '95' }], ['r1', 'readReplica', { concurrency: '40' }], ['r2', 'readReplica', { concurrency: '40' }]], edges: [['u', 'lb'], ['lb', 'a'], ['lb', 'b'], ['a', 'd'], ['b', 'd'], ['d', 'r1'], ['d', 'r2']] },
  ],
  'rate-limiter': [
    { nodes: [['u', 'client'], ['rl', 'rateLimiter', { ratePerSecond: '950', burst: '50' }], ['lb', 'loadBalancer'], ['a', 'server', { instances: '16' }], ['d', 'database']], edges: [['u', 'rl'], ['rl', 'lb'], ['lb', 'a'], ['a', 'd']] },
    { nodes: [['u', 'client'], ['gw', 'gateway'], ['rl', 'rateLimiter', { ratePerSecond: '900', burst: '20' }], ['a', 'containerService', { minTasks: '4', maxTasks: '8' }], ['d', 'nosql']], edges: [['u', 'gw'], ['gw', 'rl'], ['rl', 'a'], ['a', 'd']] },
  ],
  'notification-service': [
    { nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'server', { instances: '16' }], ['q', 'queue', { concurrency: '8', queueLimit: '20000' }], ['w', 'worker', { concurrency: '40', queueLimit: '20000', timeoutMs: '60000' }], ['dlq', 'deadLetterQueue']], edges: [['u', 'lb'], ['lb', 'a'], ['a', 'q'], ['q', 'w'], ['q', 'dlq']] },
    { nodes: [['u', 'client'], ['a', 'server', { instances: '16' }], ['s', 'eventStream', { partitions: '12' }], ['w', 'worker', { concurrency: '40', queueLimit: '20000', timeoutMs: '60000' }]], edges: [['u', 'a'], ['a', 's'], ['s', 'w']] },
  ],
  'file-storage': [
    { nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'server', { instances: '8' }], ['d', 'database'], ['dl', 'client'], ['cdn', 'cdn'], ['os', 'objectStorage']], edges: [['u', 'lb'], ['lb', 'a'], ['a', 'd'], ['dl', 'cdn'], ['cdn', 'os']] },
    { nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'server', { instances: '8' }], ['d', 'nosql'], ['dl', 'client'], ['k', 'cache', { concurrency: '8' }], ['os', 'objectStorage']], edges: [['u', 'lb'], ['lb', 'a'], ['a', 'd'], ['dl', 'k'], ['k', 'os']] },
  ],
  'product-catalog': [
    { nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'server', { instances: '24' }], ['k', 'distributedCache'], ['d', 'database']], edges: [['u', 'lb'], ['lb', 'a'], ['a', 'k'], ['k', 'd']] },
    { nodes: [['u', 'client'], ['cdn', 'cdn'], ['lb', 'loadBalancer'], ['a', 'server', { instances: '16' }], ['d', 'database']], edges: [['u', 'cdn'], ['cdn', 'lb'], ['lb', 'a'], ['a', 'd']] },
  ],
  checkout: [
    { nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'server', { instances: '24' }], ['d', 'database'], ['q', 'queue', { concurrency: '8', queueLimit: '20000' }], ['w', 'worker', { concurrency: '20', queueLimit: '20000', timeoutMs: '60000' }]], edges: [['u', 'lb'], ['lb', 'a'], ['a', 'd'], ['d', 'q'], ['q', 'w']] },
    { nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'containerService', { minTasks: '6', maxTasks: '8' }], ['d', 'database'], ['s', 'eventStream', { partitions: '12' }], ['w', 'worker', { concurrency: '20', queueLimit: '20000', timeoutMs: '60000' }]], edges: [['u', 'lb'], ['lb', 'a'], ['a', 'd'], ['d', 's'], ['s', 'w']] },
  ],
  chat: [
    { nodes: [['u', 'client'], ['gw', 'loadBalancer'], ['a', 'server', { instances: '16' }], ['s', 'eventStream', { partitions: '12' }], ['w', 'worker', { concurrency: '40', queueLimit: '20000', timeoutMs: '60000' }], ['d', 'nosql']], edges: [['u', 'gw'], ['gw', 'a'], ['a', 's'], ['s', 'w'], ['w', 'd']] },
    { nodes: [['u', 'client'], ['gw', 'reverseProxy', { concurrency: '400' }], ['a', 'server', { instances: '16' }], ['q', 'queue', { concurrency: '8', queueLimit: '20000' }], ['w', 'worker', { concurrency: '40', queueLimit: '20000', timeoutMs: '60000' }], ['d', 'database']], edges: [['u', 'gw'], ['gw', 'a'], ['a', 'q'], ['q', 'w'], ['w', 'd']] },
  ],
  autocomplete: [
    { nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'server', { instances: '16' }], ['k', 'distributedCache'], ['s', 'searchEngine']], edges: [['u', 'lb'], ['lb', 'a'], ['a', 'k'], ['k', 's']] },
    { nodes: [['u', 'client'], ['cdn', 'cdn'], ['a', 'server', { instances: '16' }], ['d', 'nosql']], edges: [['u', 'cdn'], ['cdn', 'a'], ['a', 'd']] },
  ],
  'video-processing': [
    { nodes: [['u', 'client'], ['a', 'server', { instances: '8' }], ['q', 'queue', { concurrency: '4', queueLimit: '20000' }], ['w', 'worker', { concurrency: '100', queueLimit: '20000', timeoutMs: '60000' }], ['os', 'objectStorage']], edges: [['u', 'a'], ['a', 'q'], ['q', 'w'], ['w', 'os']] },
    { nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'serverless'], ['s', 'eventStream'], ['w', 'worker', { concurrency: '100', queueLimit: '20000', timeoutMs: '60000' }], ['os', 'objectStorage'], ['v', 'client'], ['cdn', 'cdn']], edges: [['u', 'lb'], ['lb', 'a'], ['a', 's'], ['s', 'w'], ['w', 'os'], ['v', 'cdn'], ['cdn', 'os']] },
  ],
  'news-feed': [
    { nodes: [['r', 'client'], ['lb', 'loadBalancer'], ['f', 'server', { instances: '24' }], ['tl', 'distributedCache', { nodes: '4' }], ['d', 'nosql'], ['p', 'client'], ['ps', 'server', { instances: '16' }], ['s', 'eventStream', { partitions: '12' }], ['w', 'worker', { concurrency: '40', queueLimit: '20000', timeoutMs: '60000' }]], edges: [['r', 'lb'], ['lb', 'f'], ['f', 'tl'], ['tl', 'd'], ['p', 'ps'], ['ps', 's'], ['s', 'w'], ['w', 'd']] },
  ],
  'ride-booking': [
    { nodes: [['dr', 'client'], ['ls', 'server', { instances: '16' }], ['st', 'eventStream', { partitions: '12' }], ['w', 'worker', { concurrency: '40', queueLimit: '20000', timeoutMs: '60000' }], ['geo', 'nosql'], ['r', 'client'], ['lb', 'loadBalancer'], ['rs', 'server', { instances: '16' }], ['db', 'database']], edges: [['dr', 'ls'], ['ls', 'st'], ['st', 'w'], ['w', 'geo'], ['r', 'lb'], ['lb', 'rs'], ['rs', 'db']] },
    { nodes: [['dr', 'client'], ['ls', 'server', { instances: '16' }], ['st', 'queue', { concurrency: '16', queueLimit: '20000' }], ['w', 'worker', { concurrency: '40', queueLimit: '20000', timeoutMs: '60000' }], ['geo', 'distributedCache', { hitRatio: '100' }], ['gdb', 'nosql'], ['r', 'client'], ['lb', 'loadBalancer'], ['rs', 'server', { instances: '16' }], ['db', 'database']], edges: [['dr', 'ls'], ['ls', 'st'], ['st', 'w'], ['w', 'geo'], ['geo', 'gdb'], ['r', 'lb'], ['lb', 'rs'], ['rs', 'db']] },
  ],
  'job-scheduler': [
    { nodes: [['t', 'client'], ['lb', 'loadBalancer'], ['a', 'server', { instances: '8' }], ['d', 'database'], ['s', 'client'], ['q', 'queue', { concurrency: '8', queueLimit: '20000' }], ['w', 'worker', { concurrency: '40', queueLimit: '20000', timeoutMs: '60000' }], ['dlq', 'deadLetterQueue']], edges: [['t', 'lb'], ['lb', 'a'], ['a', 'd'], ['s', 'q'], ['q', 'w'], ['q', 'dlq']] },
  ],
};
