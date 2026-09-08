import { Body, Controller, Get, Patch, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import { UpdateUserProfileDto } from './dto';
import { UserService } from './user.service';
import { UserProfileResult } from './user.types';

@ApiTags('user')
@ApiBearerAuth()
@Controller('users/me/profile')
@UseGuards(JwtAuthGuard, TenantGuard)
@UseInterceptors(TenantContextInterceptor)
export class UserController {
    constructor(private readonly userService: UserService) { }

    @Get()
    @ApiOkResponse({ description: '当前租户内的个人资料' })
    @ApiUnauthorizedResponse({ description: '登录状态无效或已过期' })
    getCurrentProfile(): Promise<UserProfileResult> {
        return this.userService.getCurrentProfile();
    }

    @Patch()
    @ApiOkResponse({ description: '修改后的个人资料' })
    @ApiUnauthorizedResponse({ description: '登录状态无效或已过期' })
    updateCurrentProfile(@Body() input: UpdateUserProfileDto): Promise<UserProfileResult> {
        return this.userService.updateCurrentProfile(input);
    }
}
