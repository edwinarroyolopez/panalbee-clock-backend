import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Authenticated, CurrentAuth, Public } from './auth.decorators';
import { LoginDto } from './auth.dto';
import { AuthService } from './auth.service';
import type { LoginResult } from './auth.service';
import type { AuthContext } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.auth.login(dto);
  }

  @Authenticated()
  @Get('me')
  me(@CurrentAuth() auth: AuthContext): AuthContext {
    return auth;
  }
}
