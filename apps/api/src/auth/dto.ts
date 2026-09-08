import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ACCOUNT_MAX_LENGTH, ACCOUNT_MIN_LENGTH, ACCOUNT_PATTERN } from './account';

export class LoginDto {
    @ApiProperty({ example: 'cees' })
    @IsString()
    @MinLength(2)
    @MaxLength(64)
    @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
    tenantCode!: string;

    @ApiProperty({ example: 'zhangsan' })
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

    @ApiPropertyOptional({ example: 'Windows Desktop' })
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    deviceName?: string;
}

export class RefreshTokenDto {
    @ApiProperty({ description: '登录或上次刷新返回的 Refresh Token' })
    @IsString()
    @MinLength(32)
    @MaxLength(512)
    refreshToken!: string;
}

export class ChangePasswordDto {
    @ApiProperty({ format: 'password', minLength: 8, maxLength: 128 })
    @IsString()
    @MinLength(8)
    @MaxLength(128)
    currentPassword!: string;

    @ApiProperty({ format: 'password', minLength: 8, maxLength: 128 })
    @IsString()
    @MinLength(8)
    @MaxLength(128)
    newPassword!: string;
}
