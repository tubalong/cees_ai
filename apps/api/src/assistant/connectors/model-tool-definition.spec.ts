import {
  buildConnectorModelToolDefinitions,
  clampModelToolDescription,
  MODEL_TOOL_DESCRIPTION_MAX_LENGTH,
  MODEL_TOOL_NAME_PATTERN,
} from './model-tool-definition';

describe('buildConnectorModelToolDefinitions', () => {
  const tool = (toolId: string) => ({
    toolId,
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  });

  it('把带点号的连接器 toolId 重命名为符合 ai-service 契约的索引名', () => {
    const { definitions, modelToolMap } = buildConnectorModelToolDefinitions('tencent_meeting', [
      { tool: tool('meeting.list'), description: '查询会议' },
      { tool: tool('record.list'), description: '查询录制' },
    ]);

    expect(definitions.map((definition) => definition.name)).toEqual(['tencent_meeting_tool_1', 'tencent_meeting_tool_2']);
    definitions.forEach((definition) => expect(definition.name).toMatch(MODEL_TOOL_NAME_PATTERN));
    expect([...modelToolMap.keys()]).toEqual(['tencent_meeting_tool_1', 'tencent_meeting_tool_2']);
    expect(modelToolMap.get('tencent_meeting_tool_2')?.toolId).toBe('record.list');
  });

  it('拒绝会违反 ai-service 名称契约的内部 toolId 直连用法', () => {
    expect(MODEL_TOOL_NAME_PATTERN.test('meeting.list')).toBe(false);
    expect(MODEL_TOOL_NAME_PATTERN.test('tencent_meeting_tool_1')).toBe(true);
  });

  it('按契约上限截断过长的模型工具描述', () => {
    expect(clampModelToolDescription('x'.repeat(3000))).toHaveLength(MODEL_TOOL_DESCRIPTION_MAX_LENGTH);
    expect(clampModelToolDescription('  查询日程  ')).toBe('查询日程');
    expect(() => clampModelToolDescription('   ')).toThrow('连接器模型工具描述为空');
  });

  it('拒绝非法命名空间', () => {
    expect(() => buildConnectorModelToolDefinitions('Tencent-Meeting', [])).toThrow('连接器模型工具命名空间无效');
  });
});
