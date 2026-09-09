import { Injectable } from "@angular/core";
import type { HostBridgeClient } from "./host-bridge.client";
import type { IServiceDetail, IServiceOperation } from "../../../../../contracts/interfaces/core/services.interface";

interface IServiceBridge {
  request(operation: string, input: unknown): Promise<unknown>;
}

export type { IServiceDetail, IServiceOperation } from "../../../../../contracts/interfaces/core/services.interface";

@Injectable({ providedIn: "root" })
export class ServicesClient {
  private readonly serviceBridge: IServiceBridge;

  constructor(bridge: Pick<HostBridgeClient, "request"> | IServiceBridge) {
    this.serviceBridge = bridge;
  }

  list(projectRoot: string): Promise<ReadonlyArray<IServiceDetail>> {
    return this.serviceBridge
      .request("list-services", { projectRoot })
      .then((result) => (result as { services?: ReadonlyArray<IServiceDetail> }).services ?? []);
  }

  detail(projectRoot: string, serviceId: string): Promise<IServiceDetail> {
    return this.serviceBridge
      .request("service-detail", { projectRoot, serviceId })
      .then((result) => {
        const service = (result as { service?: IServiceDetail }).service;
        if (!service) throw new Error(`Service not found: ${serviceId}`);
        return service;
      });
  }
}