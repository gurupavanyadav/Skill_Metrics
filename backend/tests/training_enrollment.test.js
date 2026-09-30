const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../index');

const prisma = new PrismaClient();

describe('Mission 3: Trainee Training & Enrollment Backend', () => {
  let traineeToken;
  let anotherTraineeToken;
  let testTrainee;
  let anotherTrainee;
  let testProgramme;
  let testProvider;
  let testCourse;
  let testBatch;

  beforeAll(async () => {
    // Clear data to avoid conflicts
    await prisma.wageSnapshot.deleteMany();
    await prisma.salariedEmploymentDetails.deleteMany();
    await prisma.selfEmploymentDetails.deleteMany();
    await prisma.apprenticeshipDetails.deleteMany();
    await prisma.verificationRecord.deleteMany();
    await prisma.employmentOutcome.deleteMany();
    await prisma.consentRecord.deleteMany();
    await prisma.traineeSkillAttainment.deleteMany();
    await prisma.assessmentSkillResult.deleteMany();
    await prisma.assessmentAttempt.deleteMany();
    await prisma.certificationSkill.deleteMany();
    await prisma.certification.deleteMany();
    await prisma.enrollment.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.course.deleteMany();
    await prisma.provider.deleteMany();
    await prisma.programme.deleteMany();
    await prisma.traineeContact.deleteMany();
    await prisma.otpChallenge.deleteMany();
    await prisma.employmentOutcome.deleteMany();
    await prisma.trainee.deleteMany();
    await prisma.user.deleteMany();

    // Create users & trainees
    const user1 = await prisma.user.create({ data: { role: 'TRAINEE' } });
    testTrainee = await prisma.trainee.create({
      data: { userId: user1.id, systemId: 'SYS_T_001_M3', name: 'Trainee One', phone: '+919999999991' }
    });
    traineeToken = require('jsonwebtoken').sign({ id: user1.id, role: 'TRAINEE' }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' });

    const user2 = await prisma.user.create({ data: { role: 'TRAINEE' } });
    anotherTrainee = await prisma.trainee.create({
      data: { userId: user2.id, systemId: 'SYS_T_002_M3', name: 'Trainee Two', phone: '+919999999992' }
    });
    anotherTraineeToken = require('jsonwebtoken').sign({ id: user2.id, role: 'TRAINEE' }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' });

    // Create Programme, Provider, Course, Batch
    testProgramme = await prisma.programme.create({
      data: { name: 'Gov Skills', code: 'GS001', description: 'Gov skills program' }
    });

    testProvider = await prisma.provider.create({
      data: { name: 'Skill Provider 1', district: 'Delhi' }
    });

    testCourse = await prisma.course.create({
      data: { name: 'Web Dev', code: 'WD001', sector: 'IT', programmeId: testProgramme.id, duration: 120 }
    });

    testBatch = await prisma.batch.create({
      data: {
        batchIdentifier: 'B-WD-001',
        courseId: testCourse.id,
        providerId: testProvider.id,
        programmeId: testProgramme.id,
        startDate: new Date('2023-01-01'),
        plannedEndDate: new Date('2023-03-01'),
        status: 'ACTIVE'
      }
    });
  });

  afterAll(async () => {
    await prisma.wageSnapshot.deleteMany();
    await prisma.salariedEmploymentDetails.deleteMany();
    await prisma.selfEmploymentDetails.deleteMany();
    await prisma.apprenticeshipDetails.deleteMany();
    await prisma.verificationRecord.deleteMany();
    await prisma.employmentOutcome.deleteMany();
    await prisma.consentRecord.deleteMany();
    await prisma.traineeSkillAttainment.deleteMany();
    await prisma.assessmentSkillResult.deleteMany();
    await prisma.assessmentAttempt.deleteMany();
    await prisma.certificationSkill.deleteMany();
    await prisma.certification.deleteMany();
    await prisma.enrollment.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.course.deleteMany();
    await prisma.provider.deleteMany();
    await prisma.programme.deleteMany();
    await prisma.trainee.deleteMany({ where: { phone: { in: ['+919999999991', '+919999999992'] } } });
    if (testTrainee) await prisma.user.deleteMany({ where: { id: testTrainee.userId } });
    if (anotherTrainee) await prisma.user.deleteMany({ where: { id: anotherTrainee.userId } });
    await prisma.$disconnect();
  });

  describe('Ingestion & Constraints', () => {
    it('trusted ingestion can create valid enrollment', async () => {
      const res = await request(app)
        .post('/api/ingest/enrollment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          systemId: testTrainee.systemId,
          programmeId: testProgramme.id,
          providerId: testProvider.id,
          courseId: testCourse.id,
          batchId: testBatch.id,
          status: 'ENROLLED',
          enrollmentDate: '2023-01-02'
        });

      expect(res.status).toBe(200);
      expect(res.body.enrollment).toBeDefined();
      expect(res.body.enrollment.status).toBe('ENROLLED');
    });

    it('unauthenticated ingestion is rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/enrollment')
        .send({
          systemId: testTrainee.systemId,
          programmeId: testProgramme.id,
          providerId: testProvider.id,
          courseId: testCourse.id,
          batchId: testBatch.id
        });

      expect(res.status).toBe(401);
    });

    it('invalid input (missing fields) is rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/enrollment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          systemId: testTrainee.systemId,
          // Missing programmeId
          providerId: testProvider.id,
          courseId: testCourse.id,
          batchId: testBatch.id
        });

      expect(res.status).toBe(400);
    });

    it('batch relationship mismatch is rejected', async () => {
      // Create a different course
      const anotherCourse = await prisma.course.create({
        data: { name: 'Data Sci', sector: 'IT', programmeId: testProgramme.id }
      });

      const res = await request(app)
        .post('/api/ingest/enrollment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          systemId: anotherTrainee.systemId,
          programmeId: testProgramme.id,
          providerId: testProvider.id,
          courseId: anotherCourse.id, // Mismatch with testBatch.courseId
          batchId: testBatch.id
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Batch relationship mismatch");
    });
    
    it('course programme mismatch is rejected', async () => {
      // Create a different programme
      const anotherProgramme = await prisma.programme.create({
        data: { name: 'Health Program', code: 'PRG-HLTH' }
      });
      // Create a course that belongs to this new programme
      const healthCourse = await prisma.course.create({
        data: { name: 'Nursing', sector: 'Health', programmeId: anotherProgramme.id }
      });
      // Create a batch that tries to run this healthCourse under the original testProgramme
      const mismatchBatch = await prisma.batch.create({
        data: {
          batchIdentifier: 'B-HLTH-001',
          courseId: healthCourse.id,
          providerId: testProvider.id,
          programmeId: testProgramme.id, // MISMATCH
          startDate: new Date('2023-01-01'),
          plannedEndDate: new Date('2023-03-01')
        }
      });

      const res = await request(app)
        .post('/api/ingest/enrollment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          systemId: anotherTrainee.systemId,
          programmeId: testProgramme.id,
          providerId: testProvider.id,
          courseId: healthCourse.id,
          batchId: mismatchBatch.id
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Course belongs to a different programme");
    });

    it('programme-agnostic course is accepted', async () => {
      // Create a course with NO programmeId
      const agnosticCourse = await prisma.course.create({
        data: { name: 'Soft Skills', sector: 'General', programmeId: null }
      });
      // Create a batch under testProgramme
      const agnosticBatch = await prisma.batch.create({
        data: {
          batchIdentifier: 'B-AGN-001',
          courseId: agnosticCourse.id,
          providerId: testProvider.id,
          programmeId: testProgramme.id,
          startDate: new Date('2023-01-01'),
          plannedEndDate: new Date('2023-03-01')
        }
      });

      const res = await request(app)
        .post('/api/ingest/enrollment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          systemId: anotherTrainee.systemId,
          programmeId: testProgramme.id,
          providerId: testProvider.id,
          courseId: agnosticCourse.id,
          batchId: agnosticBatch.id
        });

      expect(res.status).toBe(200);
    });
    
    it('completed without completionDate rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/enrollment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          systemId: anotherTrainee.systemId,
          programmeId: testProgramme.id,
          providerId: testProvider.id,
          courseId: testCourse.id,
          batchId: testBatch.id,
          status: 'COMPLETED'
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("completionDate is required for COMPLETED status");
    });

    it('completion before enrollment rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/enrollment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          systemId: anotherTrainee.systemId,
          programmeId: testProgramme.id,
          providerId: testProvider.id,
          courseId: testCourse.id,
          batchId: testBatch.id,
          status: 'COMPLETED',
          enrollmentDate: '2023-05-01',
          completionDate: '2023-01-01'
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("completionDate cannot be before enrollmentDate");
    });

    it('same course can have multiple providers via different batches', async () => {
      const anotherProvider = await prisma.provider.create({
        data: { name: 'Skill Provider 2', district: 'Mumbai' }
      });
      const anotherBatch = await prisma.batch.create({
        data: {
          batchIdentifier: 'B-WD-002',
          courseId: testCourse.id, // SAME COURSE
          providerId: anotherProvider.id, // DIFFERENT PROVIDER
          programmeId: testProgramme.id,
          startDate: new Date('2023-01-01'),
          plannedEndDate: new Date('2023-03-01'),
          status: 'ACTIVE'
        }
      });
      
      const res = await request(app)
        .post('/api/ingest/enrollment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          systemId: testTrainee.systemId,
          programmeId: testProgramme.id,
          providerId: anotherProvider.id,
          courseId: testCourse.id,
          batchId: anotherBatch.id,
          status: 'ENROLLED'
        });
      expect(res.status).toBe(200);
    });
  });

  describe('Status Transitions', () => {
    it('valid status transition (ENROLLED -> IN_PROGRESS) is allowed', async () => {
      const res = await request(app)
        .post('/api/ingest/enrollment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          systemId: testTrainee.systemId,
          programmeId: testProgramme.id,
          providerId: testProvider.id,
          courseId: testCourse.id,
          batchId: testBatch.id,
          status: 'IN_PROGRESS'
        });

      expect(res.status).toBe(200);
      expect(res.body.enrollment.status).toBe('IN_PROGRESS');
    });

    it('invalid status transition (COMPLETED -> IN_PROGRESS) is rejected', async () => {
      // First, set it to COMPLETED
      await request(app)
        .post('/api/ingest/enrollment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          systemId: testTrainee.systemId,
          programmeId: testProgramme.id,
          providerId: testProvider.id,
          courseId: testCourse.id,
          batchId: testBatch.id,
          status: 'COMPLETED',
          enrollmentDate: '2023-01-01',
          completionDate: '2023-04-01'
        });

      // Try to revert to IN_PROGRESS
      const res = await request(app)
        .post('/api/ingest/enrollment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          systemId: testTrainee.systemId,
          programmeId: testProgramme.id,
          providerId: testProvider.id,
          courseId: testCourse.id,
          batchId: testBatch.id,
          status: 'IN_PROGRESS'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid status transition");
    });
  });

  describe('Trainee Self-Service APIs', () => {
    let referenceCode;

    it('trainee can retrieve own enrollment without UUID leaks', async () => {
      const res = await request(app)
        .get('/api/trainee/me/training')
        .set('Authorization', `Bearer ${traineeToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      const dto = res.body[0];
      referenceCode = dto.referenceCode;
      
      expect(referenceCode).toBeDefined();
      expect(dto.id).toBeUndefined(); // UUID LEAK CHECK
      expect(dto.programme).toBeDefined();
      expect(dto.programme.id).toBeUndefined(); // UUID LEAK CHECK
      expect(dto.provider).toBeDefined();
      expect(dto.course).toBeDefined();
      expect(dto.batch).toBeDefined();
      expect(dto.batch.id).toBeUndefined(); // UUID LEAK CHECK
      expect(dto.batch.code).toBeDefined();
      expect(dto.status).toBeDefined();
    });

    it('trainee can retrieve individual enrollment details via referenceCode', async () => {
      const res = await request(app)
        .get(`/api/trainee/me/training/${referenceCode}`)
        .set('Authorization', `Bearer ${traineeToken}`);

      expect(res.status).toBe(200);
      expect(res.body.referenceCode).toBe(referenceCode);
      expect(res.body.id).toBeUndefined();
    });

    it('unknown reference returns 404', async () => {
      const res = await request(app)
        .get(`/api/trainee/me/training/UNKNOWN-REF-123`)
        .set('Authorization', `Bearer ${traineeToken}`);

      expect(res.status).toBe(404);
    });

    it('trainee cannot retrieve another trainee enrollment', async () => {
      const res = await request(app)
        .get(`/api/trainee/me/training/${referenceCode}`)
        .set('Authorization', `Bearer ${anotherTraineeToken}`);

      expect(res.status).toBe(403);
    });
  });
});
