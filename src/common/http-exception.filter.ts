import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { AppException } from './app-exception';
import { RequestWithId } from './request-id.middleware';

const HTTP_ERRORS: Partial<Record<number, [string, string]>> = {
  [HttpStatus.BAD_REQUEST]: ['BAD_REQUEST', 'Request is invalid'],
  [HttpStatus.UNAUTHORIZED]: [
    'AUTHENTICATION_REQUIRED',
    'Authentication is required',
  ],
  [HttpStatus.FORBIDDEN]: ['FORBIDDEN', 'Access is denied'],
  [HttpStatus.NOT_FOUND]: ['NOT_FOUND', 'Resource not found'],
  [HttpStatus.PAYLOAD_TOO_LARGE]: [
    'PAYLOAD_TOO_LARGE',
    'Request payload is too large',
  ],
};

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();

    if (exception instanceof AppException) {
      response.status(exception.statusCode).json({
        statusCode: exception.statusCode,
        reasonCode: exception.reasonCode,
        message: exception.message,
        ...(exception.details === undefined
          ? {}
          : { details: exception.details }),
        requestId: request.requestId,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const [reasonCode, message] = HTTP_ERRORS[statusCode] ?? [
        'HTTP_ERROR',
        'Request could not be completed',
      ];
      response.status(statusCode).json({
        statusCode,
        reasonCode,
        message,
        requestId: request.requestId,
      });
      return;
    }

    const middlewareStatus = this.middlewareStatus(exception);
    if (middlewareStatus) {
      const [reasonCode, message] = HTTP_ERRORS[middlewareStatus] ?? [
        'HTTP_ERROR',
        'Request could not be completed',
      ];
      response.status(middlewareStatus).json({
        statusCode: middlewareStatus,
        reasonCode,
        message,
        requestId: request.requestId,
      });
      return;
    }

    console.error('[UNHANDLED_REQUEST_ERROR]', request.requestId);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      reasonCode: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId: request.requestId,
    });
  }

  private middlewareStatus(exception: unknown): number | undefined {
    if (!exception || typeof exception !== 'object') return undefined;
    const status = (exception as { status?: unknown }).status;
    return typeof status === 'number' && status >= 400 && status <= 599
      ? status
      : undefined;
  }
}
