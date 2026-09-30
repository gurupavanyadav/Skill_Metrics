require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const app = express();
const port = process.env.PORT || 5000;

// --- Configuration ---
const JWT_SECRET = process.env.JWT_SECRET;
const OTP_EXPIRY_SECONDS = parseInt(process.env.OTP_EXPIRY_SECONDS || '300', 10);
const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS || '3', 10);
const OTP_RESEND_COOLDOWN_SECONDS = parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || '60', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';

const VALID_JWT_SECRET = JWT_SECRET || (NODE_ENV === 'test' ? 'test-secret' : null);

if (!VALID_JWT_SECRET) {
  console.error("FATAL ERROR: JWT_SECRET environment variable is missing.");
  process.exit(1);
}

// --- Phone Normalization ---
const normalizePhone = (phone) => {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  
  if (digits.length === 10) return '+91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits;
  
  return null;
};

// Never use a wildcard CORS policy for an API that returns trainee data.
// Requests without an Origin header (CLI, tests, server-to-server) remain allowed.
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('CORS origin not allowed'));
  }
}));
app.use(express.json({ limit: '100kb' }));

// --- Authentication Middleware ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (token == null) return res.sendStatus(401);

  jwt.verify(token, VALID_JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user; // { id, role }
    next();
  });
};

const requireRole = (role) => {
  return (req, res, next) => {
    if (req.user && req.user.role === role) {
      next();
    } else {
      res.status(403).json({ error: "Access denied. Insufficient role permissions." });
    }
  };
};

// --- Data Masking Utility ---
const maskPII = (trainee) => {
  // If consent is true, return the full profile
  if (trainee.consentStatus === true) return trainee;
  
  // If consent is false, scrub Personally Identifiable Information (PII)
  return {
    ...trainee,
    name: "ANONYMIZED (Consent Revoked)",
    phone: "XXX-XXX-XXXX",
    // We keep systemId intact so analytics can track unique cohorts 
    // without knowing WHO the person actually is.
  };
};

// --- API Routes ---

// 1. Analytics (Kaushal Lens) - Requires ADMIN role in production
app.get('/api/analytics', authenticateToken, requireRole('ADMIN'), async (req, res) => {
  // TODO: Implement complex queries using Prisma
  res.json({ message: "Analytics endpoint ready" });
});

// 2. Trainee Portal Routes (Role: TRAINEE)
const traineeRouter = require('./routes/trainee');
app.use('/api/trainee/me', authenticateToken, requireRole('TRAINEE'), traineeRouter);

app.get('/api/trainee/me', authenticateToken, requireRole('TRAINEE'), async (req, res) => {
  try {
    const traineeProfile = await prisma.trainee.findUnique({
      where: { userId: req.user.id },
      include: {
        enrollments: { include: { course: true } },
        outcomes: { include: { employer: true, wageSnapshots: true } }
      }
    });
    if (!traineeProfile) return res.status(404).json({ error: "Trainee not found" });
    // Trainees can always see their own PII, so we don't mask it here.
    res.json(traineeProfile);
  } catch (error) {
    console.error("GET /api/trainee/me error:", error);
    res.status(500).json({ error: "Database error" });
  }
});

// 3. Operator CRM Routes (Role: OPERATOR)
app.get('/api/operator/trainees', authenticateToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    const trainees = await prisma.trainee.findMany({
      include: { enrollments: true, outcomes: true }
    });
    
    // Apply Data Masking Middleware logic
    const sanitizedTrainees = trainees.map(maskPII);
    
    res.json(sanitizedTrainees);
  } catch (error) {
    res.status(500).json({ error: "Database error" });
  }
});

app.get('/api/operator/trainees/:id/timeline', authenticateToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    const { id } = req.params;
    
    // 1. Fetch Trainee Data with all relations
    const trainee = await prisma.trainee.findUnique({
      where: { id },
      include: {
        enrollments: { include: { course: true, provider: true, batch: true } },
        outcomes: { include: { employer: true, wageSnapshots: true } },
        followUps: { include: { operator: true } }
      }
    });

    if (!trainee) return res.status(404).json({ error: "Trainee not found" });

    // 2. Format into a unified array
    const timeline = [];

    trainee.enrollments.forEach(en => {
      timeline.push({ type: 'ENROLLMENT', date: en.certificationDate || new Date(0), data: en });
    });

    trainee.outcomes.forEach(out => {
      timeline.push({ type: 'EMPLOYMENT', date: out.startDate, data: out });
      out.wageSnapshots.forEach(wage => {
        timeline.push({ type: 'WAGE_SNAPSHOT', date: wage.recordedDate, data: wage });
      });
    });

    trainee.followUps.forEach(fup => {
      timeline.push({ type: 'FOLLOW_UP', date: fup.completedDate || fup.scheduledDate, data: fup });
    });

    // 3. Sort chronologically (oldest to newest)
    timeline.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Mask PII if consent is revoked (using the utility we built earlier)
    const maskedTrainee = maskPII(trainee);
    // A revoked-consent timeline must not leak nested employer, operator, or
    // other identifying records even though the top-level trainee is masked.
    const safeTimeline = trainee.consentStatus === true
      ? timeline
      : timeline.map(({ type, date }) => ({ type, date }));

    res.json({
      trainee: {
        systemId: maskedTrainee.systemId,
        name: maskedTrainee.name,
        phone: maskedTrainee.phone,
        demographics: maskedTrainee.demographics,
        consentStatus: maskedTrainee.consentStatus
      },
      timeline: safeTimeline
    });
  } catch (error) {
    res.status(500).json({ error: "Database error aggregating timeline" });
  }
});

app.post('/api/operator/follow-ups/log', authenticateToken, requireRole('OPERATOR'), async (req, res) => {
  const { traineeId, method, notes, status, scheduledDate } = req.body;
  try {
    // Get the operator profile ID based on the logged in user ID
    const operator = await prisma.operator.findUnique({ where: { userId: req.user.id } });
    
    if(!operator) return res.status(404).json({error: "Operator profile not found"});

    const followUp = await prisma.followUpLog.create({
      data: {
        traineeId,
        operatorId: operator.id,
        method,
        notes,
        status,
        scheduledDate: new Date(scheduledDate),
      }
    });
    res.json(followUp);
  } catch (error) {
    res.status(500).json({ error: "Database error" });
  }
});

// --- Ingestion APIs (For External Training Partners & Employers) ---
// In production, these would be protected by API Keys, not JWTs, so automated systems can hit them.

const requireApiKey = require('./middleware/requireApiKey');
const outcomeIngestionRouter = require('./routes/outcomeIngestion');
app.use('/api/ingest', outcomeIngestionRouter);

app.post('/api/ingest/enrollment', requireApiKey, async (req, res) => {
  const { systemId, programmeId, providerId, courseId, batchId, status, enrollmentDate, completionDate } = req.body;
  
  if (!systemId || !programmeId || !providerId || !courseId || !batchId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const validStatuses = ['ENROLLED', 'IN_PROGRESS', 'COMPLETED', 'DROPPED_OUT', 'CANCELLED'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  try {
    const trainee = await prisma.trainee.findUnique({ where: { systemId } });
    if (!trainee) return res.status(404).json({ error: "Trainee not found in system" });

    const batch = await prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) return res.status(400).json({ error: "Batch not found" });
    if (batch.courseId !== courseId || batch.providerId !== providerId || batch.programmeId !== programmeId) {
      return res.status(400).json({ error: "Batch relationship mismatch" });
    }

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) return res.status(400).json({ error: "Course not found" });
    
    // Enforce Course/Programme relationship integrity:
    // If Course.programmeId is null, the course is programme-agnostic.
    // If it is set, it MUST match the programmeId of the enrollment/batch.
    if (course.programmeId && course.programmeId !== programmeId) {
      return res.status(400).json({ error: "Course belongs to a different programme" });
    }

    const parsedEnrollmentDate = enrollmentDate ? new Date(enrollmentDate) : new Date();
    if (isNaN(parsedEnrollmentDate.getTime())) return res.status(400).json({ error: "Invalid enrollmentDate" });
    
    let parsedCompletionDate = null;
    if (completionDate) {
      parsedCompletionDate = new Date(completionDate);
      if (isNaN(parsedCompletionDate.getTime())) return res.status(400).json({ error: "Invalid completionDate" });
      if (parsedCompletionDate < parsedEnrollmentDate) {
        return res.status(400).json({ error: "completionDate cannot be before enrollmentDate" });
      }
    }

    const requestedStatus = status || 'ENROLLED';

    if (requestedStatus === 'COMPLETED' && !parsedCompletionDate) {
      return res.status(400).json({ error: "completionDate is required for COMPLETED status" });
    }
    if ((requestedStatus === 'ENROLLED' || requestedStatus === 'IN_PROGRESS') && parsedCompletionDate) {
      return res.status(400).json({ error: "completionDate must be null for ENROLLED or IN_PROGRESS status" });
    }

    const existing = await prisma.enrollment.findUnique({
      where: {
        traineeId_batchId: {
          traineeId: trainee.id,
          batchId: batchId
        }
      }
    });

    if (existing) {
      const oldStatus = existing.status;
      const newStatus = requestedStatus;

      const transitions = {
        'ENROLLED': ['IN_PROGRESS', 'CANCELLED'],
        'IN_PROGRESS': ['COMPLETED', 'DROPPED_OUT'],
        'COMPLETED': [], 
        'DROPPED_OUT': [], 
        'CANCELLED': [] 
      };

      if (oldStatus !== newStatus) {
        if (!transitions[oldStatus] || !transitions[oldStatus].includes(newStatus)) {
          return res.status(400).json({ error: "Invalid status transition" });
        }
      }

      const updated = await prisma.enrollment.update({
        where: { id: existing.id },
        data: {
          status: newStatus,
          completionDate: parsedCompletionDate !== null ? parsedCompletionDate : existing.completionDate
        }
      });
      return res.json({ message: "Enrollment updated successfully", enrollment: updated });
    }

    const enrollment = await prisma.enrollment.create({
      data: {
        traineeId: trainee.id,
        programmeId,
        providerId,
        courseId,
        batchId,
        status: requestedStatus,
        enrollmentDate: parsedEnrollmentDate,
        completionDate: parsedCompletionDate
      }
    });
    res.json({ message: "Enrollment ingested successfully", enrollment });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Ingestion failed" });
  }
});

// Mission 4 Ingestion Routes
app.post('/api/ingest/skill', requireApiKey, async (req, res) => {
  const { code, name, description, taxonomy, taxonomyVersion, active } = req.body;
  if (!code || typeof code !== 'string' || code.trim() === '') return res.status(400).json({ error: "invalid_input", message: "code is required and must be non-empty" });
  if (!name || typeof name !== 'string' || name.trim() === '') return res.status(400).json({ error: "invalid_input", message: "name is required and must be non-empty" });
  if (active !== undefined && typeof active !== 'boolean') return res.status(400).json({ error: "invalid_input", message: "active must be a boolean" });

  try {
    const skill = await prisma.skill.create({
      data: { code, name, description, taxonomy, taxonomyVersion, active }
    });
    res.json({ message: "Skill created", skill });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: "Duplicate skill code" });
    res.status(500).json({ error: "Ingestion failed" });
  }
});

app.post('/api/ingest/course-skill', requireApiKey, async (req, res) => {
  const { courseId, skillId, expectedLevel, mandatory } = req.body;
  if (!courseId) return res.status(400).json({ error: "invalid_input", message: "courseId is required" });
  if (!skillId) return res.status(400).json({ error: "invalid_input", message: "skillId is required" });
  if (mandatory !== undefined && typeof mandatory !== 'boolean') return res.status(400).json({ error: "invalid_input", message: "mandatory must be a boolean" });
  if (expectedLevel !== undefined && (typeof expectedLevel !== 'string' || expectedLevel.trim() === '')) return res.status(400).json({ error: "invalid_input", message: "expectedLevel must be a non-empty string" });

  try {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) return res.status(404).json({ error: "not_found", message: "Course not found" });
    const skill = await prisma.skill.findUnique({ where: { id: skillId } });
    if (!skill) return res.status(404).json({ error: "not_found", message: "Skill not found" });

    const cs = await prisma.courseSkill.create({
      data: { courseId, skillId, expectedLevel, mandatory }
    });
    res.json({ message: "Course skill created", courseSkill: cs });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: "Duplicate course skill mapping" });
    res.status(500).json({ error: "Ingestion failed" });
  }
});

app.post('/api/ingest/assessment-definition', requireApiKey, async (req, res) => {
  const { courseId, name, code, assessmentType, maxScore, passScore } = req.body;
  
  if (!courseId) return res.status(400).json({ error: "invalid_input", message: "courseId is required" });
  if (!name || typeof name !== 'string' || name.trim() === '') return res.status(400).json({ error: "invalid_input", message: "name must be non-empty" });
  if (!code || typeof code !== 'string' || code.trim() === '') return res.status(400).json({ error: "invalid_input", message: "code must be non-empty" });
  if (!['WRITTEN', 'PRACTICAL', 'MIXED'].includes(assessmentType)) return res.status(400).json({ error: "invalid_input", message: "invalid assessmentType" });
  
  if (!Number.isFinite(maxScore) || maxScore <= 0) return res.status(400).json({ error: "invalid_input", message: "maxScore must be a positive finite number" });
  if (!Number.isFinite(passScore) || passScore < 0 || passScore > maxScore) return res.status(400).json({ error: "invalid_input", message: "passScore must be a finite number between 0 and maxScore" });

  try {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) return res.status(404).json({ error: "Course not found" });

    const assessment = await prisma.assessment.create({
      data: { courseId, name, code, assessmentType, maxScore, passScore }
    });
    res.json({ message: "Assessment created", assessment });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: "Assessment code already exists for this course" });
    res.status(500).json({ error: "Ingestion failed" });
  }
});

app.post('/api/ingest/assessment', requireApiKey, async (req, res) => {
  const { enrollmentId, assessmentId, attemptNumber, score, assessedAt, source, assessorReference, skillResults } = req.body;
  
  if (!Number.isInteger(attemptNumber) || attemptNumber <= 0) return res.status(400).json({ error: "invalid_input", message: "attemptNumber must be a positive integer" });
  if (!Number.isFinite(score) || score < 0) return res.status(400).json({ error: "invalid_input", message: "score must be a finite non-negative number" });
  const parsedAssessedAt = new Date(assessedAt);
  if (isNaN(parsedAssessedAt.getTime())) return res.status(400).json({ error: "invalid_input", message: "invalid assessedAt date" });
  const validSources = ['GOVERNMENT_IMPORT', 'PROVIDER_IMPORT', 'PROGRAMME_IMPORT', 'ASSESSOR', 'CERTIFYING_AUTHORITY'];
  if (!validSources.includes(source)) return res.status(400).json({ error: "invalid_input", message: "invalid source" });

  try {
    const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment) return res.status(404).json({ error: "invalid_input", message: "Enrollment not found" });

    const assessment = await prisma.assessment.findUnique({ where: { id: assessmentId } });
    if (!assessment) return res.status(404).json({ error: "invalid_input", message: "Assessment not found" });

    if (enrollment.courseId !== assessment.courseId) {
      return res.status(400).json({ error: "invalid_input", message: "Enrollment course does not match Assessment course" });
    }

    if (score > assessment.maxScore) {
      return res.status(400).json({ error: "invalid_input", message: "Score cannot exceed maxScore" });
    }

    const percentage = (score / assessment.maxScore) * 100;
    // overall assessment PASS/FAIL is server-derived
    const result = score >= assessment.passScore ? 'PASS' : 'FAIL';

    if (skillResults && skillResults.length > 0) {
      const courseSkills = await prisma.courseSkill.findMany({ where: { courseId: enrollment.courseId } });
      const validSkillIds = new Set(courseSkills.map(cs => cs.skillId));
      const seenSkills = new Set();
      
      for (let sr of skillResults) {
        // skill-level PASS/FAIL is evidence supplied by the trusted assessor source
        if (!validSkillIds.has(sr.skillId)) {
          return res.status(400).json({ error: "invalid_input", message: `Skill ${sr.skillId} not allowed for course/assessment` });
        }
        if (seenSkills.has(sr.skillId)) {
          return res.status(400).json({ error: "invalid_input", message: `Duplicate skill entry for ${sr.skillId}` });
        }
        seenSkills.add(sr.skillId);
        
        if (sr.score !== undefined && sr.score !== null) {
          if (!Number.isFinite(sr.score) || sr.score < 0) return res.status(400).json({ error: "invalid_input", message: "skill score must be finite and >= 0" });
        }
        if (sr.proficiencyLevel !== undefined && (typeof sr.proficiencyLevel !== 'string' || sr.proficiencyLevel.trim() === '')) {
          return res.status(400).json({ error: "invalid_input", message: "skill proficiencyLevel must be a non-empty string" });
        }
        if (sr.result !== 'PASS' && sr.result !== 'FAIL') return res.status(400).json({ error: "invalid_input", message: "skill result must be PASS or FAIL" });
      }
    }

    const attempt = await prisma.$transaction(async (tx) => {
      const newAttempt = await tx.assessmentAttempt.create({
        data: {
          assessmentId,
          enrollmentId,
          attemptNumber,
          score,
          percentage,
          result,
          assessedAt: parsedAssessedAt,
          source,
          assessorReference
        }
      });

      if (skillResults && skillResults.length > 0) {
        for (let sr of skillResults) {
          await tx.assessmentSkillResult.create({
            data: {
              assessmentAttemptId: newAttempt.id,
              skillId: sr.skillId,
              proficiencyLevel: sr.proficiencyLevel,
              score: sr.score,
              result: sr.result
            }
          });

          if (sr.result === 'PASS') {
            await tx.traineeSkillAttainment.create({
              data: {
                traineeId: enrollment.traineeId,
                skillId: sr.skillId,
                enrollmentId: enrollment.id,
                evidenceType: 'ASSESSMENT',
                evidenceReference: newAttempt.referenceCode,
                proficiencyLevel: sr.proficiencyLevel,
                status: 'ASSESSED',
                achievedAt: parsedAssessedAt,
                source
              }
            });
          }
        }
      }
      return newAttempt;
    });

    res.json({ message: "Assessment result ingested", attempt });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: "Duplicate attempt" });
    res.status(500).json({ error: "Ingestion failed" });
  }
});

app.post('/api/ingest/certification', requireApiKey, async (req, res) => {
  const { enrollmentId, certificateReference, certificateType, issuingAuthority, issuedAt, validFrom, validUntil, status, source, skills } = req.body;
  
  if (!certificateReference || typeof certificateReference !== 'string' || certificateReference.trim() === '') return res.status(400).json({ error: "invalid_input", message: "certificateReference must be non-empty" });
  if (!certificateType || typeof certificateType !== 'string' || certificateType.trim() === '') return res.status(400).json({ error: "invalid_input", message: "certificateType must be non-empty" });
  if (!issuingAuthority || typeof issuingAuthority !== 'string' || issuingAuthority.trim() === '') return res.status(400).json({ error: "invalid_input", message: "issuingAuthority must be non-empty" });

  const parsedIssuedAt = new Date(issuedAt);
  if (isNaN(parsedIssuedAt.getTime())) return res.status(400).json({ error: "invalid_input", message: "invalid issuedAt date" });
  
  let parsedValidFrom = null;
  if (validFrom) {
    parsedValidFrom = new Date(validFrom);
    if (isNaN(parsedValidFrom.getTime())) return res.status(400).json({ error: "invalid_input", message: "invalid validFrom date" });
    if (parsedValidFrom < parsedIssuedAt) return res.status(400).json({ error: "invalid_input", message: "validFrom cannot be before issuedAt" });
  }
  
  let parsedValidUntil = null;
  if (validUntil) {
    parsedValidUntil = new Date(validUntil);
    if (isNaN(parsedValidUntil.getTime())) return res.status(400).json({ error: "invalid_input", message: "invalid validUntil date" });
    if (parsedValidFrom && parsedValidUntil < parsedValidFrom) return res.status(400).json({ error: "invalid_input", message: "validUntil cannot be before validFrom" });
    if (parsedValidUntil < parsedIssuedAt) return res.status(400).json({ error: "invalid_input", message: "validUntil cannot be before issuedAt" });
  }
  
  const certStatus = status || 'ISSUED';
  if (!['ISSUED', 'REVOKED', 'EXPIRED'].includes(certStatus)) return res.status(400).json({ error: "invalid_input", message: "invalid status" });

  const validSources = ['GOVERNMENT_IMPORT', 'PROVIDER_IMPORT', 'PROGRAMME_IMPORT', 'ASSESSOR', 'CERTIFYING_AUTHORITY'];
  if (!validSources.includes(source)) return res.status(400).json({ error: "invalid_input", message: "invalid source" });

  if (skills && skills.length > 0) {
    const seenSkills = new Set();
    for (let sk of skills) {
      if (seenSkills.has(sk.skillId)) {
        return res.status(400).json({ error: "invalid_input", message: `Duplicate certification skill: ${sk.skillId}` });
      }
      seenSkills.add(sk.skillId);
      const dbSkill = await prisma.skill.findUnique({ where: { id: sk.skillId } });
      if (!dbSkill) return res.status(404).json({ error: "not_found", message: `Skill ${sk.skillId} not found` });
    }
  }

  try {
    const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment) return res.status(404).json({ error: "invalid_input", message: "Enrollment not found" });

    const certification = await prisma.$transaction(async (tx) => {
      const existingCert = await tx.certification.findUnique({ where: { certificateReference } });

      let cert;
      if (existingCert) {
        cert = await tx.certification.update({
          where: { id: existingCert.id },
          data: {
            status: certStatus,
            validFrom: parsedValidFrom !== null ? parsedValidFrom : existingCert.validFrom,
            validUntil: parsedValidUntil !== null ? parsedValidUntil : existingCert.validUntil,
            source
          }
        });

        let newAttainmentStatus = 'CERTIFIED';
        if (certStatus === 'REVOKED') newAttainmentStatus = 'REVOKED';
        if (certStatus === 'EXPIRED') newAttainmentStatus = 'EXPIRED';

        await tx.traineeSkillAttainment.updateMany({
          where: {
            evidenceType: 'CERTIFICATION',
            evidenceReference: existingCert.referenceCode
          },
          data: {
            status: newAttainmentStatus
          }
        });
      } else {
        cert = await tx.certification.create({
          data: {
            enrollmentId,
            certificateReference,
            certificateType,
            issuingAuthority,
            issuedAt: parsedIssuedAt,
            validFrom: parsedValidFrom,
            validUntil: parsedValidUntil,
            status: certStatus,
            source
          }
        });

        if (skills && skills.length > 0) {
          const courseSkills = await tx.courseSkill.findMany({ where: { courseId: enrollment.courseId } });
          const validCourseSkillIds = new Set(courseSkills.map(cs => cs.skillId));

          let attainmentStatus = 'CERTIFIED';
          if (certStatus === 'REVOKED') attainmentStatus = 'REVOKED';
          if (certStatus === 'EXPIRED') attainmentStatus = 'EXPIRED';

          for (let sk of skills) {
            const alignment = validCourseSkillIds.has(sk.skillId) ? 'COURSE_ALIGNED' : 'EXTERNAL_CERTIFICATION';

            await tx.certificationSkill.create({
              data: {
                certificationId: cert.id,
                skillId: sk.skillId,
                evidenceLevel: sk.evidenceLevel,
                alignment
              }
            });

            await tx.traineeSkillAttainment.create({
              data: {
                traineeId: enrollment.traineeId,
                skillId: sk.skillId,
                enrollmentId: enrollment.id,
                evidenceType: 'CERTIFICATION',
                evidenceReference: cert.referenceCode,
                proficiencyLevel: sk.evidenceLevel,
                status: attainmentStatus,
                achievedAt: parsedIssuedAt,
                source
              }
            });
          }
        }
      }
      return cert;
    });

    res.json({ message: "Certification ingested", certification });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: "Duplicate certification" });
    res.status(500).json({ error: "Ingestion failed" });
  }
});

// --- Authentication & OTP Routes ---

// Request OTP
app.post('/api/auth/request-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "missing_phone", message: "Phone number required" });
  
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return res.status(400).json({ error: "invalid_phone", message: "Invalid Indian phone number format" });
  }

  try {
    // Check if trainee exists with this phone
    const trainee = await prisma.trainee.findUnique({
      where: { phone: normalizedPhone },
      include: { user: true }
    });

    if (!trainee) {
      if (NODE_ENV === 'production') {
        return res.json({ message: "If the phone number is registered, an OTP has been sent." });
      }
      return res.status(404).json({ error: "not_found", message: "Trainee not found with this phone number" });
    }

    // Check resend throttling
    const latestChallenge = await prisma.otpChallenge.findFirst({
      where: { traineeId: trainee.id },
      orderBy: { createdAt: 'desc' }
    });

    if (latestChallenge) {
      const secondsSinceLast = (Date.now() - latestChallenge.createdAt.getTime()) / 1000;
      if (secondsSinceLast < OTP_RESEND_COOLDOWN_SECONDS) {
        if (NODE_ENV === 'production') {
          return res.json({ message: "If the phone number is registered, an OTP has been sent." });
        }
        return res.status(429).json({ 
          error: "rate_limit", 
          message: `Please wait before requesting another OTP. Cooldown: ${Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLast)}s` 
        });
      }
    }

    // Generate a secure, random 6-digit OTP
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    
    // Invalidate previous LOGIN challenges for this trainee
    await prisma.otpChallenge.updateMany({
      where: { 
        traineeId: trainee.id, 
        purpose: 'LOGIN',
        consumedAt: null,
        expiresAt: { gt: new Date() } 
      },
      data: { consumedAt: new Date() }
    });

    // Create new challenge
    await prisma.otpChallenge.create({
      data: {
        traineeId: trainee.id,
        otpHash: otpHash,
        purpose: 'LOGIN',
        targetPhone: normalizedPhone,
        expiresAt: new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000),
        maxAttempts: OTP_MAX_ATTEMPTS
      }
    });

    // TODO: PRODUCTION SMS GATEWAY INTEGRATION
    if (NODE_ENV !== 'production') {
      console.log(`[DEV ONLY] Sending OTP ${otp} to phone ${normalizedPhone}`);
    }

    res.json({ message: "If the phone number is registered, an OTP has been sent." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "server_error", message: "Server error during OTP request" });
  }
});

// Verify OTP & Login
app.post('/api/auth/verify-otp', async (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: "missing_credentials", message: "Phone and OTP required" });

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return res.status(400).json({ error: "invalid_phone", message: "Invalid Indian phone number format" });
  }

  try {
    const trainee = await prisma.trainee.findUnique({
      where: { phone: normalizedPhone },
      include: { user: true }
    });

    if (!trainee) return res.status(401).json({ error: "invalid_credentials", message: "Invalid login attempt" });

    // Get active challenge for LOGIN
    const challenge = await prisma.otpChallenge.findFirst({
      where: { 
        traineeId: trainee.id,
        purpose: 'LOGIN',
        targetPhone: normalizedPhone,
        consumedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!challenge) {
      return res.status(401).json({ error: "invalid_otp", message: "OTP is invalid or expired" });
    }

    // Atomically increment attempts only if under limit and not consumed
    const updateResult = await prisma.otpChallenge.updateMany({
      where: { 
        id: challenge.id,
        attempts: { lt: challenge.maxAttempts },
        consumedAt: null
      },
      data: { attempts: { increment: 1 } }
    });

    if (updateResult.count === 0) {
      return res.status(401).json({ error: "attempts_exhausted", message: "Maximum OTP attempts exceeded" });
    }

    const isValid = await bcrypt.compare(otp, challenge.otpHash);
    
    if (!isValid) {
      return res.status(401).json({ error: "invalid_otp", message: "Incorrect OTP" });
    }

    // Atomic consumption: try to set consumedAt to now, only if it is null
    const consumeResult = await prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() }
    });

    if (consumeResult.count === 0) {
      // It was consumed by a concurrent request between validation and now
      return res.status(401).json({ error: "invalid_otp", message: "OTP already consumed" });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: trainee.user.id, role: trainee.user.role },
      VALID_JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ 
      token, 
      trainee: {
        name: trainee.name,
        phone: trainee.phone,
        consentStatus: trainee.consentStatus
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "server_error", message: "Server error during OTP verification" });
  }
});

// Update Consent Status (Role: TRAINEE) - Keep for backward compatibility
// However, the real endpoints are now in routes/trainee.js
app.post('/api/trainee/consent', authenticateToken, requireRole('TRAINEE'), async (req, res) => {
  const { consentStatus } = req.body;
  
  if (typeof consentStatus !== 'boolean') {
    return res.status(400).json({ error: "consentStatus must be a boolean" });
  }

  try {
    const { grantConsent, revokeConsent } = require('./services/consent');
    const trainee = await prisma.trainee.findUnique({ where: { userId: req.user.id } });
    
    if (consentStatus) {
      await grantConsent(trainee.id, 'OUTCOME_TRACKING', '1.0', 'LEGACY_COMPATIBILITY');
    } else {
      await revokeConsent(trainee.id, 'OUTCOME_TRACKING', '1.0', 'LEGACY_COMPATIBILITY');
    }

    const updatedTrainee = await prisma.trainee.findUnique({ where: { userId: req.user.id } });

    res.json({ 
      message: "Consent status updated successfully", 
      consentStatus: updatedTrainee.consentStatus 
    });
  } catch (error) {
    res.status(500).json({ error: "Database error" });
  }
});

app.listen(port, () => {
  console.log(`Kaushal Outcome Platform API running on port ${port}`);
});

module.exports = app;
