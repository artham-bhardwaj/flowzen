import type { LldModel } from '../types';
import { file } from './util';

const pkg = 'flowzen.orders';

export const databaseModel: LldModel = {
  id: 'sql-database', title: 'SQL Database (data access)', kinds: ['database'], packageName: pkg,
  overview: {
    responsibility: 'Persist and query orders durably. On the application side this is a repository over a pooled connection, with reads optionally routed to replicas.',
    inputs: ['Queries from application servers, caches or workers'],
    outputs: ['Rows mapped to domain objects', 'Reads routed to read replicas when they are configured'],
    collaborators: ['OrderService (business operations)', 'OrderRepository (persistence port)', 'ReadWriteRouter (primary or replica DataSource)', 'OrderRowMapper (row → object)'],
    state: ['Durable rows in the database itself', 'A pool of open connections per DataSource (not shown)', 'The replica rotation counter in ReadWriteRouter'],
    behavior: ['Writes always go to the primary.', 'Reads use a replica when one is configured, otherwise the primary.', 'Each statement borrows a connection from the pool and returns it when done.'],
  },
  canvasRole: {
    upstream: 'Application servers, caches or workers run queries through OrderRepository.',
    downstream: 'Connected Read Replicas are the replica DataSources in ReadWriteRouter; reads are routed to them.',
  },
  classes: [
    { id: 'service', name: 'OrderService', kind: 'class', file: 'OrderService.java', layer: 0, responsibility: 'Business operations on orders, expressed through the repository port.', members: ['- repository: OrderRepository', '+ place(customerId: long, totalCents: long): Order', '+ recentOrders(customerId: long): List<Order>'] },
    { id: 'repo', name: 'OrderRepository', kind: 'interface', file: 'OrderRepository.java', layer: 1, responsibility: 'Persistence port: what the business needs from storage, in domain terms.', members: ['+ insert(customerId: long, totalCents: long): Order', '+ findByCustomer(customerId: long, limit: int): List<Order>'] },
    { id: 'jdbc', name: 'JdbcOrderRepository', kind: 'class', file: 'JdbcOrderRepository.java', layer: 2, responsibility: 'SQL implementation of the port using JDBC prepared statements.', members: ['- router: ReadWriteRouter', '- mapper: OrderRowMapper', '+ insert(customerId: long, totalCents: long): Order', '+ findByCustomer(customerId: long, limit: int): List<Order>'] },
    { id: 'router', name: 'ReadWriteRouter', kind: 'class', file: 'ReadWriteRouter.java', layer: 3, responsibility: 'Chooses the primary DataSource for writes and rotates reads across replicas.', members: ['- primary: DataSource', '- replicas: List<DataSource>', '- next: AtomicInteger', '+ forWrite(): DataSource', '+ forRead(): DataSource'] },
    { id: 'mapper', name: 'OrderRowMapper', kind: 'class', file: 'OrderRowMapper.java', layer: 3, responsibility: 'Converts one ResultSet row into an Order.', members: ['+ map(row: ResultSet): Order'] },
    { id: 'exception', name: 'DataAccessException', kind: 'class', file: 'DataAccessException.java', layer: 3, responsibility: 'Unchecked wrapper so SQLException does not leak into business code.', members: [] },
    { id: 'order', name: 'Order', kind: 'record', file: 'Order.java', layer: 4, support: true, responsibility: 'An order row as a domain value.', members: ['+ id(): long', '+ customerId(): long', '+ totalCents(): long', '+ createdAt(): Instant'] },
  ],
  relations: [
    { from: 'service', to: 'repo', type: 'uses' },
    { from: 'jdbc', to: 'repo', type: 'implements' },
    { from: 'jdbc', to: 'router', type: 'uses' },
    { from: 'jdbc', to: 'mapper', type: 'uses' },
    { from: 'jdbc', to: 'exception', type: 'creates', label: 'wraps SQLException' },
    { from: 'mapper', to: 'order', type: 'creates' },
    { from: 'service', to: 'order', type: 'uses' },
  ],
  files: [
    file('OrderService.java', `
package ${pkg};

import java.util.List;

/** Business operations. Talks to storage only through OrderRepository. */
public final class OrderService {
    private static final int RECENT_LIMIT = 20;
    private final OrderRepository repository;

    public OrderService(OrderRepository repository) {
        this.repository = repository;
    }

    public Order place(long customerId, long totalCents) {
        if (totalCents <= 0) {
            throw new IllegalArgumentException("Order total must be positive");
        }
        return repository.insert(customerId, totalCents);
    }

    public List<Order> recentOrders(long customerId) {
        return repository.findByCustomer(customerId, RECENT_LIMIT);
    }
}`),
    file('OrderRepository.java', `
package ${pkg};

import java.util.List;

/** Persistence port, defined in the vocabulary of the business layer. */
public interface OrderRepository {
    Order insert(long customerId, long totalCents);

    List<Order> findByCustomer(long customerId, int limit);
}`),
    file('JdbcOrderRepository.java', `
package ${pkg};

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

/** JDBC implementation. Connections come from pooled DataSources chosen by the router. */
public final class JdbcOrderRepository implements OrderRepository {
    private static final String INSERT =
            "INSERT INTO orders (customer_id, total_cents) VALUES (?, ?) RETURNING id, customer_id, total_cents, created_at";
    private static final String BY_CUSTOMER =
            "SELECT id, customer_id, total_cents, created_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?";

    private final ReadWriteRouter router;
    private final OrderRowMapper mapper;

    public JdbcOrderRepository(ReadWriteRouter router, OrderRowMapper mapper) {
        this.router = router;
        this.mapper = mapper;
    }

    @Override
    public Order insert(long customerId, long totalCents) {
        try (Connection connection = router.forWrite().getConnection();
             PreparedStatement statement = connection.prepareStatement(INSERT)) {
            statement.setLong(1, customerId);
            statement.setLong(2, totalCents);
            try (ResultSet row = statement.executeQuery()) {
                row.next();
                return mapper.map(row);
            }
        } catch (SQLException error) {
            throw new DataAccessException("insert order failed", error);
        }
    }

    @Override
    public List<Order> findByCustomer(long customerId, int limit) {
        try (Connection connection = router.forRead().getConnection();
             PreparedStatement statement = connection.prepareStatement(BY_CUSTOMER)) {
            statement.setLong(1, customerId);
            statement.setInt(2, limit);
            List<Order> orders = new ArrayList<>();
            try (ResultSet rows = statement.executeQuery()) {
                while (rows.next()) {
                    orders.add(mapper.map(rows));
                }
            }
            return orders;
        } catch (SQLException error) {
            throw new DataAccessException("query orders failed", error);
        }
    }
}`),
    file('ReadWriteRouter.java', `
package ${pkg};

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;

/** Writes go to the primary; reads rotate across replicas, or use the primary if there are none. */
public final class ReadWriteRouter {
    private final DataSource primary;
    private final List<DataSource> replicas;
    private final AtomicInteger next = new AtomicInteger();

    public ReadWriteRouter(DataSource primary, List<DataSource> replicas) {
        this.primary = primary;
        this.replicas = List.copyOf(replicas);
    }

    public DataSource forWrite() {
        return primary;
    }

    public DataSource forRead() {
        if (replicas.isEmpty()) {
            return primary;
        }
        return replicas.get(Math.floorMod(next.getAndIncrement(), replicas.size()));
    }
}`),
    file('OrderRowMapper.java', `
package ${pkg};

import java.sql.ResultSet;
import java.sql.SQLException;

/** One place that knows the column names. */
public final class OrderRowMapper {
    public Order map(ResultSet row) throws SQLException {
        return new Order(
                row.getLong("id"),
                row.getLong("customer_id"),
                row.getLong("total_cents"),
                row.getTimestamp("created_at").toInstant());
    }
}`),
    file('DataAccessException.java', `
package ${pkg};

/** Keeps checked SQL exceptions out of the business layer. */
public final class DataAccessException extends RuntimeException {
    public DataAccessException(String message, Throwable cause) {
        super(message, cause);
    }
}`),
    file('Order.java', `
package ${pkg};

import java.time.Instant;

public record Order(long id, long customerId, long totalCents, Instant createdAt) {}`),
  ],
  principles: [
    {
      principle: 'dip',
      meaning: 'OrderService (policy) depends on the OrderRepository interface; the JDBC details depend on that same interface by implementing it.',
      classes: ['service', 'repo', 'jdbc'],
      evidence: 'OrderService holds an OrderRepository; JdbcOrderRepository implements OrderRepository and is injected at startup.',
      benefit: 'Business rules can be tested with an in-memory repository, and the storage technology can change behind the port.',
      violation: 'OrderService writing SQL strings and catching SQLException itself.',
      tradeoff: 'Queries that need database-specific features still have to be expressed as port methods, which can make the interface grow.',
    },
    {
      principle: 'srp',
      meaning: 'Query execution, connection routing and row mapping each change for a different reason and live in different classes.',
      classes: ['jdbc', 'router', 'mapper'],
      evidence: 'JdbcOrderRepository runs statements, ReadWriteRouter only picks a DataSource, OrderRowMapper.map only knows column names.',
      benefit: 'Adding a replica touches only ReadWriteRouter; renaming a column touches only OrderRowMapper.',
      violation: 'A repository that also decides which host to connect to and maps columns inline in every query method.',
      tradeoff: 'More small classes for what is, per query, a few lines of code.',
    },
    {
      principle: 'abstraction',
      meaning: 'Callers see “insert an order” and “recent orders for a customer”, not SQL, connections or ResultSets.',
      classes: ['repo', 'exception'],
      evidence: 'OrderRepository’s methods use domain types only, and failures surface as DataAccessException rather than SQLException.',
      benefit: 'Business code reads in domain terms and is not forced to handle storage-specific checked exceptions.',
      violation: 'A repository method such as ResultSet query(String sql) that hands raw storage concepts to callers.',
      tradeoff: 'Leaky cases remain: performance still depends on indexes and query plans the abstraction hides.',
    },
  ],
  decisions: [
    { title: 'Repository port owned by the business layer', decision: 'OrderRepository speaks in domain terms and lives beside OrderService.', why: 'Keeps the dependency direction pointing from storage toward business logic.', alternatives: [{ name: 'Active Record (orders save themselves)', when: 'Simple CRUD apps where domain logic is thin.' }] },
    { title: 'Replica routing inside the data layer', decision: 'ReadWriteRouter picks a DataSource per statement.', why: 'Services do not need to know about replicas; the topology can change by configuration.', alternatives: [{ name: 'A proxy (e.g. PgBouncer, ProxySQL) doing read/write split', when: 'Many services share the database and routing should be centralized.' }, { name: 'Always read from the primary', when: 'Reads must see the latest write (read-your-writes) and replica lag is unacceptable.' }] },
  ],
  choices: [
    {
      id: 'access', title: 'Data access style', question: 'How should the repository talk to the database?', defaultOption: 'jdbc',
      options: [
        { id: 'jdbc', label: 'Plain JDBC', summary: 'Hand-written SQL with prepared statements.', changes: ['JdbcOrderRepository'], effect: 'Current design. Full control over every query; more boilerplate.', code: `public final class JdbcOrderRepository implements OrderRepository {
    @Override
    public List<Order> findByCustomer(long customerId, int limit) {
        try (Connection connection = router.forRead().getConnection();
             PreparedStatement statement = connection.prepareStatement(BY_CUSTOMER)) {
            // bind, execute, map rows ...
        }
    }
}` },
        { id: 'jpa', label: 'JPA / Spring Data', summary: 'An ORM generates SQL from entity mappings.', changes: ['OrderEntity (new)', 'SpringDataOrderRepository (new)', 'JpaOrderRepository adapter (new)'], effect: 'OrderService is unchanged because it depends on OrderRepository. Less SQL to write, but query behavior (lazy loading, N+1 queries) becomes less visible.', code: `@Entity
@Table(name = "orders")
class OrderEntity {
    @Id @GeneratedValue Long id;
    long customerId;
    long totalCents;
    Instant createdAt;
}

interface SpringDataOrderRepository extends JpaRepository<OrderEntity, Long> {
    List<OrderEntity> findByCustomerIdOrderByCreatedAtDesc(long customerId, Pageable page);
}` },
      ],
    },
  ],
  refactoring: {
    title: 'Splitting a do-everything data class', principle: 'srp',
    problem: 'Connection selection, SQL and column mapping were tangled together, so every topology or schema change touched the same method.',
    before: `public List<Order> findByCustomer(long customerId) throws SQLException {
    String host = random.nextBoolean() ? "replica-1" : "orders-primary";        // routing
    Connection connection = DriverManager.getConnection("jdbc:postgresql://" + host + "/orders");
    ResultSet rows = connection.createStatement()
            .executeQuery("SELECT * FROM orders WHERE customer_id = " + customerId);  // SQL (and injection risk)
    List<Order> orders = new ArrayList<>();
    while (rows.next()) {
        orders.add(new Order(rows.getLong(1), rows.getLong(2), rows.getLong(3), rows.getTimestamp(4).toInstant()));  // mapping
    }
    return orders;   // connection never closed
}`,
    after: `public List<Order> findByCustomer(long customerId, int limit) {
    try (Connection connection = router.forRead().getConnection();
         PreparedStatement statement = connection.prepareStatement(BY_CUSTOMER)) {
        statement.setLong(1, customerId);
        statement.setInt(2, limit);
        // rows mapped with mapper.map(row)
    }
}`,
    explanation: 'Routing moves to ReadWriteRouter, mapping to OrderRowMapper, and the query becomes a prepared statement with try-with-resources. Each concern now has one home, and two real bugs (SQL injection, a leaked connection) disappear.',
  },
  bindings: [
    { key: 'concurrency', classId: 'router', target: 'Connection pool size of each DataSource (pool not shown)', note: 'Simulated: queries executed at the same time; more wait in the queue.' },
    { key: 'queryLatencyMs', classId: 'jdbc', target: 'Time for one statement in JdbcOrderRepository', note: 'Simulated as a fixed time per query.' },
    { key: 'readRatio', classId: 'router', target: 'Share of calls that go through forRead()', note: 'Simulated: that share is routed round-robin to connected Read Replicas, like ReadWriteRouter.forRead().' },
    { key: 'queueLimit', classId: 'router', target: 'Pool wait queue (callers waiting for a connection)', note: 'Simulated: arrivals beyond it are rejected.' },
  ],
  simulation: 'Flowzen simulates the database as a pool of “connections” slots, each query taking the configured latency, with a bounded wait queue and timeout. When Read Replicas are connected, the read share is routed to them round-robin, like ReadWriteRouter. SQL, transactions, indexes and replica lag are not simulated.',
};
