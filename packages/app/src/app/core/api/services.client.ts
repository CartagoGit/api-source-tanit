import { Injectable } from "@angular/core";
import type { HostBridgeClient } from "./host-bridge.client";
import type { IServiceDetail } from "../../../../../contracts/interfaces/core/services.interface";

/** What the services client needs from the connector. */
interface IServiceBridge {
  request(operation: string, input: unknown): Promise<unknown>;
  requestPending(operation: string, input: unknown): Promise<unknown>;
}

export type { IServiceDetail, IServiceOperation } from "../../../../../contracts/interfaces/core/services.interface";

@Injectable({ providedIn: "root" })
export class ServicesClient {
  private readonly serviceBridge: IServiceBridge;

  constructor(bridge: Pick<HostBridgeClient, "request" | "requestPending"> | IServiceBridge) {
    this.serviceBridge = bridge;
  }

  list(projectRoot: string): Promise<ReadonlyArray<IServiceDetail>> {
    return this.serviceBridge
      .request("list-services", { projectRoot })
      .then((result) => (result as { services?: ReadonlyArray<IServiceDetail> }).services ?? []);
  }

  /**
   * The detail of one service has no handler yet: the API lists the
   * services, but the detail — transports, auth, operations — is not
   * exposed.
   */
  detail(projectRoot: string, serviceId: string): Promise<IServiceDetail> {
    return this.serviceBridge
      .requestPending("service-detail", { projectRoot, serviceId })
      .then((result) => {
        const service = (result as { service?: IServiceDetail }).service;
        if (!service) throw new Error(`Service not found: ${serviceId}`);
        return service;
      });
  }
}