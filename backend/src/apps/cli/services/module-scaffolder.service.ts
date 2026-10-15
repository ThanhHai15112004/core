import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ManifestService } from './manifest.service.js';

export interface ScaffoldingOptions {
  name: string;
  type?: 'project' | 'core';
  withDb?: boolean;
  description?: string;
}

export interface ScaffoldingResult {
  moduleName: string;
  targetDirectory: string;
  createdFiles: string[];
}

@Injectable()
export class ModuleScaffolderService {
  private readonly logger = new Logger(ModuleScaffolderService.name);

  constructor(private readonly manifestService: ManifestService) {}

  /** Chuyển đổi tên: kebab-case -> các dạng khác nhau */
  public formatNames(rawName: string) {
    const kebab = rawName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const parts = kebab.split('-');
    const camel = parts
      .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
      .join('');
    const pascal = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
    const constant = parts.map((p) => p.toUpperCase()).join('_');
    const title = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');

    return { kebab, camel, pascal, constant, title };
  }

  /** Khởi tạo khung mã nguồn (scaffolding) cho một module mới theo cấu trúc chuẩn */
  public async scaffold(options: ScaffoldingOptions): Promise<ScaffoldingResult> {
    const type = options.type ?? 'project';
    const withDb = Boolean(options.withDb);
    const { kebab, camel, pascal, constant, title } = this.formatNames(options.name);

    if (!kebab) {
      throw new Error('Invalid module name. Please provide a valid alphanumeric name.');
    }

    const baseDir = this.manifestService.getModulesRoot(type);
    const targetDir = path.join(baseDir, kebab);

    // Kiểm tra xem module đã tồn tại chưa
    try {
      await fs.access(targetDir);
      throw new Error(`Module directory already exists at ${targetDir}`);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('already exists')) {
        throw err;
      }
      // Directory doesn't exist yet, proceed
    }

    const createdFiles: string[] = [];

    /** Ghi nội dung vào tệp đích và tạo thư mục cha nếu chưa tồn tại */
    const writeFile = async (relativePath: string, content: string) => {
      const fullPath = path.join(targetDir, relativePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content.trim() + '\n', 'utf8');
      createdFiles.push(relativePath);
    };

    // 1. module.manifest.json
    const manifestJson = {
      $schema:
        type === 'core'
          ? '../../packages/kernel/schemas/module.manifest.schema.json'
          : '../../packages/kernel/schemas/module.manifest.schema.json',
      name: kebab,
      displayName: title,
      version: '1.0.0',
      description: options.description || `${title} module for ${type} capability`,
      type,
      category: type === 'core' ? 'core' : 'domain',
      author: 'Developer',
      entryModule: `${pascal}Module`,
      dependencies: withDb ? ['database'] : [],
      permissions: [`${kebab}.read`, `${kebab}.manage`],
      events: {
        published: [],
        subscribed: [],
      },
      database: {
        hasMigrations: withDb,
        tables: withDb ? [kebab.replace(/-/g, '_')] : [],
      },
    };
    await writeFile('module.manifest.json', JSON.stringify(manifestJson, null, 2));

    // 2. routes/<name>.routes.ts
    const routesContent = `
export const ${constant}_ROUTES = {
  PREFIX: '${kebab}',
  ROOT: '/',
  BY_ID: '/:id',
  buildByIdPath: (id: string | number) => \`/${kebab}/\${id}\`,
} as const;
`;
    await writeFile(`routes/${kebab}.routes.ts`, routesContent);

    // 3. requests/create-<name>.request.ts
    const requestContent = `
export class Create${pascal}Request {
  public title!: string;
  public description?: string;
}
`;
    await writeFile(`requests/create-${kebab}.request.ts`, requestContent);

    // 4. responses/<name>.response.ts
    const responseContent = `
export interface ${pascal}Response {
  id: number;
  title: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}
`;
    await writeFile(`responses/${kebab}.response.ts`, responseContent);

    // 5. contracts/index.ts
    const contractContent = `
export interface I${pascal}PublicService {
  exists(id: number): Promise<boolean>;
}

export const ${constant}_PUBLIC_SERVICE = Symbol('${constant}_PUBLIC_SERVICE');
`;
    await writeFile('contracts/index.ts', contractContent);

    // 6. locales
    await writeFile(
      `locales/vi/${kebab}.json`,
      JSON.stringify({ title: title, created: 'Tạo thành công' }, null, 2),
    );
    await writeFile(
      `locales/en/${kebab}.json`,
      JSON.stringify({ title: title, created: 'Created successfully' }, null, 2),
    );

    // 7. services/<name>.service.ts
    const serviceContent = `
import { Injectable, Logger } from '@nestjs/common';
import type { Create${pascal}Request } from '../requests/create-${kebab}.request.js';
import type { ${pascal}Response } from '../responses/${kebab}.response.js';
import type { I${pascal}PublicService } from '../contracts/index.js';

@Injectable()
export class ${pascal}Service implements I${pascal}PublicService {
  private readonly logger = new Logger(${pascal}Service.name);

  public async create(dto: Create${pascal}Request): Promise<${pascal}Response> {
    this.logger.log(\`Creating new ${kebab}: \${dto.title}\`);
    return {
      id: 1,
      title: dto.title,
      description: dto.description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  public async findById(id: number): Promise<${pascal}Response | null> {
    return {
      id,
      title: \`Sample \${id}\`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  public async exists(id: number): Promise<boolean> {
    const item = await this.findById(id);
    return item !== null;
  }
}
`;
    await writeFile(`services/${kebab}.service.ts`, serviceContent);

    // 8. controllers/<name>.controller.ts
    const controllerContent = `
import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ${constant}_ROUTES } from '../routes/${kebab}.routes.js';
import { ${pascal}Service } from '../services/${kebab}.service.js';
import { Create${pascal}Request } from '../requests/create-${kebab}.request.js';

@Controller(${constant}_ROUTES.PREFIX)
export class ${pascal}Controller {
  constructor(private readonly ${camel}Service: ${pascal}Service) {}

  @Post(${constant}_ROUTES.ROOT)
  public async create(@Body() body: Create${pascal}Request) {
    return this.${camel}Service.create(body);
  }

  @Get(${constant}_ROUTES.BY_ID)
  public async getById(@Param('id') id: string) {
    return this.${camel}Service.findById(Number(id));
  }
}
`;
    await writeFile(`controllers/${kebab}.controller.ts`, controllerContent);

    // 9. If withDb: entities, repositories, and mappers
    if (withDb) {
      const entityContent = `
import { Entity, Column, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

/**
 * Thực thể dữ liệu của module ${title}.
 * Gợi ý: Đổi sang kế thừa \`VersionedTypeOrmEntity\` nếu bảng chứa dữ liệu nhạy cảm cần Optimistic Locking.
 */
@Entity('${kebab.replace(/-/g, '_')}')
export class ${pascal}Entity extends TypeOrmBaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  public title!: string;

  @Column({ type: 'text', nullable: true })
  public description?: string;
}
`;
      await writeFile(`entities/${kebab}.entity.ts`, entityContent);

      const repoContent = `
import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { ${pascal}Entity } from '../entities/${kebab}.entity.js';

@Injectable()
export class ${pascal}Repository extends BaseTypeOrmRepository<${pascal}Entity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(${pascal}Entity, dataSource, transactionManager);
  }
}
`;
      await writeFile(`repositories/${kebab}.repository.ts`, repoContent);

      const mapperContent = `
import { Injectable } from '@nestjs/common';
import type { EntityMapperContract } from '@packages/database/index.js';
import type { ${pascal}Entity } from '../entities/${kebab}.entity.js';
import type { ${pascal}Response } from '../responses/${kebab}.response.js';

@Injectable()
export class ${pascal}Mapper implements EntityMapperContract<${pascal}Entity, ${pascal}Response> {
  public toResponse(entity: ${pascal}Entity): ${pascal}Response {
    return {
      id: entity.id,
      title: entity.title,
      ...(entity.description !== undefined ? { description: entity.description } : {}),
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  public toResponseList(entities: ${pascal}Entity[]): ${pascal}Response[] {
    return entities.map((item) => this.toResponse(item));
  }
}
`;
      await writeFile(`mappers/${kebab}.mapper.ts`, mapperContent);
    }

    // 10. <name>.module.ts
    const moduleContent = `
import { Module } from '@nestjs/common';
import { ${pascal}Controller } from './controllers/${kebab}.controller.js';
import { ${pascal}Service } from './services/${kebab}.service.js';
import { ${constant}_PUBLIC_SERVICE } from './contracts/index.js';
${withDb ? `import { ${pascal}Repository } from './repositories/${kebab}.repository.js';\nimport { ${pascal}Mapper } from './mappers/${kebab}.mapper.js';\n` : ''}
@Module({
  controllers: [${pascal}Controller],
  providers: [
    ${pascal}Service,
    {
      provide: ${constant}_PUBLIC_SERVICE,
      useExisting: ${pascal}Service,
    },
    ${withDb ? `${pascal}Repository,\n    ${pascal}Mapper,` : ''}
  ],
  exports: [${pascal}Service, ${constant}_PUBLIC_SERVICE],
})
export class ${pascal}Module {}
`;
    await writeFile(`${kebab}.module.ts`, moduleContent);

    // 11. index.ts
    const indexContent = `
export * from './contracts/index.js';
export * from './routes/${kebab}.routes.js';
export * from './requests/create-${kebab}.request.js';
export * from './responses/${kebab}.response.js';
export * from './services/${kebab}.service.js';
export * from './${kebab}.module.js';
`;
    await writeFile('index.ts', indexContent);

    this.logger.log(`Module ${kebab} scaffolded successfully at ${targetDir}`);

    return {
      moduleName: kebab,
      targetDirectory: targetDir,
      createdFiles,
    };
  }
}
