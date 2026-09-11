import { Injectable } from '@nestjs/common';
import type { ToolDefinition } from './tool.types';
import { ToolRegistryService } from './tool-registry';

export type ToolRejectionCode = 'UNKNOWN_TOOL' | 'PERMISSION_DENIED' | 'INVALID_ARGUMENTS';

export class ToolPolicyError extends Error {
  constructor(
    public readonly code: ToolRejectionCode,
    message: string,
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
  constructor(private readonly registry: ToolRegistryService) {}

  /** 执行前的第二点检查：状态可能已变化，给模型工具列表时通过不代表现在仍可执行。 */
  approve(input: {
    name: string;
    arguments: unknown;
    permissions: string[];
  }): ToolApproval {
    const definition = this.registry.get(input.name);
    if (!definition) {
      throw new ToolPolicyError('UNKNOWN_TOOL', `工具不存在或未启用：${input.name}`);
    }
    const denied = definition.requiredPermissions.filter((code) => !input.permissions.includes(code));
    if (denied.length > 0) {
      throw new ToolPolicyError('PERMISSION_DENIED', `缺少工具权限：${denied.join('、')}`);
    }
    try {
      return { definition, parsedArguments: definition.validate(input.arguments) };
    } catch (error) {
      throw new ToolPolicyError(
        'INVALID_ARGUMENTS',
        error instanceof Error ? error.message : '工具参数非法',
      );
    }
  }
}
