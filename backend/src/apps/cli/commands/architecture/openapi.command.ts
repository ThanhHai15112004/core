import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { type OpenApiDocument, detectOpenApiBreakingChanges } from '@packages/http/index.js';
import { generateCoreApiDocs } from '@apps/api/bootstrap/api-docs.bootstrap.js';
import { ManifestService } from '../../services/manifest.service.js';
import {
  type CliCommandDescriptor,
  type ICliCommandProvider,
} from '../../dispatcher/cli-dispatcher.service.js';

const DEFAULT_OPENAPI_REL_PATH = 'openapi/openapi.v1.json';
const DEFAULT_POSTMAN_REL_PATH = 'openapi/postman.v1.json';

@Injectable()
export class OpenApiCommand implements ICliCommandProvider {
  constructor(private readonly manifestService: ManifestService) {}

  /** Khai báo các lệnh CLI phục vụ xuất file OpenAPI trong CI và kiểm tra Breaking Change */
  public getCommands(): CliCommandDescriptor[] {
    return [
      {
        name: 'openapi:export',
        domain: 'Architecture',
        description:
          'Xuất đặc tả OpenAPI 3.1 (openapi.v1.json) và Postman Collection (postman.v1.json) phục vụ CI/CD',
        usage:
          'npm run cli -- openapi:export [--out openapi/openapi.v1.json] [--postman openapi/postman.v1.json]',
        execute: (args: string[]) => this.exportOpenApi(args),
      },
      {
        name: 'openapi:check',
        domain: 'Architecture',
        description:
          'Kiểm tra thay đổi phá vỡ hợp đồng API (Breaking Changes) so với bản baseline OpenAPI',
        usage: 'npm run cli -- openapi:check [--base openapi/openapi.v1.json]',
        execute: (args: string[]) => this.checkBreakingChanges(args),
      },
    ];
  }

  /** Xuất file OpenAPI 3.1 JSON và Postman Collection v2.1 ra đĩa */
  public async exportOpenApi(args: string[] = []): Promise<void> {
    const backendRoot = this.manifestService.getBackendRoot();
    const outArg = this.extractFlagValue(args, '--out') ?? DEFAULT_OPENAPI_REL_PATH;
    const postmanArg = this.extractFlagValue(args, '--postman') ?? DEFAULT_POSTMAN_REL_PATH;

    const openApiPath = path.isAbsolute(outArg) ? outArg : path.join(backendRoot, outArg);
    const postmanPath = path.isAbsolute(postmanArg)
      ? postmanArg
      : path.join(backendRoot, postmanArg);

    const { openApiDocument, postmanCollection } = generateCoreApiDocs();

    await fs.mkdir(path.dirname(openApiPath), { recursive: true });
    await fs.writeFile(openApiPath, `${JSON.stringify(openApiDocument, null, 2)}\n`, 'utf8');

    await fs.mkdir(path.dirname(postmanPath), { recursive: true });
    await fs.writeFile(postmanPath, `${JSON.stringify(postmanCollection, null, 2)}\n`, 'utf8');

    const pathCount = Object.keys(openApiDocument.paths).length;
    console.log('\n======================================================');
    console.log('          OpenAPI 3.1 & Postman CI Exporter           ');
    console.log('======================================================');
    console.log(`✓ OpenAPI 3.1 Spec exported to: ${path.relative(backendRoot, openApiPath)}`);
    console.log(`✓ Postman Collection exported to: ${path.relative(backendRoot, postmanPath)}`);
    console.log(`✓ Total documented API paths: ${pathCount}`);
    console.log('======================================================\n');
  }

  /** Kiểm tra Breaking Changes giữa mã nguồn hiện tại và file baseline OpenAPI */
  public async checkBreakingChanges(args: string[] = []): Promise<void> {
    const backendRoot = this.manifestService.getBackendRoot();
    const baseArg = this.extractFlagValue(args, '--base') ?? DEFAULT_OPENAPI_REL_PATH;
    const baselinePath = path.isAbsolute(baseArg) ? baseArg : path.join(backendRoot, baseArg);

    console.log('\n======================================================');
    console.log('       OpenAPI Breaking Change Detector (CI)          ');
    console.log('======================================================\n');

    let baselineContent: string;
    try {
      baselineContent = await fs.readFile(baselinePath, 'utf8');
    } catch {
      throw new Error(
        `Baseline OpenAPI file not found at "${baselinePath}". Run "npm run openapi:export" first to generate baseline.`,
      );
    }

    const baselineSpec = JSON.parse(baselineContent) as OpenApiDocument;
    const { openApiDocument: currentSpec } = generateCoreApiDocs();
    const report = detectOpenApiBreakingChanges(baselineSpec, currentSpec);

    console.log(`Compared ${report.totalOperationsCompared} baseline HTTP operation(s).\n`);

    if (report.passed) {
      console.log('------------------------------------------------------');
      console.log('✓ NO BREAKING API CHANGES DETECTED');
      console.log('------------------------------------------------------\n');
      return;
    }

    console.log('------------------------------------------------------');
    console.log(`✗ DETECTED ${report.breakingChanges.length} BREAKING API CHANGE(S):\n`);

    for (let i = 0; i < report.breakingChanges.length; i++) {
      const issue = report.breakingChanges[i]!;
      console.log(`[BREAKING #${i + 1}] Rule: ${issue.rule}`);
      console.log(`  Endpoint: ${issue.method} ${issue.path}`);
      if (issue.field) {
        console.log(`  Field:    ${issue.field}`);
      }
      console.log(`  Detail:   ${issue.message}\n`);
    }

    console.log('------------------------------------------------------');
    throw new Error(
      `OpenAPI breaking change check failed with ${report.breakingChanges.length} breaking issue(s).`,
    );
  }

  /** Đọc giá trị của cờ dòng lệnh (ví dụ `--out path/to/file.json`) */
  private extractFlagValue(args: string[], flagName: string): string | undefined {
    const idx = args.indexOf(flagName);
    if (idx >= 0 && idx + 1 < args.length) {
      return args[idx + 1];
    }
    return undefined;
  }
}
