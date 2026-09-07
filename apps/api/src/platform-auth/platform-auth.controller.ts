import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { PlatformLoginDto, PlatformRefreshTokenDto } from './dto';
import { PlatformAuthService } from './platform-auth.service';
import {
    PlatformAuthenticatedPrincipal,
    PlatformAuthTokenPair,
    PlatformLoginResult,
    PlatformMeResult,
} from './platform-auth.types';
import { PlatformJwtAuthGuard } from './platform-jwt-auth.guard';

type PlatformAuthenticatedRequest = Request & { user: PlatformAuthenticatedPrincipal };

@ApiTags('platform-auth')
@Controller('platform/auth')
export class PlatformAuthController {
    constructor(private readonly platformAuthService: PlatformAuthService) { }

    @Post('login')
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ description: '平台管理员登录成功' })
    @ApiUnauthorizedResponse({ description: '账号或密码错误' })
    login(@Body() input: PlatformLoginDto, @Req() request: Request): Promise<PlatformLoginResult> {
        return this.platformAuthService.login(input, getRequestMetadata(request));
    }

    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ description: '平台管理员令牌轮换成功' })
    @ApiUnauthorizedResponse({ description: '平台 Refresh Token 无效、过期或已使用' })
    refresh(@Body() input: PlatformRefreshTokenDto, @Req() request: Request): Promise<PlatformAuthTokenPair> {
        return this.platformAuthService.refresh(input, getRequestMetadata(request));
    }

    @Post('logout')
    @UseGuards(PlatformJwtAuthGuard)
    @ApiBearerAuth('platformBearerAuth')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '当前平台管理员会话已撤销' })
    logout(@Req() request: PlatformAuthenticatedRequest): Promise<void> {
        return this.platformAuthService.logout(request.user, getRequestMetadata(request));
    }

    @Get('me')
    @UseGuards(PlatformJwtAuthGuard)
    @ApiBearerAuth('platformBearerAuth')
    @ApiOkResponse({ description: '当前平台管理员身份和权限' })
    me(@Req() request: PlatformAuthenticatedRequest): PlatformMeResult {
        return this.platformAuthService.me(request.user);
    }
}

function getRequestMetadata(request: Request): { requestId: string; ipAddress?: string; userAgent?: string } {
    return {
        requestId: getHeader(request, 'x-request-id') ?? randomUUID(),
        ipAddress: request.ip,
        userAgent: getHeader(request, 'user-agent'),
    };
}

function getHeader(request: Request, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
}
