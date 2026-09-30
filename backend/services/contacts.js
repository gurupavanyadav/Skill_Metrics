const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Normalizes an Indian phone number.
 * @param {string} phone 
 * @returns {string|null} Normalized phone or null if invalid
 */
const normalizePhone = (phone) => {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  
  if (digits.length === 10) return '+91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits;
  
  return null;
};

/**
 * Retrieves all contacts for a given trainee.
 * @param {string} traineeId 
 * @returns {Promise<Array>}
 */
async function getTraineeContacts(traineeId) {
  return await prisma.traineeContact.findMany({
    where: { traineeId },
    orderBy: { createdAt: 'desc' }
  });
}

/**
 * Adds an initial phone to a trainee's contact history, setting it as primary.
 * (Utility for new trainees or migration).
 */
async function addPrimaryPhone(traineeId, phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) throw new Error("Invalid phone format");

  return await prisma.$transaction(async (tx) => {
    // Un-primary any existing phone (there shouldn't be any, but just in case)
    await tx.traineeContact.updateMany({
      where: { traineeId, contactType: 'PHONE', isPrimary: true },
      data: { isPrimary: false, validTo: new Date() }
    });

    return await tx.traineeContact.create({
      data: {
        traineeId,
        contactType: 'PHONE',
        normalizedValue: normalizedPhone,
        isPrimary: true,
        isVerified: true, // Assuming initial setup implies verification
        verifiedAt: new Date(),
        validFrom: new Date(),
      }
    });
  });
}

module.exports = {
  normalizePhone,
  getTraineeContacts,
  addPrimaryPhone
};
