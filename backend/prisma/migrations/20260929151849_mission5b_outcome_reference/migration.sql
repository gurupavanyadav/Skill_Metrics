-- AlterTable
ALTER TABLE "EmploymentOutcome" ADD COLUMN "referenceCode" TEXT;

-- Backfill existing rows
UPDATE "EmploymentOutcome" SET "referenceCode" = gen_random_uuid()::text WHERE "referenceCode" IS NULL;

-- Make column NOT NULL
ALTER TABLE "EmploymentOutcome" ALTER COLUMN "referenceCode" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "EmploymentOutcome_referenceCode_key" ON "EmploymentOutcome"("referenceCode");
