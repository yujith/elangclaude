-- AlterTable: ensure one Answer per (Attempt, Question). Phase 2 autosave
-- upserts on this composite key; without the constraint, concurrent
-- autosave calls can fork into duplicate rows.

CREATE UNIQUE INDEX "Answer_attempt_id_question_id_key" ON "Answer"("attempt_id", "question_id");
