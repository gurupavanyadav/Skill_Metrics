const { PrismaClient } = require('@prisma/client');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbUrl = process.env.TEST_DATABASE_URL;
if (!dbUrl) {
  throw new Error('TEST_DATABASE_URL is required; refusing to run a destructive upgrade test without an explicit isolated database.');
}
if (dbUrl === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL must not equal DATABASE_URL.');
}

const migrationPath = path.join(__dirname, 'prisma/migrations/20260929151849_mission5b_outcome_reference');
const tempPath = path.join(__dirname, 'prisma/temp_migration');

async function run() {
  console.log("1. Hiding Mission 5B migration...");
  if (fs.existsSync(migrationPath)) {
    fs.renameSync(migrationPath, tempPath);
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: dbUrl } }
  });

  try {
    console.log("2. Resetting DB to Mission 5A state...");
    execSync('npx prisma migrate reset --force --skip-generate --skip-seed', { env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'inherit' });

    console.log("3. Connecting to DB directly...");
    await prisma.$connect();

    // Create a trainee, provider, course, batch, enrollment, employer to satisfy FKs
    const userRes = await prisma.$queryRaw`INSERT INTO "User" ("id", "role", "updatedAt") VALUES (gen_random_uuid(), 'TRAINEE', now()) RETURNING id`;
    const userId = userRes[0].id;

    const traineeRes = await prisma.$queryRaw`INSERT INTO "Trainee" ("id", "userId", "systemId", "name", "phone", "consentStatus") VALUES (gen_random_uuid(), ${userId}::uuid, 'SYS1', 'Test', '9999999999', true) RETURNING id`;
    const traineeId = traineeRes[0].id;
    
    const employerRes = await prisma.$queryRaw`INSERT INTO "Employer" ("id", "name", "district") VALUES (gen_random_uuid(), 'Emp1', 'Dist1') RETURNING id`;
    const employerId = employerRes[0].id;

    // Insert 2 EmploymentOutcomes WITHOUT referenceCode (which isn't in DB yet)
    console.log("4. Inserting pre-Mission-5B outcomes...");
    const out1Res = await prisma.$queryRaw`
      INSERT INTO "EmploymentOutcome" ("id", "traineeId", "type", "startDate", "verificationStatus", "linkageStatus", "source", "employerId") 
      VALUES (gen_random_uuid(), ${traineeId}::uuid, 'SALARIED', '2025-01-01', 'PENDING', 'UNLINKED', 'PLACEMENT_PARTNER', ${employerId}::uuid) 
      RETURNING id
    `;
    const id1 = out1Res[0].id;

    const out2Res = await prisma.$queryRaw`
      INSERT INTO "EmploymentOutcome" ("id", "traineeId", "type", "startDate", "verificationStatus", "linkageStatus", "source", "employerId") 
      VALUES (gen_random_uuid(), ${traineeId}::uuid, 'SALARIED', '2025-02-01', 'PENDING', 'UNLINKED', 'PLACEMENT_PARTNER', ${employerId}::uuid) 
      RETURNING id
    `;
    const id2 = out2Res[0].id;

    console.log("5. Restoring Mission 5B migration...");
    fs.renameSync(tempPath, migrationPath);

    console.log("6. Deploying migration...");
    execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'inherit' });

    console.log("7. Verifying upgrade...");
    const check1 = await prisma.$queryRaw`SELECT "referenceCode" FROM "EmploymentOutcome" WHERE id = ${id1}`;
    const check2 = await prisma.$queryRaw`SELECT "referenceCode" FROM "EmploymentOutcome" WHERE id = ${id2}`;

    const ref1 = check1[0].referenceCode;
    const ref2 = check2[0].referenceCode;

    console.log(`Row 1 ref: ${ref1}`);
    console.log(`Row 2 ref: ${ref2}`);

    if (!ref1 || !ref2) {
      throw new Error("Reference codes were NULL!");
    }
    if (ref1 === ref2) {
      throw new Error("Reference codes were NOT unique!");
    }

    console.log("✅ UPGRADE PATH SUCCESSFUL!");
  } catch (error) {
    console.error("❌ FAILED:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    if (fs.existsSync(tempPath)) {
      fs.renameSync(tempPath, migrationPath);
    }
  }
}

run();
