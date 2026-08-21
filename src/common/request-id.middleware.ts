import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export interface RequestWithId extends Request {
  requestId: string;
}

export function requestIdMiddleware(
  request: RequestWithId,
  response: Response,
  next: NextFunction,
): void {
  const supplied = request.get('x-request-id');
  request.requestId =
    supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
  response.setHeader('x-request-id', request.requestId);
  next();
}
