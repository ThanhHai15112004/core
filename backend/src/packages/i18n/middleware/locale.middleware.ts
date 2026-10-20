import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { LocaleContext } from '../context/locale-context.js';
import {
  resolveRequestLocale,
  resolveRequestTimezone,
  resolveSystemDefaultLocale,
  resolveSystemDefaultTimezone,
} from '../resolvers/header-locale.resolver.js';

@Injectable()
export class LocaleMiddleware implements NestMiddleware {
  /** Thiết lập locale & timezone hoạt động cho ngữ cảnh request hiện tại */
  public use(req: FastifyRequest['raw'], _res: FastifyReply['raw'], next: () => void): void {
    const defaultLocale = resolveSystemDefaultLocale();
    const defaultTimezone = resolveSystemDefaultTimezone();

    const { locale, explicitLocale } = resolveRequestLocale(req.headers, defaultLocale);
    const { timezone, explicitTimezone } = resolveRequestTimezone(req.headers, defaultTimezone);

    LocaleContext.run(locale, next, {
      timezone,
      explicitLocale,
      explicitTimezone,
    });
  }
}
