import { Injectable, Optional } from '@nestjs/common';
import { BadRequestAppException } from '@packages/kernel/index.js';
import type { IOAuthProviderAdapter } from '../contracts/index.js';
import type { FederatedDriverMetadata } from '../types/federated-identity.types.js';
import { GenericOidcAdapter } from '../adapters/generic-oidc.adapter.js';
import { GoogleOAuthAdapter } from '../adapters/google-oauth.adapter.js';
import { MicrosoftOAuthAdapter } from '../adapters/microsoft-oauth.adapter.js';
import { SamlProviderAdapter } from '../adapters/saml.adapter.js';

@Injectable()
export class OAuthProviderRegistryService {
  private readonly adapters = new Map<string, IOAuthProviderAdapter>();

  constructor(
    googleAdapter: GoogleOAuthAdapter,
    microsoftAdapter: MicrosoftOAuthAdapter,
    @Optional() genericOidcAdapter?: GenericOidcAdapter,
    @Optional() samlAdapter?: SamlProviderAdapter,
  ) {
    this.register(googleAdapter);
    this.register(microsoftAdapter);
    this.register(genericOidcAdapter ?? new GenericOidcAdapter());
    this.register(samlAdapter ?? new SamlProviderAdapter());
  }

  public register(adapter: IOAuthProviderAdapter): void {
    this.adapters.set(adapter.driverCode.trim().toLowerCase(), adapter);
  }

  public has(driverCode: string): boolean {
    return this.adapters.has(driverCode.trim().toLowerCase());
  }

  public get(driverCode: string): IOAuthProviderAdapter {
    const normalized = driverCode.trim().toLowerCase();
    const adapter = this.adapters.get(normalized);
    if (!adapter) {
      throw new BadRequestAppException('federated-identity.unsupportedDriver', [
        { driverCode: normalized },
      ]);
    }
    return adapter;
  }

  public listDrivers(): FederatedDriverMetadata[] {
    return Array.from(this.adapters.values()).map((adapter) => adapter.getMetadata());
  }
}
