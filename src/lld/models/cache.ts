import type { LldModel } from '../types';
import { file } from './util';

const pkg = 'flowzen.cache';

export const cacheModel: LldModel = {
  id: 'cache', title: 'Cache', kinds: ['cache'], packageName: pkg,
  overview: {
    responsibility: 'Serve repeated reads from memory so that only misses reach the slower store behind it.',
    inputs: ['Lookups by key from an application server'],
    outputs: ['The cached value on a hit', 'On a miss: a read from the backing store (its downstream), whose result is then cached'],
    collaborators: ['ProductRepository (the source of truth, downstream on the canvas)', 'EvictionPolicy (which entry to drop when full)', 'CacheStats (hit and miss counters)'],
    state: ['Entries with their expiry time', 'Eviction bookkeeping (access order for LRU)', 'Hit and miss counters'],
    behavior: ['Cache-aside: the service checks the cache, loads from the repository on a miss, then stores the result.', 'Entries expire after a TTL; when full, the eviction policy picks a victim.'],
  },
  canvasRole: {
    upstream: 'Application servers call ProductCacheService.findProduct.',
    downstream: 'The first connection is the source of truth behind ProductRepository: only misses reach it.',
  },
  classes: [
    { id: 'service', name: 'ProductCacheService', kind: 'class', file: 'ProductCacheService.java', layer: 0, responsibility: 'Cache-aside reads: try the cache, fall back to the repository, populate on a miss, invalidate on update.', members: ['- cache: Cache<String, Product>', '- repository: ProductRepository', '+ findProduct(id: String): Optional<Product>', '+ updateProduct(product: Product): void'] },
    { id: 'cache', name: 'Cache', kind: 'interface', file: 'Cache.java', layer: 1, responsibility: 'Key-value lookup that may forget anything at any time.', members: ['+ get(key: K): Optional<V>', '+ put(key: K, value: V): void', '+ invalidate(key: K): void'] },
    { id: 'repo', name: 'ProductRepository', kind: 'interface', file: 'ProductRepository.java', layer: 1, responsibility: 'Source of truth for products.', members: ['+ findById(id: String): Optional<Product>', '+ save(product: Product): void'] },
    { id: 'memory', name: 'InMemoryCache', kind: 'class', file: 'InMemoryCache.java', layer: 2, responsibility: 'Thread-safe bounded map with TTL; delegates victim selection to an EvictionPolicy.', members: ['- entries: Map<K, Entry<V>>', '- policy: EvictionPolicy<K>', '- capacity: int', '- ttl: Duration', '- stats: CacheStats', '+ get(key: K): Optional<V>', '+ put(key: K, value: V): void', '+ invalidate(key: K): void'] },
    { id: 'noop', name: 'NoOpCache', kind: 'class', file: 'NoOpCache.java', layer: 2, responsibility: 'A cache that never stores anything; a legal substitute that turns caching off.', members: ['+ get(key: K): Optional<V>', '+ put(key: K, value: V): void', '+ invalidate(key: K): void'] },
    { id: 'policy', name: 'EvictionPolicy', kind: 'interface', file: 'EvictionPolicy.java', layer: 3, responsibility: 'Tracks key usage and nominates the next key to evict.', members: ['+ recordAccess(key: K): void', '+ remove(key: K): void', '+ victim(): K'] },
    { id: 'stats', name: 'CacheStats', kind: 'class', file: 'CacheStats.java', layer: 3, responsibility: 'Counts hits and misses and reports the hit ratio.', members: ['- hits: AtomicLong', '- misses: AtomicLong', '+ recordHit(): void', '+ recordMiss(): void', '+ hitRatio(): double'] },
    { id: 'lru', name: 'LruEvictionPolicy', kind: 'class', file: 'LruEvictionPolicy.java', layer: 4, responsibility: 'Least-recently-used ordering via an access-ordered LinkedHashMap.', members: ['- order: LinkedHashMap<K, Boolean>', '+ recordAccess(key: K): void', '+ remove(key: K): void', '+ victim(): K'] },
    { id: 'product', name: 'Product', kind: 'record', file: 'Product.java', layer: 4, support: true, responsibility: 'The cached value type.', members: ['+ id(): String', '+ name(): String', '+ priceCents(): long'] },
  ],
  relations: [
    { from: 'service', to: 'cache', type: 'uses' },
    { from: 'service', to: 'repo', type: 'uses', label: 'on miss' },
    { from: 'memory', to: 'cache', type: 'implements' },
    { from: 'noop', to: 'cache', type: 'implements' },
    { from: 'memory', to: 'policy', type: 'uses' },
    { from: 'memory', to: 'stats', type: 'composes' },
    { from: 'lru', to: 'policy', type: 'implements' },
    { from: 'service', to: 'product', type: 'uses' },
  ],
  files: [
    file('ProductCacheService.java', `
package ${pkg};

import java.util.Optional;

/** Cache-aside: the service, not the cache, decides when to load and when to invalidate. */
public final class ProductCacheService {
    private final Cache<String, Product> cache;
    private final ProductRepository repository;

    public ProductCacheService(Cache<String, Product> cache, ProductRepository repository) {
        this.cache = cache;
        this.repository = repository;
    }

    public Optional<Product> findProduct(String id) {
        Optional<Product> cached = cache.get(id);
        if (cached.isPresent()) {
            return cached;
        }
        Optional<Product> loaded = repository.findById(id);
        loaded.ifPresent(product -> cache.put(id, product));
        return loaded;
    }

    /** Write to the source of truth first, then drop the stale entry. */
    public void updateProduct(Product product) {
        repository.save(product);
        cache.invalidate(product.id());
    }
}`),
    file('Cache.java', `
package ${pkg};

import java.util.Optional;

/**
 * Contract: get may return empty for any key at any time (expiry, eviction, restart).
 * Callers must always be able to fall back to the source of truth.
 */
public interface Cache<K, V> {
    Optional<V> get(K key);

    void put(K key, V value);

    void invalidate(K key);
}`),
    file('InMemoryCache.java', `
package ${pkg};

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/** Bounded, thread-safe, TTL-based cache. Victim selection is delegated to the policy. */
public final class InMemoryCache<K, V> implements Cache<K, V> {
    private record Entry<V>(V value, Instant expiresAt) {}

    private final Map<K, Entry<V>> entries = new HashMap<>();
    private final EvictionPolicy<K> policy;
    private final int capacity;
    private final Duration ttl;
    private final Clock clock;
    private final CacheStats stats = new CacheStats();

    public InMemoryCache(int capacity, Duration ttl, EvictionPolicy<K> policy, Clock clock) {
        this.capacity = capacity;
        this.ttl = ttl;
        this.policy = policy;
        this.clock = clock;
    }

    @Override
    public synchronized Optional<V> get(K key) {
        Entry<V> entry = entries.get(key);
        if (entry == null || entry.expiresAt().isBefore(clock.instant())) {
            if (entry != null) {
                invalidate(key);
            }
            stats.recordMiss();
            return Optional.empty();
        }
        policy.recordAccess(key);
        stats.recordHit();
        return Optional.of(entry.value());
    }

    @Override
    public synchronized void put(K key, V value) {
        if (!entries.containsKey(key) && entries.size() >= capacity) {
            invalidate(policy.victim());
        }
        entries.put(key, new Entry<>(value, clock.instant().plus(ttl)));
        policy.recordAccess(key);
    }

    @Override
    public synchronized void invalidate(K key) {
        entries.remove(key);
        policy.remove(key);
    }

    public double hitRatio() {
        return stats.hitRatio();
    }
}`),
    file('NoOpCache.java', `
package ${pkg};

import java.util.Optional;

/** Stores nothing. Substituting it disables caching without breaking callers. */
public final class NoOpCache<K, V> implements Cache<K, V> {
    @Override
    public Optional<V> get(K key) {
        return Optional.empty();
    }

    @Override
    public void put(K key, V value) {
        // intentionally empty: a cache is allowed to forget
    }

    @Override
    public void invalidate(K key) {
        // nothing to remove
    }
}`),
    file('EvictionPolicy.java', `
package ${pkg};

/** Decides which key to drop when the cache is full. Not thread-safe; the cache serializes calls. */
public interface EvictionPolicy<K> {
    void recordAccess(K key);

    void remove(K key);

    K victim();
}`),
    file('LruEvictionPolicy.java', `
package ${pkg};

import java.util.LinkedHashMap;

/** Least recently used: an access-ordered LinkedHashMap keeps the oldest key first. */
public final class LruEvictionPolicy<K> implements EvictionPolicy<K> {
    private final LinkedHashMap<K, Boolean> order = new LinkedHashMap<>(16, 0.75f, true);

    @Override
    public void recordAccess(K key) {
        order.put(key, Boolean.TRUE);
    }

    @Override
    public void remove(K key) {
        order.remove(key);
    }

    @Override
    public K victim() {
        return order.keySet().iterator().next();
    }
}`),
    file('CacheStats.java', `
package ${pkg};

import java.util.concurrent.atomic.AtomicLong;

/** Hit/miss counters for observability. */
public final class CacheStats {
    private final AtomicLong hits = new AtomicLong();
    private final AtomicLong misses = new AtomicLong();

    public void recordHit() {
        hits.incrementAndGet();
    }

    public void recordMiss() {
        misses.incrementAndGet();
    }

    public double hitRatio() {
        long total = hits.get() + misses.get();
        return total == 0 ? 0.0 : (double) hits.get() / total;
    }
}`),
    file('ProductRepository.java', `
package ${pkg};

import java.util.Optional;

/** The source of truth (a database behind the cache). */
public interface ProductRepository {
    Optional<Product> findById(String id);

    void save(Product product);
}`),
    file('Product.java', `
package ${pkg};

public record Product(String id, String name, long priceCents) {}`),
  ],
  principles: [
    {
      principle: 'lsp',
      meaning: 'Any Cache implementation, including NoOpCache, can replace another without breaking ProductCacheService, because the contract says a cache may return empty at any time.',
      classes: ['cache', 'noop', 'memory', 'service'],
      evidence: 'Cache’s documented contract allows get to return empty; ProductCacheService.findProduct always falls back to the repository; NoOpCache honors the contract by doing nothing.',
      benefit: 'Caching can be disabled (NoOpCache) or moved to Redis without changing callers, and correctness never depends on a hit.',
      violation: 'A ReadOnlyCache whose put throws UnsupportedOperationException, or callers that assume a value they just put will be returned.',
      tradeoff: 'A weak contract means callers must always handle the miss path, even when a cache is practically always warm.',
    },
    {
      principle: 'ocp',
      meaning: 'Eviction is pluggable: LRU today, LFU or size-aware tomorrow, without editing InMemoryCache.',
      classes: ['memory', 'policy', 'lru'],
      evidence: 'InMemoryCache.put asks policy.victim() and never inspects access order itself; LruEvictionPolicy implements EvictionPolicy.',
      benefit: 'Workloads differ (scan-heavy versus hot-key); the policy can be tuned per cache.',
      violation: 'InMemoryCache with a boolean useLfu flag and two eviction code paths.',
      tradeoff: 'The policy keeps its own copy of the keys, so memory overhead roughly doubles per entry.',
    },
    {
      principle: 'encapsulation',
      meaning: 'The entry map, expiry checks and synchronization are private to InMemoryCache; callers cannot observe or corrupt them.',
      classes: ['memory', 'stats'],
      evidence: 'InMemoryCache keeps entries and the Entry record private, and every public method is synchronized; CacheStats exposes counters only through methods.',
      benefit: 'Invariants (size ≤ capacity, expired entries are never returned, the policy matches the map) are enforced in one place.',
      violation: 'Exposing the internal map with a getEntries() method so callers can iterate or modify it without the lock.',
      tradeoff: 'A single lock is simple but serializes all access; very hot caches use striped locks or concurrent structures.',
    },
    {
      principle: 'srp',
      meaning: 'Storing entries (InMemoryCache) and deciding when to read through or invalidate (ProductCacheService) are separate.',
      classes: ['service', 'memory'],
      evidence: 'ProductCacheService.findProduct implements cache-aside; InMemoryCache never calls the repository.',
      benefit: 'The same cache class works for any data type and loading rule.',
      violation: 'A ProductCache that queries the database itself on a miss and also implements LRU.',
      tradeoff: 'Every service using the cache repeats a few lines of cache-aside logic (or needs a shared helper).',
    },
  ],
  decisions: [
    { title: 'Cache-aside', decision: 'The service loads on a miss and invalidates after writes.', why: 'The cache stays a simple store; a cache outage degrades to slower reads instead of errors.', alternatives: [{ name: 'Read-through (the cache loads itself)', when: 'Many callers share loading logic and you want it in one place.' }, { name: 'Write-through', when: 'Reads must see writes immediately and write latency can absorb the extra step.' }] },
    { title: 'Invalidate rather than update on write', decision: 'updateProduct deletes the cached entry after saving.', why: 'Avoids racing writers leaving an older value in the cache; the next read repopulates it.', alternatives: [{ name: 'Update the cache in place', when: 'Values are expensive to recompute and writes are rare and single-writer.' }] },
  ],
  choices: [
    {
      id: 'eviction', title: 'Eviction policy', question: 'When full, which entry should go?', defaultOption: 'lru',
      options: [
        { id: 'lru', label: 'LRU', summary: 'Least recently used.', changes: ['LruEvictionPolicy'], effect: 'Current design. Good for recency-heavy access (sessions, recently viewed items).', code: `public final class LruEvictionPolicy<K> implements EvictionPolicy<K> {
    private final LinkedHashMap<K, Boolean> order = new LinkedHashMap<>(16, 0.75f, true);

    @Override public void recordAccess(K key) { order.put(key, Boolean.TRUE); }
    @Override public void remove(K key) { order.remove(key); }
    @Override public K victim() { return order.keySet().iterator().next(); }
}` },
        { id: 'lfu', label: 'LFU', summary: 'Least frequently used.', changes: ['LfuEvictionPolicy (new)'], effect: 'Only a new policy class; InMemoryCache is unchanged. Protects popular keys from one-off scans, but old popular keys can linger.', code: `public final class LfuEvictionPolicy<K> implements EvictionPolicy<K> {
    private final Map<K, Long> counts = new HashMap<>();

    @Override public void recordAccess(K key) { counts.merge(key, 1L, Long::sum); }
    @Override public void remove(K key) { counts.remove(key); }
    @Override public K victim() {
        return counts.entrySet().stream().min(Map.Entry.comparingByValue()).orElseThrow().getKey();
    }
}` },
      ],
    },
    {
      id: 'write', title: 'Write strategy', question: 'What happens to the cache when a product changes?', defaultOption: 'aside',
      options: [
        { id: 'aside', label: 'Cache-aside + invalidate', summary: 'Write the DB, delete the key.', changes: ['ProductCacheService'], effect: 'Current design. Simple and safe; the next read pays one miss.', code: `public void updateProduct(Product product) {
    repository.save(product);
    cache.invalidate(product.id());
}` },
        { id: 'through', label: 'Write-through', summary: 'Write the DB, then write the cache.', changes: ['ProductCacheService'], effect: 'Reads after a write hit immediately, but concurrent writers can leave an older value cached; needs versioning or a single writer.', code: `public void updateProduct(Product product) {
    repository.save(product);
    cache.put(product.id(), product);
}` },
        { id: 'behind', label: 'Write-behind', summary: 'Write the cache now, the DB later.', changes: ['ProductCacheService', 'WriteBehindQueue (new)'], effect: 'Fastest writes, but data is lost if the process dies before the flush. The cache becomes a source of truth, which breaks the “may forget anything” contract that LSP relies on.', code: `public void updateProduct(Product product) {
    cache.put(product.id(), product);
    pendingWrites.enqueue(product);   // flushed to the repository asynchronously
}` },
      ],
    },
  ],
  refactoring: {
    title: 'A cache that breaks its contract', principle: 'lsp',
    problem: 'A read-only cache was substituted for Cache and crashed callers that were correct for every other implementation.',
    before: `public final class ReadOnlyCache<K, V> implements Cache<K, V> {
    @Override public Optional<V> get(K key) { return Optional.ofNullable(preloaded.get(key)); }
    @Override public void put(K key, V value) {
        throw new UnsupportedOperationException("read-only");   // ProductCacheService.findProduct now fails on every miss
    }
    @Override public void invalidate(K key) { throw new UnsupportedOperationException("read-only"); }
}`,
    after: `public final class ReadOnlyCache<K, V> implements Cache<K, V> {
    @Override public Optional<V> get(K key) { return Optional.ofNullable(preloaded.get(key)); }
    @Override public void put(K key, V value) { /* ignored: a cache may decline to store */ }
    @Override public void invalidate(K key) { preloaded.remove(key); }
}`,
    explanation: 'The fixed version keeps the promise every Cache makes: put and invalidate never fail, and get may miss. Any caller written against Cache keeps working.',
  },
  bindings: [
    { key: 'hitRatio', classId: 'stats', target: 'What CacheStats.hitRatio() would report', note: 'In the simulator the hit ratio is an input: each lookup hits with this seeded probability. In real code it is an outcome of capacity, TTL and access pattern.' },
    { key: 'ttl', classId: 'memory', target: 'InMemoryCache ttl', note: 'Descriptive: expiry is not simulated.' },
    { key: 'lookupLatencyMs', classId: 'memory', target: 'Time for InMemoryCache.get (plus the network hop to a remote cache)', note: 'Simulated as a fixed lookup time.' },
    { key: 'concurrency', classId: 'memory', target: 'Concurrent lookups the cache server handles', note: 'Simulated capacity. This in-process example serializes with one lock instead.' },
  ],
  simulation: 'Flowzen simulates a cache as a station whose lookups hit with a seeded probability (the hit ratio). Hits complete at the cache; misses continue to its first connection, which plays the role of ProductRepository. TTL, eviction and invalidation are illustrative only; the simulator does not model cache contents.',
};
