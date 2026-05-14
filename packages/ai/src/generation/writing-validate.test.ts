import { describe, expect, it } from "vitest";
import { validateGeneratedWriting } from "./writing-validate";
import type {
  GeneratedWritingTask1Academic,
  GeneratedWritingTask1General,
  GeneratedWritingTask2,
} from "./writing-schema";

function baseAcademic(): GeneratedWritingTask1Academic {
  return {
    task_kind: "writing-task-1-academic",
    track: "Academic",
    difficulty: 4,
    prompt:
      "The bar chart below shows visitor numbers to three museums. " +
      "Summarise the information by selecting and reporting the main features, and make comparisons where relevant.\n\n" +
      "Write at least 150 words.",
    body_meta: { visual_kind: "bar", topic: "museum visitors" },
    visual: {
      kind: "bar",
      title: "Museum visitors",
      categories: ["A", "B", "C"],
      series: [
        { name: "2019", values: [10, 20, 30] },
        { name: "2023", values: [15, 25, 35] },
      ],
    },
  };
}

function baseGeneral(): GeneratedWritingTask1General {
  return {
    task_kind: "writing-task-1-general",
    track: "GeneralTraining",
    difficulty: 3,
    prompt:
      "You recently had a problem with a delivery.\n\n" +
      "Write a letter to the company. In your letter:\n\n" +
      "- explain what you ordered\n" +
      "- describe what went wrong\n" +
      "- say what you want them to do\n\n" +
      "Write at least 150 words.\n\nBegin your letter as follows:\n\nDear Sir or Madam,",
    body_meta: {
      register: "formal",
      audience: "the company",
      scenario_topic: "delivery problem",
    },
  };
}

function baseTask2(): GeneratedWritingTask2 {
  return {
    task_kind: "writing-task-2",
    track: "Academic",
    difficulty: 5,
    prompt:
      "Some people believe remote work benefits society. " +
      "To what extent do you agree or disagree?\n\n" +
      "Give reasons for your answer and include any relevant examples from your own knowledge or experience.\n\n" +
      "Write at least 250 words.",
    body_meta: { question_subtype: "opinion", topic: "remote work" },
  };
}

describe("validateGeneratedWriting", () => {
  it("accepts a well-formed Task 1 Academic", () => {
    expect(validateGeneratedWriting(baseAcademic()).ok).toBe(true);
  });

  it("accepts a well-formed Task 1 General", () => {
    expect(validateGeneratedWriting(baseGeneral()).ok).toBe(true);
  });

  it("accepts a well-formed Task 2", () => {
    expect(validateGeneratedWriting(baseTask2()).ok).toBe(true);
  });

  it("rejects Task 1 Academic missing the word-target line", () => {
    const v = baseAcademic();
    v.prompt = v.prompt.replace("Write at least 150 words.", "");
    const r = validateGeneratedWriting(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "prompt.missing-word-target")).toBe(
        true,
      );
    }
  });

  it("rejects Task 1 Academic missing the 'main features' instruction", () => {
    const v = baseAcademic();
    v.prompt =
      "The bar chart below shows visitor numbers.\n\nWrite at least 150 words.";
    const r = validateGeneratedWriting(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "prompt.missing-instruction")).toBe(
        true,
      );
    }
  });

  it("rejects Task 1 Academic when body_meta.visual_kind disagrees with visual.kind", () => {
    const v = baseAcademic();
    v.body_meta = { visual_kind: "line", topic: "museum visitors" };
    const r = validateGeneratedWriting(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "visual.kind-mismatch")).toBe(
        true,
      );
    }
  });

  it("rejects a bar visual whose series length disagrees with categories", () => {
    const v = baseAcademic();
    v.visual = {
      kind: "bar",
      categories: ["A", "B", "C"],
      series: [{ name: "2019", values: [10, 20] }],
    };
    const r = validateGeneratedWriting(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.issues.some((i) => i.code === "visual.series-length-mismatch"),
      ).toBe(true);
    }
  });

  it("rejects a line visual whose series length disagrees with x_values", () => {
    const v = baseAcademic();
    v.body_meta = { visual_kind: "line", topic: "x" };
    v.visual = {
      kind: "line",
      x_values: ["2000", "2010", "2020"],
      series: [{ name: "rate", values: [1, 2] }],
    };
    const r = validateGeneratedWriting(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.issues.some((i) => i.code === "visual.series-length-mismatch"),
      ).toBe(true);
    }
  });

  it("rejects a table visual with a row that does not match the headers", () => {
    const v = baseAcademic();
    v.body_meta = { visual_kind: "table", topic: "x" };
    v.visual = {
      kind: "table",
      headers: ["Country", "2019", "2023"],
      rows: [
        ["UK", 10, 20],
        ["France", 15],
      ],
    };
    const r = validateGeneratedWriting(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.issues.some((i) => i.code === "visual.table-row-width-mismatch"),
      ).toBe(true);
    }
  });

  it("rejects a percentage pie whose slices do not sum to ~100", () => {
    const v = baseAcademic();
    v.body_meta = { visual_kind: "pie", topic: "x" };
    v.visual = {
      kind: "pie",
      unit: "%",
      slices: [
        { label: "A", value: 30 },
        { label: "B", value: 30 },
      ],
    };
    const r = validateGeneratedWriting(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "visual.pie-sum-implausible")).toBe(
        true,
      );
    }
  });

  it("accepts a non-percentage pie regardless of slice sum", () => {
    const v = baseAcademic();
    v.body_meta = { visual_kind: "pie", topic: "x" };
    v.visual = {
      kind: "pie",
      slices: [
        { label: "A", value: 300 },
        { label: "B", value: 1200 },
      ],
    };
    expect(validateGeneratedWriting(v).ok).toBe(true);
  });

  it("rejects a letter prompt without exactly three bullets", () => {
    const v = baseGeneral();
    v.prompt =
      "You had a problem.\n\nWrite a letter. In your letter:\n\n" +
      "- explain the problem\n- say what you want\n\n" +
      "Write at least 150 words.\n\nDear Sir or Madam,";
    const r = validateGeneratedWriting(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "letter.wrong-bullet-count")).toBe(
        true,
      );
    }
  });

  it("rejects a letter prompt without a salutation", () => {
    const v = baseGeneral();
    v.prompt = v.prompt.replace("Dear Sir or Madam,", "");
    const r = validateGeneratedWriting(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "letter.missing-salutation")).toBe(
        true,
      );
    }
  });

  it("rejects Task 2 missing the word-target line", () => {
    const v = baseTask2();
    v.prompt = v.prompt.replace("Write at least 250 words.", "");
    const r = validateGeneratedWriting(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "prompt.missing-word-target")).toBe(
        true,
      );
    }
  });

  it("rejects Task 2 missing the 'Give reasons' instruction", () => {
    const v = baseTask2();
    v.prompt =
      "Some people believe remote work benefits society. " +
      "To what extent do you agree or disagree?\n\nWrite at least 250 words.";
    const r = validateGeneratedWriting(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "prompt.missing-instruction")).toBe(
        true,
      );
    }
  });
});
