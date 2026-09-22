import {
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpException,
    HttpStatus,
    Post,
    Query,
    Req,
    Res,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import { TencentMeetingService } from './tencent-meeting.service';
import { TencentMeetingAuthorizationResult, TencentMeetingConnectionResult } from './tencent-meeting.types';

@ApiTags('TencentMeeting')
@Controller('connectors/tencent-meeting')
export class TencentMeetingController {
    constructor(private readonly service: TencentMeetingService) { }

    @Post('authorization')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard, TenantGuard)
    @UseInterceptors(TenantContextInterceptor)
    @ApiOkResponse({ description: '腾讯会议授权地址已创建' })
    startAuthorization(): Promise<TencentMeetingAuthorizationResult> {
        return this.service.startAuthorization();
    }

    @Get('oauth/callback')
    async completeAuthorization(
        @Query() query: Record<string, unknown>,
        @Req() request: Request,
        @Res() response: Response,
    ): Promise<void> {
        const requestId = headerValue(request.headers['x-request-id']) || 'oauth-callback';
        try {
            const result = await this.service.completeAuthorization({
                state: queryString(query.state) ?? '',
                authCode: queryString(query.auth_code) ?? undefined,
                legacyCode: queryString(query.code) ?? undefined,
                error: queryString(query.error) ?? undefined,
                errorDescription: queryString(query.error_description) ?? undefined,
            }, requestId);
            response.status(HttpStatus.OK).type('html').send(callbackHtml(result.title, result.message, true));
        } catch (error) {
            const status = error instanceof HttpException ? error.getStatus() : HttpStatus.BAD_GATEWAY;
            response.status(status).type('html').send(callbackHtml('腾讯会议连接失败', callbackMessage(error), false));
        }
    }

    @Get('status')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard, TenantGuard)
    @UseInterceptors(TenantContextInterceptor)
    @ApiOkResponse({ description: '当前成员的腾讯会议连接状态' })
    getStatus(): Promise<TencentMeetingConnectionResult> {
        return this.service.getStatus();
    }

    @Delete('authorization')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard, TenantGuard)
    @UseInterceptors(TenantContextInterceptor)
    @ApiNoContentResponse({ description: '腾讯会议本地授权已清除' })
    disconnect(): Promise<void> {
        return this.service.disconnect();
    }
}

function callbackHtml(title: string, message: string, success: boolean): string {
    const safeTitle = escapeHtml(title);
    const safeMessage = escapeHtml(message);
    const color = success ? '#16a34a' : '#dc2626';
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title></head><body style="margin:0;font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a"><main style="max-width:520px;margin:12vh auto;padding:32px;background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(15,23,42,.12)"><div style="width:12px;height:12px;border-radius:50%;background:${color};margin-bottom:20px"></div><h1 style="font-size:24px;margin:0 0 12px">${safeTitle}</h1><p style="line-height:1.7;margin:0">${safeMessage}</p></main></body></html>`;
}

function callbackMessage(error: unknown): string {
    if (!(error instanceof HttpException)) return '腾讯会议服务暂时不可用，请稍后重试。';
    const payload = error.getResponse();
    if (typeof payload === 'object' && payload !== null && typeof (payload as { message?: unknown }).message === 'string') {
        return (payload as { message: string }).message;
    }
    return '授权未完成，请返回 CEES 后重试。';
}

function headerValue(value: string | string[] | undefined): string | null {
    const candidate = Array.isArray(value) ? value[0] : value;
    return candidate?.trim() || null;
}

function queryString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
    })[character]!);
}
