/**
 * Tests for the output sinks (c00010 S1).
 *
 * Verifies that the sinks route to the right file descriptor and that
 * `selectOutputSink` picks the right implementation based on the JSON
 * flag. The test uses `vi.spyOn(process.stdout, "write")` and the same
 * on stderr — these are not the `console.log =` reassignment banned by
 * `lint:no-monkey-patch`, because they don't mutate a global reference
 * but observe a method call.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  ConsoleOutputSink,
  JsonModeConsoleSink,
  selectOutputSink,
} from "../../packages/core/services/output-sink.service";

describe("ConsoleOutputSink", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  test("write → stdout", () => {
    new ConsoleOutputSink().write("hello");
    expect(stdoutSpy).toHaveBeenCalledWith("hello\n");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  test("writeError → stderr", () => {
    new ConsoleOutputSink().writeError("boom");
    expect(stderrSpy).toHaveBeenCalledWith("boom\n");
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  test("writeJson → stdout (report channel)", () => {
    new ConsoleOutputSink().writeJson('{"ok":true}');
    expect(stdoutSpy).toHaveBeenCalledWith('{"ok":true}\n');
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

describe("JsonModeConsoleSink", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  test("write → stderr (keeps stdout for the report)", () => {
    new JsonModeConsoleSink().write("trace");
    expect(stderrSpy).toHaveBeenCalledWith("trace\n");
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  test("writeError → stderr", () => {
    new JsonModeConsoleSink().writeError("warn");
    expect(stderrSpy).toHaveBeenCalledWith("warn\n");
  });

  test("writeJson → stdout (always reserved for the report)", () => {
    new JsonModeConsoleSink().writeJson('{"ok":true}');
    expect(stdoutSpy).toHaveBeenCalledWith('{"ok":true}\n');
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

describe("selectOutputSink", () => {
  test("jsonMode: true → JsonModeConsoleSink", () => {
    expect(selectOutputSink({ jsonMode: true })).toBeInstanceOf(JsonModeConsoleSink);
  });

  test("jsonMode: false → ConsoleOutputSink", () => {
    expect(selectOutputSink({ jsonMode: false })).toBeInstanceOf(ConsoleOutputSink);
  });
});