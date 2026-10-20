import type { LldModel } from '../types';
import { file } from './util';

const pkg = 'flowzen.messaging';

export const queueModel: LldModel = {
  id: 'message-queue', title: 'Message Queue', kinds: ['queue'], packageName: pkg,
  overview: {
    responsibility: 'Accept work now and hand it to consumers later, redelivering failed messages and moving ones that keep failing to a dead-letter destination.',
    inputs: ['Messages published by producers (e.g. an API that accepts uploads)'],
    outputs: ['Messages delivered to a consumer (Worker)', 'Messages that exhausted their deliveries, sent to the dead-letter sink'],
    collaborators: ['MessageProducer (publishing side)', 'MessageConsumer + MessageHandler (consuming side)', 'DeadLetterSink (where poison messages go)'],
    state: ['Ready messages in FIFO order', 'In-flight messages awaiting ack, with their delivery count'],
    behavior: ['A publish succeeds as soon as the message is stored, so producers do not wait for processing.', 'Delivery is at-least-once: a message is removed only on ack; nack schedules a redelivery until maxDeliveries is reached.'],
  },
  canvasRole: {
    upstream: 'A producer (usually an Application Server) publishes through MessageProducer.send.',
    downstream: 'Its first Worker runs the MessageConsumer loop; a connected Dead-Letter Queue is the DeadLetterSink.',
  },
  classes: [
    { id: 'producer', name: 'MessageProducer', kind: 'class', file: 'MessageProducer.java', layer: 0, responsibility: 'Wraps payloads in messages and publishes them; reports whether the queue accepted the message.', members: ['- publisher: MessagePublisher<T>', '+ send(payload: T): boolean'] },
    { id: 'consumer', name: 'MessageConsumer', kind: 'class', file: 'MessageConsumer.java', layer: 0, responsibility: 'Poll loop: receive, hand to the handler, then ack or nack.', members: ['- source: MessageSource<T>', '- handler: MessageHandler<T>', '+ pollOnce(timeout: Duration): boolean'] },
    { id: 'publisher', name: 'MessagePublisher', kind: 'interface', file: 'MessagePublisher.java', layer: 1, responsibility: 'The producer’s view of a queue: publish only.', members: ['+ publish(message: Message<T>): boolean'] },
    { id: 'source', name: 'MessageSource', kind: 'interface', file: 'MessageSource.java', layer: 1, responsibility: 'The consumer’s view of a queue: receive, ack, nack.', members: ['+ receive(timeout: Duration): Optional<Message<T>>', '+ ack(messageId: UUID): void', '+ nack(messageId: UUID): void'] },
    { id: 'handler', name: 'MessageHandler', kind: 'interface', file: 'MessageHandler.java', layer: 1, responsibility: 'Business processing for one message; throwing means “failed, retry”.', members: ['+ handle(payload: T): void'] },
    { id: 'queue', name: 'MessageQueue', kind: 'interface', file: 'MessageQueue.java', layer: 2, responsibility: 'A full queue combines both roles and exposes its depth.', members: ['+ depth(): int'] },
    { id: 'memory', name: 'InMemoryMessageQueue', kind: 'class', file: 'InMemoryMessageQueue.java', layer: 3, responsibility: 'Bounded FIFO with in-flight tracking, redelivery and dead-lettering.', members: ['- ready: BlockingQueue<Message<T>>', '- inFlight: Map<UUID, Message<T>>', '- maxDeliveries: int', '- deadLetters: DeadLetterSink<T>', '+ publish(message: Message<T>): boolean', '+ receive(timeout: Duration): Optional<Message<T>>', '+ ack(messageId: UUID): void', '+ nack(messageId: UUID): void', '+ depth(): int'] },
    { id: 'dlq', name: 'DeadLetterSink', kind: 'interface', file: 'DeadLetterSink.java', layer: 3, responsibility: 'Receives messages that failed on every allowed delivery.', members: ['+ accept(message: Message<T>): void'] },
    { id: 'message', name: 'Message', kind: 'record', file: 'Message.java', layer: 4, support: true, responsibility: 'Immutable envelope: id, payload and delivery attempt.', members: ['+ id(): UUID', '+ payload(): T', '+ attempt(): int', '+ nextAttempt(): Message<T>'] },
  ],
  relations: [
    { from: 'producer', to: 'publisher', type: 'uses' },
    { from: 'consumer', to: 'source', type: 'uses' },
    { from: 'consumer', to: 'handler', type: 'uses' },
    { from: 'queue', to: 'publisher', type: 'extends' },
    { from: 'queue', to: 'source', type: 'extends' },
    { from: 'memory', to: 'queue', type: 'implements' },
    { from: 'memory', to: 'dlq', type: 'uses' },
    { from: 'producer', to: 'message', type: 'creates' },
    { from: 'memory', to: 'message', type: 'uses' },
  ],
  files: [
    file('Message.java', `
package ${pkg};

import java.util.UUID;

/** Immutable envelope. attempt starts at 1 and grows with each redelivery. */
public record Message<T>(UUID id, T payload, int attempt) {
    public static <T> Message<T> of(T payload) {
        return new Message<>(UUID.randomUUID(), payload, 1);
    }

    public Message<T> nextAttempt() {
        return new Message<>(id, payload, attempt + 1);
    }
}`),
    file('MessagePublisher.java', `
package ${pkg};

/** What producers need: put a message on the queue. Returns false if the queue is full. */
public interface MessagePublisher<T> {
    boolean publish(Message<T> message);
}`),
    file('MessageSource.java', `
package ${pkg};

import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

/** What consumers need: take a message, then confirm or reject it. */
public interface MessageSource<T> {
    Optional<Message<T>> receive(Duration timeout) throws InterruptedException;

    void ack(UUID messageId);

    void nack(UUID messageId);
}`),
    file('MessageQueue.java', `
package ${pkg};

/** A queue plays both roles; clients depend only on the role they need. */
public interface MessageQueue<T> extends MessagePublisher<T>, MessageSource<T> {
    int depth();
}`),
    file('DeadLetterSink.java', `
package ${pkg};

/** Destination for messages that failed on every allowed delivery. */
public interface DeadLetterSink<T> {
    void accept(Message<T> message);
}`),
    file('MessageHandler.java', `
package ${pkg};

/** Processes one payload. Throwing an exception means the delivery failed. */
public interface MessageHandler<T> {
    void handle(T payload) throws Exception;
}`),
    file('InMemoryMessageQueue.java', `
package ${pkg};

import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/** Bounded FIFO with at-least-once delivery, redelivery on nack, and dead-lettering. */
public final class InMemoryMessageQueue<T> implements MessageQueue<T> {
    private final BlockingQueue<Message<T>> ready;
    private final Map<UUID, Message<T>> inFlight = new ConcurrentHashMap<>();
    private final int maxDeliveries;
    private final DeadLetterSink<T> deadLetters;

    public InMemoryMessageQueue(int capacity, int maxDeliveries, DeadLetterSink<T> deadLetters) {
        this.ready = new ArrayBlockingQueue<>(capacity);
        this.maxDeliveries = maxDeliveries;
        this.deadLetters = deadLetters;
    }

    @Override
    public boolean publish(Message<T> message) {
        return ready.offer(message);
    }

    @Override
    public Optional<Message<T>> receive(Duration timeout) throws InterruptedException {
        Message<T> message = ready.poll(timeout.toMillis(), TimeUnit.MILLISECONDS);
        if (message == null) {
            return Optional.empty();
        }
        inFlight.put(message.id(), message);
        return Optional.of(message);
    }

    @Override
    public void ack(UUID messageId) {
        inFlight.remove(messageId);
    }

    @Override
    public void nack(UUID messageId) {
        Message<T> failed = inFlight.remove(messageId);
        if (failed == null) {
            return;
        }
        if (failed.attempt() >= maxDeliveries || !ready.offer(failed.nextAttempt())) {
            deadLetters.accept(failed);
        }
    }

    @Override
    public int depth() {
        return ready.size();
    }
}`),
    file('MessageProducer.java', `
package ${pkg};

/** Publishing side. Depends only on MessagePublisher, so it cannot ack or drain the queue. */
public final class MessageProducer<T> {
    private final MessagePublisher<T> publisher;

    public MessageProducer(MessagePublisher<T> publisher) {
        this.publisher = publisher;
    }

    /** True once the message is stored; processing happens later. */
    public boolean send(T payload) {
        return publisher.publish(Message.of(payload));
    }
}`),
    file('MessageConsumer.java', `
package ${pkg};

import java.time.Duration;
import java.util.Optional;

/** Consuming side: receive → handle → ack, or nack so the queue can redeliver. */
public final class MessageConsumer<T> {
    private final MessageSource<T> source;
    private final MessageHandler<T> handler;

    public MessageConsumer(MessageSource<T> source, MessageHandler<T> handler) {
        this.source = source;
        this.handler = handler;
    }

    /** Processes at most one message. Returns false if none arrived within the timeout. */
    public boolean pollOnce(Duration timeout) throws InterruptedException {
        Optional<Message<T>> received = source.receive(timeout);
        if (received.isEmpty()) {
            return false;
        }
        Message<T> message = received.get();
        try {
            handler.handle(message.payload());
            source.ack(message.id());
        } catch (Exception failure) {
            source.nack(message.id());
        }
        return true;
    }
}`),
  ],
  principles: [
    {
      principle: 'isp',
      meaning: 'Producers and consumers depend on separate role interfaces instead of one broad queue interface.',
      classes: ['publisher', 'source', 'queue', 'producer', 'consumer'],
      evidence: 'MessageProducer holds a MessagePublisher; MessageConsumer holds a MessageSource; MessageQueue extends both for implementations.',
      benefit: 'A producer cannot accidentally ack or drain messages, and a test for the producer only fakes one method.',
      violation: 'A single MessageBroker interface with publish, receive, ack, nack, purge and createTopic that every client depends on (see the refactoring example).',
      tradeoff: 'More interfaces to name and document; implementations must implement all of them anyway.',
    },
    {
      principle: 'coupling-cohesion',
      meaning: 'Producers and consumers never reference each other; the queue is the only thing they share, in space and time.',
      classes: ['producer', 'consumer', 'memory'],
      evidence: 'MessageProducer and MessageConsumer have no fields or imports of each other; InMemoryMessageQueue keeps all delivery bookkeeping (ready, inFlight, redelivery) together.',
      benefit: 'Producers stay fast and available when consumers are slow or down; each side scales independently.',
      violation: 'An upload API that calls the image processor directly and waits for it (the starting point of the Async Processing challenge).',
      tradeoff: 'The system becomes eventually consistent: success means “accepted”, and failures surface later (in the dead-letter sink) instead of to the caller.',
    },
    {
      principle: 'dip',
      meaning: 'The consumer loop depends on the MessageHandler abstraction; business processing plugs into it.',
      classes: ['consumer', 'handler'],
      evidence: 'MessageConsumer.pollOnce calls handler.handle(payload) without knowing what the work is.',
      benefit: 'The same polling, ack and nack logic serves every job type.',
      violation: 'A consumer loop with image resizing code written directly inside pollOnce.',
      tradeoff: 'Handlers signal failure only by throwing, so “retry” and “do not retry” failures need extra conventions (for example a non-retryable exception type).',
    },
    {
      principle: 'encapsulation',
      meaning: 'Delivery counting, redelivery and dead-lettering are hidden inside InMemoryMessageQueue.nack.',
      classes: ['memory', 'message'],
      evidence: 'Callers only call nack(id); InMemoryMessageQueue decides between requeueing message.nextAttempt() and deadLetters.accept.',
      benefit: 'The retry policy is consistent for every consumer and cannot be bypassed.',
      violation: 'Consumers incrementing attempt counters themselves and deciding when to dead-letter.',
      tradeoff: 'Consumers cannot choose per-message retry behavior without a richer API.',
    },
  ],
  decisions: [
    { title: 'At-least-once delivery', decision: 'A message is removed only after ack; failures are redelivered.', why: 'Losing work is worse than repeating it, as long as handlers are idempotent.', alternatives: [{ name: 'At-most-once (ack on receive)', when: 'Duplicates are harmful and occasional loss is acceptable, e.g. metrics samples.' }] },
    { title: 'Bounded queue', decision: 'publish returns false when the queue is full.', why: 'Back-pressure reaches producers instead of exhausting memory.', alternatives: [{ name: 'Unbounded or disk-backed queue', when: 'Bursts are large but finite and storage is cheap (most hosted brokers).' }] },
    { title: 'Immediate requeue', decision: 'A nacked message goes straight back to the ready queue.', why: 'Simplest possible redelivery.', alternatives: [{ name: 'Delayed redelivery with backoff', when: 'Failures come from a dependency outage; immediate retries would just fail again (see Flowzen’s Redelivery delay).' }] },
  ],
  choices: [
    {
      id: 'delivery', title: 'Delivery guarantee', question: 'When is a message considered done?', defaultOption: 'at-least-once',
      options: [
        { id: 'at-least-once', label: 'At-least-once', summary: 'Ack after processing.', changes: ['MessageConsumer'], effect: 'Current design. A crash between handle and ack causes a redelivery, so handlers must be idempotent.', code: `public final class MessageConsumer<T> {
    public boolean pollOnce(Duration timeout) throws InterruptedException {
        // ...
        try {
            handler.handle(message.payload());
            source.ack(message.id());
        } catch (Exception failure) {
            source.nack(message.id());
        }
        return true;
    }
}` },
        { id: 'at-most-once', label: 'At-most-once', summary: 'Ack before processing.', changes: ['MessageConsumer'], effect: 'Only the consumer changes. Nothing is ever processed twice, but a failure or crash during handle loses the message, and nack and the dead-letter sink become unused.', code: `Message<T> message = received.get();
source.ack(message.id());          // done before the work
try {
    handler.handle(message.payload());
} catch (Exception failure) {
    log.warn("dropped message {}", message.id(), failure);
}` },
        { id: 'idempotent', label: 'Effectively once', summary: 'At-least-once plus deduplication.', changes: ['IdempotentHandler (new decorator)', 'MessageConsumer (passes the whole envelope)'], effect: 'Deduplication needs the message id, so the consumer hands the whole Message to an IdempotentHandler that wraps the business handler and skips ids already processed. The processed-id store must be durable and shared by all consumers. Flowzen cannot verify this: the simulator has no duplicate-delivery model.', code: `public final class IdempotentHandler<T> implements MessageHandler<Message<T>> {
    private final MessageHandler<T> delegate;
    private final ProcessedIds processed;   // e.g. a unique-key table

    @Override
    public void handle(Message<T> message) throws Exception {
        if (processed.contains(message.id())) return;
        delegate.handle(message.payload());
        processed.add(message.id());
    }
}` },
      ],
    },
  ],
  refactoring: {
    title: 'Splitting a fat broker interface', principle: 'isp',
    problem: 'Every producer depended on consumer and admin operations it never used, so changes to ack semantics forced producers to recompile and re-test.',
    before: `public interface MessageBroker<T> {
    boolean publish(Message<T> message);
    Optional<Message<T>> receive(Duration timeout) throws InterruptedException;
    void ack(UUID messageId);
    void nack(UUID messageId);
    void purge();
    void createTopic(String name);
}

public final class MessageProducer<T> {
    private final MessageBroker<T> broker;   // can purge the queue by mistake
}`,
    after: `public interface MessagePublisher<T> { boolean publish(Message<T> message); }
public interface MessageSource<T> { /* receive, ack, nack */ }
public interface MessageQueue<T> extends MessagePublisher<T>, MessageSource<T> { int depth(); }

public final class MessageProducer<T> {
    private final MessagePublisher<T> publisher;   // publish only
}`,
    explanation: 'Clients now depend on role interfaces. The implementation still implements everything through MessageQueue.',
  },
  bindings: [
    { key: 'maxDeliveries', classId: 'memory', target: 'maxDeliveries in InMemoryMessageQueue.nack', note: 'Simulated: failed jobs are redelivered until this many attempts, then dead-lettered.' },
    { key: 'redeliveryDelayMs', classId: 'memory', target: 'Delay before a nacked message is ready again', note: 'Simulated. This example requeues immediately; see the “Immediate requeue” decision.' },
    { key: 'queueLimit', classId: 'memory', target: 'capacity of the ready BlockingQueue', note: 'Simulated: publishes beyond the backlog limit are rejected.' },
    { key: 'processingLatencyMs', classId: 'memory', target: 'Time for publish to store the message', note: 'Simulated as the enqueue latency the producer waits for.' },
  ],
  simulation: 'Flowzen simulates the queue as a station where the request completes once enqueued, then dispatches one job to its first Worker. Failed jobs are redelivered after the redelivery delay up to Max deliveries and then go to a connected Dead-Letter Queue, matching the nack path here. The example’s immediate requeue and the dedup option are illustrative.',
};
