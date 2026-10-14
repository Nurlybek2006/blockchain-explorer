import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isBodyParserError(exception: unknown): boolean {
  return isRecord(exception) && ['entity.parse.failed', 'entity.too.large', 'encoding.unsupported'].includes(String(exception.type));
}

export function publicError(exception: unknown): { statusCode: number; message: string | string[]; error: string } {
  if (isRecord(exception) && exception.type === 'entity.parse.failed') {
    return { statusCode: 400, message: 'Malformed JSON body', error: 'Bad Request' };
  }
  if (isRecord(exception) && exception.type === 'entity.too.large') {
    return { statusCode: 413, message: 'Request body is too large', error: 'Payload Too Large' };
  }
  if (isRecord(exception) && exception.type === 'encoding.unsupported') {
    return { statusCode: 415, message: 'Content encoding is not supported', error: 'Unsupported Media Type' };
  }
  const statusCode = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
  if (statusCode >= 500) {
    const message = statusCode === 503 ? 'Service unavailable' : statusCode === 502 ? 'Upstream service unavailable' : 'Internal server error';
    return { statusCode, message, error: statusCode === 503 ? 'Service Unavailable' : statusCode === 502 ? 'Bad Gateway' : 'Internal Server Error' };
  }
  const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
  const message = isRecord(raw) ? raw.message : raw;
  const bounded = typeof message === 'string' ? message.slice(0, 512)
    : Array.isArray(message) && message.every((entry): entry is string => typeof entry === 'string')
      ? message.slice(0, 20).map((entry) => entry.slice(0, 512)) : 'Request rejected';
  const error = isRecord(raw) && typeof raw.error === 'string' ? raw.error.slice(0, 64) : 'Request rejected';
  return { statusCode, message: bounded, error };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const body = publicError(exception);
    if (body.statusCode >= 500) {
      // The structured telemetry logger sanitizes exceptions; no payload/headers/URL enter logs here.
      this.logger.error('HTTP request failed', exception instanceof Error ? exception.stack : undefined);
    }
    const response = host.switchToHttp().getResponse<Response>();
    if (!response.headersSent) response.status(body.statusCode).json(body);
  }
}
