const request = require('supertest');
const app = require('../index');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

let server;
let traineeUser;
let otherUser;

beforeAll(async () => {
  server = app.listen(0);

  // Cleanup potential leftover from failed runs
  await prisma.enrollment.deleteMany({
    where: { trainee: { phone: '+919999999999' } }
  });
  await prisma.otpChallenge.deleteMany({
    where: { trainee: { phone: '+919999999999' } }
  });
  await prisma.trainee.deleteMany({ where: { phone: '+919999999999' } });
  await prisma.operator.deleteMany({ where: { email: 'op@test.com' } });

  // Setup mock user for testing
  traineeUser = await prisma.user.create({
    data: {
      role: 'TRAINEE',
      traineeProfile: {
        create: {
          systemId: 'SYS-TEST-001',
          name: 'Test Trainee',
          phone: '+919999999999'
        }
      }
    },
    include: { traineeProfile: true }
  });

  otherUser = await prisma.user.create({
    data: {
      role: 'OPERATOR',
      operatorProfile: {
        create: {
          email: 'op@test.com',
          passwordHash: 'dummy'
        }
      }
    }
  });
});

afterAll(async () => {
  if (traineeUser && traineeUser.traineeProfile) {
    await prisma.otpChallenge.deleteMany({ where: { traineeId: traineeUser.traineeProfile.id } });
    await prisma.user.delete({ where: { id: traineeUser.id } });
  }
  if (otherUser) {
    await prisma.user.delete({ where: { id: otherUser.id } });
  }
  await prisma.$disconnect();
  server.close();
});

beforeEach(async () => {
  // Clear OTP challenges before each test
  await prisma.otpChallenge.deleteMany({});
});

describe('Authentication API', () => {

  describe('POST /api/auth/request-otp', () => {
    it('should request OTP successfully for valid phone', async () => {
      const res = await request(app)
        .post('/api/auth/request-otp')
        .send({ phone: '+919999999999' });
      
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/OTP has been sent/);

      const challenge = await prisma.otpChallenge.findFirst({
        where: { traineeId: traineeUser.traineeProfile.id }
      });
      expect(challenge).not.toBeNull();
    });

    it('should return 404 or generic for unknown phone', async () => {
      const res = await request(app)
        .post('/api/auth/request-otp')
        .send({ phone: '0000000000' });
      
      // In development env, it returns 404. 
      expect(res.status).toBe(404);
    });

    it('should reject malformed phone: too short', async () => {
      const res = await request(app).post('/api/auth/request-otp').send({ phone: '9999' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_phone');
    });

    it('should reject malformed phone: too long', async () => {
      const res = await request(app).post('/api/auth/request-otp').send({ phone: '9199999999999' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_phone');
    });

    it('should reject malformed phone: non-numeric garbage', async () => {
      const res = await request(app).post('/api/auth/request-otp').send({ phone: 'phone-number' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_phone');
    });

    it('should reject malformed phone: malformed country code', async () => {
      const res = await request(app).post('/api/auth/request-otp').send({ phone: '+19999999999' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_phone');
    });

    it('should accept valid 10-digit Indian number', async () => {
      // Clear challenges to avoid rate limit
      await prisma.otpChallenge.deleteMany({});
      const res = await request(app).post('/api/auth/request-otp').send({ phone: '9999999999' });
      expect(res.status).toBe(200);
    });

    it('should accept valid +91 number', async () => {
      await prisma.otpChallenge.deleteMany({});
      const res = await request(app).post('/api/auth/request-otp').send({ phone: '+919999999999' });
      expect(res.status).toBe(200);
    });

    it('should enforce resend throttling', async () => {
      await request(app)
        .post('/api/auth/request-otp')
        .send({ phone: '9999999999' }); // test normalization too

      const res = await request(app)
        .post('/api/auth/request-otp')
        .send({ phone: '9999999999' });
      
      expect(res.status).toBe(429);
      expect(res.body.error).toBe('rate_limit');
    });
    
    it('should invalidate old OTP after requesting new one (simulating wait bypass)', async () => {
      // First request
      await prisma.otpChallenge.create({
        data: {
          traineeId: traineeUser.traineeProfile.id,
          otpHash: 'dummy',
          purpose: 'LOGIN',
          targetPhone: '+919999999999',
          expiresAt: new Date(Date.now() + 100000),
          createdAt: new Date(Date.now() - 100000), // bypass throttle
          maxAttempts: 3
        }
      });
      
      const res = await request(app)
        .post('/api/auth/request-otp')
        .send({ phone: '9999999999' });
      
      expect(res.status).toBe(200);

      const challenges = await prisma.otpChallenge.findMany({
        where: { traineeId: traineeUser.traineeProfile.id }
      });
      
      expect(challenges.length).toBe(2);
      const consumed = challenges.find(c => c.otpHash === 'dummy');
      expect(consumed.consumedAt).not.toBeNull();
    });
  });

  describe('POST /api/auth/verify-otp', () => {
    let validOtp = '123456';
    let otpHash;

    beforeEach(async () => {
      otpHash = await bcrypt.hash(validOtp, 10);
      await prisma.otpChallenge.create({
        data: {
          traineeId: traineeUser.traineeProfile.id,
          otpHash: otpHash,
          purpose: 'LOGIN',
          targetPhone: '+919999999999',
          expiresAt: new Date(Date.now() + 300000),
          maxAttempts: 3
        }
      });
    });

    it('should fail with incorrect OTP', async () => {
      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ phone: '9999999999', otp: '654321' });
      
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_otp');
    });

    it('should fail after max attempts', async () => {
      // 3 failed attempts
      await request(app).post('/api/auth/verify-otp').send({ phone: '9999999999', otp: '000' });
      await request(app).post('/api/auth/verify-otp').send({ phone: '9999999999', otp: '000' });
      await request(app).post('/api/auth/verify-otp').send({ phone: '9999999999', otp: '000' });

      // 4th attempt (even if correct)
      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ phone: '9999999999', otp: validOtp });
      
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('attempts_exhausted');
    });

    it('should fail if OTP is expired', async () => {
      await prisma.otpChallenge.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) }
      });

      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ phone: '9999999999', otp: validOtp });
      
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_otp');
    });

    it('should verify OTP successfully', async () => {
      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ phone: '9999999999', otp: validOtp });
      
      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
    });

    it('should prevent OTP replay (single-use)', async () => {
      // First use
      await request(app).post('/api/auth/verify-otp').send({ phone: '9999999999', otp: validOtp });
      
      // Second use
      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ phone: '9999999999', otp: validOtp });
      
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_otp');
    });

    it('should prevent concurrent OTP verification race conditions', async () => {
      const wrongOtp = '999999';
      const requests = [];
      for (let i = 0; i < 10; i++) {
        requests.push(request(app).post('/api/auth/verify-otp').send({ phone: '9999999999', otp: wrongOtp }));
      }
      const responses = await Promise.all(requests);
      
      let invalidCount = 0;
      let exhaustedCount = 0;
      responses.forEach(r => {
        if (r.body.error === 'invalid_otp') invalidCount++;
        if (r.body.error === 'attempts_exhausted') exhaustedCount++;
      });
      
      expect(invalidCount).toBe(3); // Exactly 3 attempts should be processed
      expect(exhaustedCount).toBe(7); // The remaining 7 should be rejected atomically
      
      const finalChallenge = await prisma.otpChallenge.findFirst({
         where: { traineeId: traineeUser.traineeProfile.id }
      });
      expect(finalChallenge.attempts).toBe(3);
    });
  });

  describe('Protected Routes', () => {
    it('should allow access with valid token', async () => {
      const token = jwt.sign(
        { id: traineeUser.id, role: 'TRAINEE' },
        process.env.JWT_SECRET || 'test-secret'
      );

      const res = await request(app)
        .get('/api/trainee/me')
        .set('Authorization', `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.phone).toBe('+919999999999');
    });

    it('should deny access without token', async () => {
      const res = await request(app).get('/api/trainee/me');
      expect(res.status).toBe(401);
    });

    it('should deny access with invalid token', async () => {
      const res = await request(app)
        .get('/api/trainee/me')
        .set('Authorization', 'Bearer invalid-token');
      expect(res.status).toBe(403);
    });

    it('should deny access to trainee route for non-trainee role', async () => {
      const token = jwt.sign(
        { id: otherUser.id, role: 'OPERATOR' },
        process.env.JWT_SECRET || 'test-secret'
      );

      const res = await request(app)
        .get('/api/trainee/me')
        .set('Authorization', `Bearer ${token}`);
      
      expect(res.status).toBe(403);
    });

    it('should fail if JWT secret is incorrect (simulating missing/wrong secret)', async () => {
      const wrongToken = jwt.sign({ id: traineeUser.id, role: 'TRAINEE' }, 'wrong-secret');
      const res = await request(app).get('/api/trainee/me').set('Authorization', `Bearer ${wrongToken}`);
      expect(res.status).toBe(403);
    });
  });
});
