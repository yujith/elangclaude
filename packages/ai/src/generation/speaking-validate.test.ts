import { describe, expect, it } from "vitest";
import type { GeneratedSpeaking } from "./speaking-schema";
import { validateGeneratedSpeaking } from "./speaking-validate";

function base(): GeneratedSpeaking {
  return {
    section: "speaking",
    track: "Academic",
    difficulty: 3,
    topic_domain: "books and reading",
    part1: {
      theme: "Daily life and reading habits",
      subtopics: [
        {
          topic: "Hometown",
          questions: [
            "Where is your hometown?",
            "What do you like about it?",
            "Tell me about the area you grew up in.",
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
        "Why do you think reading habits have changed in recent years?",
        "How important is it for children to read for pleasure?",
        "Do you think printed books will disappear in the future?",
        "What role should libraries play in a community?",
      ],
    },
  };
}

describe("validateGeneratedSpeaking", () => {
  it("accepts a well-formed test", () => {
    expect(validateGeneratedSpeaking(base())).toEqual({ ok: true });
  });

  it("flags topic_domain values outside the 2-5 word contract", () => {
    const v = base();
    v.topic_domain = "reading";
    const res = validateGeneratedSpeaking(v);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.map((i) => i.code)).toContain(
        "topic-domain.word-count",
      );
    }
  });

  it("flags a cue card topic that does not start with 'Describe'", () => {
    const v = base();
    v.part2.cue_card_topic = "Talk about a book you enjoyed.";
    const res = validateGeneratedSpeaking(v);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.map((i) => i.code)).toContain(
        "cue-card.not-describe-prompt",
      );
    }
  });

  it("flags a final prompt that does not begin with 'and'", () => {
    const v = base();
    v.part2.final_prompt = "explain why you found it memorable.";
    const res = validateGeneratedSpeaking(v);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.map((i) => i.code)).toContain(
        "cue-card.malformed-final-prompt",
      );
    }
  });

  it("flags a Part 1 prompt that is neither a question nor an imperative", () => {
    const v = base();
    v.part1.subtopics[0]!.questions[0] = "Your hometown is interesting.";
    const res = validateGeneratedSpeaking(v);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.map((i) => i.code)).toContain(
        "part1.not-question-shaped",
      );
    }
  });

  it("flags a Part 1 opener that is not about home, work, or study", () => {
    const v = base();
    v.part1.subtopics[0] = {
      topic: "Music",
      questions: [
        "Do you enjoy listening to music?",
        "What kind of music do you like?",
        "When do you usually listen to music?",
      ],
    };
    const res = validateGeneratedSpeaking(v);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.map((i) => i.code)).toContain(
        "part1.missing-home-work-study-opening",
      );
    }
  });

  it("accepts a Part 1 'Tell me about …' imperative", () => {
    const v = base();
    v.part1.subtopics[1]!.questions[0] = "Tell me about the last book you read.";
    expect(validateGeneratedSpeaking(v)).toEqual({ ok: true });
  });

  it("flags a Part 2 follow-up that is not question-shaped", () => {
    const v = base();
    v.part2.followup_questions[0] = "Tell me about that briefly.";
    const res = validateGeneratedSpeaking(v);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.map((i) => i.code)).toContain(
        "part2.followup.not-question-shaped",
      );
    }
  });

  it("flags a Part 3 prompt that is not question-shaped", () => {
    const v = base();
    v.part3.questions[0] = "Tell me about changes in reading habits.";
    const res = validateGeneratedSpeaking(v);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.map((i) => i.code)).toContain(
        "part3.not-question-shaped",
      );
    }
  });

  it("flags a Part 3 discussion that is not thematically linked to Part 2", () => {
    const v = base();
    v.topic_domain = "urban transport";
    v.part3.theme = "Commuting and roads";
    v.part3.questions = [
      "How should cities reduce traffic congestion?",
      "Why do some people prefer to drive rather than use public transport?",
      "Do governments spend enough money on roads?",
      "How might driverless cars affect city life?",
    ];
    const res = validateGeneratedSpeaking(v);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.map((i) => i.code)).toContain(
        "part3.not-linked-to-part2",
      );
    }
  });

  it("accepts a broader Part 3 when topic_domain bridges Part 2 and Part 3", () => {
    const v = base();
    v.topic_domain = "learning new skills";
    v.part2.cue_card_topic =
      "Describe a skill you learned from someone in your family.";
    v.part2.bullets = [
      "what the skill was",
      "who taught you",
      "when you learned it",
    ];
    v.part2.final_prompt = "and explain why the skill was useful.";
    v.part3.theme = "Education and training";
    v.part3.questions = [
      "How important is practical training for young people?",
      "What skills do schools often fail to teach?",
      "Why do adults continue learning new skills later in life?",
      "How has online training changed the way people learn?",
    ];
    expect(validateGeneratedSpeaking(v)).toEqual({ ok: true });
  });

  it("flags a duplicate prompt anywhere in the test", () => {
    const v = base();
    // Repeat a Part 1 question as a Part 3 question.
    v.part3.questions[0] = v.part1.subtopics[0]!.questions[0]!;
    const res = validateGeneratedSpeaking(v);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.map((i) => i.code)).toContain(
        "content.duplicate-question",
      );
    }
  });

  it("collects multiple issues at once", () => {
    const v = base();
    v.part2.cue_card_topic = "A book I read.";
    v.part2.final_prompt = "explain the ending.";
    const res = validateGeneratedSpeaking(v);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});
