import { Injectable } from "@angular/core";
import type { HostBridgeClient } from "./host-bridge.client";

interface IServiceBridge {
  request(operation: string, input: unknown): Promise<unknown>;
}

export interface IServiceOperation {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly requestSchema?: unknown;
  readonly responseSchema?: unknown;
  readonly auth?: unknown;
  readonly serverRef?: string;
  readonly authRef?: string;
}

export interface IServiceDetail {
  readonly serviceId: string;
  readonly framework: string;
  readonly transports: ReadonlyArray<string>;
  readonly auth: unknown;
  readonly baseUrl?: string;
  readonly serverRef?: string;
  readonly authRef?: string;
  readonly operationCount: number;
  readonly operations: ReadonlyArray<IServiceOperation>;
}

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