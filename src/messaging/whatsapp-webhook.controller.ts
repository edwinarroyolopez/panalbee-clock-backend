import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/auth.decorators';
import { AppException } from '../common/app-exception';
import { WhatsAppChallengeDto } from './messaging.dto';
import {
  WebhookProcessingSummary,
  WhatsAppWebhookService,
} from './whatsapp-webhook.service';

@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(private readonly webhook: WhatsAppWebhookService) {}

  @Public()
  @Get()
  verify(@Query() query: WhatsAppChallengeDto): string {
    return this.webhook.verify(
      query['hub.mode'],
      query['hub.verify_token'],
      query['hub.challenge'],
    );
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() payload: unknown,
  ): Promise<WebhookProcessingSummary> {
    if (!request.rawBody) {
      throw new AppException(
        500,
        'WEBHOOK_RAW_BODY_UNAVAILABLE',
        'Webhook raw body is unavailable',
      );
    }
    return this.webhook.receive(request.rawBody, signature, payload);
  }
}
