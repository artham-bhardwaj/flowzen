import type { LldModel } from '../types';
import { file } from './util';

const pkg = 'flowzen.resilience';

export const circuitBreakerModel: LldModel = {
  id: 'circuit-breaker', title: 'Circuit Breaker', kinds: ['circuitBreaker'], packageName: pkg,
  overview: {
    responsibility: 'Stop calling a dependency that is failing, fail fast (or use a fallback) while it recovers, then let traffic back in carefully.',
    inputs: ['Calls to a remote dependency (here, a payment provider)'],
    outputs: ['The dependency’s result while the circuit is closed', 'An immediate fallback while it is open'],
    collaborators: ['ResilientPaymentService (the caller)', 'OutcomeWindow (recent results)', 'FailurePolicy (which errors count)', 'An injected millisecond clock'],
    state: ['CircuitState: CLOSED, OPEN or HALF_OPEN', 'When the circuit opened', 'Recent outcomes inside the rolling window', 'Whether a half-open trial call is in flight'],
    behavior: ['CLOSED → OPEN when, with at least minimumRequests in the window, the failure rate reaches the threshold.', 'OPEN → HALF_OPEN after openMillis; one trial call is allowed.', 'HALF_OPEN → CLOSED if the trial succeeds, back to OPEN if it fails.'],
  },
  canvasRole: {
    upstream: 'The calling service routes its dependency calls through CircuitBreaker.call.',
    downstream: 'The first connection is the protected dependency (PaymentClient here); while open, it receives no traffic.',
  },
  classes: [
    { id: 'service', name: 'ResilientPaymentService', kind: 'class', file: 'ResilientPaymentService.java', layer: 0, responsibility: 'Wraps payment calls in the breaker and supplies the fallback.', members: ['- client: PaymentClient', '- breaker: CircuitBreaker', '+ charge(orderId: String, amountCents: long): PaymentResult'] },
    { id: 'breaker', name: 'CircuitBreaker', kind: 'class', file: 'CircuitBreaker.java', layer: 1, responsibility: 'State machine deciding whether a call may proceed, and recording its outcome.', members: ['- state: CircuitState', '- openedAt: long', '- trialInFlight: boolean', '- window: OutcomeWindow', '- policy: FailurePolicy', '+ call(action: Supplier<T>, fallback: Supplier<T>): T', '+ state(): CircuitState', '- tryAcquirePermission(): boolean', '- onSuccess(): void', '- onFailure(): void', '- transitionTo(next: CircuitState, now: long): void'] },
    { id: 'client', name: 'PaymentClient', kind: 'interface', file: 'PaymentClient.java', layer: 1, responsibility: 'The remote dependency being protected.', members: ['+ charge(orderId: String, amountCents: long): PaymentResult'] },
    { id: 'window', name: 'OutcomeWindow', kind: 'class', file: 'OutcomeWindow.java', layer: 2, responsibility: 'Time-based rolling window of successes and failures.', members: ['- outcomes: Deque<Outcome>', '- failures: int', '+ record(nowMillis: long, failed: boolean): void', '+ count(nowMillis: long): int', '+ failureRatePct(nowMillis: long): double', '+ reset(): void'] },
    { id: 'policy', name: 'FailurePolicy', kind: 'interface', file: 'FailurePolicy.java', layer: 2, responsibility: 'Decides whether an exception says something about the dependency’s health.', members: ['+ isFailure(error: RuntimeException): boolean'] },
    { id: 'state', name: 'CircuitState', kind: 'enum', file: 'CircuitState.java', layer: 2, responsibility: 'The three breaker states.', members: ['+ CLOSED', '+ OPEN', '+ HALF_OPEN'] },
    { id: 'config', name: 'CircuitBreakerConfig', kind: 'record', file: 'CircuitBreakerConfig.java', layer: 3, responsibility: 'Thresholds and timings.', members: ['+ failureThresholdPct(): double', '+ minimumRequests(): int', '+ windowMillis(): long', '+ openMillis(): long'] },
    { id: 'default', name: 'DependencyFailurePolicy', kind: 'class', file: 'DependencyFailurePolicy.java', layer: 3, responsibility: 'Counts every error except the caller’s own mistakes (invalid arguments).', members: ['+ isFailure(error: RuntimeException): boolean'] },
    { id: 'result', name: 'PaymentResult', kind: 'record', file: 'PaymentResult.java', layer: 3, support: true, responsibility: 'Outcome of a charge, including “deferred” for the fallback.', members: ['+ status(): String', '+ deferred(orderId: String): PaymentResult'] },
  ],
  relations: [
    { from: 'service', to: 'breaker', type: 'uses' },
    { from: 'service', to: 'client', type: 'uses', label: 'inside call()' },
    { from: 'breaker', to: 'window', type: 'composes' },
    { from: 'breaker', to: 'policy', type: 'uses' },
    { from: 'breaker', to: 'state', type: 'uses' },
    { from: 'breaker', to: 'config', type: 'uses' },
    { from: 'default', to: 'policy', type: 'implements' },
    { from: 'service', to: 'result', type: 'creates', label: 'fallback' },
  ],
  files: [
    file('CircuitState.java', `
package ${pkg};

public enum CircuitState {
    CLOSED,
    OPEN,
    HALF_OPEN
}`),
    file('CircuitBreakerConfig.java', `
package ${pkg};

public record CircuitBreakerConfig(double failureThresholdPct, int minimumRequests, long windowMillis, long openMillis) {}`),
    file('FailurePolicy.java', `
package ${pkg};

/** Classifies errors: only dependency failures should open the circuit. */
public interface FailurePolicy {
    boolean isFailure(RuntimeException error);
}`),
    file('DependencyFailurePolicy.java', `
package ${pkg};

/** Invalid input is the caller's fault and says nothing about the dependency's health. */
public final class DependencyFailurePolicy implements FailurePolicy {
    @Override
    public boolean isFailure(RuntimeException error) {
        return !(error instanceof IllegalArgumentException);
    }
}`),
    file('OutcomeWindow.java', `
package ${pkg};

import java.util.ArrayDeque;
import java.util.Deque;

/** Outcomes from the last windowMillis. Not thread-safe: CircuitBreaker serializes access. */
public final class OutcomeWindow {
    private record Outcome(long atMillis, boolean failed) {}

    private final Deque<Outcome> outcomes = new ArrayDeque<>();
    private final long windowMillis;
    private int failures;

    public OutcomeWindow(long windowMillis) {
        this.windowMillis = windowMillis;
    }

    public void record(long nowMillis, boolean failed) {
        evict(nowMillis);
        outcomes.addLast(new Outcome(nowMillis, failed));
        if (failed) {
            failures++;
        }
    }

    public int count(long nowMillis) {
        evict(nowMillis);
        return outcomes.size();
    }

    public double failureRatePct(long nowMillis) {
        evict(nowMillis);
        return outcomes.isEmpty() ? 0.0 : 100.0 * failures / outcomes.size();
    }

    public void reset() {
        outcomes.clear();
        failures = 0;
    }

    private void evict(long nowMillis) {
        while (!outcomes.isEmpty() && outcomes.peekFirst().atMillis() <= nowMillis - windowMillis) {
            if (outcomes.removeFirst().failed()) {
                failures--;
            }
        }
    }
}`),
    file('CircuitBreaker.java', `
package ${pkg};

import java.util.function.LongSupplier;
import java.util.function.Supplier;

/** CLOSED → OPEN on too many failures, OPEN → HALF_OPEN after a pause, one trial decides the rest. */
public final class CircuitBreaker {
    private final CircuitBreakerConfig config;
    private final FailurePolicy policy;
    private final LongSupplier clockMillis;
    private final OutcomeWindow window;
    private CircuitState state = CircuitState.CLOSED;
    private long openedAt;
    private boolean trialInFlight;

    public CircuitBreaker(CircuitBreakerConfig config, FailurePolicy policy, LongSupplier clockMillis) {
        this.config = config;
        this.policy = policy;
        this.clockMillis = clockMillis;
        this.window = new OutcomeWindow(config.windowMillis());
    }

    public <T> T call(Supplier<T> action, Supplier<T> fallback) {
        if (!tryAcquirePermission()) {
            return fallback.get();
        }
        try {
            T result = action.get();
            onSuccess();
            return result;
        } catch (RuntimeException error) {
            if (policy.isFailure(error)) {
                onFailure();
            } else {
                onSuccess();   // the dependency answered; the request itself was bad
            }
            throw error;
        }
    }

    public synchronized CircuitState state() {
        return state;
    }

    private synchronized boolean tryAcquirePermission() {
        long now = clockMillis.getAsLong();
        if (state == CircuitState.OPEN && now - openedAt >= config.openMillis()) {
            transitionTo(CircuitState.HALF_OPEN, now);
        }
        return switch (state) {
            case CLOSED -> true;
            case OPEN -> false;
            case HALF_OPEN -> {
                if (trialInFlight) {
                    yield false;
                }
                trialInFlight = true;
                yield true;
            }
        };
    }

    private synchronized void onSuccess() {
        long now = clockMillis.getAsLong();
        if (state == CircuitState.HALF_OPEN) {
            transitionTo(CircuitState.CLOSED, now);
        } else if (state == CircuitState.CLOSED) {
            window.record(now, false);
        }
    }

    private synchronized void onFailure() {
        long now = clockMillis.getAsLong();
        if (state == CircuitState.HALF_OPEN) {
            transitionTo(CircuitState.OPEN, now);
            return;
        }
        if (state == CircuitState.OPEN) {
            return;
        }
        window.record(now, true);
        if (window.count(now) >= config.minimumRequests()
                && window.failureRatePct(now) >= config.failureThresholdPct()) {
            transitionTo(CircuitState.OPEN, now);
        }
    }

    private void transitionTo(CircuitState next, long now) {
        state = next;
        trialInFlight = false;
        if (next == CircuitState.OPEN) {
            openedAt = now;
        }
        if (next == CircuitState.CLOSED) {
            window.reset();
        }
    }
}`),
    file('PaymentClient.java', `
package ${pkg};

/** Remote payment provider. Throws on timeouts and 5xx responses. */
public interface PaymentClient {
    PaymentResult charge(String orderId, long amountCents);
}`),
    file('PaymentResult.java', `
package ${pkg};

public record PaymentResult(String orderId, String status) {
    public static PaymentResult deferred(String orderId) {
        return new PaymentResult(orderId, "DEFERRED");
    }
}`),
    file('ResilientPaymentService.java', `
package ${pkg};

/** Adds fail-fast behavior to any PaymentClient by composition, not by subclassing. */
public final class ResilientPaymentService {
    private final PaymentClient client;
    private final CircuitBreaker breaker;

    public ResilientPaymentService(PaymentClient client, CircuitBreaker breaker) {
        this.client = client;
        this.breaker = breaker;
    }

    /** While the provider is failing, the order is accepted as DEFERRED and charged later. */
    public PaymentResult charge(String orderId, long amountCents) {
        return breaker.call(
                () -> client.charge(orderId, amountCents),
                () -> PaymentResult.deferred(orderId));
    }
}`),
  ],
  principles: [
    {
      principle: 'encapsulation',
      meaning: 'The state machine’s fields can only change through private transitions; outsiders can read the state but never set it.',
      classes: ['breaker'],
      evidence: 'CircuitBreaker keeps state, openedAt and trialInFlight private; every change goes through transitionTo, called from synchronized methods; state() is read-only.',
      benefit: 'Illegal transitions (for example OPEN → CLOSED without a successful trial) are impossible, even under concurrency.',
      violation: 'A public setState(CircuitState) used by callers to “force close” the circuit, bypassing the window and the trial call.',
      tradeoff: 'Operators who need a manual override must get an explicit, audited method rather than direct access.',
    },
    {
      principle: 'srp',
      meaning: 'Counting outcomes, classifying errors and deciding transitions are three different jobs.',
      classes: ['window', 'policy', 'breaker'],
      evidence: 'OutcomeWindow.failureRatePct only does arithmetic over the window; FailurePolicy.isFailure only classifies; CircuitBreaker only owns the transitions.',
      benefit: 'Switching to a count-based window or changing which errors count does not touch the state machine.',
      violation: 'CircuitBreaker holding a raw list of timestamps and an instanceof chain inside onFailure.',
      tradeoff: 'The window is not thread-safe on its own; it relies on CircuitBreaker’s locking, a coupling that is documented rather than enforced.',
    },
    {
      principle: 'composition',
      meaning: 'Resilience is added by wrapping calls (breaker.call(...)) instead of subclassing the payment client.',
      classes: ['service', 'breaker', 'client'],
      evidence: 'ResilientPaymentService holds a PaymentClient and a CircuitBreaker and combines them in charge().',
      benefit: 'Any client, and any call, can be protected; one breaker type serves every dependency.',
      violation: 'CircuitBreakingPaymentClient extends HttpPaymentClient, overriding each method with copied breaker logic (see the refactoring example).',
      tradeoff: 'Each call site must remember to go through the breaker; a missed call is unprotected.',
    },
  ],
  decisions: [
    { title: 'Time-based window', decision: 'Failure rate is computed over the last windowMillis.', why: 'Matches how outages look in time and matches Flowzen’s rolling window.', alternatives: [{ name: 'Count-based window (last N calls)', when: 'Traffic is very uneven, and you want decisions based on a fixed sample size.' }] },
    { title: 'Fallback instead of an exception', decision: 'When open, call() returns the fallback (a DEFERRED payment).', why: 'Turns an outage into accepted-but-delayed work, like the Reliable Checkout challenge requires.', alternatives: [{ name: 'Throw CallNotPermittedException', when: 'There is no sensible degraded answer, and the caller must fail fast.' }] },
  ],
  choices: [
    {
      id: 'recovery', title: 'Recovery after the open period', question: 'How does the circuit close again?', defaultOption: 'half-open',
      configKey: 'halfOpen', matchConfig: { 'closes after open period': 'timed-close' },
      options: [
        { id: 'half-open', label: 'Half-open trial', summary: 'One trial call decides.', changes: ['CircuitBreaker'], effect: 'Current code. If the dependency is still down, only one call fails before the circuit reopens.', code: `public final class CircuitBreaker {
    private synchronized boolean tryAcquirePermission() {
        // OPEN -> HALF_OPEN after openMillis; exactly one trial call allowed
        return switch (state) {
            case CLOSED -> true;
            case OPEN -> false;
            case HALF_OPEN -> { if (trialInFlight) yield false; trialInFlight = true; yield true; }
        };
    }
}` },
        { id: 'timed-close', label: 'Close after the open period', summary: 'Fully close once openMillis passes.', changes: ['CircuitBreaker (HALF_OPEN removed)'], effect: 'This is what Flowzen simulates. Simpler, but if the dependency is still down, a full wave of traffic fails before the window trips the circuit again.', code: `private synchronized boolean tryAcquirePermission() {
    long now = clockMillis.getAsLong();
    if (state == CircuitState.OPEN && now - openedAt >= config.openMillis()) {
        transitionTo(CircuitState.CLOSED, now);   // no trial: all traffic resumes at once
    }
    return state == CircuitState.CLOSED;
}` },
      ],
    },
  ],
  refactoring: {
    title: 'From a subclass per client to a wrapper', principle: 'composition',
    problem: 'Each protected client needed its own subclass with copied breaker bookkeeping, and the logic drifted between copies.',
    before: `public class CircuitBreakingPaymentClient extends HttpPaymentClient {
    private int failures;
    private long openedAt;

    @Override
    public PaymentResult charge(String orderId, long amountCents) {
        if (failures > 5 && System.currentTimeMillis() - openedAt < 30_000) {
            throw new IllegalStateException("circuit open");
        }
        try { PaymentResult result = super.charge(orderId, amountCents); failures = 0; return result; }
        catch (RuntimeException error) { failures++; openedAt = System.currentTimeMillis(); throw error; }
    }
    // refund(), capture() ... each repeats the same logic
}`,
    after: `PaymentResult result = breaker.call(
        () -> client.charge(orderId, amountCents),
        () -> PaymentResult.deferred(orderId));`,
    explanation: 'One CircuitBreaker class handles the state machine for any call. Clients stay plain, and refund or capture are protected by wrapping them the same way.',
  },
  bindings: [
    { key: 'failureThresholdPct', classId: 'config', target: 'CircuitBreakerConfig.failureThresholdPct', note: 'Simulated.' },
    { key: 'minimumRequests', classId: 'config', target: 'CircuitBreakerConfig.minimumRequests', note: 'Simulated.' },
    { key: 'windowMs', classId: 'window', target: 'OutcomeWindow windowMillis', note: 'Simulated rolling window.' },
    { key: 'openMs', classId: 'config', target: 'CircuitBreakerConfig.openMillis', note: 'Simulated open period.' },
    { key: 'halfOpen', classId: 'breaker', target: 'HALF_OPEN handling in tryAcquirePermission', note: 'Not simulated: Flowzen closes the circuit fully after the open period (the “Close after the open period” option).' },
  ],
  simulation: 'Flowzen simulates the breaker’s rolling-window failure rate, minimum requests and open period: while open, requests fail immediately as “circuit-open”. It does not simulate half-open trial calls (the circuit closes fully after the open period) or fallbacks; a failed-fast request counts as an error.',
};
