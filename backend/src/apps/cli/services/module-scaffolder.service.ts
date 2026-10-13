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
  id: string;
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
  exists(id: string): Promise<boolean>;
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
      id: 'mock-id-' + Date.now(),
      title: dto.title,
      description: dto.description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  public async findById(id: string): Promise<${pascal}Response | null> {
    return {
      id,
      title: \`Sample \${id}\`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  public async exists(id: string): Promise<boolean> {
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
    return this.${camel}Service.findById(id);
  }
}
`;
    await writeFile(`controllers/${kebab}.controller.ts`, controllerContent);

    // 9. If withDb: entities and repositories
    if (withDb) {
      const entityContent = `
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('${kebab.replace(/-/g, '_')}')
export class ${pascal}Entity {
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @Column({ type: 'varchar', length: 255 })
  public title!: string;

  @Column({ type: 'text', nullable: true })
  public description?: string;

  @CreateDateColumn()
  public createdAt!: Date;

  @UpdateDateColumn()
  public updatedAt!: Date;
}
`;
      await writeFile(`entities/${kebab}.entity.ts`, entityContent);

      const repoContent = `
import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ${pascal}Entity } from '../entities/${kebab}.entity.js';

@Injectable()
export class ${pascal}Repository extends Repository<${pascal}Entity> {
  constructor(dataSource: DataSource) {
    super(${pascal}Entity, dataSource.createEntityManager());
  }
}
`;
      await writeFile(`repositories/${kebab}.repository.ts`, repoContent);
    }

    // 10. <name>.module.ts
    const moduleContent = `
import { Module } from '@nestjs/common';
import { ${pascal}Controller } from './controllers/${kebab}.controller.js';
import { ${pascal}Service } from './services/${kebab}.service.js';
import { ${constant}_PUBLIC_SERVICE } from './contracts/index.js';
${withDb ? `import { ${pascal}Repository } from './repositories/${kebab}.repository.js';\n` : ''}
@Module({
  controllers: [${pascal}Controller],
  providers: [
    ${pascal}Service,
    {
      provide: ${constant}_PUBLIC_SERVICE,
      useExisting: ${pascal}Service,
    },
    ${withDb ? `${pascal}Repository,` : ''}
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
