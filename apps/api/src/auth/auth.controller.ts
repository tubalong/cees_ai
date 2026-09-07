import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { AuthService, LoginResult } from './auth.service';
import { AuthenticatedPrincipal, AuthTokenPair, MeResult } from './auth.types';
import { LoginDto, RefreshTokenDto } from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';

type AuthenticatedRequest = Request & { user: AuthenticatedPrincipal };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('login')
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ description: '登录成功' })
    @ApiUnauthorizedResponse({ description: '账号或密码错误' })
    async login(@Body() input: LoginDto, @Req() request: Request): Promise<LoginResult> {
        return this.authService.login(input, getRequestMetadata(request));
    }

    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ description: '令牌轮换成功' })
    @ApiUnauthorizedResponse({ description: 'Refresh Token 无效、过期或已被使用' })
    async refresh(@Body() input: RefreshTokenDto, @Req() request: Request): Promise<AuthTokenPair> {
        return this.authService.refresh(input, getRequestMetadata(request));
    }

    @Post('logout')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '当前会话已撤销' })
    @ApiUnauthorizedResponse({ description: '登录状态无效或已过期' })
    async logout(@Req() request: AuthenticatedRequest): Promise<void> {
        await this.authService.logout(request.user, getRequestMetadata(request));
    }

    @Get('me')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOkResponse({ description: '当前用户、租户、角色和权限' })
    @ApiUnauthorizedResponse({ description: '登录状态无效或已过期' })
    me(@Req() request: AuthenticatedRequest): MeResult {
        return this.authService.me(request.user);
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
