import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateUserProfileDto {
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    displayName!: string;

    @IsInt()
    @Min(1)
    version!: number;
}
