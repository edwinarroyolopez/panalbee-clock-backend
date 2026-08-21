import { IsString, Length } from 'class-validator';

export class UpdateLocationDto {
  @IsString()
  @Length(2, 120)
  name!: string;
}
