import { Global, Module } from '@nestjs/common';
import { TokenService } from './providers/token.service.js';
import { AuthGuard } from './guards/auth.guard.js';

@Global()
@Module({
  providers: [TokenService, AuthGuard],
  exports: [TokenService, AuthGuard],
})
export class SecurityModule {}
