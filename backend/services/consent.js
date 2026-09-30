const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Gets the current active consent state for a specific purpose.
 * @param {string} traineeId 
 * @param {string} purpose 
 * @returns {Promise<Object|null>} The latest consent record
 */
async function getCurrentConsent(traineeId, purpose) {
  return await prisma.consentRecord.findFirst({
    where: { traineeId, purpose },
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' }
    ]
  });
}

/**
 * Checks if active consent exists for a purpose.
 * @param {string} traineeId 
 * @param {string} purpose 
 * @returns {Promise<boolean>} True if active and granted, otherwise false
 */
async function hasActiveConsent(traineeId, purpose) {
  const current = await getCurrentConsent(traineeId, purpose);
  if (!current) return false;
  return current.status === 'GRANTED';
}

/**
 * Grants consent for a purpose.
 * @param {string} traineeId 
 * @param {string} purpose 
 * @param {string} version 
 * @param {string} source 
 */
async function grantConsent(traineeId, purpose, version, source = 'PORTAL') {
  return await prisma.$transaction(async (tx) => {
    // Append-only event history: Do not modify previous records.
    const newRecord = await tx.consentRecord.create({
      data: {
        traineeId,
        purpose,
        status: 'GRANTED',
        version,
        grantedAt: new Date(),
        source
      }
    });

    // Backwards compatibility for general OUTCOME_TRACKING
    if (purpose === 'OUTCOME_TRACKING') {
      await tx.trainee.update({
        where: { id: traineeId },
        data: { consentStatus: true }
      });
    }

    return newRecord;
  });
}

/**
 * Revokes consent for a purpose.
 * @param {string} traineeId 
 * @param {string} purpose 
 * @param {string} version 
 * @param {string} source 
 */
async function revokeConsent(traineeId, purpose, version, source = 'PORTAL') {
  return await prisma.$transaction(async (tx) => {
    // Append-only event history: Do not modify previous records.
    const newRecord = await tx.consentRecord.create({
      data: {
        traineeId,
        purpose,
        status: 'REVOKED',
        version,
        revokedAt: new Date(),
        source
      }
    });

    // Backwards compatibility for general OUTCOME_TRACKING
    if (purpose === 'OUTCOME_TRACKING') {
      await tx.trainee.update({
        where: { id: traineeId },
        data: { consentStatus: false }
      });
    }

    return newRecord;
  });
}

/**
 * Retrieves the consent history for a trainee.
 */
async function getConsentHistory(traineeId) {
  return await prisma.consentRecord.findMany({
    where: { traineeId },
    orderBy: { createdAt: 'desc' }
  });
}

module.exports = {
  getCurrentConsent,
  hasActiveConsent,
  grantConsent,
  revokeConsent,
  getConsentHistory
};
