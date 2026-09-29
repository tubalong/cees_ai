import { BadGatewayException } from '@nestjs/common';
import type { ChatToolDefinition } from '@cees/ai-service-client';

/**
 * ai-service 对模型工具定义有硬约束，越界会被 FastAPI 请求校验直接拦成 422
 * （见 apps/ai-service/app/api/generated/models.py 的 ChatToolDefinition）：
 * - name 必须匹配 ^[A-Za-z][A-Za-z0-9_-]*$ 且不超过 128 字符，因此连接器内部带点号的 toolId
 *   （例如腾讯会议官方 CLI 的 meeting.list）不能直接当作模型工具名；
 * - description 最长 2048 字符。
 * 所有连接器 planner 统一通过这里生成定义，避免再出现「本地工具名不合法导致整轮规划 422」。
 */
export const MODEL_TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
export const MODEL_TOOL_NAME_MAX_LENGTH = 128;
export const MODEL_TOOL_DESCRIPTION_MAX_LENGTH = 2048;

const MODEL_TOOL_NAMESPACE_PATTERN = /^[a-z][a-z0-9_]*$/;

export interface ConnectorModelToolInput<TTool> {
  tool: TTool;
  /** 面向模型的描述，允许包含连接器内部 toolId 与风险标记；超长会按契约上限截断。 */
  description: string;
}

export interface ConnectorModelToolDefinitions<TTool> {
  definitions: ChatToolDefinition[];
  /** 模型工具名到连接器工具的映射；规划结果必须用它回映射成内部 toolId。 */
  modelToolMap: Map<string, TTool>;
}

export function buildConnectorModelToolDefinitions<TTool extends { parameters: Record<string, unknown> }>(
  namespace: string,
  items: readonly ConnectorModelToolInput<TTool>[],
): ConnectorModelToolDefinitions<TTool> {
  if (!MODEL_TOOL_NAMESPACE_PATTERN.test(namespace)) {
    throw new Error(`连接器模型工具命名空间无效：${namespace}`);
  }
  const definitions: ChatToolDefinition[] = [];
  const modelToolMap = new Map<string, TTool>();
  items.forEach((item, index) => {
    const name = `${namespace}_tool_${index + 1}`;
    if (name.length > MODEL_TOOL_NAME_MAX_LENGTH || !MODEL_TOOL_NAME_PATTERN.test(name)) {
      throw new Error(`连接器模型工具名无效：${name}`);
    }
    modelToolMap.set(name, item.tool);
    definitions.push({
      name,
      description: clampModelToolDescription(item.description),
      parameters: item.tool.parameters,
    });
  });
  return { definitions, modelToolMap };
}

export function clampModelToolDescription(value: string): string {
  const description = value.trim();
  if (!description) throw new BadGatewayException('连接器模型工具描述为空');
  return description.slice(0, MODEL_TOOL_DESCRIPTION_MAX_LENGTH);
}
