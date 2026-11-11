export interface PushRequest {
  readonly projectRoot: string;
  readonly workspace?: string;
  readonly dryRun?: boolean;
  readonly apiKey?: string;
}
