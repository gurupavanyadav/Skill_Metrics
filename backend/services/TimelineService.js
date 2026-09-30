/**
 * Architectural foundation for a TimelineService.
 * Normalizes events from Identity, Training, Assessment, Certification, Outcome, Verification
 * into a stable TimelineEvent DTO.
 */
class TimelineService {
  /**
   * Converts a domain event into a standardized TimelineEvent DTO
   */
  static mapToDTO({ eventType, occurredAt, reference, sourceDomain, summary, verificationState }) {
    return {
      eventType,          // e.g., 'TRAINING_COMPLETED', 'OUTCOME_REPORTED'
      occurredAt,         // Date
      reference,          // ID or object reference
      sourceDomain,       // 'TRAINING', 'OUTCOME', etc.
      summary,            // Human-readable summary
      verificationState   // Optional verification status
    };
  }

  static async getTraineeTimeline(traineeId) {
    // Stub implementation to be filled in during full Mission 5 implementation
    return [];
  }
}

module.exports = TimelineService;
