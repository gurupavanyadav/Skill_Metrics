-- AlterTable
ALTER TABLE "EmploymentOutcome" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "requestHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "EmploymentOutcome_traineeId_idempotencyKey_key" ON "EmploymentOutcome"("traineeId", "idempotencyKey");
