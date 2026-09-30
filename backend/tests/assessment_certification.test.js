const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../index');

const prisma = new PrismaClient();

describe('Mission 4: Assessment & Certification Backend', () => {
  let traineeToken;
  let anotherTraineeToken;
  let testTrainee;
  let anotherTrainee;
  let testCourse;
  let testEnrollment;
  let anotherEnrollment;
  let skill1, skill2;
  let assessment;

  beforeAll(async () => {
    // Clear data
    await prisma.traineeSkillAttainment.deleteMany();
    await prisma.assessmentSkillResult.deleteMany();
    await prisma.assessmentAttempt.deleteMany();
    await prisma.assessment.deleteMany();
    await prisma.certificationSkill.deleteMany();
    await prisma.certification.deleteMany();
    await prisma.courseSkill.deleteMany();
    await prisma.skill.deleteMany();
    await prisma.employmentOutcome.deleteMany();
    await prisma.enrollment.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.course.deleteMany();
    await prisma.provider.deleteMany();
    await prisma.programme.deleteMany();
    await prisma.employmentOutcome.deleteMany();
    await prisma.trainee.deleteMany();
    await prisma.user.deleteMany();

    const user1 = await prisma.user.create({ data: { role: 'TRAINEE' } });
    testTrainee = await prisma.trainee.create({
      data: { userId: user1.id, systemId: 'SYS_T_001_M4', name: 'Trainee One', phone: '+918888888881' }
    });
    traineeToken = require('jsonwebtoken').sign({ id: user1.id, role: 'TRAINEE' }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' });

    const user2 = await prisma.user.create({ data: { role: 'TRAINEE' } });
    anotherTrainee = await prisma.trainee.create({
      data: { userId: user2.id, systemId: 'SYS_T_002_M4', name: 'Trainee Two', phone: '+918888888882' }
    });
    anotherTraineeToken = require('jsonwebtoken').sign({ id: user2.id, role: 'TRAINEE' }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' });

    const prog = await prisma.programme.create({ data: { name: 'M4 Prog', code: 'M4P' } });
    const prov = await prisma.provider.create({ data: { name: 'M4 Prov', district: 'Pune' } });
    testCourse = await prisma.course.create({ data: { name: 'M4 Course', code: 'M4C', sector: 'IT' } });
    const batch = await prisma.batch.create({
      data: { batchIdentifier: 'M4B', courseId: testCourse.id, providerId: prov.id, programmeId: prog.id, startDate: new Date(), plannedEndDate: new Date() }
    });
    
    testEnrollment = await prisma.enrollment.create({
      data: { traineeId: testTrainee.id, programmeId: prog.id, providerId: prov.id, courseId: testCourse.id, batchId: batch.id, status: 'COMPLETED' }
    });

    const anotherCourse = await prisma.course.create({ data: { name: 'M4 Course 2', code: 'M4C2', sector: 'IT' } });
    const anotherBatch = await prisma.batch.create({
      data: { batchIdentifier: 'M4B2', courseId: anotherCourse.id, providerId: prov.id, programmeId: prog.id, startDate: new Date(), plannedEndDate: new Date() }
    });
    anotherEnrollment = await prisma.enrollment.create({
      data: { traineeId: anotherTrainee.id, programmeId: prog.id, providerId: prov.id, courseId: anotherCourse.id, batchId: anotherBatch.id, status: 'COMPLETED' }
    });
  });

  afterAll(async () => {
    await prisma.traineeSkillAttainment.deleteMany();
    await prisma.assessmentSkillResult.deleteMany();
    await prisma.assessmentAttempt.deleteMany();
    await prisma.assessment.deleteMany();
    await prisma.certificationSkill.deleteMany();
    await prisma.certification.deleteMany();
    await prisma.$disconnect();
  });

  describe('Skill Taxonomy & Course Skills', () => {
    it('creates skill through trusted path', async () => {
      const res = await request(app)
        .post('/api/ingest/skill')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({ code: 'SK-CNC', name: 'CNC Programming', taxonomy: 'NCO', active: true });
      expect(res.status).toBe(200);
      skill1 = res.body.skill;
      expect(skill1.code).toBe('SK-CNC');
    });

    it('duplicate skill code rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/skill')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({ code: 'SK-CNC', name: 'Another CNC' });
      expect(res.status).toBe(409);
    });

    it('empty code rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/skill')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({ code: '', name: 'CNC Programming' });
      expect(res.status).toBe(400);
    });

    it('empty name rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/skill')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({ code: 'SK-BLAH', name: '' });
      expect(res.status).toBe(400);
    });

    it('creates second skill', async () => {
      const res = await request(app)
        .post('/api/ingest/skill')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({ code: 'SK-SFTY', name: 'Industrial Safety' });
      skill2 = res.body.skill;
    });

    it('course skill mapping works', async () => {
      const res = await request(app)
        .post('/api/ingest/course-skill')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({ courseId: testCourse.id, skillId: skill1.id, expectedLevel: 'EXPERT', mandatory: true });
      expect(res.status).toBe(200);
    });

    it('duplicate course-skill rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/course-skill')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({ courseId: testCourse.id, skillId: skill1.id });
      expect(res.status).toBe(409);
    });
  });

  describe('Assessment', () => {
    it('valid assessment creation', async () => {
      const res = await request(app)
        .post('/api/ingest/assessment-definition')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          courseId: testCourse.id,
          name: 'Final CNC Test',
          code: 'CNC-TEST-1',
          assessmentType: 'PRACTICAL',
          maxScore: 100,
          passScore: 60
        });
      expect(res.status).toBe(200);
      assessment = res.body.assessment;
    });

    it('zero maxScore rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/assessment-definition')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          courseId: testCourse.id, name: 'T1', code: 'T1', assessmentType: 'PRACTICAL',
          maxScore: 0, passScore: 0
        });
      expect(res.status).toBe(400);
    });

    it('negative maxScore rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/assessment-definition')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          courseId: testCourse.id, name: 'T2', code: 'T2', assessmentType: 'PRACTICAL',
          maxScore: -10, passScore: 0
        });
      expect(res.status).toBe(400);
    });

    it('passScore > maxScore rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/assessment-definition')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          courseId: testCourse.id, name: 'T3', code: 'T3', assessmentType: 'PRACTICAL',
          maxScore: 100, passScore: 110
        });
      expect(res.status).toBe(400);
    });

    it('wrong course enrollment rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/assessment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: anotherEnrollment.id, // wrong enrollment
          assessmentId: assessment.id,
          attemptNumber: 1,
          score: 80,
          assessedAt: new Date().toISOString(),
          source: 'ASSESSOR'
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Enrollment course does not match Assessment course');
    });

    it('score validation and percentage calculation', async () => {
      const res = await request(app)
        .post('/api/ingest/assessment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id,
          assessmentId: assessment.id,
          attemptNumber: 1,
          score: 80,
          assessedAt: new Date().toISOString(),
          source: 'ASSESSOR',
          skillResults: [
            { skillId: skill1.id, proficiencyLevel: 'PROFICIENT', score: 80, result: 'PASS' }
          ]
        });
      expect(res.status).toBe(200);
      expect(res.body.attempt.percentage).toBe(80);
      expect(res.body.attempt.result).toBe('PASS');
    });

    it('invalid score (over max) rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/assessment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id,
          assessmentId: assessment.id,
          attemptNumber: 2,
          score: 110,
          assessedAt: new Date().toISOString(),
          source: 'ASSESSOR'
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Score cannot exceed maxScore');
    });

    it('failed assessment does not create trainee skill attainment', async () => {
      const res = await request(app)
        .post('/api/ingest/assessment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id,
          assessmentId: assessment.id,
          attemptNumber: 3,
          score: 40,
          assessedAt: new Date().toISOString(),
          source: 'ASSESSOR',
          skillResults: [
            { skillId: skill1.id, proficiencyLevel: 'BEGINNER', score: 40, result: 'FAIL' }
          ]
        });
      expect(res.status).toBe(200);
      
      const attainments = await prisma.traineeSkillAttainment.findMany({ 
        where: { traineeId: testEnrollment.traineeId, skillId: skill1.id, evidenceType: 'ASSESSMENT' }
      });
      // There should still only be the one attainment from the previous PASS test
      expect(attainments.length).toBe(1);
      expect(attainments[0].status).toBe('ASSESSED');

      const skillRes = await prisma.assessmentSkillResult.findFirst({
        where: { skillId: skill1.id, result: 'FAIL' }
      });
      expect(skillRes).toBeDefined();
    });
    
    it('duplicate attempt rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/assessment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id,
          assessmentId: assessment.id,
          attemptNumber: 1,
          score: 80,
          assessedAt: new Date().toISOString(),
          source: 'ASSESSOR'
        });
      expect(res.status).toBe(409);
    });

    it('invalid assessment date rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/assessment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id, assessmentId: assessment.id, attemptNumber: 4, score: 80,
          assessedAt: 'invalid-date', source: 'ASSESSOR'
        });
      expect(res.status).toBe(400);
    });

    it('invalid attemptNumber rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/assessment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id, assessmentId: assessment.id, attemptNumber: -1, score: 80,
          assessedAt: new Date().toISOString(), source: 'ASSESSOR'
        });
      expect(res.status).toBe(400);
    });

    it('malformed source rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/assessment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id, assessmentId: assessment.id, attemptNumber: 4, score: 80,
          assessedAt: new Date().toISOString(), source: 'INVALID_SOURCE'
        });
      expect(res.status).toBe(400);
    });

    it('skill evidence mismatch rejected (skill not in course)', async () => {
      const res = await request(app)
        .post('/api/ingest/assessment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id, assessmentId: assessment.id, attemptNumber: 5, score: 80,
          assessedAt: new Date().toISOString(), source: 'ASSESSOR',
          skillResults: [{ skillId: skill2.id, proficiencyLevel: 'PROFICIENT', score: 80, result: 'PASS' }]
        });
      expect(res.status).toBe(400);
    });

    it('skill result semantics: strictly accepts assessor PASS/FAIL as evidence', async () => {
      const res = await request(app)
        .post('/api/ingest/assessment')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id,
          assessmentId: assessment.id,
          attemptNumber: 10,
          score: 80,
          assessedAt: new Date().toISOString(),
          source: 'ASSESSOR',
          skillResults: [
            { skillId: skill1.id, proficiencyLevel: 'INTERMEDIATE', score: 90, result: 'FAIL' }
          ]
        });
      expect(res.status).toBe(200);
      expect(res.body.attempt.result).toBe('PASS');
      
      const skillRes = await prisma.assessmentSkillResult.findFirst({
        where: { assessmentAttemptId: res.body.attempt.id, skillId: skill1.id }
      });
      expect(skillRes.result).toBe('FAIL');
    });
  });

  describe('Certification', () => {
    let certification;

    it('valid certification', async () => {
      const res = await request(app)
        .post('/api/ingest/certification')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id,
          certificateReference: 'CERT-123',
          certificateType: 'DIPLOMA',
          issuingAuthority: 'NSDC',
          issuedAt: new Date().toISOString(),
          source: 'CERTIFYING_AUTHORITY',
          skills: [
            { skillId: skill1.id, evidenceLevel: 'CERTIFIED_EXPERT' }
          ]
        });
      expect(res.status).toBe(200);
      certification = res.body.certification;
      expect(certification.certificateReference).toBe('CERT-123');
    });

    it('duplicate certificate reference performs an upsert', async () => {
      const res = await request(app)
        .post('/api/ingest/certification')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id,
          certificateReference: 'CERT-123',
          certificateType: 'DIPLOMA',
          issuingAuthority: 'NSDC',
          issuedAt: new Date().toISOString(),
          source: 'CERTIFYING_AUTHORITY'
        });
      expect(res.status).toBe(200);
    });

    it('invalid enrollment rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/certification')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: 'invalid-id',
          certificateReference: 'CERT-999',
          certificateType: 'DIPLOMA',
          issuingAuthority: 'NSDC',
          issuedAt: new Date().toISOString(),
          source: 'CERTIFYING_AUTHORITY'
        });
      expect(res.status).toBe(404);
    });

    it('invalid dates rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/certification')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id, certificateReference: 'CERT-BAD-DATES', certificateType: 'DIPLOMA', issuingAuthority: 'NSDC',
          issuedAt: new Date().toISOString(), validFrom: '2026-10-01', validUntil: '2026-08-01', source: 'CERTIFYING_AUTHORITY'
        });
      expect(res.status).toBe(400);
    });

    it('invalid chronology (validFrom < issuedAt) rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/certification')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id, certificateReference: 'CERT-CHRONO', certificateType: 'DIPLOMA', issuingAuthority: 'NSDC',
          issuedAt: '2026-09-20T00:00:00Z', validFrom: '2026-09-19T00:00:00Z', source: 'CERTIFYING_AUTHORITY'
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('validFrom cannot be before issuedAt');
    });

    it('duplicate certification skill rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/certification')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id, certificateReference: 'CERT-DUP-SKILL', certificateType: 'DIPLOMA', issuingAuthority: 'NSDC',
          issuedAt: new Date().toISOString(), source: 'CERTIFYING_AUTHORITY',
          skills: [ { skillId: skill1.id }, { skillId: skill1.id } ]
        });
      expect(res.status).toBe(400);
    });

    it('missing certification skill rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/certification')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id, certificateReference: 'CERT-MISSING-SKILL', certificateType: 'DIPLOMA', issuingAuthority: 'NSDC',
          issuedAt: new Date().toISOString(), source: 'CERTIFYING_AUTHORITY',
          skills: [ { skillId: 'invalid-id-here' } ]
        });
      expect(res.status).toBe(404);
    });

    it('invalid source rejected', async () => {
      const res = await request(app)
        .post('/api/ingest/certification')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id, certificateReference: 'CERT-INV-SRC', certificateType: 'DIPLOMA', issuingAuthority: 'NSDC',
          issuedAt: new Date().toISOString(), source: 'INVALID',
        });
      expect(res.status).toBe(400);
    });

    it('REVOKED creates revoked certified attainment', async () => {
      const res = await request(app)
        .post('/api/ingest/certification')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id, certificateReference: 'CERT-REVOKED', certificateType: 'DIPLOMA', issuingAuthority: 'NSDC',
          issuedAt: new Date().toISOString(), source: 'CERTIFYING_AUTHORITY', status: 'REVOKED',
          skills: [ { skillId: skill2.id } ]
        });
      expect(res.status).toBe(200);

      const attainments = await prisma.traineeSkillAttainment.findMany({ where: { traineeId: testEnrollment.traineeId, skillId: skill2.id, evidenceType: 'CERTIFICATION' }});
      expect(attainments.length).toBe(1);
      expect(attainments[0].status).toBe('REVOKED');
    });
    
    it('EXPIRED behavior creates expired attainment', async () => {
      const res = await request(app)
        .post('/api/ingest/certification')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id, certificateReference: 'CERT-EXPIRED', certificateType: 'DIPLOMA', issuingAuthority: 'NSDC',
          issuedAt: '2020-01-01T00:00:00Z', validUntil: '2021-01-01T00:00:00Z', source: 'CERTIFYING_AUTHORITY', status: 'EXPIRED',
          skills: [ { skillId: skill2.id } ]
        });
      expect(res.status).toBe(200);

      const attainments = await prisma.traineeSkillAttainment.findMany({ where: { traineeId: testEnrollment.traineeId, skillId: skill2.id, evidenceReference: res.body.certification.referenceCode, evidenceType: 'CERTIFICATION' }});
      expect(attainments.length).toBe(1);
      expect(attainments[0].status).toBe('EXPIRED');
    });

    it('LIFECYCLE: ISSUED -> REVOKED -> EXPIRED -> ISSUED', async () => {
      // 1. REVOKE CERT-123
      let res = await request(app)
        .post('/api/ingest/certification')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id, certificateReference: 'CERT-123', certificateType: 'DIPLOMA', issuingAuthority: 'NSDC',
          issuedAt: new Date().toISOString(), source: 'CERTIFYING_AUTHORITY', status: 'REVOKED'
        });
      expect(res.status).toBe(200);
      let refCode = res.body.certification.referenceCode;

      let attainments = await prisma.traineeSkillAttainment.findMany({ where: { evidenceReference: refCode }});
      expect(attainments[0].status).toBe('REVOKED');

      // 2. EXPIRE CERT-123
      res = await request(app)
        .post('/api/ingest/certification')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id, certificateReference: 'CERT-123', certificateType: 'DIPLOMA', issuingAuthority: 'NSDC',
          issuedAt: new Date().toISOString(), source: 'CERTIFYING_AUTHORITY', status: 'EXPIRED'
        });
      expect(res.status).toBe(200);

      attainments = await prisma.traineeSkillAttainment.findMany({ where: { evidenceReference: refCode }});
      expect(attainments[0].status).toBe('EXPIRED');

      // 3. REACTIVATE CERT-123
      res = await request(app)
        .post('/api/ingest/certification')
        .set('x-api-key', process.env.PARTNER_API_KEY || 'test-partner-key')
        .send({
          enrollmentId: testEnrollment.id, certificateReference: 'CERT-123', certificateType: 'DIPLOMA', issuingAuthority: 'NSDC',
          issuedAt: new Date().toISOString(), source: 'CERTIFYING_AUTHORITY', status: 'ISSUED'
        });
      expect(res.status).toBe(200);

      attainments = await prisma.traineeSkillAttainment.findMany({ where: { evidenceReference: refCode }});
      expect(attainments[0].status).toBe('CERTIFIED');
    });
  });

  describe('Trainee Self-Service', () => {
    it('trainee sees own assessments without internal UUIDs', async () => {
      const res = await request(app)
        .get('/api/trainee/me/assessments')
        .set('Authorization', `Bearer ${traineeToken}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(3);
      expect(res.body[0].id).toBeUndefined();
      expect(res.body[0].referenceCode).toBeDefined();
    });

    it('trainee sees own certifications without internal UUIDs', async () => {
      const res = await request(app)
        .get('/api/trainee/me/certifications')
        .set('Authorization', `Bearer ${traineeToken}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(3);
      const validCert = res.body.find(c => c.certificateReference === 'CERT-123');
      expect(validCert).toBeDefined();
      expect(validCert.id).toBeUndefined();
      expect(validCert.skills[0]).toBe('CNC Programming');
    });

    it('trainee sees own skills with proper provenance', async () => {
      const res = await request(app)
        .get('/api/trainee/me/skills')
        .set('Authorization', `Bearer ${traineeToken}`);
      expect(res.status).toBe(200);
      // Expected four attainments
      expect(res.body.length).toBe(4);
      expect(res.body[0].id).toBeUndefined();
      const sources = res.body.map(a => a.evidenceType);
      expect(sources).toContain('ASSESSMENT');
      expect(sources).toContain('CERTIFICATION');
    });

    it('trainee cannot see another trainees records', async () => {
      const res = await request(app)
        .get('/api/trainee/me/assessments')
        .set('Authorization', `Bearer ${anotherTraineeToken}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(0);
    });
    
    it('trainee cannot directly create verified skills (route does not exist)', async () => {
      const res = await request(app)
        .post('/api/trainee/me/skills')
        .set('Authorization', `Bearer ${traineeToken}`)
        .send({ skill: 'SK-CNC' });
      expect(res.status).toBe(404);
    });
  });

  describe('Data Integrity (No Cascade)', () => {
    it('enrollment deletion is restricted where evidence exists', async () => {
      await expect(prisma.enrollment.delete({ where: { id: testEnrollment.id } }))
        .rejects
        .toThrow();
    });
  });
});
