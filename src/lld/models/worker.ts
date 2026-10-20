import type { LldModel } from '../types';
import { file } from './util';

const pkg = 'flowzen.worker';

export const workerModel: LldModel = {
  id: 'worker', title: 'Worker', kinds: ['worker'], packageName: pkg,
  overview: {
    responsibility: 'Run background jobs taken from a queue with a fixed number of concurrent slots, and report each job’s success or failure back to the queue.',
    inputs: ['Jobs delivered by a Message Queue or Event Stream'],
    outputs: ['Ack (done) or nack (failed, redeliver) to the source', 'Calls made by the job handler to its downstream, e.g. object storage or a payment provider'],
    collaborators: ['JobSource (where jobs come from and where results are reported)', 'JobHandler registry (one handler per job type)', 'Handler dependencies such as ImageStore'],
    state: ['A fixed set of worker threads', 'No job state of its own: progress lives in the queue (ack / nack)'],
    behavior: ['Each thread loops: take a job, dispatch it to the handler for its type, ack on success, nack on failure.', 'An unknown job type is nacked, so it eventually reaches the dead-letter queue instead of being silently dropped.'],
  },
  canvasRole: {
    upstream: 'A Message Queue or Event Stream is the JobSource that feeds WorkerPool.',
    downstream: 'Its first connection is what the handler calls after processing, such as the ImageStore (object storage) or a payment provider.',
  },
  classes: [
    { id: 'pool', name: 'WorkerPool', kind: 'class', file: 'WorkerPool.java', layer: 0, responsibility: 'Lifecycle and concurrency: starts N threads that each run the poll → dispatch → report loop.', members: ['- source: JobSource', '- handlers: Map<String, JobHandler>', '- threads: ExecutorService', '+ start(concurrency: int): void', '~ processNext(): void', '+ stop(): void'] },
    { id: 'source', name: 'JobSource', kind: 'interface', file: 'JobSource.java', layer: 1, responsibility: 'Takes jobs and receives their outcome (the queue’s consumer API).', members: ['+ take(): Job', '+ complete(jobId: String): void', '+ fail(jobId: String, cause: Exception): void'] },
    { id: 'handler', name: 'JobHandler', kind: 'interface', file: 'JobHandler.java', layer: 1, responsibility: 'Processes one kind of job; throws on failure.', members: ['+ type(): String', '+ handle(job: Job): void'] },
    { id: 'resize', name: 'ResizeImageHandler', kind: 'class', file: 'ResizeImageHandler.java', layer: 2, responsibility: 'Downloads an image, resizes it and stores the thumbnail.', members: ['- store: ImageStore', '- resizer: ImageResizer', '+ type(): String', '+ handle(job: Job): void'] },
    { id: 'store', name: 'ImageStore', kind: 'interface', file: 'ImageStore.java', layer: 3, responsibility: 'Reads and writes image bytes (object storage on the canvas).', members: ['+ read(key: String): byte[]', '+ write(key: String, bytes: byte[]): void'] },
    { id: 'resizer', name: 'ImageResizer', kind: 'interface', file: 'ImageResizer.java', layer: 3, responsibility: 'Pure image transformation.', members: ['+ resize(image: byte[], maxWidth: int): byte[]'] },
    { id: 'job', name: 'Job', kind: 'record', file: 'Job.java', layer: 3, support: true, responsibility: 'A unit of background work: id, type and parameters.', members: ['+ id(): String', '+ type(): String', '+ params(): Map<String, String>'] },
  ],
  relations: [
    { from: 'pool', to: 'source', type: 'uses' },
    { from: 'pool', to: 'handler', type: 'uses', label: 'by type' },
    { from: 'resize', to: 'handler', type: 'implements' },
    { from: 'resize', to: 'store', type: 'uses' },
    { from: 'resize', to: 'resizer', type: 'uses' },
    { from: 'pool', to: 'job', type: 'uses' },
  ],
  files: [
    file('WorkerPool.java', `
package ${pkg};

import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Runs "concurrency" threads, each taking one job at a time and dispatching it by type. */
public final class WorkerPool {
    private final JobSource source;
    private final Map<String, JobHandler> handlers;
    private ExecutorService threads;

    public WorkerPool(JobSource source, List<JobHandler> handlers) {
        this.source = source;
        this.handlers = handlers.stream().collect(Collectors.toUnmodifiableMap(JobHandler::type, Function.identity()));
    }

    public void start(int concurrency) {
        threads = Executors.newFixedThreadPool(concurrency);
        for (int slot = 0; slot < concurrency; slot++) {
            threads.submit(() -> {
                while (!Thread.currentThread().isInterrupted()) {
                    processNext();
                }
            });
        }
    }

    void processNext() {
        Job job;
        try {
            job = source.take();
        } catch (InterruptedException stopping) {
            Thread.currentThread().interrupt();
            return;
        }
        JobHandler handler = handlers.get(job.type());
        try {
            if (handler == null) {
                throw new IllegalArgumentException("No handler for job type " + job.type());
            }
            handler.handle(job);
            source.complete(job.id());
        } catch (Exception failure) {
            source.fail(job.id(), failure);   // the queue decides: redeliver or dead-letter
        }
    }

    public void stop() {
        threads.shutdownNow();
    }
}`),
    file('JobSource.java', `
package ${pkg};

/** The worker's view of its queue. */
public interface JobSource {
    Job take() throws InterruptedException;

    void complete(String jobId);

    void fail(String jobId, Exception cause);
}`),
    file('JobHandler.java', `
package ${pkg};

/** Business logic for one job type. Throwing marks the attempt as failed. */
public interface JobHandler {
    String type();

    void handle(Job job) throws Exception;
}`),
    file('ResizeImageHandler.java', `
package ${pkg};

/** Creates a thumbnail for an uploaded image. */
public final class ResizeImageHandler implements JobHandler {
    private static final int THUMBNAIL_WIDTH = 320;
    private final ImageStore store;
    private final ImageResizer resizer;

    public ResizeImageHandler(ImageStore store, ImageResizer resizer) {
        this.store = store;
        this.resizer = resizer;
    }

    @Override
    public String type() {
        return "resize-image";
    }

    @Override
    public void handle(Job job) {
        String key = job.params().get("imageKey");
        byte[] original = store.read(key);
        store.write(key + ".thumb", resizer.resize(original, THUMBNAIL_WIDTH));
    }
}`),
    file('ImageStore.java', `
package ${pkg};

/** Image bytes by key (e.g. object storage). */
public interface ImageStore {
    byte[] read(String key);

    void write(String key, byte[] bytes);
}`),
    file('ImageResizer.java', `
package ${pkg};

public interface ImageResizer {
    byte[] resize(byte[] image, int maxWidth);
}`),
    file('Job.java', `
package ${pkg};

import java.util.Map;

public record Job(String id, String type, Map<String, String> params) {}`),
  ],
  principles: [
    {
      principle: 'srp',
      meaning: 'WorkerPool handles threads and the take / dispatch / report loop; handlers contain only business work.',
      classes: ['pool', 'resize'],
      evidence: 'WorkerPool.processNext never inspects job parameters; ResizeImageHandler.handle has no threading, acking or retry code.',
      benefit: 'Concurrency and failure reporting are written once and reused by every job type.',
      violation: 'A ResizeWorker class that owns its threads, sleeps between retries and resizes images in the same method (see the refactoring example).',
      tradeoff: 'Per-job-type tuning (a separate pool size for slow jobs) needs another WorkerPool instance.',
    },
    {
      principle: 'polymorphism',
      meaning: 'One call site, handler.handle(job), runs whichever JobHandler matches the job’s type at runtime.',
      classes: ['pool', 'handler', 'resize'],
      evidence: 'WorkerPool builds Map<String, JobHandler> from each handler’s type() and dispatches through the interface.',
      benefit: 'New job types are new classes registered at startup; the pool never changes.',
      violation: 'A switch on job.type() inside WorkerPool with resizing, email and billing code in its branches.',
      tradeoff: 'Type strings are matched at runtime, so a typo produces a failed job (nacked toward the dead-letter queue) instead of a compile error.',
    },
    {
      principle: 'dependency-injection',
      meaning: 'Handlers receive their collaborators (ImageStore, ImageResizer), and the pool receives its JobSource and handler list.',
      classes: ['resize', 'store', 'resizer', 'pool'],
      evidence: 'ResizeImageHandler(store, resizer) and WorkerPool(source, handlers) construct none of their dependencies.',
      benefit: 'A handler can be tested with an in-memory ImageStore and run against a fake JobSource.',
      violation: 'ResizeImageHandler creating an S3 client in handle() on every job.',
      tradeoff: 'Wiring code (or a container) must build the handler list correctly.',
    },
  ],
  decisions: [
    { title: 'Retries belong to the queue', decision: 'The worker reports failure; the queue decides whether to redeliver or dead-letter.', why: 'Retry state survives worker crashes and is consistent across all workers.', alternatives: [{ name: 'In-process retry with backoff', when: 'Failures are very short blips and redelivery overhead is high.' }] },
    { title: 'Fixed thread count', decision: 'Concurrency is set once at start.', why: 'Predictable load on downstream dependencies such as storage or payment APIs.', alternatives: [{ name: 'Autoscaling consumers on queue depth', when: 'Load varies widely and downstream systems can absorb bursts.' }] },
  ],
  choices: [
    {
      id: 'failure', title: 'Failure handling', question: 'What should a worker do when a job fails?', defaultOption: 'report',
      configKey: 'retry', matchConfig: { 'from queue': 'report' },
      options: [
        { id: 'report', label: 'Report to the queue', summary: 'Nack and let the queue redeliver.', changes: ['WorkerPool'], effect: 'Current design, and what Flowzen simulates: the source queue’s Max deliveries and Redelivery delay govern retries.', code: `try {
    handler.handle(job);
    source.complete(job.id());
} catch (Exception failure) {
    source.fail(job.id(), failure);   // the queue decides: redeliver or dead-letter
}` },
        { id: 'local', label: 'Retry locally with backoff', summary: 'Retry inside the worker before reporting.', changes: ['RetryingHandler (new decorator)'], effect: 'A decorator wraps any JobHandler, so WorkerPool and the handlers stay unchanged. A slot stays busy during backoff, which lowers throughput exactly when a dependency is struggling.', code: `public final class RetryingHandler implements JobHandler {
    private final JobHandler delegate;
    private final int attempts;

    @Override public String type() { return delegate.type(); }

    @Override
    public void handle(Job job) throws Exception {
        for (int attempt = 1; ; attempt++) {
            try { delegate.handle(job); return; }
            catch (Exception failure) {
                if (attempt == attempts) throw failure;
                Thread.sleep(100L << attempt);   // exponential backoff
            }
        }
    }
}` },
      ],
    },
  ],
  refactoring: {
    title: 'Separating the loop from the work', principle: 'srp',
    problem: 'Threading, retries and image processing were in one class, so adding a second job type meant copying the loop.',
    before: `public final class ResizeWorker implements Runnable {
    public void run() {
        while (true) {
            Job job = queue.take();
            for (int attempt = 1; attempt <= 3; attempt++) {
                try {
                    byte[] image = s3.getObject(job.params().get("imageKey"));
                    s3.putObject(job.params().get("imageKey") + ".thumb", Thumbnails.of(image).width(320).asBytes());
                    queue.ack(job.id());
                    break;
                } catch (Exception failure) {
                    Thread.sleep(1000);
                }
            }
        }
    }
}`,
    after: `WorkerPool pool = new WorkerPool(jobSource, List.of(
        new ResizeImageHandler(imageStore, resizer),
        new SendEmailHandler(mailer)));
pool.start(30);`,
    explanation: 'The loop, dispatch and failure reporting live in WorkerPool; each job type is a small JobHandler. Retries move to the queue, where they survive crashes.',
  },
  bindings: [
    { key: 'concurrency', classId: 'pool', target: 'WorkerPool.start(concurrency): number of threads', note: 'Simulated: jobs processed at the same time.' },
    { key: 'processingRate', classId: 'resize', target: 'How long one ResizeImageHandler.handle call takes (1 / rate)', note: 'Simulated as a fixed job duration per slot.' },
    { key: 'retry', classId: 'source', target: 'JobSource.fail → the queue’s redelivery policy', note: 'Descriptive: retries are configured on the source queue (Max deliveries).' },
  ],
  simulation: 'Flowzen simulates a Worker as “concurrency” slots each processing jobs at the configured rate. After processing, a job is forwarded to the worker’s first connection (the role ImageStore plays here); a failure there is redelivered by the source queue if deliveries remain. Job types and handler dispatch are illustrative.',
};
