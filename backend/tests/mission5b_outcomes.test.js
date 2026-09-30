const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../index');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

describe('Mission 5B - Outcome Ingestion and Trainee APIs', () => {
  let trainee, operator, employer, enrollment;
  let operatorToken, traineeToken;

  beforeAll(async () => {
    // Clean up
    await prisma.employmentOutcome.deleteMany();
    await prisma.enrollment.deleteMany();
    await prisma.employer.deleteMany();
    await prisma.trainee.deleteMany();
    await prisma.operator.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.course.deleteMany();
    await prisma.provider.deleteMany();
    await prisma.programme.deleteMany();
    await prisma.user.deleteMany();

    // Create User + Operator
    const opUser = await prisma.user.create({ data: { role: 'OPERATOR' } });
    operator = await prisma.operator.create({
      data: {
        userId: opUser.id,
        email: 'op5b@example.com',
        passwordHash: await bcrypt.hash('password', 10),
        department: 'Placement'
      }
    });

    const resOp = await request(app).post('/api/auth/operator/login').send({
      email: 'op5b@example.com',
      password: 'password'
    });
    operatorToken = resOp.body.token;

    // Create User + Trainee
    const tUser = await prisma.user.create({ data: { role: 'TRAINEE' } });
    trainee = await prisma.trainee.create({
      data: {
        userId: tUser.id,
        systemId: 'TR-5B-123',
        name: 'Outcome Trainee',
        phone: '+919999955555'
      }
    });

    // Create valid OTP for trainee login
    const otp = await prisma.otpChallenge.create({
      data: {
        traineeId: trainee.id,
        otpHash: await bcrypt.hash('123456', 10),
        purpose: 'LOGIN',
        targetPhone: '+919999955555',
        expiresAt: new Date(Date.now() + 600000),
        maxAttempts: 3
      }
    });
    const resTrainee = await request(app).post('/api/auth/verify-otp').send({
      phone: '+919999955555',
      otp: '123456'
    });
    traineeToken = resTrainee.body.token;

    // Create setup data for enrollment
    const programme = await prisma.programme.create({ data: { name: 'Prog', code: 'P5B' } });
    const provider = await prisma.provider.create({ data: { name: 'Prov', district: 'Dist' } });
    const course = await prisma.course.create({ data: { name: 'Course', sector: 'IT' } });
    const batch = await prisma.batch.create({
      data: {
        batchIdentifier: 'B5B-1',
        courseId: course.id,
        providerId: provider.id,
        programmeId: programme.id,
        startDate: new Date('2025-01-01'),
        plannedEndDate: new Date('2025-06-01')
      }
    });

    enrollment = await prisma.enrollment.create({
      data: {
        traineeId: trainee.id,
        programmeId: programme.id,
        providerId: provider.id,
        courseId: course.id,
        batchId: batch.id,
        status: 'COMPLETED',
        completionDate: new Date('2025-06-01')
      }
    });

    employer = await prisma.employer.create({
      data: { name: 'Tech Corp', district: 'Bangalore' }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('ingests SALARIED outcome successfully', async () => {
    const res = await request(app)
      .post('/api/ingest/outcome')
      .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
      .set('x-idempotency-key', 'idem-1')
      .send({
        systemId: trainee.systemId,
        type: 'SALARIED',
        source: 'PLACEMENT_PARTNER',
        startDate: '2025-07-01',
        employerId: employer.id,
        enrollmentId: enrollment.id,
        wageAmount: 50000
      });
    
    expect(res.status).toBe(201);
    expect(res.body.outcome.type).toBe('SALARIED');
    expect(res.body.outcome.salariedDetails).toBeDefined();
    expect(res.body.outcome.wageSnapshots).toHaveLength(1);
    expect(res.body.outcome.wageSnapshots[0].wageAmount).toBe(50000);
    expect(res.body.outcome.wageSnapshots[0].type).toBe('SALARY');
    expect(res.body.outcome.linkageStatus).toBe('LINKED');
  });

  it('is idempotent for exact same SALARIED outcome', async () => {
    const res = await request(app)
      .post('/api/ingest/outcome')
      .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
      .set('x-idempotency-key', 'idem-1')
      .send({
        systemId: trainee.systemId,
        type: 'SALARIED',
        source: 'PLACEMENT_PARTNER',
        startDate: '2025-07-01',
        employerId: employer.id,
        enrollmentId: enrollment.id,
        wageAmount: 50000
      });
    
    expect(res.status).toBe(200); // 200 OK means idempotent hit
    expect(res.body.message).toMatch(/idempotent/);
    
    const outcomes = await prisma.employmentOutcome.findMany({ where: { type: 'SALARIED' } });
    expect(outcomes.length).toBe(1);
  });

  it('fails SALARIED outcome without employerId', async () => {
    const res = await request(app)
      .post('/api/ingest/outcome')
      .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
      .set('x-idempotency-key', 'idem-2')
      .send({
        systemId: trainee.systemId,
        type: 'SALARIED',
        source: 'PLACEMENT_PARTNER',
        startDate: '2025-08-01',
        wageAmount: 40000
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/employerId is required/);
  });

  it('ingests SELF_EMPLOYED outcome without employerId', async () => {
    const res = await request(app)
      .post('/api/ingest/outcome')
      .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
      .set('x-idempotency-key', 'idem-3')
      .send({
        systemId: trainee.systemId,
        type: 'SELF_EMPLOYED',
        source: 'PLACEMENT_PARTNER',
        startDate: '2025-09-01',
        businessName: 'My Startup',
        registrationType: 'MSME',
        wageAmount: 20000
      });
    
    expect(res.status).toBe(201);
    expect(res.body.outcome.type).toBe('SELF_EMPLOYED');
    expect(res.body.outcome.employerId).toBeNull();
    expect(res.body.outcome.selfEmploymentDetails.businessName).toBe('My Startup');
    expect(res.body.outcome.wageSnapshots[0].type).toBe('SELF_EMPLOYMENT_INCOME');
    expect(res.body.outcome.linkageStatus).toBe('UNLINKED');
  });

  it('ingests APPRENTICESHIP outcome successfully', async () => {
    const res = await request(app)
      .post('/api/ingest/outcome')
      .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
      .set('x-idempotency-key', 'idem-4')
      .send({
        systemId: trainee.systemId,
        type: 'APPRENTICESHIP',
        source: 'PLACEMENT_PARTNER',
        startDate: '2025-10-01',
        employerId: employer.id,
        portalIdentifier: 'NAPS-123',
        contractDuration: 12,
        wageAmount: 15000
      });
    
    expect(res.status).toBe(201);
    expect(res.body.outcome.type).toBe('APPRENTICESHIP');
    expect(res.body.outcome.apprenticeshipDetails.portalIdentifier).toBe('NAPS-123');
    expect(res.body.outcome.wageSnapshots[0].type).toBe('STIPEND');
  });

  it('fails with 409 when idempotency key is reused with materially different payload', async () => {
    const res = await request(app)
      .post('/api/ingest/outcome')
      .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
      .set('x-idempotency-key', 'idem-1')
      .send({
        systemId: trainee.systemId,
        type: 'SALARIED',
        source: 'PLACEMENT_PARTNER',
        startDate: '2025-07-01',
        employerId: employer.id,
        enrollmentId: enrollment.id,
        wageAmount: 90000 // Different wage amount!
      });
    
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/different payload/);
  });

  it('distinct idempotency keys create separate outcomes despite identical business fields', async () => {
    // Request A
    const resA = await request(app)
      .post('/api/ingest/outcome')
      .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
      .set('x-idempotency-key', 'DISTINCT-A')
      .send({
        systemId: trainee.systemId,
        type: 'SALARIED',
        source: 'PLACEMENT_PARTNER',
        startDate: '2025-12-01',
        employerId: employer.id,
        enrollmentId: enrollment.id,
        wageAmount: 50000
      });
    
    expect(resA.status).toBe(201);

    // Request B - Identical payload, different key
    const resB = await request(app)
      .post('/api/ingest/outcome')
      .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
      .set('x-idempotency-key', 'DISTINCT-B')
      .send({
        systemId: trainee.systemId,
        type: 'SALARIED',
        source: 'PLACEMENT_PARTNER',
        startDate: '2025-12-01',
        employerId: employer.id,
        enrollmentId: enrollment.id,
        wageAmount: 50000
      });
    
    expect(resB.status).toBe(201);

    // Verify both exist
    const outA = await prisma.employmentOutcome.findFirst({ where: { idempotencyKey: 'DISTINCT-A' } });
    const outB = await prisma.employmentOutcome.findFirst({ where: { idempotencyKey: 'DISTINCT-B' } });

    expect(outA).toBeDefined();
    expect(outB).toBeDefined();
    expect(outA.id).not.toBe(outB.id);
  });

  it('handles concurrent identical requests gracefully (race condition)', async () => {
    // Generate a new idempotency key and concurrent requests
    const requests = Array.from({ length: 5 }).map(() => {
      return request(app)
        .post('/api/ingest/outcome')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .set('x-idempotency-key', 'idem-concurrent-1')
        .send({
          systemId: trainee.systemId,
          type: 'SALARIED',
          source: 'PLACEMENT_PARTNER',
          startDate: '2025-11-01',
          employerId: employer.id,
          wageAmount: 60000
        });
    });

    const responses = await Promise.all(requests);
    
    const statusCodes = responses.map(r => r.status);
    const created = statusCodes.filter(c => c === 201).length;
    const ok = statusCodes.filter(c => c === 200).length;

    expect(created).toBe(1);
    expect(ok).toBe(4);

    const outcomes = await prisma.employmentOutcome.findMany({ where: { idempotencyKey: 'idem-concurrent-1' } });
    expect(outcomes.length).toBe(1);
  });

  it('trainee can read their outcomes safely', async () => {
    const res = await request(app)
      .get('/api/trainee/me/outcomes')
      .set('Authorization', `Bearer ${traineeToken}`);
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(6); // Salaried, Self, Apprenticeship, Concurrent, Distinct A, Distinct B
    
    const first = res.body[0];
    expect(first.referenceCode).toBeDefined();
    // Must NOT leak internal IDs
    expect(first.id).toBeUndefined();
    expect(first.traineeId).toBeUndefined();
    expect(first.employerId).toBeUndefined();
    expect(first.enrollmentId).toBeUndefined();
    expect(first.details).toBeDefined();
  });

  it('trainee can read a specific outcome by referenceCode safely', async () => {
    // Get list to grab a reference
    const listRes = await request(app).get('/api/trainee/me/outcomes').set('Authorization', `Bearer ${traineeToken}`);
    const ref = listRes.body[0].referenceCode;

    const res = await request(app)
      .get(`/api/trainee/me/outcomes/${ref}`)
      .set('Authorization', `Bearer ${traineeToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.referenceCode).toBe(ref);
    expect(res.body.type).toBeDefined();
    // Safety check
    expect(res.body.id).toBeUndefined();
    expect(res.body.traineeId).toBeUndefined();
    expect(res.body.employerId).toBeUndefined();
  });
  describe('Mission 5B - Provenance and Source Validation', () => {
    it('rejects partner outcome ingestion with missing source', async () => {
      const res = await request(app)
        .post('/api/ingest/outcome')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .set('x-idempotency-key', 'idem-prov-1')
        .send({
          systemId: trainee.systemId,
          type: 'SALARIED',
          startDate: '2025-07-01',
          employerId: employer.id,
          wageAmount: 50000
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_input');
    });

    it('rejects partner outcome ingestion with invalid source', async () => {
      const res = await request(app)
        .post('/api/ingest/outcome')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .set('x-idempotency-key', 'idem-prov-2')
        .send({
          systemId: trainee.systemId,
          type: 'SALARIED',
          source: 'FAKE_SOURCE',
          startDate: '2025-07-01',
          employerId: employer.id,
          wageAmount: 50000
        });
      expect(res.status).toBe(400);
    });

    it('rejects false trainee self-report from partner API', async () => {
      const res = await request(app)
        .post('/api/ingest/outcome')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .set('x-idempotency-key', 'idem-prov-3')
        .send({
          systemId: trainee.systemId,
          type: 'SALARIED',
          source: 'TRAINEE_SELF_REPORT',
          startDate: '2025-07-01',
          employerId: employer.id,
          wageAmount: 50000
        });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('authorization_failure');
    });

    it('rejects partner outcome ingestion with unsupported provenance sources', async () => {
      const unsupportedSources = ['EMPLOYER_REPORT', 'GOVERNMENT_REGISTRY', 'OPERATOR_ENTRY', 'PROGRAMME_IMPORT', 'PROVIDER_IMPORT'];
      for (let i = 0; i < unsupportedSources.length; i++) {
        const res = await request(app)
          .post('/api/ingest/outcome')
          .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
          .set('x-idempotency-key', `idem-unsupported-${i}`)
          .send({
            systemId: trainee.systemId,
            type: 'SALARIED',
            source: unsupportedSources[i],
            startDate: '2025-07-01',
            employerId: employer.id,
            wageAmount: 50000
          });
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('authorization_failure');
      }
    });
  });

  describe('Mission 5B - Trainee Self-Report and Consent', () => {
    const { grantConsent, revokeConsent } = require('../services/consent');

    it('rejects trainee self-report with no consent', async () => {
      // Ensure no consent
      await prisma.consentRecord.deleteMany({ where: { traineeId: trainee.id } });

      const res = await request(app)
        .post('/api/trainee/me/outcome')
        .set('Authorization', `Bearer ${traineeToken}`)
        .set('x-idempotency-key', 'trainee-idem-1')
        .send({
          type: 'SALARIED',
          startDate: '2025-10-01',
          employerId: employer.id,
          wageAmount: 55000
        });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('authorization_failure');
    });

    it('rejects trainee self-report with other consent purpose', async () => {
      await grantConsent(trainee.id, 'EMPLOYMENT_VERIFICATION', '1.0');

      const res = await request(app)
        .post('/api/trainee/me/outcome')
        .set('Authorization', `Bearer ${traineeToken}`)
        .set('x-idempotency-key', 'trainee-idem-2')
        .send({
          type: 'SALARIED',
          startDate: '2025-10-01',
          employerId: employer.id,
          wageAmount: 55000
        });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('authorization_failure');
    });

    it('accepts trainee self-report with active OUTCOME_TRACKING consent', async () => {
      await grantConsent(trainee.id, 'OUTCOME_TRACKING', '1.0');

      const res = await request(app)
        .post('/api/trainee/me/outcome')
        .set('Authorization', `Bearer ${traineeToken}`)
        .set('x-idempotency-key', 'trainee-idem-3')
        .send({
          type: 'SALARIED',
          startDate: '2025-10-01',
          employerId: employer.id,
          wageAmount: 55000
        });
      expect(res.status).toBe(201);
      expect(res.body.outcome.source).toBe('TRAINEE_SELF_REPORT');
      expect(res.body.outcome.type).toBe('SALARIED');
    });

    it('rejects trainee self-report after consent is revoked', async () => {
      await revokeConsent(trainee.id, 'OUTCOME_TRACKING', '1.0');

      const res = await request(app)
        .post('/api/trainee/me/outcome')
        .set('Authorization', `Bearer ${traineeToken}`)
        .set('x-idempotency-key', 'trainee-idem-4')
        .send({
          type: 'SALARIED',
          startDate: '2025-10-01',
          employerId: employer.id,
          wageAmount: 56000
        });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('authorization_failure');
    });

    it('rejects trainee self-report missing idempotency key', async () => {
      await grantConsent(trainee.id, 'OUTCOME_TRACKING', '1.0');
      const res = await request(app)
        .post('/api/trainee/me/outcome')
        .set('Authorization', `Bearer ${traineeToken}`)
        .send({
          type: 'SALARIED',
          startDate: '2025-10-01',
          employerId: employer.id,
          wageAmount: 55000
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('missing_idempotency_key');
    });

    it('is idempotent for exact same trainee self-report', async () => {
      // Must use same key as active consent test ('trainee-idem-3') and same payload
      await grantConsent(trainee.id, 'OUTCOME_TRACKING', '1.0');
      
      const res = await request(app)
        .post('/api/trainee/me/outcome')
        .set('Authorization', `Bearer ${traineeToken}`)
        .set('x-idempotency-key', 'trainee-idem-3')
        .send({
          type: 'SALARIED',
          startDate: '2025-10-01',
          employerId: employer.id,
          wageAmount: 55000
        });
      
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/already exists/i);
    });

    it('fails with 409 when idempotency key is reused with materially different payload for trainee', async () => {
      await grantConsent(trainee.id, 'OUTCOME_TRACKING', '1.0');
      
      const res = await request(app)
        .post('/api/trainee/me/outcome')
        .set('Authorization', `Bearer ${traineeToken}`)
        .set('x-idempotency-key', 'trainee-idem-3')
        .send({
          type: 'SALARIED',
          startDate: '2025-10-01',
          employerId: employer.id,
          wageAmount: 60000 // changed amount
        });
      
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('conflict');
    });
  });

  describe('Mission 5B - Route Extraction Structure', () => {
    it('legacy inline route is removed from index.js', () => {
      const fs = require('fs');
      const path = require('path');
      const indexPath = path.join(__dirname, '../index.js');
      const indexContent = fs.readFileSync(indexPath, 'utf8');
      
      // Verify app.post('/api/ingest/outcome' is not in index.js
      expect(indexContent.includes("app.post('/api/ingest/outcome'")).toBe(false);
      // Verify the router is used
      expect(indexContent.includes("app.use('/api/ingest', ")).toBe(true);
    });

    it('outcomeIngestion route is implemented in its own file', () => {
      const fs = require('fs');
      const path = require('path');
      const routerPath = path.join(__dirname, '../routes/outcomeIngestion.js');
      const routerContent = fs.readFileSync(routerPath, 'utf8');
      
      expect(routerContent.includes("router.post('/outcome'")).toBe(true);
    });
  });

  describe('Mission P1-3 - Trainee Outcome Routes Structure', () => {
    it('GET /outcomes is registered exactly once', () => {
      const fs = require('fs');
      const path = require('path');
      const traineePath = path.join(__dirname, '../routes/trainee.js');
      const content = fs.readFileSync(traineePath, 'utf8');
      
      const matches = content.match(/router\.get\('\/outcomes'/g);
      expect(matches).not.toBeNull();
      expect(matches.length).toBe(1);
    });

    it('GET /outcomes/:reference is registered exactly once', () => {
      const fs = require('fs');
      const path = require('path');
      const traineePath = path.join(__dirname, '../routes/trainee.js');
      const content = fs.readFileSync(traineePath, 'utf8');
      
      const matches = content.match(/router\.get\('\/outcomes\/:reference'/g);
      expect(matches).not.toBeNull();
      expect(matches.length).toBe(1);
    });
  });
});
