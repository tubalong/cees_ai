import { Injectable } from '@nestjs/common';
import type { ToolDefinition } from './tool.types';
import { ToolRegistryService } from './tool-registry';

export type ToolRejectionCode = 'UNKNOWN_TOOL' | 'PERMISSION_DENIED' | 'INVALID_ARGUMENTS';

/**
 * 工具审批拒绝错误。
 *
 * - `message` 会进入公开事件的 error 字段并原样展示给最终用户（桌面端「本次操作未完成」告警的
 *   说明行），因此必须使用中文可读措辞，不得出现英文变量名、开关名或原始堆栈；工具/权限标识
 *   可以保留在括号或句尾，用于日志与工单定位。
 * - `userFacingSummary` 是回喂模型的固定友好文案，不携带权限码、错误码等内部信息，
 *   保证模型输出（含用户诱导场景）不可能泄露系统内部细节。
 */
export class ToolPolicyError extends Error {
  constructor(
    public readonly code: ToolRejectionCode,
    message: string,
    public readonly userFacingSummary: string,
    public readonly permissionCodes: string[] = [],
  ) {
    super(message);
    this.name = 'ToolPolicyError';
  }
}

export interface ToolApproval {
  definition: ToolDefinition;
  parsedArguments: Record<string, unknown>;
}

/**
 * 统一程序化批准：工具存在 → 权限 → 参数校验，全部通过才允许执行。
 * 这是"批准不可绕过"的唯一闸口，模型返回的工具调用只是建议。
 * 额度预占/结算钩子暂缓，接入计费体系后在本服务内补第二道检查。
 */
@Injectable()
export class ToolPolicyService {
  constructor(private readonly registry: ToolRegistryService) { }

  /** 执行前的第二点检查：状态可能已变化，给模型工具列表时通过不代表现在仍可执行。 */
  approve(input: {
    name: string;
    arguments: unknown;
    permissions: string[];
  }): ToolApproval {
    const definition = this.registry.get(input.name);
    if (!definition) {
      throw new ToolPolicyError(
        'UNKNOWN_TOOL',
        `工具不存在或未启用：${input.name}`,
        '该操作暂不可用，请告知用户稍后重试或换一种方式表达',
      );
    }
    const denied = definition.requiredPermissions.filter((code) => !input.permissions.includes(code));
    if (denied.length > 0) {
      const displayNames = denied
        .map((code) => {
          const tool = this.registry.getByPermission(code);
          return tool ? `「${tool.displayName}」` : '「该功能」';
        });
      throw new ToolPolicyError(
        'PERMISSION_DENIED',
        `缺少工具权限：${denied.join('、')}`,
        `该操作需要 ${displayNames.join('、')} 权限，用户当前没有此权限。请告知用户：请联系租户管理员，在角色管理中为你的角色开通相应功能权限后重试。`,
        denied,
      );
    }
    try {
      return { definition, parsedArguments: definition.validate(input.arguments) };
    } catch (error) {
      throw new ToolPolicyError(
        'INVALID_ARGUMENTS',
        error instanceof Error ? error.message : '工具参数非法',
        '该操作未完成，请告知用户调整表述后重试',
      );
    }
  }
}
