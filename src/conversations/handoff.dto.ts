import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ReassignConversationDto {
  @IsUUID()
  assignedTo!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(500)
  reason!: string;
}

export class ReleaseConversationDto {
  @IsString()
  @MinLength(6)
  @MaxLength(500)
  reason!: string;
}
