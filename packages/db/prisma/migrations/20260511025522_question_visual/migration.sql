-- AlterTable: add optional `visual` JSON column to Question. Used by
-- Academic Task 1 to carry chart/process-diagram specs that the UI
-- renders. Shape lives in apps/web/lib/writing/visual.ts.

ALTER TABLE "Question" ADD COLUMN "visual" JSONB;
