import type { LldModel } from '../types';
import { file } from './util';

const pkg = 'flowzen.lb';

export const loadBalancerModel: LldModel = {
  id: 'load-balancer', title: 'Load Balancer', kinds: ['loadBalancer'], packageName: pkg,
  overview: {
    responsibility: 'Accept client requests and forward each one to a healthy backend, spreading load across the pool.',
    inputs: ['HTTP requests from clients, DNS, a CDN or a gateway'],
    outputs: ['The same request, forwarded to one backend', '503 Service Unavailable when no backend is healthy'],
    collaborators: ['ServerRegistry (which backends exist and are healthy)', 'LoadBalancingStrategy (which backend gets this request)', 'HttpForwarder (the network call)', 'HealthChecker + HealthProbe (keep health up to date)'],
    state: ['Registered backends and their health (ServerRegistry)', 'The round-robin position (RoundRobinStrategy.next)'],
    behavior: ['Reads the healthy set on every request, so a backend that fails a probe stops receiving traffic at the next request.', 'Selection is lock-free; the registry uses concurrent maps.'],
  },
  canvasRole: {
    upstream: 'Clients, DNS or a CDN send requests into LoadBalancer.handle.',
    downstream: 'Each connected Application Server, Container Service or Serverless Function is one Backend in ServerRegistry; HttpForwarder makes the call to it.',
  },
  classes: [
    { id: 'lb', name: 'LoadBalancer', kind: 'class', file: 'LoadBalancer.java', layer: 0, responsibility: 'Entry point: gets the healthy backends, asks the strategy for one, and forwards the request.', members: ['- registry: ServerRegistry', '- strategy: LoadBalancingStrategy', '- forwarder: HttpForwarder', '+ handle(request: Request): Response'] },
    { id: 'checker', name: 'HealthChecker', kind: 'class', file: 'HealthChecker.java', layer: 0, responsibility: 'Probes every backend on a schedule and records the result in the registry.', members: ['- registry: ServerRegistry', '- probe: HealthProbe', '+ start(intervalMillis: long): void', '~ checkAll(): void', '+ close(): void'] },
    { id: 'strategy', name: 'LoadBalancingStrategy', kind: 'interface', file: 'LoadBalancingStrategy.java', layer: 1, responsibility: 'Chooses one backend from the healthy set. The balancing algorithm lives behind this interface.', members: ['+ select(healthy: List<Backend>, request: Request): Backend'] },
    { id: 'registry', name: 'ServerRegistry', kind: 'class', file: 'ServerRegistry.java', layer: 1, responsibility: 'Owns the backend list and each backend’s health; returns a stable, immutable snapshot of healthy backends.', members: ['- backends: Map<String, Backend>', '- healthy: Map<String, Boolean>', '+ register(backend: Backend): void', '+ deregister(backendId: String): void', '+ markHealth(backendId: String, isHealthy: boolean): void', '+ allBackends(): List<Backend>', '+ healthyBackends(): List<Backend>'] },
    { id: 'forwarder', name: 'HttpForwarder', kind: 'interface', file: 'HttpForwarder.java', layer: 1, responsibility: 'Sends a request to a specific backend and returns its response.', members: ['+ forward(backend: Backend, request: Request): Response'] },
    { id: 'rr', name: 'RoundRobinStrategy', kind: 'class', file: 'RoundRobinStrategy.java', layer: 2, responsibility: 'Cycles through healthy backends in order using an atomic counter.', members: ['- next: AtomicLong', '+ select(healthy: List<Backend>, request: Request): Backend'] },
    { id: 'probe', name: 'HealthProbe', kind: 'interface', file: 'HealthProbe.java', layer: 2, responsibility: 'Answers one question: is this backend healthy right now?', members: ['+ isHealthy(backend: Backend): boolean'] },
    { id: 'backend', name: 'Backend', kind: 'record', file: 'Backend.java', layer: 3, support: true, responsibility: 'Immutable identity of one upstream server.', members: ['+ id(): String', '+ host(): String', '+ port(): int'] },
    { id: 'request', name: 'Request', kind: 'record', file: 'Request.java', layer: 3, support: true, responsibility: 'An incoming HTTP request.', members: ['+ method(): String', '+ path(): String', '+ headers(): Map<String, String>'] },
    { id: 'response', name: 'Response', kind: 'record', file: 'Response.java', layer: 3, support: true, responsibility: 'An HTTP response.', members: ['+ status(): int', '+ body(): byte[]'] },
  ],
  relations: [
    { from: 'lb', to: 'registry', type: 'uses', label: 'healthy set' },
    { from: 'lb', to: 'strategy', type: 'uses', label: 'select' },
    { from: 'lb', to: 'forwarder', type: 'uses', label: 'forward' },
    { from: 'checker', to: 'registry', type: 'uses', label: 'markHealth' },
    { from: 'checker', to: 'probe', type: 'uses', label: 'isHealthy' },
    { from: 'rr', to: 'strategy', type: 'implements' },
    { from: 'registry', to: 'backend', type: 'uses' },
    { from: 'lb', to: 'response', type: 'creates', label: '503' },
    { from: 'lb', to: 'request', type: 'uses' },
  ],
  files: [
    file('LoadBalancer.java', `
package ${pkg};

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Objects;

/** Receives client requests and forwards each one to a backend chosen by the strategy. */
public final class LoadBalancer {
    private final ServerRegistry registry;
    private final LoadBalancingStrategy strategy;
    private final HttpForwarder forwarder;

    public LoadBalancer(ServerRegistry registry, LoadBalancingStrategy strategy, HttpForwarder forwarder) {
        this.registry = Objects.requireNonNull(registry);
        this.strategy = Objects.requireNonNull(strategy);
        this.forwarder = Objects.requireNonNull(forwarder);
    }

    public Response handle(Request request) {
        List<Backend> healthy = registry.healthyBackends();
        if (healthy.isEmpty()) {
            return new Response(503, "No healthy backend".getBytes(StandardCharsets.UTF_8));
        }
        Backend target = strategy.select(healthy, request);
        return forwarder.forward(target, request);
    }
}`),
    file('LoadBalancingStrategy.java', `
package ${pkg};

import java.util.List;

/** Picks one backend from the currently healthy set. Callers guarantee the list is not empty. */
public interface LoadBalancingStrategy {
    Backend select(List<Backend> healthy, Request request);
}`),
    file('RoundRobinStrategy.java', `
package ${pkg};

import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

/** Cycles through backends in order. Thread-safe without locks. */
public final class RoundRobinStrategy implements LoadBalancingStrategy {
    private final AtomicLong next = new AtomicLong();

    @Override
    public Backend select(List<Backend> healthy, Request request) {
        int index = (int) Math.floorMod(next.getAndIncrement(), (long) healthy.size());
        return healthy.get(index);
    }
}`),
    file('ServerRegistry.java', `
package ${pkg};

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Tracks which backends exist and which of them are currently healthy. */
public final class ServerRegistry {
    private final Map<String, Backend> backends = new ConcurrentHashMap<>();
    private final Map<String, Boolean> healthy = new ConcurrentHashMap<>();

    public void register(Backend backend) {
        backends.put(backend.id(), backend);
        healthy.put(backend.id(), true);
    }

    public void deregister(String backendId) {
        backends.remove(backendId);
        healthy.remove(backendId);
    }

    public void markHealth(String backendId, boolean isHealthy) {
        healthy.computeIfPresent(backendId, (id, previous) -> isHealthy);
    }

    public List<Backend> allBackends() {
        return backends.values().stream().sorted(Comparator.comparing(Backend::id)).toList();
    }

    /** A stable, immutable snapshot: sorted so round robin visits backends in a fixed order. */
    public List<Backend> healthyBackends() {
        return allBackends().stream()
                .filter(backend -> healthy.getOrDefault(backend.id(), false))
                .toList();
    }
}`),
    file('HttpForwarder.java', `
package ${pkg};

/** Performs the network call to one backend. */
public interface HttpForwarder {
    Response forward(Backend backend, Request request);
}`),
    file('HealthProbe.java', `
package ${pkg};

/** Checks one backend, e.g. with GET /health and a short timeout. */
public interface HealthProbe {
    boolean isHealthy(Backend backend);
}`),
    file('HealthChecker.java', `
package ${pkg};

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Periodically probes every registered backend and records the result. */
public final class HealthChecker implements AutoCloseable {
    private final ServerRegistry registry;
    private final HealthProbe probe;
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();

    public HealthChecker(ServerRegistry registry, HealthProbe probe) {
        this.registry = registry;
        this.probe = probe;
    }

    public void start(long intervalMillis) {
        scheduler.scheduleAtFixedRate(this::checkAll, 0, intervalMillis, TimeUnit.MILLISECONDS);
    }

    void checkAll() {
        for (Backend backend : registry.allBackends()) {
            registry.markHealth(backend.id(), probe.isHealthy(backend));
        }
    }

    @Override
    public void close() {
        scheduler.shutdownNow();
    }
}`),
    file('Backend.java', `
package ${pkg};

/** One upstream server instance. Immutable, so it can be shared between threads freely. */
public record Backend(String id, String host, int port) {}`),
    file('Request.java', `
package ${pkg};

import java.util.Map;

public record Request(String method, String path, Map<String, String> headers) {}`),
    file('Response.java', `
package ${pkg};

public record Response(int status, byte[] body) {}`),
  ],
  principles: [
    {
      principle: 'srp',
      meaning: 'Routing, membership and health checking change for different reasons, so each has its own class.',
      classes: ['lb', 'registry', 'checker'],
      evidence: 'LoadBalancer.handle only routes; ServerRegistry owns the backend maps; HealthChecker owns the probe schedule.',
      benefit: 'Changing the health-check interval or probe logic cannot break request routing, and each class can be tested alone.',
      violation: 'A LoadBalancer that keeps its own backend list, starts a probe thread in its constructor and also picks the target.',
      tradeoff: 'Three classes must be wired together at startup instead of one.',
    },
    {
      principle: 'ocp',
      meaning: 'New balancing algorithms are added as new LoadBalancingStrategy classes; LoadBalancer never changes.',
      classes: ['strategy', 'rr', 'lb'],
      evidence: 'LoadBalancer calls strategy.select(...) and has no knowledge of round robin.',
      benefit: 'Least-connections or weighted routing can ship without touching tested routing code.',
      violation: 'A switch on an algorithm name inside LoadBalancer.handle that grows a case for every new algorithm (see the refactoring example).',
      tradeoff: 'Strategies that need extra signals (in-flight counts, latency) force a richer interface or a callback after each response.',
    },
    {
      principle: 'dip',
      meaning: 'The routing policy depends on the HttpForwarder and LoadBalancingStrategy abstractions, not on an HTTP client library.',
      classes: ['lb', 'forwarder', 'strategy'],
      evidence: 'LoadBalancer’s fields are interface types; concrete implementations are passed into its constructor.',
      benefit: 'Tests can pass a fake forwarder; the HTTP stack can be swapped without editing the balancer.',
      violation: 'LoadBalancer constructing a specific HTTP client and calling it directly inside handle().',
      tradeoff: 'More indirection: reading handle() alone does not tell you which network client is used.',
    },
    {
      principle: 'isp',
      meaning: 'Health checking needs only “is it healthy?”, so it depends on the one-method HealthProbe, not on the request forwarder.',
      classes: ['checker', 'probe', 'forwarder'],
      evidence: 'HealthChecker’s constructor takes a HealthProbe; HttpForwarder is not visible to it.',
      benefit: 'Probes can use a different protocol (TCP connect, gRPC health) without implementing request forwarding.',
      violation: 'One BackendClient interface with forward(), isHealthy(), drain() and metrics() that every caller depends on.',
      tradeoff: 'Two small interfaces may end up implemented by the same class in simple deployments.',
    },
  ],
  decisions: [
    { title: 'Strategy object for the algorithm', decision: 'Selection is delegated to LoadBalancingStrategy.', why: 'Algorithms are the part most likely to vary; isolating them keeps LoadBalancer stable.', alternatives: [{ name: 'Enum + switch in LoadBalancer', when: 'Only ever one or two fixed algorithms, and the extra type is not worth it.' }] },
    { title: 'Health kept beside, not inside, Backend', decision: 'Backend is an immutable record; health is a separate concurrent map in ServerRegistry.', why: 'Immutable identities are safe to share; health flips often and is updated by another thread.', alternatives: [{ name: 'Mutable Backend with a volatile healthy flag', when: 'Very small pools where one object per backend is simpler to reason about.' }] },
    { title: '503 instead of an exception', decision: 'When no backend is healthy, handle() returns a 503 response.', why: 'Load balancers are expected to answer every client; a 503 is the protocol-level signal for “try later”.', alternatives: [{ name: 'Throw NoHealthyBackendException', when: 'The balancer is a library inside a client, and the caller decides how to fail.' }] },
  ],
  choices: [
    {
      id: 'algorithm', title: 'Balancing algorithm', question: 'How should the next backend be chosen?', defaultOption: 'round-robin',
      configKey: 'algorithm', matchConfig: { 'round robin': 'round-robin', 'least connections': 'least-connections', 'weighted': 'weighted' },
      options: [
        { id: 'round-robin', label: 'Round robin', summary: 'Each backend in turn.', changes: ['RoundRobinStrategy'], effect: 'Current design. Fair when backends are identical and requests cost about the same.', code: `public final class RoundRobinStrategy implements LoadBalancingStrategy {
    private final AtomicLong next = new AtomicLong();

    @Override
    public Backend select(List<Backend> healthy, Request request) {
        int index = (int) Math.floorMod(next.getAndIncrement(), (long) healthy.size());
        return healthy.get(index);
    }
}` },
        { id: 'least-connections', label: 'Least connections', summary: 'The backend with the fewest requests in flight.', changes: ['LeastConnectionsStrategy (new)', 'LoadBalancer (reports completion)'], effect: 'Adds a new strategy class, but it needs to know when requests finish. LoadBalancer.handle must call strategy.onComplete(target) in a finally block, so the interface gains a default no-op method. Better when request costs vary widely.', code: `public final class LeastConnectionsStrategy implements LoadBalancingStrategy {
    private final Map<String, AtomicInteger> inFlight = new ConcurrentHashMap<>();

    @Override
    public Backend select(List<Backend> healthy, Request request) {
        Backend best = healthy.stream()
                .min(Comparator.comparingInt(backend -> count(backend).get()))
                .orElseThrow();
        count(best).incrementAndGet();
        return best;
    }

    @Override
    public void onComplete(Backend backend) {   // new default method on the interface
        count(backend).decrementAndGet();
    }

    private AtomicInteger count(Backend backend) {
        return inFlight.computeIfAbsent(backend.id(), id -> new AtomicInteger());
    }
}` },
        { id: 'weighted', label: 'Weighted round robin', summary: 'Bigger backends get proportionally more requests.', changes: ['WeightedRoundRobinStrategy (new)', 'Backend (gains weight)'], effect: 'Backend gains a weight component, so every place that constructs a Backend changes. LoadBalancer itself does not. Useful for mixed instance sizes.', code: `public record Backend(String id, String host, int port, int weight) {}

public final class WeightedRoundRobinStrategy implements LoadBalancingStrategy {
    private final AtomicLong next = new AtomicLong();

    @Override
    public Backend select(List<Backend> healthy, Request request) {
        int total = healthy.stream().mapToInt(Backend::weight).sum();
        long ticket = Math.floorMod(next.getAndIncrement(), (long) total);
        for (Backend backend : healthy) {
            ticket -= backend.weight();
            if (ticket < 0) return backend;
        }
        throw new IllegalStateException("weights changed during selection");
    }
}` },
      ],
    },
  ],
  refactoring: {
    title: 'Replacing an algorithm switch with a strategy', principle: 'ocp',
    problem: 'Every new algorithm edits LoadBalancer, and the class must be retested each time.',
    before: `public final class LoadBalancer {
    private final String algorithm;
    private int position;

    public Response handle(Request request) {
        List<Backend> healthy = registry.healthyBackends();
        Backend target;
        switch (algorithm) {
            case "ROUND_ROBIN" -> target = healthy.get(position++ % healthy.size());
            case "RANDOM" -> target = healthy.get(ThreadLocalRandom.current().nextInt(healthy.size()));
            // every new algorithm is another case here
            default -> throw new IllegalStateException(algorithm);
        }
        return forwarder.forward(target, request);
    }
}`,
    after: `public final class LoadBalancer {
    private final LoadBalancingStrategy strategy;   // injected

    public Response handle(Request request) {
        List<Backend> healthy = registry.healthyBackends();
        if (healthy.isEmpty()) return new Response(503, NO_BACKEND);
        return forwarder.forward(strategy.select(healthy, request), request);
    }
}`,
    explanation: 'The switch moves into separate LoadBalancingStrategy classes. LoadBalancer is now closed for modification: adding an algorithm is a new class plus one line in the wiring. The unsynchronized position counter also becomes an AtomicLong inside the strategy.',
  },
  bindings: [
    { key: 'algorithm', classId: 'strategy', target: 'Which LoadBalancingStrategy is injected', note: 'Descriptive on the canvas: Flowzen’s simulator always round-robins.' },
    { key: 'healthCheck', classId: 'checker', target: 'HealthChecker.start(intervalMillis)', note: 'Descriptive: the simulator has no health checks; every connected compute target is always eligible.' },
    { key: 'concurrency', classId: 'lb', target: 'Threads accepting connections (server runtime, not shown)', note: 'Simulated: how many requests the balancer handles at once.' },
  ],
  simulation: 'Flowzen simulates the load balancer as a processing station (latency, concurrency, queue limit, timeout) that round-robins across directly connected Application Servers, Container Services and Serverless Functions. A balancer with no compute target fails requests as unrouted, like the 503 branch here. Health checks and other algorithms are not simulated.',
};
