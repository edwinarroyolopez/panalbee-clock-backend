import { IsString, MaxLength, MinLength } from 'class-validator';

export class SendConversationMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text!: string;
}

export class WhatsAppChallengeDto {
  @IsString()
  'hub.mode'!: string;

  @IsString()
  'hub.verify_token'!: string;

  @IsString()
  'hub.challenge'!: string;
}
