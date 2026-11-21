import { author, homepage } from "../../../../../package.json";
import { CLI_VERSION } from "../../../../contracts/constants/cli/cli-version.constant";

export const APP_METADATA = {
  creator: author,
  repository: homepage,
  version: CLI_VERSION,
} as const;
