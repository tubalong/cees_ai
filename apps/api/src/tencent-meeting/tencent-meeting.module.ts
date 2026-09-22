import { Module } from '@nestjs/common';
import { TencentMeetingClient } from './tencent-meeting.client';
import { TencentMeetingConfig } from './tencent-meeting.config';
import { TencentMeetingController } from './tencent-meeting.controller';
import { TencentMeetingCredentialCipher } from './tencent-meeting-credential-cipher';
import { TencentMeetingService } from './tencent-meeting.service';

@Module({
    controllers: [TencentMeetingController],
    providers: [TencentMeetingClient, TencentMeetingConfig, TencentMeetingCredentialCipher, TencentMeetingService],
    exports: [TencentMeetingService],
})
export class TencentMeetingModule { }
