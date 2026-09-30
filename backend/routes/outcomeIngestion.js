const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const requireApiKey = require('../middleware/requireApiKey');

router.post('/outcome', requireApiKey, async (req, res) => {
  const idempotencyKey = req.headers['x-idempotency-key'];
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return res.status(400).json({ error: "missing_idempotency_key", message: "x-idempotency-key header is required" });
  }

  const { 
    systemId, 
    type, 
    source,
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

  const payloadString = JSON.stringify({ systemId, type, source, startDate, endDate, enrollmentId, employerId, businessName, registrationType, portalIdentifier, contractDuration, wageAmount });
  const requestHash = crypto.createHash('sha256').update(payloadString).digest('hex');

  try {
    const trainee = await prisma.trainee.findUnique({ where: { systemId } });
    if (!trainee) return res.status(404).json({ error: "not_found", message: "Trainee not found in system" });

    if (!['SALARIED', 'SELF_EMPLOYED', 'APPRENTICESHIP'].includes(type)) {
      return res.status(400).json({ error: "invalid_input", message: "Invalid outcome type" });
    }

    if (!source) {
      return res.status(400).json({ error: "invalid_input", message: "Outcome source is required" });
    }

    const validSources = ['TRAINEE_SELF_REPORT', 'EMPLOYER_REPORT', 'PLACEMENT_PARTNER', 'GOVERNMENT_REGISTRY', 'PROGRAMME_IMPORT', 'PROVIDER_IMPORT', 'OPERATOR_ENTRY'];
    if (!validSources.includes(source)) {
      return res.status(400).json({ error: "invalid_input", message: "Invalid outcome source" });
    }

    if (source !== 'PLACEMENT_PARTNER') {
      return res.status(403).json({ error: "authorization_failure", message: "Generic partner API key channel is only authorized to submit PLACEMENT_PARTNER provenance." });
    }

    const outcomeSource = source;

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
      // In ingestion, usually provided by third-party systems or placement partners, treat as LINKED
      linkageStatus = 'LINKED';
    }

    // Sequential fast-path check
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
            source: outcomeSource,
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

      res.status(201).json({ message: "Employment outcome ingested successfully", outcome });
    } catch (e) {
      if (e.code === 'P2002' && e.meta?.target?.includes('idempotencyKey')) {
        // Race condition: another request inserted it before us
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
      throw e; // Bubble up other errors
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "server_error", message: "Ingestion failed" });
  }
});

module.exports = router;
