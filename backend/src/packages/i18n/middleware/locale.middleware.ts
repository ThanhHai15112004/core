import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { LocaleContext } from '../context/locale-context.js';
import { resolveHeaderLocale } from '../resolvers/header-locale.resolver.js';

@Injectable()
export class LocaleMiddleware implements NestMiddleware {
  public use(req: FastifyRequest['raw'], _res: FastifyReply['raw'], next: () => void): void {
    const header = req.headers['accept-language'];
    const locale = resolveHeaderLocale(Array.isArray(header) ? header[0] : header);
    LocaleContext.run(locale, next);
  }
}
