-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "reading_paper_session_id" TEXT;

-- CreateTable
CREATE TABLE "ReadingPaper" (
    "id" TEXT NOT NULL,
    "track" "Track" NOT NULL,
    "status" "TestStatus" NOT NULL DEFAULT 'Draft',
    "approved_by" TEXT,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReadingPaper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadingPaperPart" (
    "id" TEXT NOT NULL,
    "paper_id" TEXT NOT NULL,
    "test_id" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadingPaperPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadingPaperSession" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "paper_id" TEXT NOT NULL,
    "track" "Track" NOT NULL,
    "status" "MockStatus" NOT NULL DEFAULT 'InProgress',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReadingPaperSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReadingPaper_track_status_idx" ON "ReadingPaper"("track", "status");

-- CreateIndex
CREATE INDEX "ReadingPaper_approved_by_idx" ON "ReadingPaper"("approved_by");

-- CreateIndex
CREATE INDEX "ReadingPaperPart_test_id_idx" ON "ReadingPaperPart"("test_id");

-- CreateIndex
CREATE UNIQUE INDEX "ReadingPaperPart_paper_id_slot_key" ON "ReadingPaperPart"("paper_id", "slot");

-- CreateIndex
CREATE INDEX "ReadingPaperSession_org_id_idx" ON "ReadingPaperSession"("org_id");

-- CreateIndex
CREATE INDEX "ReadingPaperSession_org_id_user_id_idx" ON "ReadingPaperSession"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "ReadingPaperSession_org_id_status_idx" ON "ReadingPaperSession"("org_id", "status");

-- CreateIndex
CREATE INDEX "ReadingPaperSession_paper_id_idx" ON "ReadingPaperSession"("paper_id");

-- CreateIndex
CREATE INDEX "Attempt_reading_paper_session_id_idx" ON "Attempt"("reading_paper_session_id");

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_reading_paper_session_id_fkey" FOREIGN KEY ("reading_paper_session_id") REFERENCES "ReadingPaperSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingPaper" ADD CONSTRAINT "ReadingPaper_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingPaperPart" ADD CONSTRAINT "ReadingPaperPart_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "ReadingPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingPaperPart" ADD CONSTRAINT "ReadingPaperPart_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingPaperSession" ADD CONSTRAINT "ReadingPaperSession_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingPaperSession" ADD CONSTRAINT "ReadingPaperSession_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingPaperSession" ADD CONSTRAINT "ReadingPaperSession_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "ReadingPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;
