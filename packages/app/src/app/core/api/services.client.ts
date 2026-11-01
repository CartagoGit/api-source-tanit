import { Injectable, inject } from "@angular/core";

import { HostBridgeClient } from "./host-bridge.client";
import type {
  IServiceDetail,
  IServiceSummary,
} from "../../../../../contracts/interfaces/core/services.interface";
import type { EndpointRecord, EndpointTransport } from "./endpoints.client";

export type { IServiceDetail, IServiceSummary } from "../../../../../contracts/interfaces/core/services.interface";

/**
 * The services client.
 *
 * The backend answers with what it really knows about each service:
 * its id, the framework that recognized it and how many operations
 * it holds. The transports are **derived** from the endpoints the
 * app already has — they are not invented, they are counted.
 *
 * ## The constructor that could not be injected
 *
 * This client used to take the bridge as a constructor argument, so
 * a test could hand it a fake. It was also declared
 * `providedIn: "root"`, which means Angular built it itself — and
 * Angular cannot resolve a parameter typed as an interface. The
 * first time the app rendered a service list, it would have thrown.
 * The connector is injected now, and the tests provide a fake
 * through the injector.
 */
@Injectable({ providedIn: "root" })
export class ServicesClient {
  private readonly bridge = inject(HostBridgeClient);

  /** The services of the open project. */
  async list(projectRoot: string): Promise<ReadonlyArray<IServiceSummary>> {
    const result = (await this.bridge.request("list-services", { projectRoot })) as {
      services?: ReadonlyArray<IServiceSummary>;
    };
    return result.services ?? [];
  }

  /**
   * The services, with what the endpoint list says about them.
   *
   * The transports are read off the endpoints: a service that has
   * one gRPC call and nine HTTP calls has both, and the app can say
   * so because it has seen the calls.
   */
  async listWithEndpoints(
    projectRoot: string,
    endpoints: readonly EndpointRecord[],
  ): Promise<ReadonlyArray<IServiceDetail>> {
    const services = await this.list(projectRoot);
    return services.map((service) => {
      const own = endpoints.filter((endpoint) => endpoint.service === service.serviceId);
      const transports = own
        .map((endpoint) => endpoint.transport)
        .filter((transport): transport is EndpointTransport => transport !== undefined);
      return {
        ...service,
        transports: [...new Set(transports)].sort(),
        operationCount: own.length > 0 ? own.length : service.endpointCount,
      };
    });
  }

  /**
   * The detail of one service.
   *
   * The API lists the services, but it does not expose the detail of
   * one — its base URL, its auth reference, its operations. The core
   * has the data, so the call is declared **pending**: it fails
   * visibly, and the gap is written down instead of turning into an
   * `UNKNOWN_HANDLER` at runtime.
   */
  detail(projectRoot: string, serviceId: string): Promise<IServiceDetail> {
    return this.bridge
      .requestPending("service-detail", { projectRoot, serviceId })
      .then((result) => {
        const service = (result as { service?: IServiceDetail }).service;
        if (!service) throw new Error(`Service not found: ${serviceId}`);
        return service;
      });
  }
}
