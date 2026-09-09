export interface SecureStoragePort {
  save(service: string, value: string): Promise<void>;
  saveSession(service: string, value: string): void;
  retrieve(service: string): Promise<string | null>;
  delete(service: string): Promise<void>;
}