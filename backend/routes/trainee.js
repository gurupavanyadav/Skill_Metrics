const express = require('express');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { normalizePhone } = require('../services/contacts');
const { hasActiveConsent, grantConsent, revokeConsent, getConsentHistory } = require('../services/consent');

const router = express.Router();
const prisma = new PrismaClient();

const OTP_EXPIRY_SECONDS = parseInt(process.env.OTP_EXPIRY_SECONDS || '300', 10);
const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS || '3', 10);

// Helper for JWT authentication from index.js (we assume it's attached by middleware)
// Routes in this file will be prefixed with /api/trainee/me
// and already protected by authenticateToken and requireRole('TRAINEE')

// GET /api/trainee/me/contacts
router.get('/contacts', async (req, res) => {
  try {
    const trainee = await prisma.trainee.findUnique({ where: { userId: req.user.id } });
    if (!trainee) return res.status(404).json({ error: "not_found", message: "Trainee profile not found" });

    const traineeContacts = await prisma.traineeContact.findMany({
      where: { traineeId: trainee.id },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(traineeContacts);
  } catch (error) {
    res.status(500).json({ error: "server_error", message: "Database error" });
  }
});

// POST /api/trainee/me/phone/change/request
router.post('/phone/change/request', async (req, res) => {
  const { newPhone } = req.body;
  if (!newPhone) return res.status(400).json({ error: "missing_phone", message: "New phone number required" });
  
  const normalizedPhone = normalizePhone(newPhone);
  if (!normalizedPhone) return res.status(400).json({ error: "invalid_phone", message: "Invalid Indian phone number format" });

  try {
    const trainee = await prisma.trainee.findUnique({ where: { userId: req.user.id } });
    if (!trainee) return res.status(404).json({ error: "not_found", message: "Trainee profile not found" });

    // Check if phone already owned by another trainee (or this trainee)
    const existingTrainee = await prisma.trainee.findUnique({ where: { phone: normalizedPhone } });
    if (existingTrainee) return res.status(409).json({ error: "conflict", message: "Phone number already associated with an account" });

    // Check resend throttling for PHONE_CHANGE
    const OTP_RESEND_COOLDOWN_SECONDS = parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || '60', 10);
    const latestChallenge = await prisma.otpChallenge.findFirst({
      where: { traineeId: trainee.id, purpose: 'PHONE_CHANGE' },
      orderBy: { createdAt: 'desc' }
    });

    if (latestChallenge) {
      const secondsSinceLast = (Date.now() - latestChallenge.createdAt.getTime()) / 1000;
      if (secondsSinceLast < OTP_RESEND_COOLDOWN_SECONDS) {
        return res.status(429).json({ 
          error: "rate_limit", 
          message: `Please wait before requesting another OTP. Cooldown: ${Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLast)}s` 
        });
      }
    }

    // Invalidate old challenges
    await prisma.otpChallenge.updateMany({
      where: { traineeId: trainee.id, purpose: 'PHONE_CHANGE', consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() }
    });

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    
    await prisma.otpChallenge.create({
      data: {
        traineeId: trainee.id,
        otpHash: otpHash,
        purpose: 'PHONE_CHANGE',
        targetPhone: normalizedPhone,
        expiresAt: new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000),
        maxAttempts: OTP_MAX_ATTEMPTS
      }
    });

    // In production, send SMS to `normalizedPhone` with `otp`
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV ONLY] Sending phone change OTP ${otp} to phone ${normalizedPhone}`);
    }

    res.json({ message: "OTP sent to new phone number." });
  } catch (error) {
    res.status(500).json({ error: "server_error", message: "Database error" });
  }
});

// POST /api/trainee/me/phone/change/verify
router.post('/phone/change/verify', async (req, res) => {
  const { newPhone, otp } = req.body;
  if (!newPhone || !otp) return res.status(400).json({ error: "missing_fields", message: "New phone and OTP required" });

  const normalizedPhone = normalizePhone(newPhone);
  if (!normalizedPhone) return res.status(400).json({ error: "invalid_phone", message: "Invalid phone number format" });

  try {
    const trainee = await prisma.trainee.findUnique({ where: { userId: req.user.id } });
    if (!trainee) return res.status(404).json({ error: "not_found", message: "Trainee not found" });

    const challenge = await prisma.otpChallenge.findFirst({
      where: { 
        traineeId: trainee.id,
        purpose: 'PHONE_CHANGE',
        targetPhone: normalizedPhone,
        consumedAt: null,
        expiresAt: { gt: new Date() } 
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!challenge) return res.status(401).json({ error: "invalid_otp", message: "OTP is invalid or expired" });

    const updateResult = await prisma.otpChallenge.updateMany({
      where: { id: challenge.id, attempts: { lt: challenge.maxAttempts }, consumedAt: null },
      data: { attempts: { increment: 1 } }
    });

    if (updateResult.count === 0) return res.status(401).json({ error: "attempts_exhausted", message: "Maximum OTP attempts exceeded" });

    const isValid = await bcrypt.compare(otp, challenge.otpHash);
    if (!isValid) return res.status(401).json({ error: "invalid_otp", message: "Incorrect OTP" });

    try {
      // Update phone and consume OTP transactionally
      await prisma.$transaction(async (tx) => {
        // Atomic consumption inside transaction
        const consumeResult = await tx.otpChallenge.updateMany({ 
          where: { id: challenge.id, consumedAt: null },
          data: { consumedAt: new Date() } 
        });

        if (consumeResult.count === 0) {
          throw new Error("OTP_ALREADY_CONSUMED");
        }

        // Un-primary old contacts
        await tx.traineeContact.updateMany({
          where: { traineeId: trainee.id, contactType: 'PHONE', isPrimary: true },
          data: { isPrimary: false, validTo: new Date() }
        });

        // Create new contact
        await tx.traineeContact.create({
          data: {
            traineeId: trainee.id,
            contactType: 'PHONE',
            normalizedValue: normalizedPhone,
            isPrimary: true,
            isVerified: true,
            verifiedAt: new Date(),
            validFrom: new Date(),
          }
        });

        // Update trainee canon phone for login compatibility
        await tx.trainee.update({
          where: { id: trainee.id },
          data: { phone: normalizedPhone }
        });
      });
    } catch (txError) {
      if (txError.message === "OTP_ALREADY_CONSUMED") {
        return res.status(401).json({ error: "invalid_otp", message: "OTP already consumed" });
      }
      throw txError;
    }

    res.json({ message: "Phone number updated successfully." });
  } catch (error) {
    res.status(500).json({ error: "server_error", message: "Database error" });
  }
});

// GET /api/trainee/me/consent
router.get('/consent', async (req, res) => {
  try {
    const trainee = await prisma.trainee.findUnique({ where: { userId: req.user.id } });
    if (!trainee) return res.status(404).json({ error: "not_found", message: "Trainee not found" });

    // Get current state for each purpose by finding latest record for each purpose
    const purposes = ['OUTCOME_TRACKING', 'FOLLOW_UP', 'EMPLOYMENT_VERIFICATION', 'ANALYTICS', 'CROSS_PROGRAMME_LINKING'];
    const activeConsents = {};

    for (const purpose of purposes) {
      activeConsents[purpose] = await hasActiveConsent(trainee.id, purpose);
    }

    res.json({ activeConsents });
  } catch (error) {
    res.status(500).json({ error: "server_error", message: "Database error" });
  }
});

// POST /api/trainee/me/consent
router.post('/consent', async (req, res) => {
  const { purpose, version, consent } = req.body;
  if (!purpose || !version || typeof consent !== 'boolean') {
    return res.status(400).json({ error: "invalid_request", message: "purpose, version, and explicit boolean consent required" });
  }

  const validPurposes = ['OUTCOME_TRACKING', 'FOLLOW_UP', 'EMPLOYMENT_VERIFICATION', 'ANALYTICS', 'CROSS_PROGRAMME_LINKING'];
  if (!validPurposes.includes(purpose)) {
    return res.status(400).json({ error: "invalid_purpose", message: "Invalid consent purpose" });
  }

  try {
    const trainee = await prisma.trainee.findUnique({ where: { userId: req.user.id } });
    if (!trainee) return res.status(404).json({ error: "not_found", message: "Trainee not found" });

    if (consent) {
      await grantConsent(trainee.id, purpose, version, 'PORTAL');
    } else {
      await revokeConsent(trainee.id, purpose, version, 'PORTAL');
    }

    res.json({ message: `Consent for ${purpose} updated successfully` });
  } catch (error) {
    res.status(500).json({ error: "server_error", message: "Database error" });
  }
});

// POST /api/trainee/me/consent/revoke
router.post('/consent/revoke', async (req, res) => {
  const { purpose, version } = req.body;
  if (!purpose || !version) {
    return res.status(400).json({ error: "invalid_request", message: "purpose and version required" });
  }

  const validPurposes = ['OUTCOME_TRACKING', 'FOLLOW_UP', 'EMPLOYMENT_VERIFICATION', 'ANALYTICS', 'CROSS_PROGRAMME_LINKING'];
  if (!validPurposes.includes(purpose)) {
    return res.status(400).json({ error: "invalid_purpose", message: "Invalid consent purpose" });
  }

  try {
    const trainee = await prisma.trainee.findUnique({ where: { userId: req.user.id } });
    if (!trainee) return res.status(404).json({ error: "not_found", message: "Trainee not found" });

    await revokeConsent(trainee.id, purpose, version, 'PORTAL');

    res.json({ message: `Consent for ${purpose} revoked successfully` });
  } catch (error) {
    res.status(500).json({ error: "server_error", message: "Database error" });
  }
});

// GET /api/trainee/me/consent/history
router.get('/consent/history', async (req, res) => {
  try {
    const trainee = await prisma.trainee.findUnique({ where: { userId: req.user.id } });
    if (!trainee) return res.status(404).json({ error: "not_found", message: "Trainee not found" });

    const history = await getConsentHistory(trainee.id);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: "server_error", message: "Database error" });
  }
});

// GET /api/trainee/me/training
router.get('/training', async (req, res) => {
  try {
    const trainee = await prisma.trainee.findUnique({ where: { userId: req.user.id } });
    if (!trainee) return res.status(404).json({ error: "not_found", message: "Trainee not found" });

    const enrollments = await prisma.enrollment.findMany({
      where: { traineeId: trainee.id },
      include: {
        programme: true,
        provider: true,
        course: true,
        batch: true
      },
      orderBy: { enrollmentDate: 'desc' }
    });

    const dtos = enrollments.map(en => ({
      referenceCode: en.referenceCode,
      programme: { name: en.programme.name },
      provider: { name: en.provider.name },
      course: { name: en.course.name },
      batch: { code: en.batch.batchIdentifier, startDate: en.batch.startDate, endDate: en.batch.actualEndDate || en.batch.plannedEndDate },
      status: en.status,
      enrolledAt: en.enrollmentDate,
      completedAt: en.completionDate
    }));

    res.json(dtos);
  } catch (error) {
    res.status(500).json({ error: "server_error", message: "Database error" });
  }
});

// GET /api/trainee/me/training/:reference
router.get('/training/:reference', async (req, res) => {
  try {
    const trainee = await prisma.trainee.findUnique({ where: { userId: req.user.id } });
    if (!trainee) return res.status(404).json({ error: "not_found", message: "Trainee not found" });

    const enrollment = await prisma.enrollment.findUnique({
      where: { referenceCode: req.params.reference },
      include: {
        programme: true,
        provider: true,
        course: true,
        batch: true
      }
    });

    if (!enrollment) return res.status(404).json({ error: "not_found", message: "Enrollment not found" });
    if (enrollment.traineeId !== trainee.id) return res.status(403).json({ error: "forbidden", message: "Access denied" });

    const dto = {
      referenceCode: enrollment.referenceCode,
      programme: { name: enrollment.programme.name },
      provider: { name: enrollment.provider.name },
      course: { name: enrollment.course.name },
      batch: { code: enrollment.batch.batchIdentifier, startDate: enrollment.batch.startDate, endDate: enrollment.batch.actualEndDate || enrollment.batch.plannedEndDate },
      status: enrollment.status,
      enrolledAt: enrollment.enrollmentDate,
      completedAt: enrollment.completionDate
    };

    res.json(dto);
  } catch (error) {
    res.status(500).json({ error: "server_error", message: "Database error" });
  }
});

// GET /api/trainee/me/assessments
router.get('/assessments', async (req, res) => {
  try {
    const trainee = await prisma.trainee.findUnique({ where: { userId: req.user.id } });
    if (!trainee) return res.status(404).json({ error: "not_found", message: "Trainee not found" });

    const attempts = await prisma.assessmentAttempt.findMany({
      where: { enrollment: { traineeId: trainee.id } },
      include: {
        assessment: { include: { course: true } },
        skillResults: { include: { skill: true } }
      }
    });

    const response = attempts.map(a => ({
      referenceCode: a.referenceCode,
      course: a.assessment.course.name,
      assessmentName: a.assessment.name,
      assessedAt: a.assessedAt,
      score: a.score,
      percentage: a.percentage,
      result: a.result,
      skills: a.skillResults.map(sr => ({
        skill: sr.skill.name,
        proficiency: sr.proficiencyLevel,
        result: sr.result
      }))
    }));
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: "server_error", message: "Database error" });
  }
});

// GET /api/trainee/me/assessments/:reference
router.get('/assessments/:reference', async (req, res) => {
  try {
    const trainee = await prisma.trainee.findUnique({ where: { userId: req.user.id } });
    if (!trainee) return res.status(404).json({ error: "not_found", message: "Trainee not found" });
    
    const attempt = await prisma.assessmentAttempt.findUnique({
      where: { referenceCode: req.params.reference },
      include: {
        assessment: { include: { course: true } },
        enrollment: true,
        skillResults: { include: { skill: true } }
      }
    });

    if (!attempt) return res.status(404).json({ error: "not_found", message: "Not found" });
    if (attempt.enrollment.traineeId !== trainee.id) return res.status(403).json({ error: "forbidden", message: "Access denied" });

    const response = {
      referenceCode: attempt.referenceCode,
      course: attempt.assessment.course.name,
      assessmentName: attempt.assessment.name,
      assessedAt: attempt.assessedAt,
      score: attempt.score,
      percentage: attempt.percentage,
      result: attempt.result,
      skills: attempt.skillResults.map(sr => ({
        skill: sr.skill.name,
        proficiency: sr.proficiencyLevel,
        result: sr.result
      }))
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

// GET /api/trainee/me/certifications
router.get('/certifications', async (req, res) => {
  try {
    const trainee = await prisma.trainee.findUnique({ where: { userId: req.user.id } });
    if (!trainee) return res.status(404).json({ error: "not_found", message: "Trainee not found" });
    
    const certs = await prisma.certification.findMany({
      where: { enrollment: { traineeId: trainee.id } },
      include: {
        skills: { include: { skill: true } }
      }
    });

    const response = certs.map(c => ({
      referenceCode: c.referenceCode,
      certificateReference: c.certificateReference,
      type: c.certificateType,
      issuingAuthority: c.issuingAuthority,
      issueDate: c.issuedAt,
      status: c.status,
      skills: c.skills.map(sk => sk.skill.name)
    }));
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

// GET /api/trainee/me/certifications/:reference
router.get('/certifications/:reference', async (req, res) => {
  try {
    const trainee = await prisma.trainee.findUnique({ where: { userId: req.user.id } });
    if (!trainee) return res.status(404).json({ error: "not_found", message: "Trainee not found" });
    
    const cert = await prisma.certification.findUnique({
      where: { referenceCode: req.params.reference },
      include: {
        enrollment: true,
        skills: { include: { skill: true } }
      }
    });

    if (!cert) return res.status(404).json({ error: "not_found" });
    if (cert.enrollment.traineeId !== trainee.id) return res.status(403).json({ error: "forbidden" });

    const response = {
      referenceCode: cert.referenceCode,
      certificateReference: cert.certificateReference,
      type: cert.certificateType,
      issuingAuthority: cert.issuingAuthority,
      issueDate: cert.issuedAt,
      status: cert.status,
      skills: cert.skills.map(sk => sk.skill.name)
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

// GET /api/trainee/me/skills
router.get('/skills', async (req, res) => {
  try {
    const trainee = await prisma.trainee.findUnique({ where: { userId: req.user.id } });
    if (!trainee) return res.status(404).json({ error: "not_found", message: "Trainee not found" });
    
    const attainments = await prisma.traineeSkillAttainment.findMany({
      where: { traineeId: trainee.id },
      include: { skill: true }
    });

    const response = attainments.map(a => ({
      referenceCode: a.referenceCode,
      skill: a.skill.name,
      proficiency: a.proficiencyLevel,
      evidenceType: a.evidenceType,
      attainmentStatus: a.status,
      achievedDate: a.achievedAt
    }));
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

// GET /api/trainee/me/outcomes
router.get('/outcomes', async (req, res) => {
  try {
    const trainee = await prisma.trainee.findUnique({ where: { userId: req.user.id } });
    if (!trainee) return res.status(404).json({ error: "not_found", message: "Trainee not found" });

    const outcomes = await prisma.employmentOutcome.findMany({
      where: { traineeId: trainee.id },
      include: {
        employer: true,
        enrollment: true,
        salariedDetails: true,
        selfEmploymentDetails: true,
        apprenticeshipDetails: true,
        wageSnapshots: true,
        verifications: true
      },
      orderBy: { startDate: 'desc' }
    });

    const dtos = outcomes.map(o => ({
      referenceCode: o.referenceCode,
      type: o.type,
      startDate: o.startDate,
      endDate: o.endDate,
      source: o.source,
      verificationStatus: o.verificationStatus,
      linkageStatus: o.linkageStatus,
      employer: o.employer ? { name: o.employer.name, district: o.employer.district } : null,
      enrollmentReference: o.enrollment ? o.enrollment.referenceCode : null,
      details: o.type === 'SALARIED' && o.salariedDetails ? {}
             : o.type === 'SELF_EMPLOYED' && o.selfEmploymentDetails ? {
                 businessName: o.selfEmploymentDetails.businessName,
                 registrationType: o.selfEmploymentDetails.registrationType
               }
             : o.type === 'APPRENTICESHIP' && o.apprenticeshipDetails ? {
                 portalIdentifier: o.apprenticeshipDetails.portalIdentifier,
                 contractDuration: o.apprenticeshipDetails.contractDuration
               } : null,
      wageSnapshots: o.wageSnapshots.map(w => ({
        wageAmount: w.wageAmount,
        type: w.type,
        recordedDate: w.recordedDate
      })),
      verifications: o.verifications.map(v => ({
        status: v.status,
        method: v.method,
        source: v.source,
        verifiedAt: v.verifiedAt
      }))
    }));

    res.json(dtos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "server_error", message: "Database error" });
  }
});

// GET /api/trainee/me/outcomes/:reference
router.get('/outcomes/:reference', async (req, res) => {
  try {
    const trainee = await prisma.trainee.findUnique({ where: { userId: req.user.id } });
    if (!trainee) return res.status(404).json({ error: "not_found", message: "Trainee not found" });

    const outcome = await prisma.employmentOutcome.findUnique({
      where: { referenceCode: req.params.reference },
      include: {
        employer: true,
        enrollment: true,
        salariedDetails: true,
        selfEmploymentDetails: true,
        apprenticeshipDetails: true,
        wageSnapshots: true,
        verifications: true
      }
    });

    if (!outcome) return res.status(404).json({ error: "not_found", message: "Outcome not found" });
    if (outcome.traineeId !== trainee.id) return res.status(403).json({ error: "authorization_failure", message: "Access denied" });

    const dto = {
      referenceCode: outcome.referenceCode,
      type: outcome.type,
      startDate: outcome.startDate,
      endDate: outcome.endDate,
      source: outcome.source,
      verificationStatus: outcome.verificationStatus,
      linkageStatus: outcome.linkageStatus,
      employer: outcome.employer ? { name: outcome.employer.name, district: outcome.employer.district } : null,
      enrollmentReference: outcome.enrollment ? outcome.enrollment.referenceCode : null,
      details: outcome.type === 'SALARIED' && outcome.salariedDetails ? {}
             : outcome.type === 'SELF_EMPLOYED' && outcome.selfEmploymentDetails ? {
                 businessName: outcome.selfEmploymentDetails.businessName,
                 registrationType: outcome.selfEmploymentDetails.registrationType
               }
             : outcome.type === 'APPRENTICESHIP' && outcome.apprenticeshipDetails ? {
                 portalIdentifier: outcome.apprenticeshipDetails.portalIdentifier,
                 contractDuration: outcome.apprenticeshipDetails.contractDuration
               } : null,
      wageSnapshots: outcome.wageSnapshots.map(w => ({
        wageAmount: w.wageAmount,
        type: w.type,
        recordedDate: w.recordedDate
      })),
      verifications: outcome.verifications.map(v => ({
        status: v.status,
        method: v.method,
        source: v.source,
        verifiedAt: v.verifiedAt
      }))
    };

    res.json(dto);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "server_error", message: "Database error" });
  }
});

// POST /api/trainee/me/outcome
router.post('/outcome', async (req, res) => {
  try {
    const trainee = await prisma.trainee.findUnique({ where: { userId: req.user.id } });
    if (!trainee) return res.status(404).json({ error: "not_found", message: "Trainee profile not found" });

    // 1. Check consent
    const hasConsent = await hasActiveConsent(trainee.id, 'OUTCOME_TRACKING');
    if (!hasConsent) {
      return res.status(403).json({ error: "authorization_failure", message: "Active OUTCOME_TRACKING consent is required to self-report an outcome" });
    }

    const { 
      type, 
      startDate, 
      endDate,
      enrollmentId,
      employerId,
      businessName,
      registrationType,
      portalIdentifier,
      contractDuration,
      wageAmount 
    } = req.body;

    if (!['SALARIED', 'SELF_EMPLOYED', 'APPRENTICESHIP'].includes(type)) {
      return res.status(400).json({ error: "invalid_input", message: "Invalid outcome type" });
    }

    const parsedStartDate = new Date(startDate);
    if (isNaN(parsedStartDate.getTime())) return res.status(400).json({ error: "invalid_input", message: "Invalid startDate" });

    let parsedEndDate = null;
    if (endDate) {
      parsedEndDate = new Date(endDate);
      if (isNaN(parsedEndDate.getTime())) return res.status(400).json({ error: "invalid_input", message: "Invalid endDate" });
      if (parsedEndDate < parsedStartDate) return res.status(400).json({ error: "invalid_input", message: "endDate cannot be before startDate" });
    }

    if (type === 'SALARIED' && !employerId) {
      return res.status(400).json({ error: "invalid_input", message: "employerId is required for SALARIED" });
    }
    if (type === 'APPRENTICESHIP' && !employerId) {
      return res.status(400).json({ error: "invalid_input", message: "employerId is required for APPRENTICESHIP" });
    }

    let parsedWageAmount = null;
    if (wageAmount !== undefined && wageAmount !== null && wageAmount !== '') {
      parsedWageAmount = Number(wageAmount);
      if (!Number.isFinite(parsedWageAmount) || parsedWageAmount < 0 || parsedWageAmount > 1000000000) {
        return res.status(400).json({ error: "invalid_input", message: "wageAmount must be a finite non-negative amount" });
      }
    }

    let parsedContractDuration = null;
    if (contractDuration !== undefined && contractDuration !== null && contractDuration !== '') {
      parsedContractDuration = Number(contractDuration);
      if (!Number.isInteger(parsedContractDuration) || parsedContractDuration < 0 || parsedContractDuration > 120) {
        return res.status(400).json({ error: "invalid_input", message: "contractDuration must be an integer between 0 and 120" });
      }
    }

    let resolvedEnrollmentId = null;
    let linkageStatus = 'UNLINKED';
    
    if (enrollmentId) {
      const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
      if (!enrollment) {
        return res.status(400).json({ error: "invalid_linkage", message: "Enrollment not found" });
      }
      if (enrollment.traineeId !== trainee.id) {
        return res.status(403).json({ error: "authorization_failure", message: "Enrollment does not belong to trainee" });
      }
      resolvedEnrollmentId = enrollment.id;
      linkageStatus = 'MANUALLY_LINKED';
    }

    const idempotencyKey = req.headers['x-idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      return res.status(400).json({ error: "missing_idempotency_key", message: "x-idempotency-key header is required" });
    }
    const payloadString = JSON.stringify({ type, startDate, endDate, enrollmentId, employerId, businessName, registrationType, portalIdentifier, contractDuration, wageAmount });
    const requestHash = crypto.createHash('sha256').update(payloadString).digest('hex');

    const source = 'TRAINEE_SELF_REPORT';

    const existingOutcome = await prisma.employmentOutcome.findUnique({
      where: {
        traineeId_idempotencyKey: {
          traineeId: trainee.id,
          idempotencyKey
        }
      },
      include: {
        salariedDetails: true,
        selfEmploymentDetails: true,
        apprenticeshipDetails: true,
        wageSnapshots: true
      }
    });

    if (existingOutcome) {
      if (existingOutcome.requestHash !== requestHash) {
        return res.status(409).json({ error: "conflict", message: "Idempotency key reused with materially different payload" });
      }
      return res.json({ message: "Employment outcome already exists (idempotent)", outcome: existingOutcome });
    }

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const newOutcome = await tx.employmentOutcome.create({
          data: {
            traineeId: trainee.id,
            employerId: type === 'SELF_EMPLOYED' ? null : employerId,
            enrollmentId: resolvedEnrollmentId,
            linkageStatus,
            type,
            startDate: parsedStartDate,
            endDate: parsedEndDate,
            source,
            verificationStatus: 'PENDING',
            idempotencyKey,
            requestHash
          }
        });

        if (type === 'SALARIED') {
          await tx.salariedEmploymentDetails.create({
            data: { outcomeId: newOutcome.id }
          });
        } else if (type === 'SELF_EMPLOYED') {
          await tx.selfEmploymentDetails.create({
            data: {
              outcomeId: newOutcome.id,
              businessName,
              registrationType
            }
          });
        } else if (type === 'APPRENTICESHIP') {
          await tx.apprenticeshipDetails.create({
            data: {
              outcomeId: newOutcome.id,
              portalIdentifier,
              contractDuration: parsedContractDuration
            }
          });
        }

        if (parsedWageAmount !== null) {
          const compType = type === 'SALARIED' ? 'SALARY' : (type === 'APPRENTICESHIP' ? 'STIPEND' : 'SELF_EMPLOYMENT_INCOME');
          await tx.wageSnapshot.create({
            data: {
              outcomeId: newOutcome.id,
              wageAmount: parsedWageAmount,
              recordedDate: parsedStartDate,
              type: compType
            }
          });
        }

        return await tx.employmentOutcome.findUnique({
          where: { id: newOutcome.id },
          include: {
            salariedDetails: true,
            selfEmploymentDetails: true,
            apprenticeshipDetails: true,
            wageSnapshots: true
          }
        });
      });

      res.status(201).json({ message: "Employment outcome self-reported successfully", outcome });
    } catch (e) {
      if (e.code === 'P2002' && e.meta?.target?.includes('idempotencyKey')) {
        const existingOutcomeConc = await prisma.employmentOutcome.findUnique({
          where: {
            traineeId_idempotencyKey: {
              traineeId: trainee.id,
              idempotencyKey
            }
          },
          include: {
            salariedDetails: true,
            selfEmploymentDetails: true,
            apprenticeshipDetails: true,
            wageSnapshots: true
          }
        });

        if (!existingOutcomeConc) {
          return res.status(500).json({ error: "server_error", message: "Unresolved concurrency conflict" });
        }

        if (existingOutcomeConc.requestHash !== requestHash) {
          return res.status(409).json({ error: "conflict", message: "Idempotency key reused with materially different payload" });
        }

        return res.json({ message: "Employment outcome already exists (idempotent)", outcome: existingOutcomeConc });
      }
      throw e;
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "server_error", message: "Self-report failed" });
  }
});

module.exports = router;

