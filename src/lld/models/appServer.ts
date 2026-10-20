import type { LldModel } from '../types';
import { file } from './util';

const pkg = 'flowzen.checkout';

export const appServerModel: LldModel = {
  id: 'application-server', title: 'Application Server', kinds: ['server'], packageName: pkg,
  overview: {
    responsibility: 'Run the application’s business logic for each request, with bounded concurrency so overload turns into fast rejections instead of unbounded queues.',
    inputs: ['Requests from a client, load balancer, gateway or proxy'],
    outputs: ['A response to the caller', 'Calls to its own dependencies (repository, inventory service), which are its downstream connections on the canvas'],
    collaborators: ['CheckoutController (HTTP mapping)', 'CheckoutService (business rules)', 'OrderRepository and InventoryClient (dependencies)'],
    state: ['A fixed pool of worker threads and a bounded wait queue (AppServer)', 'No session state: every request carries what it needs, so instances are interchangeable'],
    behavior: ['A request waits in the queue for a free thread; if the queue is full it is rejected with 503.', 'If a request waited longer than the timeout by the time a thread picks it up, it fails with 504.'],
  },
  canvasRole: {
    upstream: 'A load balancer, gateway or client submits requests to AppServer.submit.',
    downstream: 'Its first connection is a dependency called from CheckoutService, such as the store behind OrderRepository or the service behind InventoryClient.',
  },
  classes: [
    { id: 'server', name: 'AppServer', kind: 'class', file: 'AppServer.java', layer: 0, responsibility: 'Admission and concurrency: a fixed thread pool with a bounded queue and a queue timeout.', members: ['- pool: ThreadPoolExecutor', '- timeoutMillis: long', '- controller: CheckoutController', '+ submit(request: CheckoutRequest): CompletableFuture<HttpResponse>', '+ shutdown(): void'] },
    { id: 'controller', name: 'CheckoutController', kind: 'class', file: 'CheckoutController.java', layer: 1, responsibility: 'Transport layer: validates input and maps results and exceptions to HTTP responses.', members: ['- service: CheckoutService', '+ checkout(request: CheckoutRequest): HttpResponse'] },
    { id: 'service', name: 'CheckoutService', kind: 'class', file: 'CheckoutService.java', layer: 2, responsibility: 'Business rules: reserve stock, then persist the order.', members: ['- orders: OrderRepository', '- inventory: InventoryClient', '+ placeOrder(request: CheckoutRequest): Order'] },
    { id: 'repo', name: 'OrderRepository', kind: 'interface', file: 'OrderRepository.java', layer: 3, responsibility: 'Persistence port for orders.', members: ['+ save(order: Order): Order'] },
    { id: 'inventory', name: 'InventoryClient', kind: 'interface', file: 'InventoryClient.java', layer: 3, responsibility: 'Port to the inventory service.', members: ['+ reserve(sku: String, quantity: int): boolean'] },
    { id: 'out', name: 'OutOfStockException', kind: 'class', file: 'OutOfStockException.java', layer: 3, responsibility: 'Business failure: the requested quantity is not available.', members: [] },
    { id: 'order', name: 'Order', kind: 'record', file: 'Order.java', layer: 4, support: true, responsibility: 'A placed order.', members: ['+ id(): UUID', '+ sku(): String', '+ quantity(): int'] },
    { id: 'request', name: 'CheckoutRequest', kind: 'record', file: 'CheckoutRequest.java', layer: 4, support: true, responsibility: 'The incoming checkout payload.', members: ['+ sku(): String', '+ quantity(): int'] },
    { id: 'response', name: 'HttpResponse', kind: 'record', file: 'HttpResponse.java', layer: 4, support: true, responsibility: 'Status code and body returned to the caller.', members: ['+ status(): int', '+ body(): String'] },
  ],
  relations: [
    { from: 'server', to: 'controller', type: 'uses', label: 'dispatch' },
    { from: 'controller', to: 'service', type: 'uses' },
    { from: 'service', to: 'repo', type: 'uses' },
    { from: 'service', to: 'inventory', type: 'uses' },
    { from: 'service', to: 'out', type: 'creates', label: 'throws' },
    { from: 'service', to: 'order', type: 'creates' },
    { from: 'controller', to: 'response', type: 'creates' },
    { from: 'server', to: 'response', type: 'creates', label: '503 / 504' },
    { from: 'controller', to: 'request', type: 'uses' },
  ],
  files: [
    file('AppServer.java', `
package ${pkg};

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * Bounded concurrency for one server: "instances" threads, a wait queue of "queueLimit" requests,
 * and a queue timeout checked when a thread picks the request up.
 */
public final class AppServer {
    private final ThreadPoolExecutor pool;
    private final long timeoutMillis;
    private final CheckoutController controller;

    public AppServer(int instances, int queueLimit, long timeoutMillis, CheckoutController controller) {
        BlockingQueue<Runnable> waiting = queueLimit == 0 ? new SynchronousQueue<>() : new ArrayBlockingQueue<>(queueLimit);
        this.pool = new ThreadPoolExecutor(instances, instances, 0L, TimeUnit.MILLISECONDS, waiting);
        this.timeoutMillis = timeoutMillis;
        this.controller = controller;
    }

    public CompletableFuture<HttpResponse> submit(CheckoutRequest request) {
        long acceptedAt = System.nanoTime();
        CompletableFuture<HttpResponse> result = new CompletableFuture<>();
        try {
            pool.execute(() -> {
                long waitedMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - acceptedAt);
                if (waitedMillis > timeoutMillis) {
                    result.complete(new HttpResponse(504, "Timed out waiting for a worker thread"));
                    return;
                }
                result.complete(controller.checkout(request));
            });
        } catch (RejectedExecutionException queueFull) {
            result.complete(new HttpResponse(503, "Server busy"));
        }
        return result;
    }

    public void shutdown() {
        pool.shutdown();
    }
}`),
    file('CheckoutController.java', `
package ${pkg};

/** Maps HTTP concerns (validation, status codes) onto the service; contains no business rules. */
public final class CheckoutController {
    private final CheckoutService service;

    public CheckoutController(CheckoutService service) {
        this.service = service;
    }

    public HttpResponse checkout(CheckoutRequest request) {
        if (request.sku() == null || request.quantity() <= 0) {
            return new HttpResponse(400, "sku and a positive quantity are required");
        }
        try {
            Order order = service.placeOrder(request);
            return new HttpResponse(201, order.id().toString());
        } catch (OutOfStockException outOfStock) {
            return new HttpResponse(409, outOfStock.getMessage());
        }
    }
}`),
    file('CheckoutService.java', `
package ${pkg};

import java.util.UUID;

/** Business rules for checkout. Knows nothing about HTTP or threads. */
public final class CheckoutService {
    private final OrderRepository orders;
    private final InventoryClient inventory;

    public CheckoutService(OrderRepository orders, InventoryClient inventory) {
        this.orders = orders;
        this.inventory = inventory;
    }

    public Order placeOrder(CheckoutRequest request) {
        if (!inventory.reserve(request.sku(), request.quantity())) {
            throw new OutOfStockException(request.sku());
        }
        return orders.save(new Order(UUID.randomUUID(), request.sku(), request.quantity()));
    }
}`),
    file('OrderRepository.java', `
package ${pkg};

/** Where orders are stored; implemented by the persistence layer. */
public interface OrderRepository {
    Order save(Order order);
}`),
    file('InventoryClient.java', `
package ${pkg};

/** Reserves stock in the inventory service. */
public interface InventoryClient {
    boolean reserve(String sku, int quantity);
}`),
    file('OutOfStockException.java', `
package ${pkg};

public final class OutOfStockException extends RuntimeException {
    public OutOfStockException(String sku) {
        super("Out of stock: " + sku);
    }
}`),
    file('Order.java', `
package ${pkg};

import java.util.UUID;

public record Order(UUID id, String sku, int quantity) {}`),
    file('CheckoutRequest.java', `
package ${pkg};

public record CheckoutRequest(String sku, int quantity) {}`),
    file('HttpResponse.java', `
package ${pkg};

public record HttpResponse(int status, String body) {}`),
  ],
  principles: [
    {
      principle: 'srp',
      meaning: 'AppServer owns only admission and concurrency. It would change if threading or overload policy changed, never because checkout rules changed.',
      classes: ['server', 'service'],
      evidence: 'AppServer.submit decides accept / reject / time out and then calls the controller; CheckoutService contains no threading code.',
      benefit: 'Capacity tuning (threads, queue size, timeout) is isolated in one class, matching how operators reason about a server.',
      violation: 'CheckoutService creating its own thread pool, or checking queue wait times inside placeOrder.',
      tradeoff: 'The timeout is enforced only when a thread picks the request up, not while it waits. That is simple but means a request can wait longer than the timeout before failing.',
    },
    {
      principle: 'separation-of-concerns',
      meaning: 'Transport, business rules and dependencies are separate layers: controller → service → ports.',
      classes: ['controller', 'service', 'repo'],
      evidence: 'CheckoutController maps OutOfStockException to 409; CheckoutService throws it without knowing HTTP exists; OrderRepository hides storage.',
      benefit: 'The same CheckoutService could serve a message consumer or a CLI; HTTP details stay at the edge.',
      violation: 'A service method that returns HTTP status codes, or a controller that writes SQL.',
      tradeoff: 'For a tiny endpoint, three layers can feel like ceremony.',
    },
    {
      principle: 'dip',
      meaning: 'The business layer depends on OrderRepository and InventoryClient interfaces that it defines; storage and remote calls implement them.',
      classes: ['service', 'repo', 'inventory'],
      evidence: 'CheckoutService’s fields are the OrderRepository and InventoryClient interfaces.',
      benefit: 'Unit tests use in-memory fakes; the database or inventory transport can change without touching checkout rules.',
      violation: 'CheckoutService calling new JdbcOrderRepository(DriverManager.getConnection(...)) inside placeOrder (see the refactoring example).',
      tradeoff: 'Interfaces with a single production implementation add a file each.',
    },
    {
      principle: 'dependency-injection',
      meaning: 'Every class receives its collaborators through its constructor; a composition root wires them.',
      classes: ['server', 'controller', 'service'],
      evidence: 'AppServer(…, controller), CheckoutController(service) and CheckoutService(orders, inventory) never construct their dependencies.',
      benefit: 'Object graphs are explicit, immutable (final fields) and easy to replace in tests.',
      violation: 'Static singletons such as OrderRepository.getInstance() reached from inside methods.',
      tradeoff: 'Someone must assemble the graph, either by hand or with a DI container that adds startup cost and indirection.',
    },
  ],
  decisions: [
    { title: 'Bounded queue, explicit rejection', decision: 'The pool’s queue has a fixed size; overflow becomes 503.', why: 'An unbounded queue hides overload until memory runs out and makes every request slow. Fast rejection keeps latency bounded for accepted work.', alternatives: [{ name: 'Unbounded queue', when: 'Load is known to be bounded upstream (e.g. by a rate limiter) and every request must eventually run.' }, { name: 'Caller-runs policy', when: 'Back-pressure should slow the producer thread instead of failing the request.' }] },
    { title: 'Synchronous controller on a thread pool', decision: 'Each request occupies one thread from start to finish.', why: 'Straightforward code and stack traces; capacity equals thread count, which is easy to reason about.', alternatives: [{ name: 'Virtual threads (Java 21)', when: 'Requests spend most of their time waiting on I/O and you need far more concurrent requests than OS threads allow.' }, { name: 'Reactive / non-blocking', when: 'Very high concurrency with streaming I/O, at the cost of more complex code.' }] },
  ],
  choices: [
    {
      id: 'concurrency', title: 'Concurrency model', question: 'How should requests get a thread?', defaultOption: 'fixed-pool',
      options: [
        { id: 'fixed-pool', label: 'Fixed pool, bounded queue', summary: 'N threads, a queue of Q, reject beyond that.', changes: ['AppServer'], effect: 'Current design. Mirrors the simulator: instances = threads, queue limit = waiting slots, timeout checked when work starts.', code: `public final class AppServer {
    public AppServer(int instances, int queueLimit, long timeoutMillis, CheckoutController controller) {
        BlockingQueue<Runnable> waiting = queueLimit == 0 ? new SynchronousQueue<>() : new ArrayBlockingQueue<>(queueLimit);
        this.pool = new ThreadPoolExecutor(instances, instances, 0L, TimeUnit.MILLISECONDS, waiting);
        // ...
    }
}` },
        { id: 'virtual', label: 'Virtual threads + semaphore', summary: 'One cheap thread per request, concurrency capped by a semaphore.', changes: ['AppServer'], effect: 'Only AppServer changes; the controller and service are untouched. Concurrency is limited by permits instead of OS threads, which suits I/O-heavy handlers.', code: `public final class AppServer {
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private final Semaphore permits;

    public CompletableFuture<HttpResponse> submit(CheckoutRequest request) {
        if (!permits.tryAcquire()) {
            return CompletableFuture.completedFuture(new HttpResponse(503, "Server busy"));
        }
        return CompletableFuture.supplyAsync(() -> {
            try { return controller.checkout(request); } finally { permits.release(); }
        }, executor);
    }
}` },
        { id: 'unbounded', label: 'Unbounded queue (anti-pattern)', summary: 'Never reject; queue everything.', changes: ['AppServer'], effect: 'Looks safer, but under overload latency grows without limit and memory fills. Run an overloaded server in Flowzen with a huge queue limit to see p95 explode.', code: `this.pool = new ThreadPoolExecutor(instances, instances, 0L, TimeUnit.MILLISECONDS,
        new LinkedBlockingQueue<>());   // no capacity: nothing is ever rejected` },
      ],
    },
  ],
  refactoring: {
    title: 'Injecting dependencies instead of constructing them', principle: 'dip',
    problem: 'Business logic was welded to a specific database and could not be tested without one.',
    before: `public final class CheckoutService {
    public Order placeOrder(CheckoutRequest request) throws SQLException {
        Connection connection = DriverManager.getConnection("jdbc:postgresql://orders-db/orders");
        JdbcOrderRepository orders = new JdbcOrderRepository(connection);
        HttpInventoryClient inventory = new HttpInventoryClient("https://inventory.internal");
        if (!inventory.reserve(request.sku(), request.quantity())) throw new OutOfStockException(request.sku());
        return orders.save(new Order(UUID.randomUUID(), request.sku(), request.quantity()));
    }
}`,
    after: `public final class CheckoutService {
    private final OrderRepository orders;      // interface
    private final InventoryClient inventory;   // interface

    public CheckoutService(OrderRepository orders, InventoryClient inventory) {
        this.orders = orders;
        this.inventory = inventory;
    }
    // placeOrder uses the fields; no connection strings, no SQLException
}`,
    explanation: 'The service now depends on abstractions it owns. Connection handling moves to the persistence layer, and tests pass in-memory implementations.',
  },
  bindings: [
    { key: 'instances', classId: 'server', target: 'ThreadPoolExecutor core and max size', note: 'Simulated: requests processed at the same time.' },
    { key: 'queueLimit', classId: 'server', target: 'Capacity of the waiting queue', note: 'Simulated: arrivals beyond it are rejected (503 here).' },
    { key: 'timeoutMs', classId: 'server', target: 'timeoutMillis, checked when a thread picks the request up', note: 'Simulated the same way: the timeout is detected when the request would start.' },
    { key: 'processingLatencyMs', classId: 'service', target: 'Time spent inside CheckoutController.checkout', note: 'Simulated as a fixed processing time per request.' },
  ],
  simulation: 'Flowzen simulates an Application Server as a station with “instances” parallel slots, a bounded queue and a queue timeout that is checked when a request would start, the same admission rules AppServer implements. Processing time is a configured constant; the controller, service and repository calls are illustrative. Its downstream on the canvas (for example a cache or database) corresponds to dependencies such as OrderRepository.',
};
