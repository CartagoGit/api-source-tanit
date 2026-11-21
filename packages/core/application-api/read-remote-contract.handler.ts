import { ReadRemoteContractInputSchema } from "../../contracts/constants/core/application-api.constant.js";
import type { ReadContractArtifactOutput, ReadRemoteContractInput } from "../../contracts/interfaces/core/application-api.interface.js";
import { getSession } from "../session/project-session.service.js";
import type { IHandler } from "./dispatcher.js";
import { apiError } from "./error.js";
import { readRemoteContractText } from "./remote-contract-text.helper.js";

/** Loads one declared documentation link from the active service on request. */
export function createReadRemoteContractHandler(): IHandler<ReadRemoteContractInput, ReadContractArtifactOutput> {
  return {
    name: "read-remote-contract",
    input: ReadRemoteContractInputSchema,
    async handle({ projectRoot, sessionId, serviceId, url }) {
      const session = getSession(projectRoot);
      if (!session || session.id !== sessionId) {
        throw apiError("SESSION_NOT_FOUND", "The project session has changed");
      }
      const snapshot = session.current();
      const listed = snapshot.results.some(result => result.contractEvidence?.sources.some(source =>
        source.kind === "documentation" && source.serviceId === serviceId && source.links?.some(link => link.url === url),
      ));
      if (!listed) {
        throw apiError("ARTIFACT_NOT_FOUND", "The URL is not in the active documentation report");
      }
      const text = await readRemoteContractText(url).catch(() => {
        throw apiError("EXECUTION_FAILED", "The remote documentation could not be read");
      });
      if (getSession(projectRoot) !== session || session.current() !== snapshot) {
        throw apiError("SESSION_NOT_FOUND", "The project snapshot has changed");
      }
      return { text };
    },
  };
}
