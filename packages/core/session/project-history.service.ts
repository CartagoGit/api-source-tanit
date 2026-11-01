import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { toCanonicalSnapshot } from "./canonical-snapshot.service.js";
import { diffSnapshots } from "./history-diff.helper.js";
import { decodeSnapshot, encodeSnapshot } from "./snapshot-codec.helper.js";
import { snapshotSha256 } from "./snapshot-hash.service.js";
import {
  HISTORY_STORE_DIRECTORY_NAME,
  HISTORY_STORE_ENVIRONMENT_VARIABLE,
  STATE_DB_DIRECTORY_NAME,
} from "../../contracts/constants/core/state-store.constant.js";
import type { IHistoryDiff, IHistoryRecord, IHistorySummary } from "../../contracts/interfaces/core/history.interface.js";
import type { IProjectSnapshot } from "../../contracts/interfaces/core/session.interface.js";

/**
 * The persisted history of a project.
 *
 * ## What it is
 *
 * A folder per project, one file per record. Each record holds:
 *
 *   · the **canonical snapshot** — what the API surface was, in the
 *     shape the diff compares and the hash digests;
 *   · the **whole snapshot** — so the record can be exported again,
 *     or restored, exactly as it was;
 *   · the **configuration** it was made with — the formats, where it
 *     was written — so two records can be compared by how they were
 *     built, not only by what they contain.
 *
 * ## Why it is on disk and not in memory
 *
 * Because a history that dies with the process is not a history. The
 * whole point of remembering a revision is being able to come back to
 * it **later**: tomorrow, next week, from another machine that syncs
 * the folder. The in-memory recorder that used to live here was
 * written, tested, and wired to nothing — the diff had no history to
 * compare and the hash had nothing to digest.
 *
 * ## Why one file per record
 *
 * Because two processes must not fight over one file. A JSON array
 * would be read-modify-written by both, and the loser would drop the
 * winner's record. One file per record means one writer per file: a
 * record is written once and never rewritten, so the only race left
 * is two records with the same id, and the id carries the hash of
 * what it holds.
 *
 * ## Where it lives
 *
 * `~/.tanit/history/<project>/`, next to the state store and the
 * user's own settings — **not** inside the project. A tool that
 * writes into the project it is analysing changes what it analyses,
 * and the project belongs to the person, not to the tool.
 */
export interface IProjectHistoryOptions {
  /** Where the history lives. The user's own folder when nobody says. */
  readonly directory?: string;
}

/** How a record was made. */
export interface IHistoryRecordOptions {
  /** The formats it was written in. */
  readonly formats?: ReadonlyArray<string>;
  /** Where it was written. */
  readonly output?: string;
  /** What made it. */
  readonly source?: IHistoryRecord["provenance"]["source"];
  /** The record it came from. */
  readonly parentId?: string;
  /** How it was configured. */
  readonly configuration?: Readonly<Record<string, unknown>>;
}

/** The two configurations, side by side. */
export interface IHistoryConfigurationPair {
  readonly before: Readonly<Record<string, unknown>>;
  readonly after: Readonly<Record<string, unknown>>;
}

/** What is written in each file. */
interface IPersistedRecord {
  /** The version of the format, so a future reader knows what it has. */
  readonly version: 1;
  /** The record: what it is, when, and its canonical snapshot. */
  readonly record: IHistoryRecord;
  /** The whole snapshot, encoded: what it can be exported or restored from. */
  readonly snapshot: string;
}

/** The version this code writes. */
const PERSISTED_VERSION = 1;

/** The characters a record's id may not have. */
const UNSAFE_ID = /[^A-Za-z0-9._-]/g;

/**
 * Where the history of every project lives.
 *
 * @param environment The environment to read the override from.
 * @returns The folder.
 */
export function resolveHistoryDirectory(
  environment: Record<string, string | undefined> = process.env,
): string {
  const override = environment[HISTORY_STORE_ENVIRONMENT_VARIABLE];
  return override !== undefined && override.trim() !== ""
    ? override
    : join(homedir(), STATE_DB_DIRECTORY_NAME, HISTORY_STORE_DIRECTORY_NAME);
}

/**
 * The folder of one project's history.
 *
 * The project's path is hashed: a path is not a folder name (it has
 * slashes, and it can be longer than a file name allows), and the
 * hash keeps the name short and stable.
 */
function projectDirectory(root: string, base: string): string {
  const key = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return join(base, key);
}

/** An id is safe to be a file name. */
function safeId(id: string): string {
  return id.replace(UNSAFE_ID, "_");
}

/** The persisted document of a record. */
function toPersisted(
  record: IHistoryRecord,
  snapshot: IProjectSnapshot,
): IPersistedRecord {
  return {
    version: PERSISTED_VERSION,
    record,
    snapshot: encodeSnapshot(snapshot),
  };
}

/**
 * Reads a persisted document.
 *
 * A file that cannot be read is **not** a record that is empty: the
 * reader says so and moves on, because one broken file must not hide
 * the other records.
 */
function fromPersisted(text: string): { record: IHistoryRecord; snapshot: unknown } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") return undefined;
  const document = parsed as Partial<IPersistedRecord>;
  if (document.version !== PERSISTED_VERSION) return undefined;
  if (document.record === undefined || typeof document.snapshot !== "string") return undefined;
  let snapshot: unknown;
  try {
    snapshot = decodeSnapshot(document.snapshot);
  } catch {
    return undefined;
  }
  return { record: document.record, snapshot };
}

/** The persisted history of a project. */
export class ProjectHistoryService {
  private readonly base: string;

  constructor(options: IProjectHistoryOptions = {}) {
    this.base = options.directory ?? resolveHistoryDirectory();
  }

  /**
   * Remembers a snapshot.
   *
   * @param projectRoot The project it belongs to.
   * @param snapshot The snapshot, whole.
   * @param options How it was made.
   * @returns The record.
   */
  async record(
    projectRoot: string,
    snapshot: IProjectSnapshot,
    options: IHistoryRecordOptions = {},
  ): Promise<IHistoryRecord> {
    const canonical = toCanonicalSnapshot(snapshot);
    const sha256 = snapshotSha256(canonical);
    const timestamp = snapshot.capturedAt.toISOString();
    const record: IHistoryRecord = {
      id: `${timestamp}-${sha256.slice(0, 12)}`,
      timestamp,
      formats: [...(options.formats ?? [])].sort(),
      count: canonical.services.reduce(
        (total, service) => total + service.operations.length,
        0,
      ),
      output: options.output ?? "",
      sha256,
      provenance: {
        source: options.source ?? "scan",
        projectRoot,
        parentId: options.parentId,
      },
      configuration: { ...(options.configuration ?? {}) },
      snapshot: canonical,
    };
    const directory = projectDirectory(projectRoot, this.base);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, `${safeId(record.id)}.json`),
      JSON.stringify(toPersisted(record, snapshot), null, 2),
      "utf8",
    );
    return record;
  }

  /**
   * The records of a project, newest first.
   *
   * @param projectRoot The project.
   * @returns The records.
   */
  async list(projectRoot: string): Promise<ReadonlyArray<IHistoryRecord>> {
    const directory = projectDirectory(projectRoot, this.base);
    const names = await this.fileNames(directory);
    const records: IHistoryRecord[] = [];
    for (const name of names) {
      const persisted = await this.readPersisted(directory, name);
      if (persisted !== undefined) records.push(persisted.record);
    }
    return records.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  }

  /**
   * The revisions of a project, without their snapshots.
   *
   * A list is a list: it says what each revision was, and the
   * snapshot stays on disk until somebody asks for it.
   *
   * @param projectRoot The project.
   * @returns The revisions, newest first.
   */
  async summaries(projectRoot: string): Promise<ReadonlyArray<IHistorySummary>> {
    const records = await this.list(projectRoot);
    return records.map((record) => ({
      id: record.id,
      timestamp: record.timestamp,
      formats: record.formats,
      count: record.count,
      output: record.output,
      sha256: record.sha256,
      source: record.provenance.source,
    }));
  }

  /**
   * One record.
   *
   * @param projectRoot The project.
   * @param id The record's id.
   * @returns The record, when it is there.
   */
  async get(
    projectRoot: string,
    id: string,
  ): Promise<IHistoryRecord | undefined> {
    const directory = projectDirectory(projectRoot, this.base);
    const persisted = await this.readPersisted(directory, `${safeId(id)}.json`);
    return persisted?.record;
  }

  /**
   * The snapshot a record was made from.
   *
   * @param projectRoot The project.
   * @param id The record's id.
   * @returns The snapshot, when the record is there.
   */
  async snapshotOf(
    projectRoot: string,
    id: string,
  ): Promise<IProjectSnapshot | undefined> {
    const directory = projectDirectory(projectRoot, this.base);
    const persisted = await this.readPersisted(directory, `${safeId(id)}.json`);
    if (persisted === undefined) return undefined;
    const snapshot = persisted.snapshot as Partial<IProjectSnapshot>;
    if (!Array.isArray(snapshot.results)) return undefined;
    if (typeof snapshot.projectRoot !== "string") return undefined;
    return snapshot as IProjectSnapshot;
  }

  /**
   * What changed between two records.
   *
   * @param projectRoot The project.
   * @param leftId The older record.
   * @param rightId The newer record.
   * @returns The difference.
   * @throws When one of the records is not there: a comparison with a
   * missing revision is not an empty comparison.
   */
  async compare(
    projectRoot: string,
    leftId: string,
    rightId: string,
  ): Promise<IHistoryDiff> {
    const left = await this.require(projectRoot, leftId);
    const right = await this.require(projectRoot, rightId);
    return diffSnapshots(
      left.snapshot,
      right.snapshot,
      left.configuration,
      right.configuration,
    );
  }

  /**
   * How two records were configured.
   *
   * @param projectRoot The project.
   * @param leftId The older record.
   * @param rightId The newer record.
   * @returns The two configurations.
   * @throws When one of the records is not there.
   */
  async compareConfiguration(
    projectRoot: string,
    leftId: string,
    rightId: string,
  ): Promise<IHistoryConfigurationPair> {
    const left = await this.require(projectRoot, leftId);
    const right = await this.require(projectRoot, rightId);
    return { before: left.configuration, after: right.configuration };
  }

  /** A record, or the reason there is not one. */
  private async require(
    projectRoot: string,
    id: string,
  ): Promise<IHistoryRecord> {
    const record = await this.get(projectRoot, id);
    if (record === undefined) {
      throw new Error(`History record "${id}" does not exist for this project`);
    }
    return record;
  }

  /** The names of the files of a folder, when the folder is there. */
  private async fileNames(directory: string): Promise<ReadonlyArray<string>> {
    try {
      return (await readdir(directory)).filter((name) => name.endsWith(".json"));
    } catch {
      return [];
    }
  }

  /** One persisted document. */
  private async readPersisted(
    directory: string,
    name: string,
  ): Promise<{ record: IHistoryRecord; snapshot: unknown } | undefined> {
    try {
      return fromPersisted(await readFile(join(directory, name), "utf8"));
    } catch {
      return undefined;
    }
  }
}
