-- CreateEnum
CREATE TYPE "OutcomeLinkageStatus" AS ENUM ('LINKED', 'UNLINKED', 'MANUALLY_LINKED');

-- CreateEnum
CREATE TYPE "OutcomeSource" AS ENUM ('TRAINEE_SELF_REPORT', 'EMPLOYER_REPORT', 'PLACEMENT_PARTNER', 'GOVERNMENT_REGISTRY', 'PROGRAMME_IMPORT', 'PROVIDER_IMPORT', 'OPERATOR_ENTRY');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CompensationType" AS ENUM ('SALARY', 'STIPEND', 'SELF_EMPLOYMENT_INCOME');

-- AlterTable
ALTER TABLE "EmploymentOutcome" ADD COLUMN     "enrollmentId" TEXT,
ADD COLUMN     "linkageStatus" "OutcomeLinkageStatus" NOT NULL DEFAULT 'UNLINKED',
ADD COLUMN     "source" "OutcomeSource" NOT NULL DEFAULT 'OPERATOR_ENTRY';

-- AlterTable
ALTER TABLE "WageSnapshot" ADD COLUMN     "type" "CompensationType" NOT NULL DEFAULT 'SALARY';

-- CreateTable
CREATE TABLE "SalariedEmploymentDetails" (
    "id" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,

    CONSTRAINT "SalariedEmploymentDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfEmploymentDetails" (
    "id" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "businessName" TEXT,
    "registrationType" TEXT,

    CONSTRAINT "SelfEmploymentDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprenticeshipDetails" (
    "id" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "portalIdentifier" TEXT,
    "contractDuration" INTEGER,

    CONSTRAINT "ApprenticeshipDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationRecord" (
    "id" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "method" TEXT,
    "source" TEXT,
    "actorReference" TEXT,
    "evidenceReference" TEXT,
    "reason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalariedEmploymentDetails_outcomeId_key" ON "SalariedEmploymentDetails"("outcomeId");

-- CreateIndex
CREATE UNIQUE INDEX "SelfEmploymentDetails_outcomeId_key" ON "SelfEmploymentDetails"("outcomeId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprenticeshipDetails_outcomeId_key" ON "ApprenticeshipDetails"("outcomeId");

-- AddForeignKey
ALTER TABLE "EmploymentOutcome" ADD CONSTRAINT "EmploymentOutcome_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalariedEmploymentDetails" ADD CONSTRAINT "SalariedEmploymentDetails_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "EmploymentOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfEmploymentDetails" ADD CONSTRAINT "SelfEmploymentDetails_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "EmploymentOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeshipDetails" ADD CONSTRAINT "ApprenticeshipDetails_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "EmploymentOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRecord" ADD CONSTRAINT "VerificationRecord_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "EmploymentOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce Linkage Integrity
ALTER TABLE "EmploymentOutcome" ADD CONSTRAINT "EmploymentOutcome_linkage_check" CHECK (
  ("linkageStatus" = 'UNLINKED' AND "enrollmentId" IS NULL) OR
  ("linkageStatus" IN ('LINKED', 'MANUALLY_LINKED') AND "enrollmentId" IS NOT NULL)
);
