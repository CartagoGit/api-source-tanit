import type { IOperation } from "../../contracts/interfaces/core/operation.interface.js";
import type {
  ICombinedDescriptor,
  IServiceDescriptor,
} from "../../contracts/interfaces/core/service.interface.js";
import { perOperationResolver } from "./per-operation-resolver.service.js";

function serviceIdOf(service: IServiceDescriptor): string {
  return service.id || service.serviceId || "";
}

function resolveOperation(
  operation: IOperation,
  services: ReadonlyArray<IServiceDescriptor>,
): IOperation {
  const context = perOperationResolver.resolve(operation, services);
  return { ...operation, serverRef: context.serverRef, authRef: context.authRef };
}

export function combineServices(
  services: ReadonlyArray<IServiceDescriptor>,
): ICombinedDescriptor {
  const operations = services.flatMap((service) =>
    service.endpoints.map((operation) => resolveOperation(operation, services)),
  );
  const variables = services.flatMap((service) => [
    { key: `baseUrl_${serviceIdOf(service)}`, value: service.baseUrl },
    ...service.variables,
  ]);

  return {
    services,
    variables,
    operations,
    endpoints: operations,
  };
}

export default combineServices;