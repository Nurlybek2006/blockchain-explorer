import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host.js';
import { describe, expect, it } from 'vitest';
import { InternalServiceGuard } from './internal-service.guard.js';

const token = 'internal-service-token-with-32-random-bytes';
const context = (provided: string | string[] | undefined) => new ExecutionContextHost([{ headers: { 'x-internal-service-token': provided } }]);

describe('Portfolio internal service boundary', () => {
  const guard = new InternalServiceGuard(new ConfigService({ INTERNAL_SERVICE_TOKEN: token }));
  it.each([undefined, '', 'wrong', `${token}, ${token}`, [token], [token, 'wrong'], ['wrong', token]])('rejects missing, wrong or ambiguous token %j', (provided) => {
    expect(() => guard.canActivate(context(provided))).toThrow(UnauthorizedException);
  });
  it('accepts only one exact service token and ignores caller identity claims', () => {
    expect(guard.canActivate(context(token))).toBe(true);
    expect(() => guard.canActivate(context(`Bearer ${token}`))).toThrow(UnauthorizedException);
  });
});
