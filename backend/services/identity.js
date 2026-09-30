const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Associates an external identifier with a trainee.
 * @param {string} traineeId 
 * @param {string} namespace 
 * @param {string} identifierType 
 * @param {string} identifierValue 
 * @param {string} source 
 * @returns {Promise<Object>} The created identifier record
 */
async function associateTraineeIdentifier(traineeId, namespace, identifierType, identifierValue, source = null) {
  // We use create because uniqueness is guaranteed by DB constraint.
  // We could also do upsert if we wanted to update validity, but for now deterministic association is enough.
  return await prisma.traineeIdentifier.create({
    data: {
      traineeId,
      namespace,
      identifierType,
      identifierValue,
      source,
      isVerified: false,
      validFrom: new Date(),
    }
  });
}

/**
 * Retrieves all identifiers for a trainee.
 * @param {string} traineeId 
 * @returns {Promise<Array>} List of identifiers
 */
async function getTraineeIdentifiers(traineeId) {
  return await prisma.traineeIdentifier.findMany({
    where: { traineeId },
    orderBy: { createdAt: 'desc' }
  });
}

module.exports = {
  associateTraineeIdentifier,
  getTraineeIdentifiers,
};
