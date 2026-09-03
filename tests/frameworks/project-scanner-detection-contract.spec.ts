import { describe, expect, test } from "vitest";
import { createTempProject } from "../helpers/scanner-fixture";
import {
  DjangoProjectScanner,
} from "../../packages/frameworks/scanners/django.scanner";
import { GinProjectScanner } from "../../packages/frameworks/scanners/gin.scanner";
import { PhoenixProjectScanner } from "../../packages/frameworks/scanners/phoenix.scanner";

function expectValidDetection(result: { score: number; evidence: ReadonlyArray<{ signal: string; weight: number }> }): void {
  expect(Number.isFinite(result.score)).toBe(true);
  expect(result.score).toBeGreaterThanOrEqual(0);
  expect(result.score).toBeLessThanOrEqual(1);
  expect(result.score === 0).toBe(result.evidence.length === 0);
  for (const evidence of result.evidence) {
    expect(evidence.signal.trim()).not.toBe("");
    expect(Number.isFinite(evidence.weight)).toBe(true);
    expect(evidence.weight).toBeGreaterThanOrEqual(0);
    expect(evidence.weight).toBeLessThanOrEqual(1);
  }
}

describe("Project scanner detection contract", () => {
  test("Gin score equals the sum of its evidence weights", async () => {
    const project = await createTempProject({
      "go.mod": "module contract-gin\n\nrequire github.com/gin-gonic/gin v1.9.1\n",
      "main.go": "package main\n",
    }, "detection-contract-gin-");
    try {
      const result = await new GinProjectScanner().detect(project.root);
      expectValidDetection(result);
      expect(result.score).toBeCloseTo(result.evidence.reduce((sum, item) => sum + item.weight, 0));
    } finally {
      await project.cleanup();
    }
  });

  test("Phoenix score equals the available evidence weights", async () => {
    const project = await createTempProject({
      "mix.exs": "defmodule Demo.MixProject do\n  def project, do: [deps: [{:phoenix, \"~> 1.7\"}]]\nend\n",
    }, "detection-contract-phoenix-");
    try {
      const result = await new PhoenixProjectScanner().detect(project.root);
      expectValidDetection(result);
      expect(result.score).toBeCloseTo(result.evidence.reduce((sum, item) => sum + item.weight, 0));
    } finally {
      await project.cleanup();
    }
  });

  test("Django no devuelve score positivo sin evidencia", async () => {
    const project = await createTempProject({
      "requirements.txt": "Django==5.0\n",
    }, "detection-contract-django-");
    try {
      const result = await new DjangoProjectScanner().detect(project.root);
      expectValidDetection(result);
      expect(result.score).toBeGreaterThan(0);
      expect(result.evidence.length).toBeGreaterThan(0);
    } finally {
      await project.cleanup();
    }
  });
});