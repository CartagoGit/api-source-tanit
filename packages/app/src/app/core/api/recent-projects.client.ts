import type { IBrowseListing } from "../../../../../contracts/interfaces/cli/browse.interface";

interface IDirectoryPicker {
  readonly pick: () => Promise<string | null>;
}

export class RecentProjectsClient {
  async browse(path?: string): Promise<IBrowseListing> {
    const response = await fetch("/api/browse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(path ? { path } : {}),
    });
    if (!response.ok) throw new Error(`Browse failed (${response.status})`);
    return (await response.json()) as IBrowseListing;
  }
}