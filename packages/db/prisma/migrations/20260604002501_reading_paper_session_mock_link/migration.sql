-- AlterTable
ALTER TABLE "ReadingPaperSession" ADD COLUMN     "mock_session_id" TEXT;

-- CreateIndex
CREATE INDEX "ReadingPaperSession_mock_session_id_idx" ON "ReadingPaperSession"("mock_session_id");

-- AddForeignKey
ALTER TABLE "ReadingPaperSession" ADD CONSTRAINT "ReadingPaperSession_mock_session_id_fkey" FOREIGN KEY ("mock_session_id") REFERENCES "MockSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
