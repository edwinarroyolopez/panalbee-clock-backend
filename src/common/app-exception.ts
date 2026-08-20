import { HttpException } from '@nestjs/common';

export class AppException extends HttpException {
  constructor(
    public readonly statusCode: number,
    public readonly reasonCode: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message, statusCode);
  }
}
