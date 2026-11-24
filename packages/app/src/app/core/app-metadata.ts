import { author, repository } from "../../../../../package.json";
import { CLI_VERSION } from "../../../../contracts/constants/cli/cli-version.constant";

export function appMetadata() {
  return {
    creator: author,
    repository: repository.url.replace(/^git\+/, "").replace(/\.git$/, ""),
    version: CLI_VERSION,
  } as const;
}
