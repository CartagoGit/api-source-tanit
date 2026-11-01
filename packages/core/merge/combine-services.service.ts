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

function assertUniqueServiceIds(services: ReadonlyArray<IServiceDescriptor>): void {
  const seen = new Set<string>();
  for (const service of services) {
    const id = serviceIdOf(service);
    if (id.length === 0) throw new Error("Service id must not be empty");
    if (seen.has(id)) throw new Error(`Duplicate service id: ${id}`);
    seen.add(id);
  }
}

function assertUniqueVariableKeys(
  variables: ReadonlyArray<{ readonly key: string; readonly value: string }>,
): void {
  const seen = new Set<string>();
  for (const variable of variables) {
    if (seen.has(variable.key)) throw new Error(`Duplicate variable key: ${variable.key}`);
    seen.add(variable.key);
  }
}

/**
 * Merges several services into one descriptor whose operations each carry
 * their own server and auth.
 *
 * Both uniqueness checks THROW rather than de-duplicating. A duplicate
 * `serviceId` or variable key means two services disagree about a name
 * that has to be unique for the merge to mean anything, and silently
 * keeping one of them would produce a collection that looks complete
 * while quietly dropping half of somebody's endpoints. Refusing names
 * the collision while the caller can still fix it.
 *
 * `endpoints` mirrors `operations` for the older consumers that have not
 * moved to the r00019 vocabulary yet; both refer to the same array.
 */
export function combineServices(
  services: ReadonlyArray<IServiceDescriptor>,
): ICombinedDescriptor {
  assertUniqueServiceIds(services);
  const operations = services.flatMap((service) =>
    service.endpoints.map((operation) => resolveOperation(operation, services)),
  );
  const variables = services.flatMap((service) => [
    { key: `baseUrl_${serviceIdOf(service)}`, value: service.baseUrl },
    ...service.variables,
  ]);
  assertUniqueVariableKeys(variables);

  return {
    services,
    variables,
    operations,
    endpoints: operations,
  };
}

export default combineServices;