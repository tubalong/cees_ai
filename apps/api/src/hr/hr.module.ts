import { Module } from '@nestjs/common';
import { HrController } from './hr.controller';
import { HrAvailabilityService } from './hr-availability.service';
import { HrService } from './hr.service';

@Module({
    controllers: [HrController],
    providers: [HrService, HrAvailabilityService],
    exports: [HrService, HrAvailabilityService],
})
export class HrModule { }
