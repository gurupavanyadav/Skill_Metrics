/*
  Warnings:
  - You are about to drop the column `providerId` on the `Course` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[referenceCode]` on the table `Enrollment` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `referenceCode` to the `Enrollment` table without a default value. This is not possible if the table is not empty.
*/

-- AlterTable
ALTER TABLE "Course" DROP COLUMN "providerId";

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN "referenceCode" TEXT;
-- Backfill existing rows with a random string resembling a cuid to satisfy NOT NULL constraints.
UPDATE "Enrollment" SET "referenceCode" = gen_random_uuid()::text WHERE "referenceCode" IS NULL;
ALTER TABLE "Enrollment" ALTER COLUMN "referenceCode" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_referenceCode_key" ON "Enrollment"("referenceCode");
