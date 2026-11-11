import { OUTPUT_DIR_NAME } from "./postman.constant.js";

/** Dependency and generated directories excluded from source session watchers. */
export const SESSION_WATCH_IGNORED_DIRECTORY_NAMES: readonly string[] = [
  "node_modules", "vendor", ".git", ".cache", "dist", "build", OUTPUT_DIR_NAME,
];
