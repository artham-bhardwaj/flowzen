import type { LldModel } from '../types';
import { file } from './util';

const pkg = 'flowzen.ratelimit';

export const rateLimiterModel: LldModel = {
  id: 'rate-limiter', title: 'Rate Limiter', kinds: ['rateLimiter'], packageName: pkg,
  overview: {
    responsibility: 'Admit requests up to a sustained rate with a bounded burst, and reject the excess immediately so it never reaches the protected service.',
    inputs: ['Requests, each with a key (client, API key or a single global key)'],
    outputs: ['Admitted requests, passed downstream', '429 Too Many Requests for rejected ones'],
    collaborators: ['RateLimitFilter (HTTP adapter)', 'RateLimiter (admission decision)', 'TokenBucket (the algorithm)', 'A nanosecond clock (injected)'],
    state: ['One token bucket per key: current tokens and last refill time'],
    behavior: ['Tokens refill continuously at ratePerSecond, up to the burst capacity.', 'A request consumes one token; with no token available it is rejected without waiting.'],
  },
  canvasRole: {
    upstream: 'Clients or an edge component call RateLimitFilter.handle.',
    downstream: 'The first connection is the protected downstream Handler; only admitted requests reach it.',
  },
  classes: [
    { id: 'filter', name: 'RateLimitFilter', kind: 'class', file: 'RateLimitFilter.java', layer: 0, responsibility: 'HTTP adapter: derives the key, asks the limiter, returns 429 or forwards.', members: ['- limiter: RateLimiter', '- downstream: Handler', '+ handle(request: Request): Response'] },
    { id: 'limiter', name: 'RateLimiter', kind: 'interface', file: 'RateLimiter.java', layer: 1, responsibility: 'Admission decision for one request with a given key.', members: ['+ tryAcquire(key: String): boolean'] },
    { id: 'handler', name: 'Handler', kind: 'interface', file: 'Handler.java', layer: 1, responsibility: 'The protected downstream service.', members: ['+ handle(request: Request): Response'] },
    { id: 'tbl', name: 'TokenBucketRateLimiter', kind: 'class', file: 'TokenBucketRateLimiter.java', layer: 2, responsibility: 'Keeps one TokenBucket per key and delegates to it.', members: ['- buckets: Map<String, TokenBucket>', '- ratePerSecond: double', '- burst: double', '- nanoClock: LongSupplier', '+ tryAcquire(key: String): boolean'] },
    { id: 'bucket', name: 'TokenBucket', kind: 'class', file: 'TokenBucket.java', layer: 3, responsibility: 'The token-bucket arithmetic for one key, thread-safe.', members: ['- capacity: double', '- refillPerNano: double', '- tokens: double', '- lastRefillNanos: long', '+ tryConsume(nowNanos: long): boolean', '- refill(nowNanos: long): void'] },
    { id: 'request', name: 'Request', kind: 'record', file: 'Request.java', layer: 3, support: true, responsibility: 'An incoming request with the client identity used as the key.', members: ['+ clientId(): String', '+ path(): String'] },
    { id: 'response', name: 'Response', kind: 'record', file: 'Response.java', layer: 3, support: true, responsibility: 'An HTTP response.', members: ['+ status(): int', '+ body(): String'] },
  ],
  relations: [
    { from: 'filter', to: 'limiter', type: 'uses' },
    { from: 'filter', to: 'handler', type: 'uses', label: 'admitted' },
    { from: 'filter', to: 'handler', type: 'implements' },
    { from: 'tbl', to: 'limiter', type: 'implements' },
    { from: 'tbl', to: 'bucket', type: 'composes', label: 'per key' },
    { from: 'filter', to: 'response', type: 'creates', label: '429' },
    { from: 'filter', to: 'request', type: 'uses' },
  ],
  files: [
    file('RateLimiter.java', `
package ${pkg};

/** Returns true if the request may proceed now. Never blocks. */
public interface RateLimiter {
    boolean tryAcquire(String key);
}`),
    file('TokenBucket.java', `
package ${pkg};

/** Tokens refill continuously up to capacity; each request consumes one. */
public final class TokenBucket {
    private final double capacity;
    private final double refillPerNano;
    private double tokens;
    private long lastRefillNanos;

    public TokenBucket(double ratePerSecond, double capacity, long nowNanos) {
        this.capacity = capacity;
        this.refillPerNano = ratePerSecond / 1_000_000_000.0;
        this.tokens = capacity;
        this.lastRefillNanos = nowNanos;
    }

    public synchronized boolean tryConsume(long nowNanos) {
        refill(nowNanos);
        if (tokens < 1.0) {
            return false;
        }
        tokens -= 1.0;
        return true;
    }

    private void refill(long nowNanos) {
        long elapsed = Math.max(0, nowNanos - lastRefillNanos);
        tokens = Math.min(capacity, tokens + elapsed * refillPerNano);
        lastRefillNanos = nowNanos;
    }
}`),
    file('TokenBucketRateLimiter.java', `
package ${pkg};

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;

/** One bucket per key. The clock is injected so tests can control time. */
public final class TokenBucketRateLimiter implements RateLimiter {
    private final Map<String, TokenBucket> buckets = new ConcurrentHashMap<>();
    private final double ratePerSecond;
    private final double burst;
    private final LongSupplier nanoClock;

    public TokenBucketRateLimiter(double ratePerSecond, double burst, LongSupplier nanoClock) {
        this.ratePerSecond = ratePerSecond;
        this.burst = burst;
        this.nanoClock = nanoClock;
    }

    @Override
    public boolean tryAcquire(String key) {
        long now = nanoClock.getAsLong();
        TokenBucket bucket = buckets.computeIfAbsent(key, ignored -> new TokenBucket(ratePerSecond, burst, now));
        return bucket.tryConsume(now);
    }
}`),
    file('RateLimitFilter.java', `
package ${pkg};

/** Rejects over-limit requests with 429 before they reach the protected handler. */
public final class RateLimitFilter implements Handler {
    private final RateLimiter limiter;
    private final Handler downstream;

    public RateLimitFilter(RateLimiter limiter, Handler downstream) {
        this.limiter = limiter;
        this.downstream = downstream;
    }

    @Override
    public Response handle(Request request) {
        if (!limiter.tryAcquire(request.clientId())) {
            return new Response(429, "Too many requests");
        }
        return downstream.handle(request);
    }
}`),
    file('Handler.java', `
package ${pkg};

public interface Handler {
    Response handle(Request request);
}`),
    file('Request.java', `
package ${pkg};

public record Request(String clientId, String path) {}`),
    file('Response.java', `
package ${pkg};

public record Response(int status, String body) {}`),
  ],
  principles: [
    {
      principle: 'encapsulation',
      meaning: 'A bucket’s tokens and refill time can only change through tryConsume, which refills and consumes atomically.',
      classes: ['bucket'],
      evidence: 'TokenBucket’s tokens and lastRefillNanos are private; tryConsume is synchronized and refill is private.',
      benefit: 'The invariant 0 ≤ tokens ≤ capacity holds under concurrency, and no caller can “add tokens” to cheat the limit.',
      violation: 'Public tokens field updated by callers, or separate refill() and consume() methods that a caller could interleave incorrectly.',
      tradeoff: 'One lock per bucket: a single very hot key serializes on that lock.',
    },
    {
      principle: 'dependency-injection',
      meaning: 'Time is a dependency. TokenBucketRateLimiter receives a LongSupplier clock instead of calling System.nanoTime().',
      classes: ['tbl', 'bucket'],
      evidence: 'TokenBucketRateLimiter(ratePerSecond, burst, nanoClock) passes nanoClock.getAsLong() into TokenBucket.tryConsume.',
      benefit: 'Tests can advance a fake clock and check exact admission counts, deterministically, as Flowzen’s simulator does with simulated time.',
      violation: 'Calling System.nanoTime() inside TokenBucket, so tests must sleep and become slow and flaky (see the refactoring example).',
      tradeoff: 'One more constructor argument that production code must supply (System::nanoTime).',
    },
    {
      principle: 'ocp',
      meaning: 'RateLimitFilter depends on the RateLimiter interface, so a different algorithm is a new implementation, not an edit.',
      classes: ['filter', 'limiter', 'tbl'],
      evidence: 'RateLimitFilter.handle only calls limiter.tryAcquire; TokenBucketRateLimiter is one implementation.',
      benefit: 'Fixed-window, sliding-window or a distributed (Redis-backed) limiter can be swapped in per route.',
      violation: 'RateLimitFilter containing token arithmetic and a flag to switch to window counting.',
      tradeoff: 'A boolean tryAcquire cannot report “retry after N ms” without widening the interface.',
    },
  ],
  decisions: [
    { title: 'Token bucket', decision: 'Sustained rate plus a burst allowance.', why: 'Smooths admission while tolerating small spikes; cheap per request.', alternatives: [{ name: 'Fixed window counter', when: 'Simplicity matters more than accuracy at window edges.' }, { name: 'Sliding window log', when: 'Limits must be exact over any window, at higher memory cost.' }] },
    { title: 'Reject, do not wait', decision: 'tryAcquire never blocks; excess gets 429.', why: 'Waiting would hold threads and push queueing back onto the caller’s latency.', alternatives: [{ name: 'Blocking acquire with timeout', when: 'Smoothing outbound calls from a client to a third-party API.' }] },
    { title: 'Limiter as a decorator', decision: 'RateLimitFilter implements Handler and wraps the protected Handler.', why: 'Callers cannot tell a limited handler from an unlimited one, so limiting can be added or removed in the wiring.', alternatives: [{ name: 'Check inside the service', when: 'Limits depend on business data only the service has (e.g. per-account plans).' }] },
    { title: 'In-memory buckets', decision: 'Buckets live in this process.', why: 'No network hop per request.', alternatives: [{ name: 'Shared store (Redis + Lua script)', when: 'Several limiter instances must enforce one global limit.' }] },
  ],
  choices: [
    {
      id: 'algorithm', title: 'Algorithm', question: 'How should the limit be measured?', defaultOption: 'token-bucket',
      configKey: 'algorithm', matchConfig: { 'token bucket': 'token-bucket', 'fixed window': 'fixed-window' },
      options: [
        { id: 'token-bucket', label: 'Token bucket', summary: 'Continuous refill with a burst.', changes: ['TokenBucket'], effect: 'Current design, and exactly what Flowzen simulates (rate and burst).', code: `public final class TokenBucket {
    public synchronized boolean tryConsume(long nowNanos) {
        refill(nowNanos);
        if (tokens < 1.0) return false;
        tokens -= 1.0;
        return true;
    }
}` },
        { id: 'fixed-window', label: 'Fixed window', summary: 'At most N per calendar second.', changes: ['FixedWindowRateLimiter (new RateLimiter)'], effect: 'New RateLimiter implementation; RateLimitFilter unchanged. Up to 2× the limit can pass around a window boundary.', code: `public final class FixedWindowRateLimiter implements RateLimiter {
    private final Map<String, long[]> windows = new ConcurrentHashMap<>();   // [windowStart, count]

    @Override
    public boolean tryAcquire(String key) {
        long window = nanoClock.getAsLong() / 1_000_000_000L;
        long[] state = windows.compute(key, (k, old) ->
                old == null || old[0] != window ? new long[] { window, 1 } : new long[] { window, old[1] + 1 });
        return state[1] <= limitPerSecond;
    }
}` },
      ],
    },
  ],
  refactoring: {
    title: 'Making time injectable', principle: 'dependency-injection',
    problem: 'Tests had to sleep in real time to see tokens refill, so they were slow and occasionally failed on busy CI machines.',
    before: `public synchronized boolean tryConsume() {
    long now = System.nanoTime();          // hidden dependency on the real clock
    tokens = Math.min(capacity, tokens + (now - lastRefillNanos) * refillPerNano);
    lastRefillNanos = now;
    // ...
}

// test
limiter.tryAcquire("a");
Thread.sleep(1000);                         // slow and timing-sensitive
assertTrue(limiter.tryAcquire("a"));`,
    after: `AtomicLong fakeNanos = new AtomicLong();
RateLimiter limiter = new TokenBucketRateLimiter(1, 1, fakeNanos::get);

assertTrue(limiter.tryAcquire("a"));
assertFalse(limiter.tryAcquire("a"));
fakeNanos.addAndGet(1_000_000_000L);       // advance one second instantly
assertTrue(limiter.tryAcquire("a"));`,
    explanation: 'With the clock injected, the test controls time, runs instantly and gives the same result every time. Production passes System::nanoTime.',
  },
  bindings: [
    { key: 'ratePerSecond', classId: 'bucket', target: 'refillPerNano = ratePerSecond / 1e9', note: 'Simulated: the token refill rate.' },
    { key: 'burst', classId: 'bucket', target: 'capacity (and the initial token count)', note: 'Simulated: the bucket size.' },
    { key: 'checkLatencyMs', classId: 'filter', target: 'Time for RateLimitFilter to decide', note: 'Simulated as a fixed check time.' },
    { key: 'algorithm', classId: 'limiter', target: 'Which RateLimiter is injected', note: 'Descriptive: the simulator always uses a token bucket.' },
  ],
  simulation: 'Flowzen simulates exactly one token bucket per Rate Limiter component (rate and burst): every request shares it, as if all requests used the same key. Requests without a token fail as “rate-limited”; admitted ones are forwarded to the first connection. Per-client keys and other algorithms are illustrative.',
};
