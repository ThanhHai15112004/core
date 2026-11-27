import {
  SEQUENCE_DATE_FORMAT,
  SEQUENCE_RESET_POLICY,
  SEQUENCE_STATUS,
  SequenceRegistryService,
  defaultSequenceRegistry,
} from '@packages/kernel/index.js';
import { DATA_GOVERNANCE_SEQUENCES } from '../enum/data-governance.enum.js';

function ensureSequenceRuleRegistered(
  sequenceRegistry: SequenceRegistryService,
  key: string,
  prefix: string,
): void {
  if (sequenceRegistry.getRule(key)) return;
  sequenceRegistry.registerRule(
    {
      key,
      module: 'data-governance',
      name: prefix,
      description: null,
      prefix,
      suffix: '',
      separator: '-',
      dateFormat: SEQUENCE_DATE_FORMAT.YYYYMMDD,
      dateFormatName: 'YYYYMMDD',
      templatePattern: null,
      paddingLength: 4,
      startValue: 1,
      step: 1,
      resetPolicy: SEQUENCE_RESET_POLICY.DAILY,
      resetPolicyName: 'DAILY',
      scopeByUnit: false,
      timezone: 'Asia/Ho_Chi_Minh',
      isSystem: true,
      status: SEQUENCE_STATUS.ACTIVE,
    },
    { silent: true },
  );
}

export async function nextDsarRequestCode(
  sequenceRegistry: SequenceRegistryService = defaultSequenceRegistry,
): Promise<string> {
  ensureSequenceRuleRegistered(sequenceRegistry, DATA_GOVERNANCE_SEQUENCES.DSAR_CODE, 'DSAR');
  const generated = await sequenceRegistry.nextCode(DATA_GOVERNANCE_SEQUENCES.DSAR_CODE);
  return generated.code;
}

export async function nextLegalHoldCode(
  sequenceRegistry: SequenceRegistryService = defaultSequenceRegistry,
): Promise<string> {
  ensureSequenceRuleRegistered(
    sequenceRegistry,
    DATA_GOVERNANCE_SEQUENCES.LEGAL_HOLD_CODE,
    'LHOLD',
  );
  const generated = await sequenceRegistry.nextCode(DATA_GOVERNANCE_SEQUENCES.LEGAL_HOLD_CODE);
  return generated.code;
}
