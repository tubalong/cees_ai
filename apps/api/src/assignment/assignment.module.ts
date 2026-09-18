import { Module } from '@nestjs/common';
import { HrModule } from '../hr/hr.module';
import { AssignmentController } from './assignment.controller';
import { AssignmentService } from './assignment.service';

@Module({
    imports: [HrModule],
    controllers: [AssignmentController],
    providers: [AssignmentService],
    exports: [AssignmentService],
})
export class AssignmentModule { }
