import type { IAuthRef } from "./auth-ref.interface.js";
import type { IEndpointAuth } from "./endpoint-legacy.interface.js";
import type { IOperation } from "./operation.interface.js";
import type { IServerRef } from "./server-ref.interface.js";
import type { Transport } from "./transport/index.js";

export type ServiceAuth = IAuthRef | IEndpointAuth | undefined;

/**
 * The canonical descriptor of ONE service, as the exporters see it.
 *
 * ## One word, two shapes — and why this file owns it
 *
 * Before r00019 the repo had two unrelated types called
 * `IServiceDescriptor`:
 *
 *   - **this one** — the *export* descriptor: what a service looks
 *     like once it has an identity, its own base URL, its own auth
 *     scheme, its variables and its operations. It is the canonical
 *     contract.
 *   - `service-graph.interface.ts#IServiceDescriptor` — a **legacy
 *     alias** of `IServiceGraphNode`, the *discovery* shape: a
 *     scanner match plus the routes it produced. It is kept
 *     `@deprecated` so the graph consumers keep compiling.
 *
 * They are NOT interchangeable: the graph node knows which scanner
 * found the service, and the export descriptor knows the transport
 * and the operations. The bridge between them is an **adapter** (see
 * {@link IServiceDescriptorAdapter}), not a second definition of the
 * same word.
 *
 * The rule for the rest of the codebase:
 *
 *   - New code imports the descriptor from **this** module.
 *   - Code that still holds a discovery graph node adapts it first
 *     (`toServiceDescriptor`, in `packages/core/merge/`).
 *   - Nobody writes a second `IServiceDescriptor` anywhere else.
 */
export interface IServiceDescriptor {
  /**
   * Stable identity of the service. It is also the suffix of the
   * `{{baseUrl_<id>}}` variable the combined descriptor publishes, so
   * two services can never publish the same variable name.
   */
  readonly id: string;
  /**
   * The service's OWN base URL. A merged collection never inherits
   * it from a sibling: two services on two hosts is the whole point
   * of `combineServices`.
   */
  readonly baseUrl: string;
  /**
   * The service's OWN auth. Same rule as `baseUrl`: the combined
   * collection must not send one service's requests with another
   * service's credentials.
   */
  readonly auth: ServiceAuth;
  /** Variables this service contributes on top of the merged ones. */
  readonly variables: ReadonlyArray<{ readonly key: string; readonly value: string }>;
  /**
   * Transport of the service. It is the transport of its first
   * operation, and a neutral default when the service has none yet.
   */
  readonly transport: Transport;
  /** The operations this service contributes to a combined descriptor. */
  readonly endpoints: ReadonlyArray<IOperation>;
  /** @deprecated Use `id`; retained while the legacy graph is still supported. */
  readonly serviceId?: string;
}

/**
 * The minimum a discovery-side service must expose to be adapted into
 * the canonical {@link IServiceDescriptor}.
 *
 * It is a **constraint**, not a second descriptor: the legacy
 * `IServiceGraphNode` satisfies it structurally, so this file does
 * not restate the graph's shape. Only the four fields the adapter
 * actually reads are listed, so a consumer that carries a service in
 * another shape can be adapted too.
 */
export interface IServiceDescriptorSource {
  /** The identity the discovery graph assigned to the service. */
  readonly serviceId: string;
  /** The service's base URL, or `null` when it inherits the project's. */
  readonly baseUrl: string | null;
  /** The service's auth override, or `undefined` when it inherits the project's. */
  readonly auth: IEndpointAuth | undefined;
  /** Variables the service contributes on top of the project's. */
  readonly variables: ReadonlyArray<{ readonly key: string; readonly value: string }>;
}

/**
 * The public contract of the bridge between the legacy discovery graph
 * and the canonical {@link IServiceDescriptor}.
 *
 * `TSource` is the discovery-side shape being adapted (the legacy
 * `IServiceGraphNode`, or any other shape that satisfies
 * {@link IServiceDescriptorSource}). Making the adapter generic over
 * its source is what keeps the duplication from coming back: the
 * contract does NOT restate the graph's shape, it only states what
 * the adapter needs to read.
 *
 * The implementation lives in `packages/core/merge/` — the contracts
 * package is types only, and an adapter is behaviour.
 */
export type IServiceDescriptorAdapter<
  TSource extends IServiceDescriptorSource = IServiceDescriptorSource,
> = (source: TSource, endpoints: ReadonlyArray<IOperation>) => IServiceDescriptor;

/**
 * Several services merged into one descriptor.
 *
 * `operations` and `endpoints` are the same array: `endpoints` is the
 * name the older consumers already use, `operations` is the r00019
 * vocabulary. Both point at the merged operations, each of which
 * carries the `serverRef` and `authRef` of the service it came from.
 */
export interface ICombinedDescriptor {
  /** The services that were merged, untouched. */
  readonly services: ReadonlyArray<IServiceDescriptor>;
  /** The merged variables: `baseUrl_<serviceId>` per service, plus each service's own. */
  readonly variables: ReadonlyArray<{ readonly key: string; readonly value: string }>;
  /** Every operation of every service, each with its own server and auth. */
  readonly operations: ReadonlyArray<IOperation>;
  /** Legacy alias of `operations`; the same array. */
  readonly endpoints: ReadonlyArray<IOperation>;
}

/**
 * The context an operation actually runs against: the server it
 * reaches and the credentials it carries.
 */
export interface IResolvedOperationContext {
  readonly serverRef: IServerRef;
  readonly authRef: IAuthRef;
}