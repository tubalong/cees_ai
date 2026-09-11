import { ToolPolicyError, ToolPolicyService } from './tool-policy.service';
import { ToolRegistryService } from './tool-registry';
import type { ToolDefinition } from './tool.types';

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
    return {
        name: 'generate_image',
        version: '1.0.0',
        description: '生成图片',
        parameters: { type: 'object', properties: {} },
        requiredPermissions: ['ai.image.generate'],
        riskLevel: 'EXTERNAL',
        validate: () => ({}),
        execute: jest.fn(),
        ...overrides,
    };
}

describe('ToolPolicyService', () => {
    let registry: ToolRegistryService;
    let policy: ToolPolicyService;

    beforeEach(() => {
        registry = new ToolRegistryService();
        policy = new ToolPolicyService(registry);
    });

    it('rejects unknown tools with UNKNOWN_TOOL', () => {
        expect(() =>
            policy.approve({ name: 'no_such_tool', arguments: {}, permissions: [] }),
        ).toThrow(expect.objectContaining({ code: 'UNKNOWN_TOOL' }) as unknown as Error);
    });

    it('rejects tools the caller lacks permission for with PERMISSION_DENIED', () => {
        registry.register(makeTool());
        expect(() =>
            policy.approve({ name: 'generate_image', arguments: {}, permissions: [] }),
        ).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }) as unknown as Error);
    });

    it('maps validation failures to INVALID_ARGUMENTS and keeps the parsed error message', () => {
        registry.register(makeTool({
            validate: () => {
                throw new Error('prompt 必须是非空字符串');
            },
        }));
        let caught: unknown;
        try {
            policy.approve({ name: 'generate_image', arguments: { prompt: '' }, permissions: ['ai.image.generate'] });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(ToolPolicyError);
        expect((caught as ToolPolicyError).code).toBe('INVALID_ARGUMENTS');
        expect((caught as ToolPolicyError).message).toContain('prompt 必须是非空字符串');
    });

    it('returns the parsed arguments when the tool passes every check', () => {
        const parsed = { prompt: '一只猫' };
        registry.register(makeTool({ validate: () => parsed }));
        const approval = policy.approve({
            name: 'generate_image',
            arguments: { prompt: ' 一只猫 ' },
            permissions: ['ai.image.generate'],
        });
        expect(approval.definition.name).toBe('generate_image');
        expect(approval.parsedArguments).toBe(parsed);
    });
});
