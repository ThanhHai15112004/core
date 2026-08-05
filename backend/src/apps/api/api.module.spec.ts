import { describe, beforeEach, it, expect } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ApiModule } from './api.module.js';

describe('ApiModule', () => {
  let apiModule: ApiModule;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ApiModule],
    }).compile();

    apiModule = module.get<ApiModule>(ApiModule);
  });

  it('should be defined', () => {
    expect(apiModule).toBeDefined();
  });
});
