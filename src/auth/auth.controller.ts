import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { Authenticated, CurrentAuth, Public } from './auth.decorators';
import { ExchangeDelegatedSessionDto, LoginDto } from './auth.dto';
import { AuthService } from './auth.service';
import type { LoginResult } from './auth.service';
import type { AuthContext, AuthenticatedRequest } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.auth.login(dto);
  }

  @Public()
  @Post('delegated-sessions/exchange')
  @HttpCode(HttpStatus.OK)
  exchangeDelegated(
    @Body() dto: ExchangeDelegatedSessionDto,
  ): Promise<LoginResult> {
    return this.auth.exchangeDelegated(dto.exchangeCode);
  }

  @Authenticated()
  @Post('delegated-sessions/end')
  @HttpCode(HttpStatus.OK)
  endDelegated(
    @CurrentAuth() auth: AuthContext,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; status: string; expiresAt: Date }> {
    return this.auth.endDelegated(auth, request.requestId);
  }

  @Authenticated()
  @Get('me')
  me(@CurrentAuth() auth: AuthContext): AuthContext {
    return auth;
  }
}
