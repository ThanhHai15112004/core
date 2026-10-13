import { useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { Badge, Button, Textarea } from '@core/ui/primitives';
import { DetailSection, JsonView, Panel } from '@core/ui/blocks';
import { JWT_INPUT_ROWS, JWT_JSON_MAX_HEIGHT_PX } from '../../constants/governance';
import { decodeJwt, type DecodedJwt } from './jwt';

type DecodeResult = { ok: true; value: DecodedJwt } | { ok: false; error: 'format' | 'decode' } | null;

function tryDecode(token: string): DecodeResult {
  if (!token.trim()) return null;
  try {
    return { ok: true, value: decodeJwt(token) };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.message === 'format' ? 'format' : 'decode' };
  }
}

/** Giải mã header / payload JWT ngay trên trình duyệt — token không rời khỏi máy, KHÔNG xác minh chữ ký. */
export function JwtDecoderPanel() {
  const { t } = useLocale();
  const [token, setToken] = useState('');
  const result = useMemo(() => tryDecode(token), [token]);

  return (
    <Panel
      title={t('gov.security.decoder.title')}
      hint={t('gov.security.decoder.hint')}
      actions={
        token ? (
          <Button size="xs" variant="ghost" onClick={() => setToken('')}>
            <X />
            {t('gov.security.decoder.clear')}
          </Button>
        ) : undefined
      }
    >
      <Textarea
        rows={JWT_INPUT_ROWS}
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder={t('gov.security.decoder.placeholder')}
        aria-label={t('gov.security.decoder.input')}
        spellCheck={false}
        autoComplete="off"
        className="break-all font-mono text-xs"
      />

      {result && !result.ok && (
        <div className="mt-3 flex items-center gap-1.5 text-sm text-crit-fg" role="alert">
          <AlertTriangle className="size-4 shrink-0" />
          {t(`gov.security.decoder.error.${result.error}`)}
        </div>
      )}

      {result?.ok && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <DetailSection title={t('gov.security.decoder.header')} className="mb-0">
            <JsonView value={result.value.header} maxHeight={JWT_JSON_MAX_HEIGHT_PX} />
          </DetailSection>
          <DetailSection
            className="mb-0"
            title={t('gov.security.decoder.payload')}
            actions={
              result.value.isExpired ? (
                <Badge tone="crit">{t('gov.security.decoder.expired')}</Badge>
              ) : (
                <Badge tone="warn">{t('gov.security.decoder.notVerified')}</Badge>
              )
            }
          >
            <JsonView value={result.value.payload} maxHeight={JWT_JSON_MAX_HEIGHT_PX} />
          </DetailSection>
        </div>
      )}
    </Panel>
  );
}
