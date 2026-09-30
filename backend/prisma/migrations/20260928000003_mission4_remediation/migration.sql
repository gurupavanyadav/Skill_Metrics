-- CreateEnum
CREATE TYPE "CertificationAlignment" AS ENUM ('COURSE_ALIGNED', 'EXTERNAL_CERTIFICATION');

-- DropForeignKey
ALTER TABLE "AssessmentAttempt" DROP CONSTRAINT "AssessmentAttempt_enrollmentId_fkey";

-- DropForeignKey
ALTER TABLE "Certification" DROP CONSTRAINT "Certification_enrollmentId_fkey";

-- AlterTable
ALTER TABLE "CertificationSkill" ADD COLUMN     "alignment" "CertificationAlignment" NOT NULL DEFAULT 'COURSE_ALIGNED';

-- AddForeignKey
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
