import { isAbsolute } from "node:path";

import { ReadContractArtifactInputSchema } from "../../contracts/constants/core/application-api.constant.js";
import type {
  ReadContractArtifactInput,
  ReadContractArtifactOutput,
} from "../../contracts/interfaces/core/application-api.interface.js";
import { ensureInside } from "../helpers/path-containment.helper.js";
import { readBoundedText } from "../helpers/read-bounded-text.helper.js";
import { getSession } from "../session/project-session.service.js";
import type { IHandler } from "./dispatcher.js";
import { apiError } from "./error.js";

const MAX_PREVIEW_BYTES = 256 * 1024;

/** Reads one local documentation artifact already identified by the active scan. */
export function createReadContractArtifactHandler(): IHandler<ReadContractArtifactInput, ReadContractArtifactOutput> {
  return {
    name: "read-contract-artifact",
    input: ReadContractArtifactInputSchema,
    async handle({ projectRoot, sessionId, serviceId, artifact }) {
      const session = getSession(projectRoot);
      if (!session || session.id !== sessionId) {
        throw apiError("SESSION_NOT_FOUND", "The project session has changed");
      }
      const snapshot = session.current();
      const listed = snapshot.results.some(result => result.contractEvidence?.sources.some(source =>
        source.kind === "documentation" && source.serviceId === serviceId && source.artifacts.includes(artifact),
      ));
      if (!listed || isAbsolute(artifact)) {
        throw apiError("ARTIFACT_NOT_FOUND", "The artifact is not in the active documentation report");
      }
      const contained = await ensureInside(session.projectRoot, artifact);
      if (!contained.ok) {
        throw apiError("ARTIFACT_NOT_FOUND", "The artifact is outside the project");
      }
      const { text } = await readBoundedText(contained.resolved, MAX_PREVIEW_BYTES).catch(() => {
        throw apiError("EXECUTION_FAILED", "The artifact could not be read as bounded UTF-8 text");
      });
      if (getSession(projectRoot) !== session || session.current() !== snapshot) {
        throw apiError("SESSION_NOT_FOUND", "The project snapshot has changed");
      }
      return { text };
    },
  };
}
