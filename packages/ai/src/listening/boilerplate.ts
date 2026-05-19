// IELTS-canonical opening + closing narration injected at persistence time
// and detected by the player to flag missing-clip cases. Kept in a
// dependency-free module so the client bundle can import the strings via
// `@elc/ai/listening/boilerplate` without dragging in node:fs (the
// generation prompt loader's transitive dep through the main barrel).
//
// If you change the wording you MUST update the persist test that asserts
// the prefix ("This is the IELTS Listening test." / "That is the end of
// the Listening test.") — see listening-persist.test.ts.

export const OPENING_NARRATION =
  "This is the IELTS Listening test. There will be time for you to " +
  "read the instructions and questions, and you will have a chance " +
  "to check your work. All the recordings will be played once only. " +
  "The test is in four parts. When the recording for each part " +
  "begins, you will hear it once and once only. Let's begin.";

export const CLOSING_NARRATION =
  "That is the end of the Listening test. Please take a moment to " +
  "check your answers, then click Submit when you are ready. If you " +
  "do not submit within ten minutes, your answers will be submitted " +
  "automatically.";
