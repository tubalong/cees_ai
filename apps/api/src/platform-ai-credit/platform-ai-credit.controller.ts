import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PlatformAuthenticatedPrincipal } from '../platform-auth/platform-auth.types';
import { PlatformJwtAuthGuard } from '../platform-auth/platform-jwt-auth.guard';
import {
    PlatformPermissionGuard,
    RequirePlatformPermissions,
} from '../platform-auth/platform-permission.guard';
import { getRequestMetadata } from './request-metadata';
import {
    CreateAICreditCapabilityDto,
    UpdateAICreditCapabilityDto,
} from './dto';
import { AICreditCapabilityService } from './platform-ai-credit.service';
import {
    AICreditCapabilityListResult,
    AICreditCapabilityResult,
} from './platform-ai-credit.types';

type PlatformRequest = Request & { user: PlatformAuthenticatedPrincipal };

@ApiTags('platform-ai-credit')
@ApiBearerAuth('platformBearerAuth')
@Controller('platform/ai-credit/capabilities')
@UseGuards(PlatformJwtAuthGuard, PlatformPermissionGuard)
export class AICreditCapabilityController {
    constructor(private readonly capabilityService: AICreditCapabilityService) { }

    @Get()
    @RequirePlatformPermissions('platform.aiCredit.read')
    @ApiOkResponse({ description: '能力目录列表' })
    listCapabilities(): Promise<AICreditCapabilityListResult> {
        return this.capabilityService.listCapabilities();
    }

    @Post()
    @RequirePlatformPermissions('platform.aiCredit.write')
    @ApiOkResponse({ description: '创建成功的能力' })
    createCapability(
        @Body() input: CreateAICreditCapabilityDto,
        @Req() request: PlatformRequest,
    ): Promise<AICreditCapabilityResult> {
        return this.capabilityService.createCapability(input, request.user, getRequestMetadata(request));
    }

    @Get(':capabilityId')
    @RequirePlatformPermissions('platform.aiCredit.read')
    @ApiOkResponse({ description: '能力详情' })
    getCapability(
        @Param('capabilityId', new ParseUUIDPipe()) capabilityId: string,
    ): Promise<AICreditCapabilityResult> {
        return this.capabilityService.getCapability(capabilityId);
    }

    @Patch(':capabilityId')
    @RequirePlatformPermissions('platform.aiCredit.write')
    @ApiOkResponse({ description: '修改后的能力' })
    updateCapability(
        @Param('capabilityId', new ParseUUIDPipe()) capabilityId: string,
        @Body() input: UpdateAICreditCapabilityDto,
        @Req() request: PlatformRequest,
    ): Promise<AICreditCapabilityResult> {
        return this.capabilityService.updateCapability(capabilityId, input, request.user, getRequestMetadata(request));
    }

    @Delete(':capabilityId')
    @RequirePlatformPermissions('platform.aiCredit.write')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '已删除' })
    deleteCapability(
        @Param('capabilityId', new ParseUUIDPipe()) capabilityId: string,
        @Req() request: PlatformRequest,
    ): Promise<void> {
        return this.capabilityService.deleteCapability(capabilityId, request.user, getRequestMetadata(request));
    }
}
