import { homedir } from "node:os";
import { join } from "node:path";

import {
  STATE_DB_DIRECTORY_NAME,
  STATE_DB_ENVIRONMENT_VARIABLE,
  STATE_DB_FILE_NAME,
} from "../../../contracts/constants/core/state-store.constant.js";

/** Resuelve la ruta de la base de estado desde el entorno o el valor por defecto. */
export function resolveStateDatabasePath(environment: Record<string, string | undefined> = process.env): string {
  const override = environment[STATE_DB_ENVIRONMENT_VARIABLE];
  return override && override.trim().length > 0
    ? override
    : join(homedir(), STATE_DB_DIRECTORY_NAME, STATE_DB_FILE_NAME);
}