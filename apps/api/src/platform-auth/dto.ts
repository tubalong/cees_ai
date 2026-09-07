import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ACCOUNT_MAX_LENGTH, ACCOUNT_MIN_LENGTH, ACCOUNT_PATTERN } from '../auth/account';

export class PlatformLoginDto {
    @ApiProperty({ example: 'superadmin' })
    @IsString()
    @MinLength(ACCOUNT_MIN_LENGTH)
    @MaxLength(ACCOUNT_MAX_LENGTH)
    @Matches(ACCOUNT_PATTERN)
    account!: string;

    @ApiProperty({ format: 'password', minLength: 8, maxLength: 128 })
    @IsString()
    @MinLength(8)
    @MaxLength(128)
    password!: string;

    @ApiPropertyOptional({ example: 'Platform Console' })
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    deviceName?: string;
}

export class PlatformRefreshTokenDto {
    @ApiProperty({ description: '平台管理员登录或上次刷新返回的 Refresh Token' })
    @IsString()
    @MinLength(32)
    @MaxLength(512)
    refreshToken!: string;
}
