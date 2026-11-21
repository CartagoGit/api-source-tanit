import { constants } from "node:fs";
import { open } from "node:fs/promises";

/** Read at most one byte over the limit, even if the file grows after stat. */
export async function readBoundedText(path: string, limit: number): Promise<{ text: string; bytes: number }> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const details = await file.stat();
    if (!details.isFile()) throw new Error("Expected a regular file");
    if (details.size > limit) throw new Error(`file size limit (${limit} bytes) exceeded`);
    const buffer = Buffer.alloc(limit + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const result = await file.read(buffer, bytes, buffer.length - bytes, bytes);
      if (result.bytesRead === 0) break;
      bytes += result.bytesRead;
    }
    if (bytes > limit) throw new Error(`file size limit (${limit} bytes) exceeded`);
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytes)), bytes };
  } finally {
    await file.close();
  }
}
