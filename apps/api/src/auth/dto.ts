import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
    @ApiProperty({ example: 'cees' })
    @IsString()
    @MinLength(2)
    @MaxLength(64)
    @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
    tenantCode!: string;

    @ApiProperty({ example: 'admin@example.com' })
    @IsEmail()
    @MaxLength(320)
    email!: string;

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
