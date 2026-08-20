import { ValidationPipe } from '@nestjs/common';
import type { INestApplication, ValidationError } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from './app-exception';
import { APPOINTMENT_MANAGEMENT_TOKEN_HEADER } from './http-headers';
import { GlobalHttpExceptionFilter } from './http-exception.filter';
import { requestIdMiddleware } from './request-id.middleware';
import type { Environment } from '../config/environment';

interface ValidationIssue {
  field: string;
  messages: string[];
}

function validationIssues(
  errors: ValidationError[],
  parent = '',
): ValidationIssue[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const current = error.constraints
      ? [{ field, messages: Object.values(error.constraints) }]
      : [];
    return [...current, ...validationIssues(error.children ?? [], field)];
  });
}

export function configureApplication(app: INestApplication): void {
  const config = app.get(ConfigService<Environment, true>);
  const allowedOrigins = config.get('CORS_ORIGINS', { infer: true });

  app.setGlobalPrefix('api/v1');
  app.use(requestIdMiddleware);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new AppException(
          400,
          'VALIDATION_FAILED',
          'Request validation failed',
          validationIssues(errors),
        ),
    }),
  );
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ): void => callback(null, !origin || allowedOrigins.includes(origin)),
    credentials: true,
    allowedHeaders: [
      'authorization',
      'content-type',
      'x-request-id',
      APPOINTMENT_MANAGEMENT_TOKEN_HEADER,
    ],
    exposedHeaders: ['x-request-id'],
  });
  app.enableShutdownHooks();
}
