import { Controller, Get, Param, ParseUUIDPipe, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermissions } from '../rbac/permission.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import { ImageService } from './image.service';
import { ImageResult } from './image.types';

@ApiTags('image')
@ApiBearerAuth()
@Controller('images')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class ImageController {
    constructor(private readonly imageService: ImageService) { }

    @Get(':imageId')
    @RequirePermissions('image.read')
    @ApiOkResponse({ description: '授权范围内图片访问信息' })
    getImage(@Param('imageId', new ParseUUIDPipe()) imageId: string): Promise<ImageResult> {
        return this.imageService.getImageAccess(imageId);
    }
}
