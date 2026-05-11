import { describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@elc/db";
import { GradeShapeError } from "../errors";
import { createWritingGrader } from "./writing";
import type { WritingTaskKind } from "./prompts";

const CTX: OrgContext = {
  org_id: "org_1",
  user_id: "user_1",
  role: "Learner",
};

const VALID_GRADE = {
  band_overall: 6.5,
  criteria: {
    task_achievement: {
      band: 6.5,
      justification:
        "The response addresses both parts of the prompt with appropriate development.",
      evidence: "\"In my opinion, universities should…\"",
    },
    coherence_cohesion: {
      band: 6.0,
      justification: "Paragraphing is logical but cohesive devices are mechanical.",
      evidence: "\"Furthermore, in addition\"",
    },
    lexical_resource: {
      band: 7.0,
      justification: "Wide vocabulary range with accurate collocations.",
      evidence: "\"marked decline in remote engagement\"",
    },
    grammatical_range: {
      band: 6.0,
      justification: "Mix of simple and complex structures with some agreement errors.",
      evidence: "\"The chart show a sharp increase\"",
    },
  },
  strengths: [
    "Wide vocabulary with accurate collocations.",
    "Logical paragraphing with clear topic sentences.",
  ],
  improvements: [
    "Develop the second part of the essay with examples.",
    "Watch subject-verb agreement in long sentences.",
  ],
  next_drill: "task-2-grammar-agreement",
};

const PROMPT_BODY =
  "Grade IELTS Writing.\n\nTask:\n<<TASK_PROMPT>>\n\nResponse:\n<<RESPONSE>>\n\nReturn JSON.";

type ChatArg = {
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
};

function makeAi(responses: { text: string }[]) {
  let i = 0;
  const recorded: ChatArg[] = [];
  const chat = async (arg: ChatArg) => {
    recorded.push(arg);
    const r = responses[i] ?? responses[responses.length - 1];
    if (!r) throw new Error("no response stubbed");
    i++;
    return {
      text: r.text,
      model: "claude-sonnet-4-5-20250929",
      usage: { input_tokens: 1000, output_tokens: 500 },
    };
  };
  return {
    ai: { chat: chat as unknown as Parameters<typeof createWritingGrader>[0]["ai"]["chat"] },
    calls: () => recorded,
  };
}

function makeGrader(opts: {
  responses: { text: string }[];
  loadPrompt?: (k: WritingTaskKind) => string;
}) {
  const { ai, calls } = makeAi(opts.responses);
  const grader = createWritingGrader({
    ai,
    loadPrompt: opts.loadPrompt ?? (() => PROMPT_BODY),
  });
  return { grader, calls };
}

describe("writingGrader.grade", () => {
  it("happy path: returns the parsed grade after one chat call", async () => {
    const { grader, calls } = makeGrader({
      responses: [{ text: JSON.stringify(VALID_GRADE) }],
    });
    const out = await grader.grade({
      ctx: CTX,
      taskType: "writing-task-2",
      taskPrompt: "Discuss both views.",
      responseText: "A 250 word essay.",
    });
    expect(out.grade.band_overall).toBe(6.5);
    expect(out.attempts).toBe(1);
    expect(calls()).toHaveLength(1);
  });

  it("substitutes <<TASK_PROMPT>> and <<RESPONSE>> in the system message", async () => {
    const { grader, calls } = makeGrader({
      responses: [{ text: JSON.stringify(VALID_GRADE) }],
    });
    await grader.grade({
      ctx: CTX,
      taskType: "writing-task-2",
      taskPrompt: "PROMPT-MARKER-XYZ",
      responseText: "RESPONSE-MARKER-XYZ",
    });
    const first = calls()[0];
    expect(first).toBeDefined();
    expect(first?.system).toContain("PROMPT-MARKER-XYZ");
    expect(first?.system).toContain("RESPONSE-MARKER-XYZ");
    expect(first?.system).not.toContain("<<TASK_PROMPT>>");
    expect(first?.system).not.toContain("<<RESPONSE>>");
  });

  it("retries once on malformed JSON, succeeds on second try", async () => {
    const { grader, calls } = makeGrader({
      responses: [
        { text: "Here's the grade: { not valid json" },
        { text: JSON.stringify(VALID_GRADE) },
      ],
    });
    const out = await grader.grade({
      ctx: CTX,
      taskType: "writing-task-2",
      taskPrompt: "p",
      responseText: "r",
    });
    expect(out.attempts).toBe(2);
    expect(calls()).toHaveLength(2);
    // The retry includes the assistant turn so the model can see its
    // own malformed response.
    const retry = calls()[1];
    expect(retry).toBeDefined();
    expect(retry?.messages.some((m) => m.role === "assistant")).toBe(true);
  });

  it("retries once on schema-invalid JSON (eg non-half band)", async () => {
    const invalid = { ...VALID_GRADE, band_overall: 6.3 };
    const { grader } = makeGrader({
      responses: [
        { text: JSON.stringify(invalid) },
        { text: JSON.stringify(VALID_GRADE) },
      ],
    });
    const out = await grader.grade({
      ctx: CTX,
      taskType: "writing-task-2",
      taskPrompt: "p",
      responseText: "r",
    });
    expect(out.attempts).toBe(2);
  });

  it("throws GradeShapeError after two bad responses", async () => {
    const { grader, calls } = makeGrader({
      responses: [
        { text: "still nonsense" },
        { text: "{ also nonsense" },
      ],
    });
    await expect(
      grader.grade({
        ctx: CTX,
        taskType: "writing-task-2",
        taskPrompt: "p",
        responseText: "r",
      }),
    ).rejects.toBeInstanceOf(GradeShapeError);
    expect(calls()).toHaveLength(2);
  });

  it("loads the prompt that matches the taskType", async () => {
    const loaded: WritingTaskKind[] = [];
    const { grader } = makeGrader({
      responses: [{ text: JSON.stringify(VALID_GRADE) }],
      loadPrompt: (k) => {
        loaded.push(k);
        return PROMPT_BODY;
      },
    });
    await grader.grade({
      ctx: CTX,
      taskType: "writing-task-1-general",
      taskPrompt: "p",
      responseText: "r",
    });
    expect(loaded).toEqual(["writing-task-1-general"]);
  });
});
