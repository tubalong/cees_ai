import { Injectable, Logger } from '@nestjs/common';
import type { ChatToolDefinition } from '@cees/ai-service-client';
import { toChatToolDefinition, type ToolDefinition } from './tool.types';

/**
 * 统一工具注册表：所有 AI 工具必须注册到这里，按工具名分发执行。
 * 给模型的工具列表也由本注册表按权限过滤产生，禁止任何模块绕过注册表
 * 直接暴露或调用工具。
 */
@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly tools = new Map<string, ToolDefinition>();

  /** 注册一个工具定义；同名重复注册直接抛错，避免静默覆盖。 */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    this.logger.log(`registered ai tool: ${tool.name} v${tool.version}`);
  }

  /** 按工具名取定义；未注册返回 undefined。 */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** 按权限码查工具定义；用于把权限码翻译成用户可理解的功能名。 */
  getByPermission(permissionCode: string): ToolDefinition | undefined {
    return [...this.tools.values()].find((tool) => tool.requiredPermissions.includes(permissionCode));
  }

  /** 是否有任何工具注册；决定 TurnRunner 走纯文本还是工具轮次。 */
  hasAny(): boolean {
    return this.tools.size > 0;
  }

  /** 给模型前的第一点检查：只暴露当前权限允许的工具定义。 */
  listAllowed(permissions: string[]): ChatToolDefinition[] {
    return [...this.tools.values()]
      .filter((tool) => tool.requiredPermissions.every((code) => permissions.includes(code)))
      .map(toChatToolDefinition);
  }
}
