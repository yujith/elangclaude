// Shared fixtures for the listening generation tests. Not loaded by any
// production code path — every export here exists to keep the test files
// short and to share a known-good baseline that both the schema test and
// the generator test can mutate.
//
// Filename intentionally has no `.test.ts` suffix so vitest doesn't try
// to execute it as a test file.

import {
  generatedListeningSchema,
  type GeneratedListening,
} from "./listening-schema";

// Returns a fully grounded, schema-and-validator-clean GeneratedListening
// — 20 questions across the 4 parts, every accepted answer literally in
// its part's transcript, every reference resolves, and each part follows
// the canonical narrator/preview/listen/end-of-part scaffold.
export function validatorCleanGeneration(): GeneratedListening {
  const raw = {
    track: "Academic" as const,
    difficulty: 3,
    parts: [
      {
        part: 1 as const,
        context: "social" as const,
        title: "Leisure centre membership",
        speakers: [
          {
            id: "narrator",
            name: "Narrator",
            role: "narrator" as const,
            accent: "british" as const,
          },
          {
            id: "rec",
            name: "Receptionist",
            role: "speaker" as const,
            accent: "british" as const,
          },
          {
            id: "cal",
            name: "Caller",
            role: "speaker" as const,
            accent: "australian" as const,
          },
        ],
        transcript: [
          { kind: "narration" as const, text: "Part 1." },
          {
            kind: "narration" as const,
            text: "You will hear a conversation between a caller and a receptionist about joining a local leisure centre.",
          },
          {
            kind: "narration" as const,
            text: "First you have some time to look at questions 1 to 5.",
          },
          {
            kind: "questions-preview" as const,
            seconds: 30,
            question_positions: [0, 1, 2, 3, 4],
          },
          {
            kind: "narration" as const,
            text: "Now listen carefully and answer questions 1 to 5.",
          },
          {
            kind: "speech" as const,
            speaker_id: "cal",
            text: "Hello. I'd like to join the leisure centre because I have just moved to Brookside Road.",
          },
          {
            kind: "speech" as const,
            speaker_id: "rec",
            text: "Of course. I can set up the account now. Your surname is Costa, that's C O S T A, and the standard membership costs 28 pounds a month. The induction class takes place on Thursday evening, and the swimming pool closes at 9 pm on weekdays.",
          },
          {
            kind: "narration" as const,
            text: "That is the end of Part 1. You now have half a minute to check your answers.",
          },
          { kind: "reading-pause" as const, seconds: 30 },
        ],
        question_positions: [0, 1, 2, 3, 4],
        completion_blocks: [
          {
            id: "p1-form",
            layout: "form" as const,
            title: "Membership details",
            instructions: "Write NO MORE THAN TWO WORDS AND/OR A NUMBER for each answer.",
            rows: [
              {
                label: "Surname",
                cells: [[{ kind: "blank" as const, slot_id: "p1-surname" }]],
              },
              {
                label: "Monthly fee",
                cells: [[{ kind: "blank" as const, slot_id: "p1-fee" }]],
              },
              {
                label: "Induction class",
                cells: [[{ kind: "blank" as const, slot_id: "p1-induction" }]],
              },
            ],
          },
        ],
      },
      {
        part: 2 as const,
        context: "social" as const,
        title: "Community theatre tour",
        speakers: [
          {
            id: "narrator",
            name: "Narrator",
            role: "narrator" as const,
            accent: "british" as const,
          },
          {
            id: "guide",
            name: "Guide",
            role: "speaker" as const,
            accent: "american" as const,
          },
        ],
        transcript: [
          { kind: "narration" as const, text: "Part 2." },
          {
            kind: "narration" as const,
            text: "You will hear a guide giving visitors information about a community theatre.",
          },
          {
            kind: "narration" as const,
            text: "First you have some time to look at questions 6 to 10.",
          },
          {
            kind: "questions-preview" as const,
            seconds: 30,
            question_positions: [5, 6, 7, 8, 9],
          },
          {
            kind: "narration" as const,
            text: "Now listen carefully and answer questions 6 to 10.",
          },
          {
            kind: "speech" as const,
            speaker_id: "guide",
            text: "Welcome to the Riverside Community Theatre. The theatre first opened in 1986. The box office opens at noon every day, guided tours run on Saturdays, the cafe is closed on Mondays, and the backstage education studio was added in 2018.",
          },
          {
            kind: "narration" as const,
            text: "That is the end of Part 2. You now have half a minute to check your answers.",
          },
          { kind: "reading-pause" as const, seconds: 30 },
        ],
        question_positions: [5, 6, 7, 8, 9],
      },
      {
        part: 3 as const,
        context: "academic" as const,
        title: "Research tutorial",
        speakers: [
          {
            id: "narrator",
            name: "Narrator",
            role: "narrator" as const,
            accent: "british" as const,
          },
          {
            id: "tutor",
            name: "Tutor",
            role: "speaker" as const,
            accent: "british" as const,
          },
          {
            id: "anna",
            name: "Anna",
            role: "speaker" as const,
            accent: "canadian" as const,
          },
          {
            id: "ben",
            name: "Ben",
            role: "speaker" as const,
            accent: "american" as const,
          },
        ],
        transcript: [
          { kind: "narration" as const, text: "Part 3." },
          {
            kind: "narration" as const,
            text: "You will hear two students discussing a research project with their tutor.",
          },
          {
            kind: "narration" as const,
            text: "First you have some time to look at questions 11 to 15.",
          },
          {
            kind: "questions-preview" as const,
            seconds: 30,
            question_positions: [10, 11, 12, 13, 14],
          },
          {
            kind: "narration" as const,
            text: "Now listen carefully and answer questions 11 to 15.",
          },
          {
            kind: "speech" as const,
            speaker_id: "tutor",
            text: "Before next week, I want you both to narrow the topic to urban cycling rather than general transport.",
          },
          {
            kind: "speech" as const,
            speaker_id: "anna",
            text: "That's fine. I can analyse the survey data, and I'll compare weekday commuters with weekend riders.",
          },
          {
            kind: "speech" as const,
            speaker_id: "ben",
            text: "I'll handle the interviews, but I still need permission to record them in the city library.",
          },
          {
            kind: "speech" as const,
            speaker_id: "tutor",
            text: "Good. Submit the draft proposal by Friday, and make sure the methodology section explains why you chose a mixed-method approach.",
          },
          {
            kind: "narration" as const,
            text: "That is the end of Part 3. You now have half a minute to check your answers.",
          },
          { kind: "reading-pause" as const, seconds: 30 },
        ],
        question_positions: [10, 11, 12, 13, 14],
      },
      {
        part: 4 as const,
        context: "academic" as const,
        title: "Lecture on urban wetlands",
        speakers: [
          {
            id: "narrator",
            name: "Narrator",
            role: "narrator" as const,
            accent: "british" as const,
          },
          {
            id: "lecturer",
            name: "Lecturer",
            role: "speaker" as const,
            accent: "australian" as const,
          },
        ],
        transcript: [
          { kind: "narration" as const, text: "Part 4." },
          {
            kind: "narration" as const,
            text: "You will hear part of a lecture about urban wetlands.",
          },
          {
            kind: "narration" as const,
            text: "First you have some time to look at questions 16 to 20.",
          },
          {
            kind: "questions-preview" as const,
            seconds: 30,
            question_positions: [15, 16, 17, 18, 19],
          },
          {
            kind: "narration" as const,
            text: "Now listen carefully and answer questions 16 to 20.",
          },
          {
            kind: "speech" as const,
            speaker_id: "lecturer",
            text: "Urban wetlands were once dismissed as useless land, but city planners now value them for flood control and water filtration.",
          },
          {
            kind: "speech" as const,
            speaker_id: "lecturer",
            text: "In Melbourne, one restored wetland can store nearly 12 million litres of stormwater during a single season.",
          },
          {
            kind: "speech" as const,
            speaker_id: "lecturer",
            text: "Researchers also found that reed beds reduce summer surface temperatures by about 3 degrees in the surrounding suburbs.",
          },
          {
            kind: "speech" as const,
            speaker_id: "lecturer",
            text: "The main challenge is maintenance, because invasive grass can spread quickly if monitoring is delayed.",
          },
          {
            kind: "narration" as const,
            text: "That is the end of Part 4. You now have half a minute to check your answers.",
          },
          { kind: "reading-pause" as const, seconds: 30 },
        ],
        question_positions: [15, 16, 17, 18, 19],
      },
    ],
    questions: [
      {
        type: "listening-completion-blank" as const,
        position: 0,
        prompt: "Surname",
        points: 1,
        correct_answer: {
          block_id: "p1-form",
          slot_id: "p1-surname",
          word_limit: 2,
          accepted: ["Costa"],
        },
      },
      {
        type: "listening-sentence-completion" as const,
        position: 1,
        prompt: "Complete the sentence using NO MORE THAN TWO WORDS AND/OR A NUMBER from the recording.",
        points: 1,
        correct_answer: {
          stem: "The standard membership costs ___ pounds a month.",
          word_limit: 2,
          accepted: ["28", "twenty-eight"],
        },
      },
      {
        type: "listening-short-answer" as const,
        position: 2,
        prompt: "Which road has the caller moved to?",
        points: 1,
        correct_answer: {
          word_limit: 2,
          accepted: ["Brookside Road", "Brookside"],
        },
      },
      {
        type: "listening-mcq-single" as const,
        position: 3,
        prompt: "When does the induction class take place?",
        points: 1,
        correct_answer: {
          options: [
            { id: "A", text: "Thursday evening" },
            { id: "B", text: "Thursday morning" },
            { id: "C", text: "Saturday evening" },
          ],
          correct: "A",
        },
      },
      {
        type: "listening-short-answer" as const,
        position: 4,
        prompt: "What time does the swimming pool close on weekdays?",
        points: 1,
        correct_answer: {
          word_limit: 2,
          accepted: ["9 pm"],
        },
      },
      {
        type: "listening-mcq-single" as const,
        position: 5,
        prompt: "What is the talk mainly about?",
        points: 1,
        correct_answer: {
          options: [
            { id: "A", text: "A community theatre" },
            { id: "B", text: "A sports stadium" },
            { id: "C", text: "A railway museum" },
          ],
          correct: "A",
        },
      },
      {
        type: "listening-sentence-completion" as const,
        position: 6,
        prompt: "Complete the sentence using NO MORE THAN TWO WORDS AND/OR A NUMBER from the recording.",
        points: 1,
        correct_answer: {
          stem: "The theatre first opened in ___.",
          word_limit: 1,
          accepted: ["1986"],
        },
      },
      {
        type: "listening-short-answer" as const,
        position: 7,
        prompt: "When does the box office open each day?",
        points: 1,
        correct_answer: {
          word_limit: 1,
          accepted: ["noon"],
        },
      },
      {
        type: "listening-mcq-multi" as const,
        position: 8,
        prompt: "Which TWO features are mentioned by the guide?",
        points: 2,
        correct_answer: {
          options: [
            { id: "A", text: "Guided tours on Saturdays" },
            { id: "B", text: "A rooftop garden" },
            { id: "C", text: "A backstage education studio" },
            { id: "D", text: "Free parking for visitors" },
          ],
          pick_count: 2,
          correct: ["A", "C"],
        },
      },
      {
        type: "listening-short-answer" as const,
        position: 9,
        prompt: "On which day is the cafe closed?",
        points: 1,
        correct_answer: {
          word_limit: 1,
          accepted: ["Mondays", "Monday"],
        },
      },
      {
        type: "listening-mcq-single" as const,
        position: 10,
        prompt: "What topic does the tutor want the students to focus on?",
        points: 1,
        correct_answer: {
          options: [
            { id: "A", text: "Urban cycling" },
            { id: "B", text: "General transport" },
            { id: "C", text: "Road engineering" },
          ],
          correct: "A",
        },
      },
      {
        type: "listening-short-answer" as const,
        position: 11,
        prompt: "What will Anna analyse?",
        points: 1,
        correct_answer: {
          word_limit: 2,
          accepted: ["survey data"],
        },
      },
      {
        type: "listening-sentence-completion" as const,
        position: 12,
        prompt: "Complete the sentence using NO MORE THAN TWO WORDS AND/OR A NUMBER from the recording.",
        points: 1,
        correct_answer: {
          stem: "Ben still needs permission to record interviews in the ___.",
          word_limit: 2,
          accepted: ["city library", "library"],
        },
      },
      {
        type: "listening-short-answer" as const,
        position: 13,
        prompt: "When must the draft proposal be submitted?",
        points: 1,
        correct_answer: {
          word_limit: 1,
          accepted: ["Friday"],
        },
      },
      {
        type: "listening-mcq-multi" as const,
        position: 14,
        prompt: "Which TWO tasks are mentioned in the discussion?",
        points: 2,
        correct_answer: {
          options: [
            { id: "A", text: "Comparing weekday commuters with weekend riders" },
            { id: "B", text: "Booking hotel rooms" },
            { id: "C", text: "Explaining the mixed-method approach" },
            { id: "D", text: "Designing a new bicycle helmet" },
          ],
          pick_count: 2,
          correct: ["A", "C"],
        },
      },
      {
        type: "listening-sentence-completion" as const,
        position: 15,
        prompt: "Complete the sentence using NO MORE THAN TWO WORDS AND/OR A NUMBER from the recording.",
        points: 1,
        correct_answer: {
          stem: "City planners value urban wetlands for flood control and ___.",
          word_limit: 2,
          accepted: ["water filtration"],
        },
      },
      {
        type: "listening-short-answer" as const,
        position: 16,
        prompt: "How much stormwater can one restored wetland store?",
        points: 1,
        correct_answer: {
          word_limit: 3,
          accepted: ["12 million litres", "12 million"],
        },
      },
      {
        type: "listening-mcq-single" as const,
        position: 17,
        prompt: "What benefit do reed beds provide?",
        points: 1,
        correct_answer: {
          options: [
            { id: "A", text: "They reduce summer surface temperatures." },
            { id: "B", text: "They increase ticket sales." },
            { id: "C", text: "They shorten the wet season." },
          ],
          correct: "A",
        },
      },
      {
        type: "listening-short-answer" as const,
        position: 18,
        prompt: "What is the main challenge mentioned by the lecturer?",
        points: 1,
        correct_answer: {
          word_limit: 1,
          accepted: ["maintenance"],
        },
      },
      {
        type: "listening-sentence-completion" as const,
        position: 19,
        prompt: "Complete the sentence using NO MORE THAN TWO WORDS AND/OR A NUMBER from the recording.",
        points: 1,
        correct_answer: {
          stem: "Invasive grass can spread quickly if ___ is delayed.",
          word_limit: 1,
          accepted: ["monitoring"],
        },
      },
    ],
  };
  const parsed = generatedListeningSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `validatorCleanGeneration failed schema: ${JSON.stringify(parsed.error.issues)}`,
    );
  }
  return parsed.data;
}
