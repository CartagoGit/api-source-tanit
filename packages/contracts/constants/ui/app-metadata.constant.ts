import { author, repository } from "../../../../package.json";
import { CLI_VERSION } from "../cli/cli-version.constant.js";

export const APP_METADATA = {
  creator: author,
  repository: repository.url.replace(/^git\+/, "").replace(/\.git$/, ""),
  version: CLI_VERSION,
} as const;
