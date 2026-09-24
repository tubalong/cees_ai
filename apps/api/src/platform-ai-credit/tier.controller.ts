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
    CreateAICreditTierDto,
    UpdateAICreditTierDto,
} from './tier.dto';
import { AICreditTierService } from './tier.service';
import {
    AICreditTierListResult,
    AICreditTierResult,
} from './tier.types';

type PlatformRequest = Request & { user: PlatformAuthenticatedPrincipal };

@ApiTags('platform-ai-credit')
@ApiBearerAuth('platformBearerAuth')
@Controller('platform/ai-credit/tiers')
@UseGuards(PlatformJwtAuthGuard, PlatformPermissionGuard)
export class AICreditTierController {
    constructor(private readonly tierService: AICreditTierService) { }

    @Get()
    @RequirePlatformPermissions('platform.aiCredit.read')
    @ApiOkResponse({ description: '档位列表' })
    listTiers(): Promise<AICreditTierListResult> {
        return this.tierService.listTiers();
    }

    @Post()
    @RequirePlatformPermissions('platform.aiCredit.write')
    @ApiOkResponse({ description: '创建成功的档位' })
    createTier(
        @Body() input: CreateAICreditTierDto,
        @Req() request: PlatformRequest,
    ): Promise<AICreditTierResult> {
        return this.tierService.createTier(input, request.user, getRequestMetadata(request));
    }

    @Get(':tierId')
    @RequirePlatformPermissions('platform.aiCredit.read')
    @ApiOkResponse({ description: '档位详情' })
    getTier(
        @Param('tierId', new ParseUUIDPipe()) tierId: string,
    ): Promise<AICreditTierResult> {
        return this.tierService.getTier(tierId);
    }

    @Patch(':tierId')
    @RequirePlatformPermissions('platform.aiCredit.write')
    @ApiOkResponse({ description: '修改后的档位' })
    updateTier(
        @Param('tierId', new ParseUUIDPipe()) tierId: string,
        @Body() input: UpdateAICreditTierDto,
        @Req() request: PlatformRequest,
    ): Promise<AICreditTierResult> {
        return this.tierService.updateTier(tierId, input, request.user, getRequestMetadata(request));
    }

    @Delete(':tierId')
    @RequirePlatformPermissions('platform.aiCredit.write')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '已删除' })
    deleteTier(
        @Param('tierId', new ParseUUIDPipe()) tierId: string,
        @Req() request: PlatformRequest,
    ): Promise<void> {
        return this.tierService.deleteTier(tierId, request.user, getRequestMetadata(request));
    }
}
