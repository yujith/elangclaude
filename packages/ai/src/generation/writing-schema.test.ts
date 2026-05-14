import { describe, expect, it } from "vitest";
import { parseGeneratedWriting } from "./writing-schema";

const T1_ACADEMIC = {
  task_kind: "writing-task-1-academic",
  track: "Academic",
  difficulty: 4,
  prompt:
    "The bar chart below shows the number of visitors to three museums in 2019 and 2023. " +
    "Summarise the information by selecting and reporting the main features, and make comparisons where relevant.\n\n" +
    "Write at least 150 words.",
  body_meta: { visual_kind: "bar", topic: "museum visitor numbers" },
  visual: {
    kind: "bar",
    title: "Museum visitors, 2019 vs 2023",
    unit: "k",
    categories: ["City Museum", "Art Gallery", "Science Centre"],
    series: [
      { name: "2019", values: [120, 90, 75] },
      { name: "2023", values: [150, 85, 110] },
    ],
  },
};

const T1_GENERAL = {
  task_kind: "writing-task-1-general",
  track: "GeneralTraining",
  difficulty: 3,
  prompt:
    "You recently stayed at a hotel and were unhappy with the service you received.\n\n" +
    "Write a letter to the hotel manager. In your letter:\n\n" +
    "- explain why you were staying at the hotel\n" +
    "- describe the problems you experienced\n" +
    "- say what you would like the manager to do\n\n" +
    "Write at least 150 words.\n\n" +
    "You do NOT need to write any addresses.\n\n" +
    "Begin your letter as follows:\n\nDear Sir or Madam,",
  body_meta: {
    register: "formal",
    audience: "the hotel manager",
    scenario_topic: "hotel service complaint",
  },
};

const T2 = {
  task_kind: "writing-task-2",
  track: "Academic",
  difficulty: 5,
  prompt:
    "Some people think that governments should invest in public transport, " +
    "while others believe that money is better spent on building new roads. " +
    "Discuss both views and give your own opinion.\n\n" +
    "Give reasons for your answer and include any relevant examples from your own knowledge or experience.\n\n" +
    "Write at least 250 words.",
  body_meta: { question_subtype: "discussion", topic: "public transport funding" },
};

describe("parseGeneratedWriting", () => {
  it("accepts a valid Task 1 Academic object", () => {
    const r = parseGeneratedWriting(JSON.stringify(T1_ACADEMIC));
    expect(r.ok).toBe(true);
  });

  it("accepts a valid Task 1 General object", () => {
    const r = parseGeneratedWriting(JSON.stringify(T1_GENERAL));
    expect(r.ok).toBe(true);
  });

  it("accepts a valid Task 2 object", () => {
    const r = parseGeneratedWriting(JSON.stringify(T2));
    expect(r.ok).toBe(true);
  });

  it("accepts Task 2 on the General Training track", () => {
    const r = parseGeneratedWriting(
      JSON.stringify({ ...T2, track: "GeneralTraining" }),
    );
    expect(r.ok).toBe(true);
  });

  it("extracts the JSON when the model prefaced it with prose", () => {
    const raw = `Here is the task:\n${JSON.stringify(T2)}\nHope that helps.`;
    const r = parseGeneratedWriting(raw);
    expect(r.ok).toBe(true);
  });

  it("rejects malformed JSON", () => {
    const r = parseGeneratedWriting("not actually json");
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown task_kind", () => {
    const r = parseGeneratedWriting(
      JSON.stringify({ ...T2, task_kind: "writing-task-3" }),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects Task 1 Academic on the General Training track", () => {
    const r = parseGeneratedWriting(
      JSON.stringify({ ...T1_ACADEMIC, track: "GeneralTraining" }),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects Task 1 General on the Academic track", () => {
    const r = parseGeneratedWriting(
      JSON.stringify({ ...T1_GENERAL, track: "Academic" }),
    );
    expect(r.ok).toBe(false);
  });

  it("accepts a visual_kind / visual.kind mismatch at the schema layer (validator's job)", () => {
    // The schema can't enforce this cross-field rule inside a
    // discriminated union — validateGeneratedWriting catches it instead.
    const r = parseGeneratedWriting(
      JSON.stringify({
        ...T1_ACADEMIC,
        body_meta: { ...T1_ACADEMIC.body_meta, visual_kind: "line" },
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("rejects unknown extra keys (strict)", () => {
    const r = parseGeneratedWriting(
      JSON.stringify({ ...T2, surprise: "field" }),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a difficulty outside 1..5", () => {
    const r = parseGeneratedWriting(JSON.stringify({ ...T2, difficulty: 9 }));
    expect(r.ok).toBe(false);
  });

  it("rejects a Task 1 Academic visual with an unknown kind", () => {
    const r = parseGeneratedWriting(
      JSON.stringify({
        ...T1_ACADEMIC,
        body_meta: { visual_kind: "scatter", topic: "x" },
        visual: { kind: "scatter", points: [] },
      }),
    );
    expect(r.ok).toBe(false);
  });
});
