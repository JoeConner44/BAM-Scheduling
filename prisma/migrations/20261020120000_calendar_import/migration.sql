-- AlterTable
ALTER TABLE "ScheduleBlock" ADD COLUMN     "externalRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleBlock_externalRef_key" ON "ScheduleBlock"("externalRef");

