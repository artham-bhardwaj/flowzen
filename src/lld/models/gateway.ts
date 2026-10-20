import type { LldModel } from '../types';
import { file } from './util';

const pkg = 'flowzen.gateway';

export const gatewayModel: LldModel = {
  id: 'api-gateway', title: 'API Gateway', kinds: ['gateway'], packageName: pkg,
  overview: {
    responsibility: 'Be the single entry point for API calls: run cross-cutting checks (authentication, request IDs) and route each request to the service that owns its path.',
    inputs: ['HTTP API requests from clients or a load balancer'],
    outputs: ['The request, forwarded to the owning service', '401 when authentication fails, 404 when no route matches'],
    collaborators: ['GatewayFilter chain (cross-cutting checks)', 'RouteTable (path prefix → service)', 'TokenVerifier (validates credentials)', 'ServiceClient (calls the downstream service)'],
    state: ['The immutable route table and filter list, built at startup', 'No per-request state is kept between requests'],
    behavior: ['Filters run in order; the first one that returns a response short-circuits the chain.', 'The longest matching path prefix wins.'],
  },
  canvasRole: {
    upstream: 'Clients or a load balancer call ApiGateway.handle.',
    downstream: 'The first connection is the service a Route points to; ServiceClient.send makes that call. In the simulator every request goes to that one downstream.',
  },
  classes: [
    { id: 'gateway', name: 'ApiGateway', kind: 'class', file: 'ApiGateway.java', layer: 0, responsibility: 'Runs the filter chain, then routes the request through the RouteTable.', members: ['- filters: List<GatewayFilter>', '- routes: RouteTable', '+ handle(request: Request): Response'] },
    { id: 'filter', name: 'GatewayFilter', kind: 'interface', file: 'GatewayFilter.java', layer: 1, responsibility: 'One cross-cutting check. Returns a response to stop the request, or empty to continue.', members: ['+ apply(request: Request): Optional<Response>'] },
    { id: 'routes', name: 'RouteTable', kind: 'class', file: 'RouteTable.java', layer: 1, responsibility: 'Maps path prefixes to service clients and resolves the longest match.', members: ['- routes: List<Route>', '+ resolve(path: String): Optional<ServiceClient>'] },
    { id: 'auth', name: 'AuthenticationFilter', kind: 'class', file: 'AuthenticationFilter.java', layer: 2, responsibility: 'Rejects requests without a valid bearer token.', members: ['- verifier: TokenVerifier', '+ apply(request: Request): Optional<Response>'] },
    { id: 'size', name: 'PayloadSizeFilter', kind: 'class', file: 'PayloadSizeFilter.java', layer: 2, responsibility: 'Rejects request bodies above a size limit with 413.', members: ['- maxBytes: long', '+ apply(request: Request): Optional<Response>'] },
    { id: 'client', name: 'ServiceClient', kind: 'interface', file: 'ServiceClient.java', layer: 2, responsibility: 'Sends a request to one downstream service.', members: ['+ send(request: Request): Response'] },
    { id: 'verifier', name: 'TokenVerifier', kind: 'interface', file: 'TokenVerifier.java', layer: 3, responsibility: 'Decides whether a credential is valid (e.g. JWT signature check or token introspection).', members: ['+ isValid(token: String): boolean'] },
    { id: 'jwt', name: 'JwtTokenVerifier', kind: 'class', file: 'JwtTokenVerifier.java', layer: 4, responsibility: 'Verifies the token’s signature and expiry locally with the issuer’s public key.', members: ['- parser: JwtParser', '+ isValid(token: String): boolean'] },
    { id: 'route', name: 'Route', kind: 'record', file: 'Route.java', layer: 3, support: true, responsibility: 'A path prefix and the client that serves it.', members: ['+ prefix(): String', '+ client(): ServiceClient'] },
    { id: 'request', name: 'Request', kind: 'record', file: 'Request.java', layer: 3, support: true, responsibility: 'An incoming API request with header access.', members: ['+ path(): String', '+ header(name: String): Optional<String>'] },
    { id: 'response', name: 'Response', kind: 'record', file: 'Response.java', layer: 3, support: true, responsibility: 'An HTTP response.', members: ['+ status(): int', '+ body(): String'] },
  ],
  relations: [
    { from: 'gateway', to: 'filter', type: 'uses', label: '1..*' },
    { from: 'gateway', to: 'routes', type: 'uses', label: 'resolve' },
    { from: 'auth', to: 'filter', type: 'implements' },
    { from: 'size', to: 'filter', type: 'implements' },
    { from: 'auth', to: 'verifier', type: 'uses' },
    { from: 'jwt', to: 'verifier', type: 'implements' },
    { from: 'routes', to: 'route', type: 'uses' },
    { from: 'routes', to: 'client', type: 'uses' },
    { from: 'gateway', to: 'response', type: 'creates', label: '404' },
    { from: 'auth', to: 'response', type: 'creates', label: '401' },
    { from: 'gateway', to: 'request', type: 'uses' },
  ],
  files: [
    file('ApiGateway.java', `
package ${pkg};

import java.util.List;
import java.util.Optional;

/** Single entry point: cross-cutting filters first, then routing by path. */
public final class ApiGateway {
    private final List<GatewayFilter> filters;
    private final RouteTable routes;

    public ApiGateway(List<GatewayFilter> filters, RouteTable routes) {
        this.filters = List.copyOf(filters);
        this.routes = routes;
    }

    public Response handle(Request request) {
        for (GatewayFilter filter : filters) {
            Optional<Response> rejection = filter.apply(request);
            if (rejection.isPresent()) {
                return rejection.get();
            }
        }
        return routes.resolve(request.path())
                .map(client -> client.send(request))
                .orElseGet(() -> new Response(404, "No route for " + request.path()));
    }
}`),
    file('GatewayFilter.java', `
package ${pkg};

import java.util.Optional;

/** A cross-cutting check. A present response stops the chain; empty lets the request continue. */
public interface GatewayFilter {
    Optional<Response> apply(Request request);
}`),
    file('AuthenticationFilter.java', `
package ${pkg};

import java.util.Optional;

/** Requires "Authorization: Bearer <token>" with a token the verifier accepts. */
public final class AuthenticationFilter implements GatewayFilter {
    private static final String PREFIX = "Bearer ";
    private final TokenVerifier verifier;

    public AuthenticationFilter(TokenVerifier verifier) {
        this.verifier = verifier;
    }

    @Override
    public Optional<Response> apply(Request request) {
        boolean valid = request.header("Authorization")
                .filter(value -> value.startsWith(PREFIX))
                .map(value -> value.substring(PREFIX.length()))
                .map(verifier::isValid)
                .orElse(false);
        return valid ? Optional.empty() : Optional.of(new Response(401, "Unauthorized"));
    }
}`),
    file('PayloadSizeFilter.java', `
package ${pkg};

import java.util.Optional;

/** Rejects bodies larger than the configured limit before any service spends work on them. */
public final class PayloadSizeFilter implements GatewayFilter {
    private final long maxBytes;

    public PayloadSizeFilter(long maxBytes) {
        this.maxBytes = maxBytes;
    }

    @Override
    public Optional<Response> apply(Request request) {
        long length = request.header("Content-Length").map(Long::parseLong).orElse(0L);
        return length > maxBytes ? Optional.of(new Response(413, "Payload too large")) : Optional.empty();
    }
}`),
    file('RouteTable.java', `
package ${pkg};

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/** Path-prefix routing; the longest matching prefix wins. */
public final class RouteTable {
    private final List<Route> routes;

    public RouteTable(List<Route> routes) {
        this.routes = routes.stream()
                .sorted(Comparator.comparingInt((Route route) -> route.prefix().length()).reversed())
                .toList();
    }

    public Optional<ServiceClient> resolve(String path) {
        return routes.stream()
                .filter(route -> path.startsWith(route.prefix()))
                .map(Route::client)
                .findFirst();
    }
}`),
    file('ServiceClient.java', `
package ${pkg};

/** Calls one downstream service (HTTP, gRPC, ...). */
public interface ServiceClient {
    Response send(Request request);
}`),
    file('TokenVerifier.java', `
package ${pkg};

/** Validates a credential without the gateway knowing how. */
public interface TokenVerifier {
    boolean isValid(String token);
}`),
    file('JwtTokenVerifier.java', `
package ${pkg};

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.JwtParser;
import java.time.Instant;

/** Local verification (jjwt library): no network call per request. */
public final class JwtTokenVerifier implements TokenVerifier {
    private final JwtParser parser;   // built with the issuer's public key

    public JwtTokenVerifier(JwtParser parser) {
        this.parser = parser;
    }

    @Override
    public boolean isValid(String token) {
        try {
            Claims claims = parser.parseSignedClaims(token).getPayload();
            return claims.getExpiration().toInstant().isAfter(Instant.now());
        } catch (JwtException invalid) {
            return false;
        }
    }
}`),
    file('Route.java', `
package ${pkg};

public record Route(String prefix, ServiceClient client) {}`),
    file('Request.java', `
package ${pkg};

import java.util.Map;
import java.util.Optional;

public record Request(String method, String path, Map<String, String> headers) {
    public Optional<String> header(String name) {
        return Optional.ofNullable(headers.get(name));
    }
}`),
    file('Response.java', `
package ${pkg};

public record Response(int status, String body) {}`),
  ],
  principles: [
    {
      principle: 'composition',
      meaning: 'The gateway’s behavior is assembled from a list of GatewayFilter objects instead of subclasses of ApiGateway.',
      classes: ['gateway', 'filter', 'auth', 'size'],
      evidence: 'ApiGateway holds List<GatewayFilter>; AuthenticationFilter and PayloadSizeFilter are independent objects added to that list.',
      benefit: 'Filters can be reordered, reused across gateways or turned off per environment without a class hierarchy.',
      violation: 'AuthenticatedGateway extends LoggingGateway extends ApiGateway, where each subclass overrides handle() and calls super.',
      tradeoff: 'Order matters and is decided at wiring time, so a misordered list (for example, verifying tokens before cheaply rejecting oversized bodies) is a configuration mistake the compiler cannot catch.',
    },
    {
      principle: 'ocp',
      meaning: 'A new cross-cutting concern, such as CORS or request size limits, is a new GatewayFilter. ApiGateway.handle is unchanged.',
      classes: ['gateway', 'filter'],
      evidence: 'ApiGateway.handle loops over filters and only knows the GatewayFilter.apply contract.',
      benefit: 'Gateways accumulate many concerns over time; none of them requires editing the request loop.',
      violation: 'An ever-growing handle() with an if-block per concern (auth, CORS, size limits, IP allow-lists).',
      tradeoff: 'A filter can only stop or pass a request; concerns that need to change the response afterwards need a richer interface.',
    },
    {
      principle: 'srp',
      meaning: 'Routing, authentication and the network call are separate classes with separate reasons to change.',
      classes: ['routes', 'auth', 'client'],
      evidence: 'RouteTable.resolve only matches prefixes; AuthenticationFilter only checks the header; ServiceClient only sends.',
      benefit: 'A routing rule change cannot weaken authentication, and each piece has small, focused tests.',
      violation: 'An ApiGateway.handle that parses the JWT, picks a URL with string comparisons and opens the HTTP connection itself.',
      tradeoff: 'Following a request means reading several small classes.',
    },
    {
      principle: 'dip',
      meaning: 'AuthenticationFilter depends on the TokenVerifier abstraction, not on a JWT library or an identity provider client.',
      classes: ['auth', 'verifier', 'jwt'],
      evidence: 'AuthenticationFilter receives a TokenVerifier in its constructor and calls verifier::isValid; JwtTokenVerifier is one implementation, chosen in the wiring.',
      benefit: 'Switching from local JWT verification to token introspection does not touch the filter.',
      violation: 'AuthenticationFilter calling the JWT library directly to decode the token and check its signature inline.',
      tradeoff: 'TokenVerifier returns only a boolean, so richer results (claims, scopes) need a broader abstraction later.',
    },
  ],
  decisions: [
    { title: 'Filters return Optional<Response>', decision: 'A filter either stops the request with a response or lets it continue.', why: 'Short-circuiting is explicit and cheap; there is no hidden “next” callback to forget.', alternatives: [{ name: 'Servlet-style chain.doFilter(next)', when: 'Filters must run code after the downstream call, such as timing or response rewriting.' }] },
    { title: 'Longest-prefix routing', decision: 'Routes are sorted by prefix length once, at construction.', why: 'More specific routes (/orders/export) must beat general ones (/orders).', alternatives: [{ name: 'A trie of path segments', when: 'Thousands of routes, or path parameters such as /orders/{id}/items.' }] },
  ],
  choices: [
    {
      id: 'auth', title: 'Token verification', question: 'How should the gateway decide a token is valid?', defaultOption: 'jwt',
      configKey: 'auth', matchConfig: { jwt: 'jwt', oauth: 'introspection', 'oauth 2': 'introspection', introspection: 'introspection' },
      options: [
        { id: 'jwt', label: 'Local JWT verification', summary: 'Check the signature with a cached public key.', changes: ['JwtTokenVerifier'], effect: 'Current design. No network call per request, so it adds little latency. Revocation is only as fast as the token’s expiry.', code: `public final class JwtTokenVerifier implements TokenVerifier {
    private final JwtParser parser;   // configured with the issuer's public key

    @Override
    public boolean isValid(String token) {
        try {
            Claims claims = parser.parseSignedClaims(token).getPayload();
            return claims.getExpiration().toInstant().isAfter(Instant.now());
        } catch (JwtException invalid) {
            return false;
        }
    }
}` },
        { id: 'introspection', label: 'Token introspection', summary: 'Ask the identity provider about every token.', changes: ['IntrospectionTokenVerifier (new TokenVerifier)'], effect: 'Revocation is immediate, but every request makes a network call; usually paired with a short-lived cache. AuthenticationFilter does not change.', code: `public final class IntrospectionTokenVerifier implements TokenVerifier {
    private final IdentityProviderClient idp;
    private final Cache<String, Boolean> recent;   // short TTL, e.g. 30 s

    @Override
    public boolean isValid(String token) {
        return recent.get(token).orElseGet(() -> {
            boolean active = idp.introspect(token).active();
            recent.put(token, active);
            return active;
        });
    }
}` },
      ],
    },
  ],
  refactoring: {
    title: 'From a monolithic handler to a filter chain', principle: 'composition',
    problem: 'Each new concern was added by subclassing the gateway, so behavior depended on the class hierarchy.',
    before: `class ApiGateway {
    Response handle(Request request) { return route(request); }
}
class AuthenticatedGateway extends ApiGateway {
    @Override Response handle(Request request) {
        if (!jwt.verify(request.header("Authorization").orElse(""))) return new Response(401, "Unauthorized");
        return super.handle(request);
    }
}
class SizeLimitedAuthenticatedGateway extends AuthenticatedGateway { /* ... */ }`,
    after: `ApiGateway gateway = new ApiGateway(
        List.of(new PayloadSizeFilter(1_048_576), new AuthenticationFilter(new JwtTokenVerifier(parser))),
        new RouteTable(routes));`,
    explanation: 'Each concern becomes an object in a list. Combinations no longer need their own subclass, and order is visible in one place.',
  },
  bindings: [
    { key: 'auth', classId: 'verifier', target: 'Which TokenVerifier is injected into AuthenticationFilter', note: 'Descriptive: the simulator does not authenticate requests.' },
    { key: 'rateLimit', classId: 'filter', target: 'Would be another GatewayFilter', note: 'Not enforced by the simulator; add a Rate Limiter component to simulate limiting.' },
    { key: 'processingLatencyMs', classId: 'gateway', target: 'Time spent in ApiGateway.handle before forwarding', note: 'Simulated as a fixed per-request processing time.' },
  ],
  simulation: 'Flowzen simulates the gateway as a processing station (latency, concurrency, queue limit, timeout) that forwards to its first connection. Authentication, filters and path routing are illustrative only: every request is forwarded to the same downstream.',
};
