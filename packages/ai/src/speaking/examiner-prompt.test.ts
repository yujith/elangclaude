import { describe, expect, it } from "vitest";
import {
  buildExaminerScript,
  loadExaminerPrompt,
  type ExaminerScriptContent,
} from "./examiner-prompt";

const CONTENT: ExaminerScriptContent = {
  topic_domain: "books and reading",
  part1: {
    theme: "Daily life and reading habits",
    subtopics: [
      {
        topic: "Hometown",
        questions: [
          "Where is your hometown?",
          "What do you like about it?",
          "Would you like to live there in the future?",
        ],
      },
      {
        topic: "Reading",
        questions: [
          "Do you enjoy reading?",
          "What kind of books do you like?",
          "When do you usually read?",
        ],
      },
      {
        topic: "Free time",
        questions: [
          "What do you do in your free time?",
          "Do you prefer to relax alone or with others?",
          "Has the way you spend free time changed?",
        ],
      },
    ],
  },
  part2: {
    cue_card_topic: "Describe a book you recently read and enjoyed.",
    bullets: [
      "what the book was about",
      "when and where you read it",
      "why you decided to read it",
    ],
    final_prompt: "and explain why you found it memorable.",
    followup_questions: [
      "Did you recommend it to anyone?",
      "Would you read it again?",
    ],
  },
  part3: {
    theme: "Reading and society",
    questions: [
      "Why have reading habits changed in recent years?",
      "How important is it for children to read for pleasure?",
      "Will printed books disappear in the future?",
      "What role should libraries play in a community?",
    ],
  },
};

describe("loadExaminerPrompt", () => {
  it("loads the examiner persona from prompts/speaking/examiner.md", () => {
    const persona = loadExaminerPrompt();
    expect(persona.length).toBeGreaterThan(200);
    // Sanity: the persona names the role and forbids coaching.
    expect(persona).toMatch(/IELTS Speaking examiner/i);
    expect(persona).toMatch(/never coach|do not coach/i);
  });
});

describe("buildExaminerScript", () => {
  const persona = "PERSONA";
  const script = buildExaminerScript({ persona, content: CONTENT });

  it("produces all six stages", () => {
    expect(Object.keys(script).sort()).toEqual(
      [
        "part1",
        "part2_followup",
        "part2_intro",
        "part2_long_turn",
        "part2_prep",
        "part3",
      ].sort(),
    );
  });

  it("Part 2 intro has the examiner deliver the canonical hand-off then stop", () => {
    expect(script.part2_intro.turn_detection).toBe("none");
    expect(script.part2_intro.examiner_opens).toBe(true);
    // Includes the cue card so the examiner reads it verbatim.
    expect(script.part2_intro.instructions).toContain(
      "Describe a book you recently read",
    );
    expect(script.part2_intro.instructions).toMatch(/one to two minutes/i);
    expect(script.part2_intro.instructions).toMatch(
      /one minute to think|one minute starts/i,
    );
  });

  it("Part 1 enables server VAD and the examiner opens", () => {
    expect(script.part1.turn_detection).toBe("server_vad");
    expect(script.part1.examiner_opens).toBe(true);
    expect(script.part1.instructions).toContain("Part 1");
    expect(script.part1.instructions).toContain("Hometown");
    expect(script.part1.instructions).toContain("Where is your hometown?");
  });

  it("Part 2 prep is silent and includes the cue card", () => {
    expect(script.part2_prep.turn_detection).toBe("none");
    expect(script.part2_prep.examiner_opens).toBe(false);
    expect(script.part2_prep.instructions).toContain("Stay silent");
    expect(script.part2_prep.instructions).toContain(
      "Describe a book you recently read",
    );
  });

  it("Part 2 long turn is silent — examiner must not interrupt", () => {
    expect(script.part2_long_turn.turn_detection).toBe("none");
    expect(script.part2_long_turn.examiner_opens).toBe(false);
    expect(script.part2_long_turn.instructions).toMatch(
      /do not interrupt|Stay silent/i,
    );
  });

  it("Part 2 follow-up turns VAD back on and lists the rounding-off questions", () => {
    expect(script.part2_followup.turn_detection).toBe("server_vad");
    expect(script.part2_followup.examiner_opens).toBe(true);
    expect(script.part2_followup.instructions).toContain(
      "Did you recommend it to anyone?",
    );
  });

  it("Part 3 enables server VAD, examiner opens, and includes the discussion questions", () => {
    expect(script.part3.turn_detection).toBe("server_vad");
    expect(script.part3.examiner_opens).toBe(true);
    expect(script.part3.instructions).toContain(
      "Why have reading habits changed",
    );
  });

  it("every stage prepends the persona", () => {
    for (const cfg of Object.values(script)) {
      expect(cfg.instructions.startsWith(persona)).toBe(true);
    }
  });
});
