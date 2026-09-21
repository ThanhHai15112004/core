import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import type { DatabaseConnectionContract } from '../contracts/database.contract.js';

@Injectable()
export class BaseDatabaseProvider
  implements DatabaseConnectionContract, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('DatabaseProvider');
  private connected = false;
  private readonly connection: string;
  private readonly host: string;
  private readonly port: number;
  private readonly database: string;
  private readonly username: string;
  private readonly maxConnections: number;

  constructor(private readonly configService: CoreConfigService) {
    this.connection = this.configService.database.connection;
    this.host = this.configService.database.host;
    this.port = this.configService.database.port;
    this.database = this.configService.database.database;
    this.username = this.configService.database.username;
    this.maxConnections = this.configService.database.maxConnections;
  }

  public async connect(): Promise<void> {
    this.logger.log(
      `Initializing ${this.connection} connection to ${this.host}:${this.port}/${this.database} (pool: ${this.maxConnections})...`,
    );
    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    this.logger.log('Closing database connection...');
    this.connected = false;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async ping(): Promise<boolean> {
    return this.connected;
  }

  public async onModuleInit(): Promise<void> {
    await this.connect();
  }

  public async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }
}
