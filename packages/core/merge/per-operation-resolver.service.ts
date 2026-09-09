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

export function resolvePerOperationContext(
  operation: Pick<IOperation, "serviceId">,
  services: ReadonlyArray<IServiceDescriptor>,
): IResolvedOperationContext {
  return perOperationResolver.resolve(operation, services);
}