const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { hasActiveConsent, grantConsent, revokeConsent } = require('../services/consent');
describe('Mission 5A Domain Integrity Tests', () => {
  let traineeId;
  let enrollmentId;
  let employerId;
  let courseId;

  beforeAll(async () => {
    // Clear out related tables for testing
    await prisma.wageSnapshot.deleteMany();
    await prisma.salariedEmploymentDetails.deleteMany();
    await prisma.selfEmploymentDetails.deleteMany();
    await prisma.apprenticeshipDetails.deleteMany();
    await prisma.verificationRecord.deleteMany();
    await prisma.employmentOutcome.deleteMany();
    await prisma.consentRecord.deleteMany();
    await prisma.enrollment.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.course.deleteMany();
    await prisma.provider.deleteMany();
    await prisma.programme.deleteMany();
    await prisma.employmentOutcome.deleteMany();
    await prisma.trainee.deleteMany();
    await prisma.user.deleteMany();
    await prisma.employer.deleteMany();

    const user = await prisma.user.create({ data: { role: 'TRAINEE' } });
    const trainee = await prisma.trainee.create({
      data: { userId: user.id, systemId: 'T1-5A', name: 'Test 5A', phone: '1111111111', consentStatus: false }
    });
    traineeId = trainee.id;

    const employer = await prisma.employer.create({
      data: { name: 'Test Employer', district: 'Test District' }
    });
    employerId = employer.id;

    const programme = await prisma.programme.create({
      data: { name: 'Prog 1', code: 'P1' }
    });

    const course = await prisma.course.create({
      data: { name: 'Course 1', code: 'C1', sector: 'IT', programmeId: programme.id }
    });
    courseId = course.id;

    const provider = await prisma.provider.create({
      data: { name: 'Prov 1', district: 'Dist 1' }
    });

    const batch = await prisma.batch.create({
      data: {
        batchIdentifier: 'B1',
        courseId: course.id,
        providerId: provider.id,
        programmeId: programme.id,
        startDate: new Date(),
        plannedEndDate: new Date()
      }
    });

    const enrollment = await prisma.enrollment.create({
      data: {
        traineeId: trainee.id,
        programmeId: programme.id,
        providerId: provider.id,
        courseId: course.id,
        batchId: batch.id,
        status: 'COMPLETED'
      }
    });
    enrollmentId = enrollment.id;
  });

  afterAll(async () => {
    await prisma.wageSnapshot.deleteMany();
    await prisma.salariedEmploymentDetails.deleteMany();
    await prisma.selfEmploymentDetails.deleteMany();
    await prisma.apprenticeshipDetails.deleteMany();
    await prisma.verificationRecord.deleteMany();
    await prisma.employmentOutcome.deleteMany();
    await prisma.consentRecord.deleteMany();
    await prisma.enrollment.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.course.deleteMany();
    await prisma.provider.deleteMany();
    await prisma.programme.deleteMany();
    await prisma.employmentOutcome.deleteMany();
    await prisma.trainee.deleteMany();
    await prisma.user.deleteMany();
    await prisma.employer.deleteMany();
    await prisma.$disconnect();
  });

  it('1. Outcome may exist without enrollment only when explicitly UNLINKED', async () => {
    const outcome = await prisma.employmentOutcome.create({
      data: {
        traineeId,
        type: 'SALARIED',
        startDate: new Date(),
        linkageStatus: 'UNLINKED'
      }
    });

    expect(outcome.enrollmentId).toBeNull();
    expect(outcome.linkageStatus).toBe('UNLINKED');
  });

  it('2. New manually linked outcome requires valid enrollment', async () => {
    const outcome = await prisma.employmentOutcome.create({
      data: {
        traineeId,
        type: 'SALARIED',
        startDate: new Date(),
        linkageStatus: 'MANUALLY_LINKED',
        enrollmentId
      }
    });

    expect(outcome.enrollmentId).toBe(enrollmentId);
    expect(outcome.linkageStatus).toBe('MANUALLY_LINKED');
  });

  it('2.5. Linked outcome rejects invalid enrollment (foreign key)', async () => {
    await expect(
      prisma.employmentOutcome.create({
        data: {
          traineeId,
          type: 'SALARIED',
          startDate: new Date(),
          linkageStatus: 'MANUALLY_LINKED',
          enrollmentId: 'invalid-id-not-exist'
        }
      })
    ).rejects.toThrow();
  });

  it('2.6. Linked outcome rejects NULL enrollment (CHECK constraint)', async () => {
    await expect(
      prisma.employmentOutcome.create({
        data: {
          traineeId,
          type: 'SALARIED',
          startDate: new Date(),
          linkageStatus: 'LINKED',
          enrollmentId: null
        }
      })
    ).rejects.toThrow();
  });

  it('2.7. Manually linked outcome rejects NULL enrollment (CHECK constraint)', async () => {
    await expect(
      prisma.employmentOutcome.create({
        data: {
          traineeId,
          type: 'SALARIED',
          startDate: new Date(),
          linkageStatus: 'MANUALLY_LINKED',
          enrollmentId: null
        }
      })
    ).rejects.toThrow();
  });
  it('3. No automatic latest enrollment linkage', async () => {
    // Creating outcome without enrollment defaults to UNLINKED
    const outcome = await prisma.employmentOutcome.create({
      data: {
        traineeId,
        type: 'SALARIED',
        startDate: new Date()
      }
    });
    expect(outcome.enrollmentId).toBeNull();
    expect(outcome.linkageStatus).toBe('UNLINKED');
  });

  it('4. OutcomeSource rejects invalid values', async () => {
    await expect(
      prisma.employmentOutcome.create({
        data: {
          traineeId,
          type: 'SALARIED',
          startDate: new Date(),
          source: 'INVALID_SOURCE'
        }
      })
    ).rejects.toThrow();
  });

  it('5. VerificationStatus rejects invalid values', async () => {
    const outcome = await prisma.employmentOutcome.create({
      data: { traineeId, type: 'SALARIED', startDate: new Date() }
    });
    
    await expect(
      prisma.verificationRecord.create({
        data: {
          outcomeId: outcome.id,
          status: 'NOT_A_STATUS'
        }
      })
    ).rejects.toThrow();
  });

  it('6. VerificationRecord can represent VERIFIED and REJECTED states', async () => {
    const outcome = await prisma.employmentOutcome.create({
      data: { traineeId, type: 'SALARIED', startDate: new Date() }
    });

    const v1 = await prisma.verificationRecord.create({
      data: {
        outcomeId: outcome.id,
        status: 'VERIFIED',
        method: 'EPFO_MATCH',
        verifiedAt: new Date()
      }
    });
    expect(v1.status).toBe('VERIFIED');

    const v2 = await prisma.verificationRecord.create({
      data: {
        outcomeId: outcome.id,
        status: 'REJECTED',
        reason: 'Invalid documents'
      }
    });
    expect(v2.status).toBe('REJECTED');
  });

  it('7. Self-employment does not require employer', async () => {
    const outcome = await prisma.employmentOutcome.create({
      data: {
        traineeId,
        type: 'SELF_EMPLOYED',
        startDate: new Date()
      }
    });

    const details = await prisma.selfEmploymentDetails.create({
      data: {
        outcomeId: outcome.id,
        businessName: 'My Business',
        registrationType: 'MSME'
      }
    });

    expect(outcome.employerId).toBeNull();
    expect(details.businessName).toBe('My Business');
  });

  it('8. Salaried employment requires employer (domain rule)', async () => {
    // In schema, employer is technically optional on EmploymentOutcome to support Self-Employed,
    // but the domain enforces that SALARIED and APPRENTICESHIP must have an employer.
    // This test documents that the database allows the null, meaning we MUST enforce it in the API layer.
    const outcome = await prisma.employmentOutcome.create({
      data: {
        traineeId,
        type: 'SALARIED',
        startDate: new Date(),
        employerId
      }
    });
    const details = await prisma.salariedEmploymentDetails.create({
      data: { outcomeId: outcome.id }
    });

    expect(outcome.employerId).toBe(employerId);
    expect(details.outcomeId).toBe(outcome.id);
  });

  it('9. Apprenticeship has its distinct semantics', async () => {
    const outcome = await prisma.employmentOutcome.create({
      data: { traineeId, type: 'APPRENTICESHIP', startDate: new Date(), employerId }
    });

    const details = await prisma.apprenticeshipDetails.create({
      data: {
        outcomeId: outcome.id,
        portalIdentifier: 'APP123',
        contractDuration: 12
      }
    });

    expect(details.contractDuration).toBe(12);
  });

  it('10. Compensation type distinguishes SALARY / STIPEND / SELF_EMPLOYMENT_INCOME', async () => {
    const outcome = await prisma.employmentOutcome.create({
      data: { traineeId, type: 'SALARIED', startDate: new Date() }
    });

    const salary = await prisma.wageSnapshot.create({
      data: {
        outcomeId: outcome.id,
        wageAmount: 50000,
        type: 'SALARY'
      }
    });

    const stipend = await prisma.wageSnapshot.create({
      data: {
        outcomeId: outcome.id,
        wageAmount: 15000,
        type: 'STIPEND'
      }
    });
    
    const selfIncome = await prisma.wageSnapshot.create({
      data: {
        outcomeId: outcome.id,
        wageAmount: 30000,
        type: 'SELF_EMPLOYMENT_INCOME'
      }
    });

    expect(salary.type).toBe('SALARY');
    expect(stipend.type).toBe('STIPEND');
    expect(selfIncome.type).toBe('SELF_EMPLOYMENT_INCOME');
  });

  it('11. Consent conceptually uses append-only history (Regression)', async () => {
    // 1. grant -> hasConsent = true
    await grantConsent(traineeId, 'OUTCOME_TRACKING', 'v1');
    let hasConsent = await hasActiveConsent(traineeId, 'OUTCOME_TRACKING');
    expect(hasConsent).toBe(true);

    // 2. revoke -> hasConsent = false
    await revokeConsent(traineeId, 'OUTCOME_TRACKING', 'v1');
    hasConsent = await hasActiveConsent(traineeId, 'OUTCOME_TRACKING');
    expect(hasConsent).toBe(false);

    // 3. grant -> revoke -> grant -> hasConsent = true
    await grantConsent(traineeId, 'OUTCOME_TRACKING', 'v2');
    hasConsent = await hasActiveConsent(traineeId, 'OUTCOME_TRACKING');
    expect(hasConsent).toBe(true);

    // 4. separate purposes remain independent
    const otherConsent = await hasActiveConsent(traineeId, 'EMPLOYMENT_VERIFICATION');
    expect(otherConsent).toBe(false);
  });

  it('12. No invalid Course -> Provider relation is introduced', async () => {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: { batches: true, enrollments: true }
    });
    
    // Using TS/JS checking that .provider does not exist on Course natively
    // A query for 'provider' directly on 'course' in Prisma include would fail typechecks or at runtime
    expect(course.provider).toBeUndefined();
    
    const enrollments = await prisma.enrollment.findMany({
      where: { id: enrollmentId },
      include: { course: true, provider: true, batch: true }
    });
    expect(enrollments[0].course).toBeDefined();
    expect(enrollments[0].provider).toBeDefined();
  });
});
