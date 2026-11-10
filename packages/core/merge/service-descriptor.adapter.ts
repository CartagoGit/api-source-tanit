import type { IOperation } from "../../contracts/interfaces/core/operation.interface.js";
import type { IServiceDescriptor } from "../../contracts/interfaces/core/service.interface.js";
import type { IServiceGraphNode } from "../../contracts/interfaces/core/service-graph.interface.js";

/** Adapts one discovery graph node to the exporter's service contract. */
export function toServiceDescriptor(
  node: IServiceGraphNode,
  endpoints: ReadonlyArray<IOperation>,
): IServiceDescriptor {
  return {
    id: node.serviceId,
    baseUrl: node.baseUrl ?? "",
    auth: node.auth,
    variables: node.variables,
    transport: endpoints[0]?.transport ?? {
      kind: "http",
      method: "GET",
      path: "/",
    },
    endpoints,
  };
}
