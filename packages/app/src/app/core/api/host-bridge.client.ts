import { Injectable } from "@angular/core";
import type {
  IHostBridge,
  IHostRequestMap,
  IHostResponseMap,
} from "../../../../../contracts/interfaces/ui/host-bridge.interface";

@Injectable({ providedIn: "root" })
export class HostBridgeClient implements IHostBridge {
  request<K extends keyof IHostRequestMap>(
    operation: K,
    input: IHostRequestMap[K],
  ): Promise<IHostResponseMap[K]> {
    void operation;
    void input;
    return Promise.reject(new Error("Host bridge is not connected"));
  }

  subscribe(listener: (event: unknown) => void): () => void {
    void listener;
    return () => undefined;
  }
}
