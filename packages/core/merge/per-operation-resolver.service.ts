import type {
  IResolvedOperationContext,
  IServiceDescriptor,
} from "../../contracts/interfaces/core/service.interface.js";
import type { IOperation } from "../../contracts/interfaces/core/operation.interface.js";

function serviceIdOf(service: IServiceDescriptor): string {
  return service.id || service.serviceId || "";
}

function authRefFor(service: IServiceDescriptor): IResolvedOperationContext["authRef"] {
  if (service.auth && "id" in service.auth && "type" in service.auth) {
    return service.auth;
  }

  const kind = service.auth?.kind === "scheme" ? service.auth.scheme : "none";
  return {
    id: { kind: "auth", value: `${serviceIdOf(service)}-${kind}` },
    type: kind,
  };
}

/**
 * Resolves the server and auth an operation actually runs against.
 *
 * The r00019 model moved these from collection-level defaults to
 * per-operation refs, because a merged collection draws operations from
 * several services and a single shared `baseUrl`/auth silently sends half
 * of them to the wrong host. Every operation therefore names its own
 * service, and this is where that name becomes a concrete `serverRef` and
 * `authRef`.
 *
 * An unknown `serviceId` THROWS rather than falling back to a default:
 * inventing a server for an operation whose own service is missing is how
 * a request ends up authenticated against the wrong API.
 */
export const perOperationResolver = {
  resolve(
    operation: Pick<IOperation, "serviceId">,
    services: ReadonlyArray<IServiceDescriptor>,
  ): IResolvedOperationContext {
    const service = services.find((candidate) => serviceIdOf(candidate) === operation.serviceId);
    if (!service) {
      throw new Error(`Unknown serviceId: ${operation.serviceId}`);
    }

    return {
      serverRef: {
        id: { kind: "server", value: serviceIdOf(service) },
        url: service.baseUrl,
      },
      authRef: authRefFor(service),
    };
  },
};

/**
 * Function form of `perOperationResolver.resolve`, for callers that want
 * the behaviour without taking a dependency on the object — the object
 * exists so a host can swap the resolution strategy, and most callers
 * never need to.
 */
export function resolvePerOperationContext(
  operation: Pick<IOperation, "serviceId">,
  services: ReadonlyArray<IServiceDescriptor>,
): IResolvedOperationContext {
  return perOperationResolver.resolve(operation, services);
}