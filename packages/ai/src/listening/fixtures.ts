// Hand-authored Listening fixture — one Academic 4-part section that
// exercises every Phase 1 question kind and every Phase 1 completion-block
// layout. The parser tests assert this round-trips cleanly through
// parseListeningContent + parseListeningQuestionPayload, and Phases 4+
// reuse it as a deterministic seed (no LLM call needed during dev).
//
// The transcripts are deliberately compact: just enough natural speech to
// validate the segment parser. They are NOT publishable IELTS practice
// content. Phase 3 (generation) and Phase 7 (content seeding) produce the
// real catalogue.

import type {
  ListeningContent,
  ListeningPart,
  ListeningSpeaker,
} from "./content";
import type { ListeningQuestionPayload } from "./question-types";

// A faux Question row — mirrors the columns the DB writes, minus ids/
// timestamps. Phase 4 imports this to seed the DB; Phase 1 only uses it
// to assert the per-question payloads round-trip through their parsers.
export type ListeningFixtureQuestion = {
  position: number;
  type: ListeningQuestionPayload["kind"];
  prompt: string;
  correct_answer: ListeningQuestionPayload;
  points: number;
};

// ─── Speakers ───────────────────────────────────────────────────────────

const narratorBritish: ListeningSpeaker = {
  id: "narrator",
  name: "Narrator",
  role: "narrator",
  accent: "british",
};

const part1Receptionist: ListeningSpeaker = {
  id: "receptionist",
  name: "Library Receptionist",
  role: "speaker",
  accent: "british",
};

const part1Caller: ListeningSpeaker = {
  id: "caller",
  name: "Maria",
  role: "speaker",
  accent: "australian",
};

const part2Guide: ListeningSpeaker = {
  id: "guide",
  name: "Garden Tour Guide",
  role: "speaker",
  accent: "american",
};

const part3Tutor: ListeningSpeaker = {
  id: "tutor",
  name: "Dr. Whitlock",
  role: "speaker",
  accent: "british",
};

const part3StudentA: ListeningSpeaker = {
  id: "student-a",
  name: "Hannah",
  role: "speaker",
  accent: "canadian",
};

const part3StudentB: ListeningSpeaker = {
  id: "student-b",
  name: "Joel",
  role: "speaker",
  accent: "new-zealand",
};

const part4Lecturer: ListeningSpeaker = {
  id: "lecturer",
  name: "Professor Adlam",
  role: "speaker",
  accent: "australian",
};

// ─── Parts ──────────────────────────────────────────────────────────────

const part1: ListeningPart = {
  part: 1,
  context: "social",
  title: "Applying for a library card",
  speakers: [narratorBritish, part1Receptionist, part1Caller],
  question_positions: [0, 1, 2, 3, 4],
  transcript: [
    { kind: "narration", text: "Now turn to Part 1." },
    {
      kind: "questions-preview",
      seconds: 30,
      question_positions: [0, 1, 2, 3, 4],
      // The narrator first tells the learner what to look at.
      // Real IELTS pairs the audio cue with a silent pause; the player
      // surfaces both.
    },
    {
      kind: "speech",
      speaker_id: part1Receptionist.id,
      text: "Good morning, Riverside Library. How can I help?",
    },
    {
      kind: "speech",
      speaker_id: part1Caller.id,
      text: "Hi there, I'd like to apply for a library card, please.",
    },
    {
      kind: "speech",
      speaker_id: part1Receptionist.id,
      text:
        "Of course. Can I take a few details? Your full name, first.",
    },
    {
      kind: "speech",
      speaker_id: part1Caller.id,
      text: "It's Maria Costa. C-O-S-T-A.",
    },
    {
      kind: "speech",
      speaker_id: part1Receptionist.id,
      text: "And your home address?",
    },
    {
      kind: "speech",
      speaker_id: part1Caller.id,
      text: "Twenty-four Riverside Crescent, that's in the Brighton area.",
    },
    {
      kind: "speech",
      speaker_id: part1Receptionist.id,
      text: "Lovely. A contact number?",
    },
    {
      kind: "speech",
      speaker_id: part1Caller.id,
      text: "Yes — oh-seven-eight-double-five, three-one-four, two-nine-nine.",
    },
    {
      kind: "speech",
      speaker_id: part1Receptionist.id,
      text:
        "Perfect. And which membership type would you like — Standard or Premium?",
    },
    {
      kind: "speech",
      speaker_id: part1Caller.id,
      text: "Premium, please — I'd like to borrow audiobooks.",
    },
    {
      kind: "speech",
      speaker_id: part1Receptionist.id,
      text:
        "Premium is twenty-eight pounds a year. That's fine if you can pay by card today.",
    },
    {
      kind: "reading-pause",
      seconds: 30,
      instruction: "You now have 30 seconds to check your answers to Part 1.",
    },
  ],
  completion_blocks: [
    {
      id: "p1-form",
      layout: "form",
      title: "Library card application",
      instructions: "Write NO MORE THAN TWO WORDS AND/OR A NUMBER for each answer.",
      rows: [
        {
          label: "Surname",
          cells: [[{ kind: "blank", slot_id: "p1-surname" }]],
        },
        {
          label: "Address (street + number)",
          cells: [[{ kind: "blank", slot_id: "p1-address" }]],
        },
        {
          label: "Contact number",
          cells: [[{ kind: "blank", slot_id: "p1-phone" }]],
        },
        {
          label: "Membership type",
          cells: [[{ kind: "blank", slot_id: "p1-membership" }]],
        },
      ],
    },
  ],
};

const part2: ListeningPart = {
  part: 2,
  context: "social",
  title: "Community garden tour",
  speakers: [narratorBritish, part2Guide],
  question_positions: [5, 6, 7, 8, 9],
  transcript: [
    { kind: "narration", text: "Now turn to Part 2." },
    {
      kind: "questions-preview",
      seconds: 30,
      question_positions: [5, 6],
    },
    {
      kind: "speech",
      speaker_id: part2Guide.id,
      text:
        "Welcome to Eastfield Community Garden. The garden was founded in 2014 by a small group of neighbours who turned a disused car park into the green space you see today.",
    },
    {
      kind: "speech",
      speaker_id: part2Guide.id,
      text:
        "The most popular activity here is, of all things, beekeeping — we have four hives on the back wall. Composting workshops and our seed-swap evenings are also well-attended.",
    },
    {
      kind: "reading-pause",
      seconds: 20,
      instruction: "Now look at questions 7 to 9.",
    },
    {
      kind: "speech",
      speaker_id: part2Guide.id,
      text:
        "If you'd like to volunteer, drop in on Saturdays at nine. We'll lend you a pair of gloves and a trowel; you bring your own water bottle.",
    },
    {
      kind: "speech",
      speaker_id: part2Guide.id,
      text:
        "Sessions usually run for three hours. We finish with tea and homemade cake in the shed.",
    },
    {
      kind: "reading-pause",
      seconds: 30,
      instruction: "You now have 30 seconds to check your answers to Part 2.",
    },
  ],
  completion_blocks: [
    {
      id: "p2-notes",
      layout: "notes",
      title: "Volunteer session notes",
      instructions: "Write NO MORE THAN TWO WORDS for each answer.",
      rows: [
        {
          label: "When to arrive",
          cells: [
            [
              { kind: "text", text: "Saturdays at " },
              { kind: "blank", slot_id: "p2-arrival-time" },
            ],
          ],
        },
        {
          label: "Bring",
          cells: [[{ kind: "blank", slot_id: "p2-bring" }]],
        },
        {
          label: "Session length",
          cells: [[{ kind: "blank", slot_id: "p2-length" }]],
        },
      ],
    },
  ],
};

const part3: ListeningPart = {
  part: 3,
  context: "academic",
  title: "Marine biology tutorial",
  speakers: [narratorBritish, part3Tutor, part3StudentA, part3StudentB],
  question_positions: [10, 11, 12, 13, 14],
  transcript: [
    { kind: "narration", text: "Now turn to Part 3." },
    {
      kind: "questions-preview",
      seconds: 30,
      question_positions: [10, 11],
    },
    {
      kind: "speech",
      speaker_id: part3Tutor.id,
      text:
        "So, Hannah, Joel — let's talk about your dissertation plans. You both want to look at coastal ecosystems, but you've taken different angles. Hannah, you go first.",
    },
    {
      kind: "speech",
      speaker_id: part3StudentA.id,
      text:
        "I want to focus on seagrass meadows and their role in carbon sequestration. There's solid recent literature out of Australia I can build on.",
    },
    {
      kind: "speech",
      speaker_id: part3Tutor.id,
      text:
        "Good — but be careful: the methodology is quite specialised, and you'll need access to a remote-sensing dataset I can't guarantee.",
    },
    {
      kind: "speech",
      speaker_id: part3StudentB.id,
      text:
        "Mine's different. I'd like to study how local fishing communities adapt to declining catch sizes. So it's social science, not biology really.",
    },
    {
      kind: "speech",
      speaker_id: part3Tutor.id,
      text:
        "That's still within the department's scope, but you'll want a co-supervisor from sociology. I'd suggest Dr. Patel.",
    },
    {
      kind: "reading-pause",
      seconds: 30,
      instruction: "Now look at questions 12 to 14.",
    },
    {
      kind: "speech",
      speaker_id: part3Tutor.id,
      text:
        "Let's talk timeline. Both of you need a topic confirmed by week six, a fieldwork plan in by week ten, and a draft chapter by the start of next term.",
    },
    {
      kind: "reading-pause",
      seconds: 30,
      instruction: "You now have 30 seconds to check your answers to Part 3.",
    },
  ],
  completion_blocks: [
    {
      id: "p3-table",
      layout: "table",
      title: "Dissertation milestones",
      instructions: "Write NO MORE THAN TWO WORDS for each answer.",
      rows: [
        {
          is_header: true,
          cells: [
            [{ kind: "text", text: "Milestone" }],
            [{ kind: "text", text: "Deadline" }],
          ],
        },
        {
          cells: [
            [{ kind: "text", text: "Topic confirmed" }],
            [{ kind: "blank", slot_id: "p3-topic-deadline" }],
          ],
        },
        {
          cells: [
            [{ kind: "text", text: "Fieldwork plan submitted" }],
            [{ kind: "blank", slot_id: "p3-fieldwork-deadline" }],
          ],
        },
        {
          cells: [
            [{ kind: "text", text: "First chapter draft" }],
            [{ kind: "blank", slot_id: "p3-draft-deadline" }],
          ],
        },
      ],
    },
  ],
};

const part4: ListeningPart = {
  part: 4,
  context: "academic",
  title: "Lecture: The history of mechanical clockmaking",
  speakers: [narratorBritish, part4Lecturer],
  question_positions: [15, 16, 17, 18, 19],
  transcript: [
    { kind: "narration", text: "Now turn to Part 4." },
    {
      kind: "questions-preview",
      seconds: 45,
      question_positions: [15, 16, 17, 18, 19],
    },
    {
      kind: "speech",
      speaker_id: part4Lecturer.id,
      text:
        "Good afternoon. Today we're looking at the development of mechanical clockmaking from the thirteenth century onwards — and, importantly, the way it reshaped daily life in European cities long before it became affordable for private households.",
    },
    {
      kind: "speech",
      speaker_id: part4Lecturer.id,
      text:
        "The earliest reliable mechanical clocks were tower clocks: large, weight-driven mechanisms installed in churches and municipal buildings. They had no minute hand — one hand for hours was sufficient, because the technology simply wasn't accurate enough to warrant more.",
    },
    {
      kind: "speech",
      speaker_id: part4Lecturer.id,
      text:
        "The crucial innovation was the verge-and-foliot escapement, which regulated the release of energy from the falling weight. It is, in many ways, the ancestor of every mechanical timepiece that followed.",
    },
    {
      kind: "speech",
      speaker_id: part4Lecturer.id,
      text:
        "By the late fifteenth century, smaller spring-driven clocks appeared. They could be carried, though not yet worn. The minute hand only became standard in the seventeenth century, after Huygens's application of the pendulum dramatically improved accuracy.",
    },
    {
      kind: "reading-pause",
      seconds: 30,
      instruction: "You now have 30 seconds to check your answers to Part 4.",
    },
  ],
};

// ─── Content ────────────────────────────────────────────────────────────

export const sampleListeningContent: ListeningContent = {
  schema_version: 1,
  parts: [part1, part2, part3, part4],
};

// ─── Questions ──────────────────────────────────────────────────────────
//
// Question.position is 0-indexed across the whole section (0..19 in this
// fixture). The runner displays them as "1..20" in the UI; storage is
// canonical.

export const sampleListeningQuestions: ListeningFixtureQuestion[] = [
  // Part 1 — form completion
  {
    position: 0,
    type: "listening-completion-blank",
    prompt: "Surname",
    correct_answer: {
      kind: "listening-completion-blank",
      block_id: "p1-form",
      slot_id: "p1-surname",
      word_limit: 2,
      accepted: ["Costa"],
    },
    points: 1,
  },
  {
    position: 1,
    type: "listening-completion-blank",
    prompt: "Address (street + number)",
    correct_answer: {
      kind: "listening-completion-blank",
      block_id: "p1-form",
      slot_id: "p1-address",
      word_limit: 3,
      accepted: ["24 Riverside Crescent", "Twenty-four Riverside Crescent"],
    },
    points: 1,
  },
  {
    position: 2,
    type: "listening-completion-blank",
    prompt: "Contact number",
    correct_answer: {
      kind: "listening-completion-blank",
      block_id: "p1-form",
      slot_id: "p1-phone",
      word_limit: 1,
      accepted: ["07855314299"],
    },
    points: 1,
  },
  {
    position: 3,
    type: "listening-completion-blank",
    prompt: "Membership type",
    correct_answer: {
      kind: "listening-completion-blank",
      block_id: "p1-form",
      slot_id: "p1-membership",
      word_limit: 1,
      accepted: ["Premium"],
    },
    points: 1,
  },
  {
    position: 4,
    type: "listening-sentence-completion",
    prompt:
      "Complete the sentence using NO MORE THAN ONE WORD AND/OR A NUMBER from the recording.",
    correct_answer: {
      kind: "listening-sentence-completion",
      stem: "The Premium membership costs ___ pounds a year.",
      word_limit: 2,
      accepted: ["28", "twenty-eight"],
    },
    points: 1,
  },

  // Part 2 — MCQ + notes
  {
    position: 5,
    type: "listening-mcq-single",
    prompt: "When was the community garden founded?",
    correct_answer: {
      kind: "listening-mcq-single",
      options: [
        { id: "A", text: "2004" },
        { id: "B", text: "2014" },
        { id: "C", text: "2024" },
      ],
      correct: "B",
    },
    points: 1,
  },
  {
    position: 6,
    type: "listening-mcq-multi",
    prompt:
      "Which TWO activities at the garden are described as well-attended?",
    correct_answer: {
      kind: "listening-mcq-multi",
      options: [
        { id: "A", text: "Beekeeping" },
        { id: "B", text: "Composting workshops" },
        { id: "C", text: "Seed-swap evenings" },
        { id: "D", text: "Yoga classes" },
        { id: "E", text: "Children's storytime" },
      ],
      pick_count: 2,
      correct: ["B", "C"],
    },
    points: 2,
  },
  {
    position: 7,
    type: "listening-completion-blank",
    prompt: "Saturday arrival time",
    correct_answer: {
      kind: "listening-completion-blank",
      block_id: "p2-notes",
      slot_id: "p2-arrival-time",
      word_limit: 2,
      accepted: ["9", "nine", "9 am", "nine am"],
    },
    points: 1,
  },
  {
    position: 8,
    type: "listening-completion-blank",
    prompt: "Volunteers should bring",
    correct_answer: {
      kind: "listening-completion-blank",
      block_id: "p2-notes",
      slot_id: "p2-bring",
      word_limit: 2,
      accepted: ["water bottle", "a water bottle"],
    },
    points: 1,
  },
  {
    position: 9,
    type: "listening-completion-blank",
    prompt: "Session length",
    correct_answer: {
      kind: "listening-completion-blank",
      block_id: "p2-notes",
      slot_id: "p2-length",
      word_limit: 2,
      accepted: ["3 hours", "three hours"],
    },
    points: 1,
  },

  // Part 3 — MCQ + table
  {
    position: 10,
    type: "listening-mcq-single",
    prompt: "Which research methodology concerns the tutor about Hannah's plan?",
    correct_answer: {
      kind: "listening-mcq-single",
      options: [
        { id: "A", text: "It is too dependent on a remote-sensing dataset." },
        { id: "B", text: "It overlaps with another student's topic." },
        { id: "C", text: "It is too narrow in geographic scope." },
      ],
      correct: "A",
    },
    points: 1,
  },
  {
    position: 11,
    type: "listening-mcq-single",
    prompt: "What does the tutor recommend Joel do?",
    correct_answer: {
      kind: "listening-mcq-single",
      options: [
        { id: "A", text: "Switch to a biology-focused topic." },
        { id: "B", text: "Find a co-supervisor in sociology." },
        { id: "C", text: "Postpone fieldwork until next term." },
      ],
      correct: "B",
    },
    points: 1,
  },
  {
    position: 12,
    type: "listening-completion-blank",
    prompt: "Topic confirmed by",
    correct_answer: {
      kind: "listening-completion-blank",
      block_id: "p3-table",
      slot_id: "p3-topic-deadline",
      word_limit: 2,
      accepted: ["week 6", "week six"],
    },
    points: 1,
  },
  {
    position: 13,
    type: "listening-completion-blank",
    prompt: "Fieldwork plan submitted by",
    correct_answer: {
      kind: "listening-completion-blank",
      block_id: "p3-table",
      slot_id: "p3-fieldwork-deadline",
      word_limit: 2,
      accepted: ["week 10", "week ten"],
    },
    points: 1,
  },
  {
    position: 14,
    type: "listening-completion-blank",
    prompt: "First chapter draft due",
    correct_answer: {
      kind: "listening-completion-blank",
      block_id: "p3-table",
      slot_id: "p3-draft-deadline",
      word_limit: 4,
      accepted: ["start of next term", "next term"],
    },
    points: 1,
  },

  // Part 4 — sentence completion + short answer + MCQ
  {
    position: 15,
    type: "listening-sentence-completion",
    prompt:
      "Complete the sentence using NO MORE THAN TWO WORDS from the recording.",
    correct_answer: {
      kind: "listening-sentence-completion",
      stem:
        "The earliest reliable mechanical clocks were installed in churches and ___.",
      word_limit: 2,
      accepted: ["municipal buildings"],
    },
    points: 1,
  },
  {
    position: 16,
    type: "listening-sentence-completion",
    prompt:
      "Complete the sentence using NO MORE THAN TWO WORDS from the recording.",
    correct_answer: {
      kind: "listening-sentence-completion",
      stem: "Early tower clocks had only ___ to indicate the time.",
      word_limit: 2,
      accepted: ["one hand", "a hand"],
    },
    points: 1,
  },
  {
    position: 17,
    type: "listening-short-answer",
    prompt:
      "What innovation regulated the release of energy in early mechanical clocks? (NO MORE THAN FOUR WORDS)",
    correct_answer: {
      kind: "listening-short-answer",
      word_limit: 4,
      accepted: ["verge-and-foliot escapement", "the escapement", "escapement"],
    },
    points: 1,
  },
  {
    position: 18,
    type: "listening-short-answer",
    prompt:
      "In which century did smaller spring-driven clocks first appear? (NO MORE THAN THREE WORDS)",
    correct_answer: {
      kind: "listening-short-answer",
      word_limit: 3,
      accepted: ["fifteenth century", "15th century", "the fifteenth century"],
    },
    points: 1,
  },
  {
    position: 19,
    type: "listening-mcq-single",
    prompt: "Whose work led to the minute hand becoming standard?",
    correct_answer: {
      kind: "listening-mcq-single",
      options: [
        { id: "A", text: "Galileo" },
        { id: "B", text: "Huygens" },
        { id: "C", text: "Harrison" },
      ],
      correct: "B",
    },
    points: 1,
  },
];

export const sampleListeningTest = {
  content: sampleListeningContent,
  questions: sampleListeningQuestions,
};
