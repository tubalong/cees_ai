import { Injectable, Logger } from '@nestjs/common';

/**
 * 任务执行器（骨架）：计划确认后驱动「取就绪步骤 → 组装派发书 → 同事执行窗口
 * → 摘要回流」的调度循环，以及租约心跳、失败阶梯与重编排。
 *
 * M1 只提供入口与状态承诺：确认后的任务停留在 RUNNING（步骤按依赖初始化为
 * READY/PENDING），不产生任何派发，也不消耗任何额度；M2 实装执行窗口，
 * M3 实装步骤级挂起与重编排。调度循环将使用任务级租约
 * （executionOwner / leaseExpiresAt / heartbeatAt），多实例部署下同一任务
 * 只有一个执行者（与轮次租约同构）。
 */
@Injectable()
export class TaskRunnerService {
  private readonly logger = new Logger(TaskRunnerService.name);

  /** 计划确认后的调度入口；由 TaskService 在 PLAN_CONFIRMED 提交后调用。 */
  async startTask(taskId: string): Promise<void> {
    this.logger.log(`task ${taskId} plan confirmed; scheduler lands in M2`);
  }
}
