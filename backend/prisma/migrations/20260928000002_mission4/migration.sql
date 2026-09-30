-- CreateEnum
CREATE TYPE "AssessmentType" AS ENUM ('WRITTEN', 'PRACTICAL', 'MIXED');

-- CreateEnum
CREATE TYPE "AssessmentResult" AS ENUM ('PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "CertificationStatus" AS ENUM ('ISSUED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AttainmentStatus" AS ENUM ('CLAIMED', 'ASSESSED', 'CERTIFIED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('ASSESSMENT', 'CERTIFICATION');

-- CreateEnum
CREATE TYPE "ProvenanceSource" AS ENUM ('GOVERNMENT_IMPORT', 'PROVIDER_IMPORT', 'PROGRAMME_IMPORT', 'ASSESSOR', 'CERTIFYING_AUTHORITY');

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "taxonomy" TEXT,
    "taxonomyVersion" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseSkill" (
    "courseId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "expectedLevel" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseSkill_pkey" PRIMARY KEY ("courseId","skillId")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "assessmentType" "AssessmentType" NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "passScore" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentAttempt" (
    "id" TEXT NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL,
    "result" "AssessmentResult" NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL,
    "source" "ProvenanceSource" NOT NULL,
    "assessorReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentSkillResult" (
    "assessmentAttemptId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "proficiencyLevel" TEXT,
    "score" DOUBLE PRECISION,
    "result" "AssessmentResult" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentSkillResult_pkey" PRIMARY KEY ("assessmentAttemptId","skillId")
);

-- CreateTable
CREATE TABLE "Certification" (
    "id" TEXT NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "certificateReference" TEXT NOT NULL,
    "certificateType" TEXT NOT NULL,
    "issuingAuthority" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "status" "CertificationStatus" NOT NULL DEFAULT 'ISSUED',
    "source" "ProvenanceSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificationSkill" (
    "certificationId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "evidenceLevel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertificationSkill_pkey" PRIMARY KEY ("certificationId","skillId")
);

-- CreateTable
CREATE TABLE "TraineeSkillAttainment" (
    "id" TEXT NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "evidenceType" "EvidenceType" NOT NULL,
    "evidenceReference" TEXT NOT NULL,
    "proficiencyLevel" TEXT,
    "status" "AttainmentStatus" NOT NULL,
    "achievedAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "source" "ProvenanceSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TraineeSkillAttainment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Skill_code_key" ON "Skill"("code");

-- CreateIndex
CREATE INDEX "CourseSkill_courseId_idx" ON "CourseSkill"("courseId");

-- CreateIndex
CREATE INDEX "CourseSkill_skillId_idx" ON "CourseSkill"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_referenceCode_key" ON "Assessment"("referenceCode");

-- CreateIndex
CREATE INDEX "Assessment_courseId_idx" ON "Assessment"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_courseId_code_key" ON "Assessment"("courseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentAttempt_referenceCode_key" ON "AssessmentAttempt"("referenceCode");

-- CreateIndex
CREATE INDEX "AssessmentAttempt_enrollmentId_idx" ON "AssessmentAttempt"("enrollmentId");

-- CreateIndex
CREATE INDEX "AssessmentAttempt_assessmentId_idx" ON "AssessmentAttempt"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentAttempt_enrollmentId_assessmentId_attemptNumber_key" ON "AssessmentAttempt"("enrollmentId", "assessmentId", "attemptNumber");

-- CreateIndex
CREATE INDEX "AssessmentSkillResult_assessmentAttemptId_idx" ON "AssessmentSkillResult"("assessmentAttemptId");

-- CreateIndex
CREATE INDEX "AssessmentSkillResult_skillId_idx" ON "AssessmentSkillResult"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "Certification_referenceCode_key" ON "Certification"("referenceCode");

-- CreateIndex
CREATE UNIQUE INDEX "Certification_certificateReference_key" ON "Certification"("certificateReference");

-- CreateIndex
CREATE INDEX "Certification_enrollmentId_idx" ON "Certification"("enrollmentId");

-- CreateIndex
CREATE INDEX "Certification_certificateReference_idx" ON "Certification"("certificateReference");

-- CreateIndex
CREATE INDEX "CertificationSkill_certificationId_idx" ON "CertificationSkill"("certificationId");

-- CreateIndex
CREATE INDEX "CertificationSkill_skillId_idx" ON "CertificationSkill"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "TraineeSkillAttainment_referenceCode_key" ON "TraineeSkillAttainment"("referenceCode");

-- CreateIndex
CREATE INDEX "TraineeSkillAttainment_traineeId_idx" ON "TraineeSkillAttainment"("traineeId");

-- CreateIndex
CREATE INDEX "TraineeSkillAttainment_skillId_idx" ON "TraineeSkillAttainment"("skillId");

-- CreateIndex
CREATE INDEX "TraineeSkillAttainment_enrollmentId_idx" ON "TraineeSkillAttainment"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "TraineeSkillAttainment_traineeId_skillId_evidenceType_evide_key" ON "TraineeSkillAttainment"("traineeId", "skillId", "evidenceType", "evidenceReference");

-- AddForeignKey
ALTER TABLE "CourseSkill" ADD CONSTRAINT "CourseSkill_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSkill" ADD CONSTRAINT "CourseSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentSkillResult" ADD CONSTRAINT "AssessmentSkillResult_assessmentAttemptId_fkey" FOREIGN KEY ("assessmentAttemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentSkillResult" ADD CONSTRAINT "AssessmentSkillResult_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificationSkill" ADD CONSTRAINT "CertificationSkill_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "Certification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificationSkill" ADD CONSTRAINT "CertificationSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraineeSkillAttainment" ADD CONSTRAINT "TraineeSkillAttainment_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "Trainee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraineeSkillAttainment" ADD CONSTRAINT "TraineeSkillAttainment_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraineeSkillAttainment" ADD CONSTRAINT "TraineeSkillAttainment_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

