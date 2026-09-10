import {
    Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe,
    Patch, Post, Put, Query, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermissions } from '../rbac/permission.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import {
    AddMeetingParticipantDto, CreateMeetingDto, ListMeetingsQueryDto, MeetingTransitionDto,
    MeetingVersionDto, RespondMeetingParticipantDto, UpdateMeetingDto,
    UpdateMeetingParticipantDto, UpsertMeetingMinutesDto,
} from './dto';
import { MeetingService } from './meeting.service';
import {
    MeetingListResult, MeetingMinutesResult, MeetingParticipantListResult,
    MeetingParticipantResult, MeetingResult,
} from './meeting.types';

@ApiTags('meeting')
@ApiBearerAuth()
@Controller('meetings')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class MeetingController {
    constructor(private readonly meetingService: MeetingService) { }

    @Get()
    @RequirePermissions('meeting.read')
    @ApiOkResponse({ description: '当前成员可见会议列表' })
    listMeetings(@Query() query: ListMeetingsQueryDto): Promise<MeetingListResult> {
        return this.meetingService.listMeetings(query);
    }

    @Post()
    @RequirePermissions('meeting.create')
    @ApiCreatedResponse({ description: '会议草稿已创建' })
    createMeeting(@Body() input: CreateMeetingDto): Promise<MeetingResult> {
        return this.meetingService.createMeeting(input);
    }

    @Get(':meetingId')
    @RequirePermissions('meeting.read')
    @ApiOkResponse({ description: '会议详情' })
    getMeeting(@Param('meetingId', new ParseUUIDPipe()) meetingId: string): Promise<MeetingResult> {
        return this.meetingService.getMeeting(meetingId);
    }

    @Patch(':meetingId')
    @RequirePermissions('meeting.update')
    @ApiOkResponse({ description: '会议资料已修改' })
    updateMeeting(
        @Param('meetingId', new ParseUUIDPipe()) meetingId: string,
        @Body() input: UpdateMeetingDto,
    ): Promise<MeetingResult> {
        return this.meetingService.updateMeeting(meetingId, input);
    }

    @Delete(':meetingId')
    @RequirePermissions('meeting.delete')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '会议草稿已软删除' })
    deleteMeeting(
        @Param('meetingId', new ParseUUIDPipe()) meetingId: string,
        @Query() query: MeetingVersionDto,
    ): Promise<void> {
        return this.meetingService.deleteMeeting(meetingId, query.version);
    }

    @Post(':meetingId/transitions')
    @RequirePermissions('meeting.status.update')
    @ApiOkResponse({ description: '会议状态已变更' })
    transitionMeeting(
        @Param('meetingId', new ParseUUIDPipe()) meetingId: string,
        @Body() input: MeetingTransitionDto,
    ): Promise<MeetingResult> {
        return this.meetingService.transitionMeeting(meetingId, input);
    }

    @Get(':meetingId/participants')
    @RequirePermissions('meeting.read')
    @ApiOkResponse({ description: '会议参会人列表' })
    listParticipants(
        @Param('meetingId', new ParseUUIDPipe()) meetingId: string,
    ): Promise<MeetingParticipantListResult> {
        return this.meetingService.listParticipants(meetingId);
    }

    @Post(':meetingId/participants')
    @RequirePermissions('meeting.participant.manage')
    @ApiCreatedResponse({ description: '会议参会人已添加' })
    addParticipant(
        @Param('meetingId', new ParseUUIDPipe()) meetingId: string,
        @Body() input: AddMeetingParticipantDto,
    ): Promise<MeetingParticipantResult> {
        return this.meetingService.addParticipant(meetingId, input);
    }

    @Patch(':meetingId/participants/me/response')
    @RequirePermissions('meeting.read')
    @ApiOkResponse({ description: '会议邀请应答已修改' })
    respondToInvitation(
        @Param('meetingId', new ParseUUIDPipe()) meetingId: string,
        @Body() input: RespondMeetingParticipantDto,
    ): Promise<MeetingParticipantResult> {
        return this.meetingService.respondToInvitation(meetingId, input);
    }

    @Patch(':meetingId/participants/:membershipId')
    @RequirePermissions('meeting.participant.manage')
    @ApiOkResponse({ description: '会议参会人已修改' })
    updateParticipant(
        @Param('meetingId', new ParseUUIDPipe()) meetingId: string,
        @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
        @Body() input: UpdateMeetingParticipantDto,
    ): Promise<MeetingParticipantResult> {
        return this.meetingService.updateParticipant(meetingId, membershipId, input);
    }

    @Delete(':meetingId/participants/:membershipId')
    @RequirePermissions('meeting.participant.manage')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '会议参会人已移除' })
    removeParticipant(
        @Param('meetingId', new ParseUUIDPipe()) meetingId: string,
        @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
        @Query() query: MeetingVersionDto,
    ): Promise<void> {
        return this.meetingService.removeParticipant(meetingId, membershipId, query.version);
    }

    @Get(':meetingId/minutes')
    @RequirePermissions('meeting.read')
    @ApiOkResponse({ description: '会议纪要' })
    getMinutes(
        @Param('meetingId', new ParseUUIDPipe()) meetingId: string,
    ): Promise<MeetingMinutesResult | null> {
        return this.meetingService.getMinutes(meetingId);
    }

    @Put(':meetingId/minutes')
    @RequirePermissions('meeting.minutes.manage')
    @ApiOkResponse({ description: '会议纪要草稿已保存' })
    upsertMinutes(
        @Param('meetingId', new ParseUUIDPipe()) meetingId: string,
        @Body() input: UpsertMeetingMinutesDto,
    ): Promise<MeetingMinutesResult> {
        return this.meetingService.upsertMinutes(meetingId, input);
    }

    @Post(':meetingId/minutes/publish')
    @RequirePermissions('meeting.minutes.manage')
    @ApiOkResponse({ description: '会议纪要已发布' })
    publishMinutes(
        @Param('meetingId', new ParseUUIDPipe()) meetingId: string,
        @Body() input: MeetingVersionDto,
    ): Promise<MeetingMinutesResult> {
        return this.meetingService.publishMinutes(meetingId, input.version);
    }

    @Post(':meetingId/minutes/reopen')
    @RequirePermissions('meeting.minutes.manage')
    @ApiOkResponse({ description: '会议纪要已重新打开' })
    reopenMinutes(
        @Param('meetingId', new ParseUUIDPipe()) meetingId: string,
        @Body() input: MeetingVersionDto,
    ): Promise<MeetingMinutesResult> {
        return this.meetingService.reopenMinutes(meetingId, input.version);
    }
}
