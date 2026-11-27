export const COMPLIANCE_QUEUE_TOPICS = {
  REVIEW_REMINDER_SWEEP_TICK: 'compliance.review.reminder.sweep.tick',
} as const;

export type ComplianceQueueTopic =
  (typeof COMPLIANCE_QUEUE_TOPICS)[keyof typeof COMPLIANCE_QUEUE_TOPICS];

export const COMPLIANCE_DOMAIN_EVENTS = {
  CONTROL_SAVED: 'compliance.control.saved',
  CONTROL_DELETED: 'compliance.control.deleted',
  EVIDENCE_ADDED: 'compliance.evidence.added',
  EVIDENCE_DELETED: 'compliance.evidence.deleted',
  CHECK_RECORDED: 'compliance.check.recorded',
  VENDOR_SAVED: 'compliance.vendor.saved',
  VENDOR_DELETED: 'compliance.vendor.deleted',
  VENDOR_DATA_ASSESSMENT_SAVED: 'compliance.vendor.data_assessment.saved',
  REVIEW_DUE: 'compliance.review.due',
  CONTRACT_EXPIRING: 'compliance.contract.expiring',
  REPORT_GENERATED: 'compliance.report.generated',
} as const;

export type ComplianceDomainEventName =
  (typeof COMPLIANCE_DOMAIN_EVENTS)[keyof typeof COMPLIANCE_DOMAIN_EVENTS];
