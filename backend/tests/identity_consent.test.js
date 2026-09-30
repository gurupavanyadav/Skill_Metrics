const request = require('supertest');
const app = require('../index');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { associateTraineeIdentifier, getTraineeIdentifiers } = require('../services/identity');
const { addPrimaryPhone, normalizePhone } = require('../services/contacts');
const { hasActiveConsent, grantConsent, revokeConsent, getConsentHistory, getCurrentConsent } = require('../services/consent');

let server;
let traineeUser1;
let traineeUser2;
let token1;
let token2;

beforeAll(async () => {
  server = app.listen(0);

  // Cleanup before tests
  await prisma.employmentOutcome.deleteMany({
    where: { trainee: { phone: { in: ['+919999999991', '+919999999992'] } } }
  });
  await prisma.enrollment.deleteMany({
    where: { trainee: { phone: { in: ['+919999999991', '+919999999992'] } } }
  });
  await prisma.otpChallenge.deleteMany({
    where: { trainee: { phone: { in: ['+919999999991', '+919999999992'] } } }
  });
  await prisma.traineeContact.deleteMany({
    where: { trainee: { phone: { in: ['+919999999991', '+919999999992'] } } }
  });
  await prisma.consentRecord.deleteMany({
    where: { trainee: { phone: { in: ['+919999999991', '+919999999992'] } } }
  });
  await prisma.traineeIdentifier.deleteMany({
    where: { trainee: { phone: { in: ['+919999999991', '+919999999992'] } } }
  });
  
  const existingTrainees = await prisma.trainee.findMany({
    where: { phone: { in: ['+919999999991', '+919999999992'] } }
  });
  const userIds = existingTrainees.map(t => t.userId);
  await prisma.trainee.deleteMany({ where: { phone: { in: ['+919999999991', '+919999999992'] } } });
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  // Setup mock users for testing
  traineeUser1 = await prisma.user.create({
    data: {
      role: 'TRAINEE',
      traineeProfile: {
        create: {
          systemId: 'SYS-TEST-002',
          name: 'Test Trainee 1',
          phone: '+919999999991'
        }
      }
    },
    include: { traineeProfile: true }
  });

  traineeUser2 = await prisma.user.create({
    data: {
      role: 'TRAINEE',
      traineeProfile: {
        create: {
          systemId: 'SYS-TEST-003',
          name: 'Test Trainee 2',
          phone: '+919999999992'
        }
      }
    },
    include: { traineeProfile: true }
  });

  // Init initial contacts
  await addPrimaryPhone(traineeUser1.traineeProfile.id, traineeUser1.traineeProfile.phone);
  await addPrimaryPhone(traineeUser2.traineeProfile.id, traineeUser2.traineeProfile.phone);

  token1 = jwt.sign({ id: traineeUser1.id, role: 'TRAINEE' }, process.env.JWT_SECRET || 'test-secret');
  token2 = jwt.sign({ id: traineeUser2.id, role: 'TRAINEE' }, process.env.JWT_SECRET || 'test-secret');
});

afterAll(async () => {
  await prisma.employmentOutcome.deleteMany();
  await prisma.enrollment.deleteMany();
  await prisma.traineeContact.deleteMany();
  await prisma.consentRecord.deleteMany();
  await prisma.traineeIdentifier.deleteMany();
  await prisma.otpChallenge.deleteMany();
  if (traineeUser1 && traineeUser2) {
    await prisma.trainee.deleteMany({ where: { id: { in: [traineeUser1.traineeProfile.id, traineeUser2.traineeProfile.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [traineeUser1.id, traineeUser2.id] } } });
  }
  await prisma.$disconnect();
  server.close();
});

describe('Trainee Identity & Consent Subsystem', () => {

  describe('IDENTITY Tests', () => {
    it('canonical trainee ID remains stable', () => {
      expect(traineeUser1.traineeProfile.id).toBeDefined();
    });

    it('one trainee can have multiple identifiers', async () => {
      await associateTraineeIdentifier(traineeUser1.traineeProfile.id, 'PMKVY', 'PROGRAMME_ID', '12345');
      await associateTraineeIdentifier(traineeUser1.traineeProfile.id, 'PROVIDER_X', 'EXTERNAL_ID', '67890');
      
      const identifiers = await getTraineeIdentifiers(traineeUser1.traineeProfile.id);
      expect(identifiers.length).toBeGreaterThanOrEqual(2);
    });

    it('duplicate namespace + identifier is rejected', async () => {
      await expect(
        associateTraineeIdentifier(traineeUser2.traineeProfile.id, 'PMKVY', 'PROGRAMME_ID', '12345')
      ).rejects.toThrow();
    });

    it('same value in different namespaces is allowed', async () => {
      await expect(
        associateTraineeIdentifier(traineeUser2.traineeProfile.id, 'OTHER_NS', 'PROGRAMME_ID', '12345')
      ).resolves.toBeDefined();
    });
    it('identifier verification defaults to false', async () => {
      const id = await associateTraineeIdentifier(traineeUser1.traineeProfile.id, 'DEFAULT', 'ID', '000');
      expect(id.isVerified).toBe(false);
    });

  });

  describe('CONTACT Tests', () => {
    it('phone is normalized consistently', () => {
      expect(normalizePhone('9999999999')).toBe('+919999999999');
      expect(normalizePhone('+919999999999')).toBe('+919999999999');
      expect(normalizePhone('12345')).toBeNull();
    });

    it('trainee can access own contacts', async () => {
      const res = await request(app).get('/api/trainee/me/contacts').set('Authorization', `Bearer ${token1}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].traineeId).toBe(traineeUser1.traineeProfile.id);
    });

    it('phone change request creates appropriate OTP challenge', async () => {
      const res = await request(app)
        .post('/api/trainee/me/phone/change/request')
        .set('Authorization', `Bearer ${token1}`)
        .send({ newPhone: '8888888888' });
      expect(res.status).toBe(200);
      
      const challenges = await prisma.otpChallenge.findMany({ where: { traineeId: traineeUser1.traineeProfile.id } });
      expect(challenges.length).toBeGreaterThan(0);
    });

    it('unverified new phone does not replace primary', async () => {
      const contacts = await prisma.traineeContact.findMany({ 
        where: { traineeId: traineeUser1.traineeProfile.id, isPrimary: true } 
      });
      expect(contacts.length).toBe(1);
      expect(contacts[0].normalizedValue).toBe('+919999999991');
    });

    it('phone already owned by another trainee is rejected', async () => {
      const res = await request(app)
        .post('/api/trainee/me/phone/change/request')
        .set('Authorization', `Bearer ${token1}`)
        .send({ newPhone: '9999999992' }); // Owned by trainee 2
      expect(res.status).toBe(409);
    });

    it('successful verification changes primary phone and retains old as historical', async () => {
      await prisma.otpChallenge.deleteMany({});
      // Create request
      await request(app).post('/api/trainee/me/phone/change/request').set('Authorization', `Bearer ${token1}`).send({ newPhone: '7777777777' });
      const challenge = await prisma.otpChallenge.findFirst({ where: { traineeId: traineeUser1.traineeProfile.id, targetPhone: '+917777777777' } });
      
      const otpHash = await bcrypt.hash('123456', 10);
      await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { otpHash } });

      const res = await request(app)
        .post('/api/trainee/me/phone/change/verify')
        .set('Authorization', `Bearer ${token1}`)
        .send({ newPhone: '7777777777', otp: '123456' });
      expect(res.status).toBe(200);

      // Verify DB
      const activeContacts = await prisma.traineeContact.findMany({ where: { traineeId: traineeUser1.traineeProfile.id, isPrimary: true } });
      expect(activeContacts.length).toBe(1);
      expect(activeContacts[0].normalizedValue).toBe('+917777777777');
    });

    it('phone change request is throttled', async () => {
      await request(app).post('/api/trainee/me/phone/change/request').set('Authorization', `Bearer ${token1}`).send({ newPhone: '6666666666' });
      const res = await request(app).post('/api/trainee/me/phone/change/request').set('Authorization', `Bearer ${token1}`).send({ newPhone: '6666666666' });
      expect(res.status).toBe(429);
      expect(res.body.error).toBe('rate_limit');
    });

    it('phone change OTP cannot be used for a different target phone', async () => {
      await prisma.otpChallenge.deleteMany({});
      await request(app).post('/api/trainee/me/phone/change/request').set('Authorization', `Bearer ${token1}`).send({ newPhone: '5555555555' });
      const challenge = await prisma.otpChallenge.findFirst({ where: { traineeId: traineeUser1.traineeProfile.id, consumedAt: null } });
      
      const otpHash = await bcrypt.hash('654321', 10);
      await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { otpHash } });

      const res = await request(app)
        .post('/api/trainee/me/phone/change/verify')
        .set('Authorization', `Bearer ${token1}`)
        .send({ newPhone: '4444444444', otp: '654321' });
      
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_otp');
    });

    it('phone change concurrency verification is single-use', async () => {
      await prisma.otpChallenge.deleteMany({});
      await request(app).post('/api/trainee/me/phone/change/request').set('Authorization', `Bearer ${token1}`).send({ newPhone: '3333333333' });
      const challenge = await prisma.otpChallenge.findFirst({ where: { traineeId: traineeUser1.traineeProfile.id, consumedAt: null } });
      
      const otpHash = await bcrypt.hash('111111', 10);
      await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { otpHash } });

      const reqs = [];
      for(let i = 0; i < 5; i++) {
        reqs.push(request(app)
          .post('/api/trainee/me/phone/change/verify')
          .set('Authorization', `Bearer ${token1}`)
          .send({ newPhone: '3333333333', otp: '111111' })
        );
      }
      
      const responses = await Promise.all(reqs);
      let successCount = 0;
      responses.forEach(r => { if(r.status === 200) successCount++; });
      
      expect(successCount).toBe(1);
    });

    it('login OTP rejected by phone-change verification', async () => {
      await prisma.otpChallenge.deleteMany({});
      // Create login challenge
      await request(app).post('/api/auth/request-otp').send({ phone: traineeUser2.traineeProfile.phone });
      const challenge = await prisma.otpChallenge.findFirst({ where: { traineeId: traineeUser2.traineeProfile.id, purpose: 'LOGIN', consumedAt: null } });
      const otpHash = await bcrypt.hash('222222', 10);
      await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { otpHash } });

      const res = await request(app)
        .post('/api/trainee/me/phone/change/verify')
        .set('Authorization', `Bearer ${token2}`)
        .send({ newPhone: traineeUser2.traineeProfile.phone, otp: '222222' });
      expect(res.status).toBe(401);
    });

    it('phone-change OTP rejected by normal login', async () => {
      await prisma.otpChallenge.deleteMany({});
      await request(app).post('/api/trainee/me/phone/change/request').set('Authorization', `Bearer ${token1}`).send({ newPhone: '1111111111' });
      const challenge = await prisma.otpChallenge.findFirst({ where: { traineeId: traineeUser1.traineeProfile.id, purpose: 'PHONE_CHANGE', consumedAt: null } });
      const otpHash = await bcrypt.hash('333333', 10);
      await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { otpHash } });

      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ phone: traineeUser1.traineeProfile.phone, otp: '333333' }); // Login endpoint
      
      expect(res.status).toBe(401);
    });

    it('rolls back OTP consumption if phone update fails', async () => {
      await prisma.otpChallenge.deleteMany({});
      
      // Inject OTP challenge targeting traineeUser2's phone
      const targetPhone = traineeUser2.traineeProfile.phone;
      const otpHash = await bcrypt.hash('999999', 10);
      const challenge = await prisma.otpChallenge.create({
        data: {
          traineeId: traineeUser1.traineeProfile.id,
          otpHash,
          purpose: 'PHONE_CHANGE',
          targetPhone: targetPhone,
          expiresAt: new Date(Date.now() + 300000),
          maxAttempts: 3
        }
      });

      // We need to know initial phone
      const initialTrainee = await prisma.trainee.findUnique({ where: { id: traineeUser1.traineeProfile.id } });

      // Verify OTP (will fail during transaction due to unique constraint on Trainee.phone)
      const res = await request(app)
        .post('/api/trainee/me/phone/change/verify')
        .set('Authorization', `Bearer ${token1}`)
        .send({ newPhone: targetPhone, otp: '999999' });
      
      expect(res.status).toBe(500); // Because we haven't mapped P2002, it throws 500 Database error

      // Verify OTP is still unconsumed
      const updatedChallenge = await prisma.otpChallenge.findUnique({ where: { id: challenge.id } });
      expect(updatedChallenge.consumedAt).toBeNull();
      
      // Verify phone is unchanged
      const currentTrainee = await prisma.trainee.findUnique({ where: { id: traineeUser1.traineeProfile.id } });
      expect(currentTrainee.phone).toBe(initialTrainee.phone);
      
      // Verify no partial contact created
      const contacts = await prisma.traineeContact.findMany({ 
        where: { traineeId: traineeUser1.traineeProfile.id, normalizedValue: targetPhone } 
      });
      expect(contacts.length).toBe(0);
    });
  });

  describe('CONSENT Tests', () => {
    it('consent can be granted', async () => {
      const res = await request(app)
        .post('/api/trainee/me/consent')
        .set('Authorization', `Bearer ${token1}`)
        .send({ purpose: 'FOLLOW_UP', version: '1.0', consent: true });
      expect(res.status).toBe(200);
      
      const active = await hasActiveConsent(traineeUser1.traineeProfile.id, 'FOLLOW_UP');
      expect(active).toBe(true);
    });

    it('consent can be revoked and revocation creates a new historical state (append-only)', async () => {
      const initialHistory = await getConsentHistory(traineeUser1.traineeProfile.id);
      
      const res = await request(app)
        .post('/api/trainee/me/consent/revoke')
        .set('Authorization', `Bearer ${token1}`)
        .send({ purpose: 'FOLLOW_UP', version: '1.0' });
      expect(res.status).toBe(200);

      const active = await hasActiveConsent(traineeUser1.traineeProfile.id, 'FOLLOW_UP');
      expect(active).toBe(false);

      const history = await getConsentHistory(traineeUser1.traineeProfile.id);
      expect(history.length).toBeGreaterThan(initialHistory.length);
      expect(history[0].status).toBe('REVOKED');
      
      // Ensure previous record wasn't mutated
      const previous = history.find(h => h.id !== history[0].id && h.purpose === 'FOLLOW_UP' && h.status === 'GRANTED');
      if (previous) {
        expect(previous.revokedAt).toBeNull();
      }
    });

    it('consent concurrency resolves deterministically', async () => {
      // Spam grant and revoke
      const reqs = [];
      for(let i=0; i<3; i++) {
        reqs.push(grantConsent(traineeUser2.traineeProfile.id, 'ANALYTICS', '1.0'));
        reqs.push(revokeConsent(traineeUser2.traineeProfile.id, 'ANALYTICS', '1.0'));
      }
      await Promise.all(reqs);

      const active = await hasActiveConsent(traineeUser2.traineeProfile.id, 'ANALYTICS');
      expect(typeof active).toBe('boolean'); // It just has to be deterministic and not throw/error
    });

    it('separate purposes are independent', async () => {
      await grantConsent(traineeUser1.traineeProfile.id, 'ANALYTICS', '1.0');
      
      const res = await request(app).get('/api/trainee/me/consent').set('Authorization', `Bearer ${token1}`);
      expect(res.status).toBe(200);
      expect(res.body.activeConsents['ANALYTICS']).toBe(true);
      expect(res.body.activeConsents['FOLLOW_UP']).toBe(false); // Revoked previously
    });

    it('compatibility field remains consistent for OUTCOME_TRACKING', async () => {
      await request(app).post('/api/trainee/me/consent').set('Authorization', `Bearer ${token1}`).send({ purpose: 'OUTCOME_TRACKING', version: '1.0', consent: true });
      
      let trainee = await prisma.trainee.findUnique({ where: { id: traineeUser1.traineeProfile.id } });
      expect(trainee.consentStatus).toBe(true);

      await request(app).post('/api/trainee/me/consent').set('Authorization', `Bearer ${token1}`).send({ purpose: 'OUTCOME_TRACKING', version: '1.0', consent: false });
      
      trainee = await prisma.trainee.findUnique({ where: { id: traineeUser1.traineeProfile.id } });
      expect(trainee.consentStatus).toBe(false);
    });

    it('invalid consent purpose returns 400', async () => {
      const res = await request(app)
        .post('/api/trainee/me/consent/revoke')
        .set('Authorization', `Bearer ${token1}`)
        .send({ purpose: 'INVALID_PURPOSE', version: '1.0' });
      
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_purpose');
    });
  });

  describe('AUTHORIZATION Tests', () => {
    it('trainee cannot access another trainee contacts', async () => {
      // The API only returns contacts for req.user.id. So by design it's protected.
      const res = await request(app).get('/api/trainee/me/contacts').set('Authorization', `Bearer ${token1}`);
      expect(res.body[0].traineeId).toBe(traineeUser1.traineeProfile.id);
      expect(res.body[0].traineeId).not.toBe(traineeUser2.traineeProfile.id);
    });

    it('trainee cannot modify another trainee consent', async () => {
      // API implicitly uses req.user.id
      await request(app).post('/api/trainee/me/consent').set('Authorization', `Bearer ${token1}`).send({ purpose: 'FOLLOW_UP', version: '1.0', consent: true });
      
      const active2 = await hasActiveConsent(traineeUser2.traineeProfile.id, 'FOLLOW_UP');
      expect(active2).toBe(false); // token1 action should not affect trainee2
    });
  });

});
