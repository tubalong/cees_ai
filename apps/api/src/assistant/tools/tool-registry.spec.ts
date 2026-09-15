import { ToolRegistryService } from './tool-registry';
import type { ToolDefinition } from './tool.types';

function makeTool(name: string, requiredPermissions: string[]): ToolDefinition {
    return {
        name,
        version: '1.0.0',
        displayName: `工具 ${name}`,
        description: `工具 ${name}`,
        parameters: { type: 'object', properties: {} },
        requiredPermissions,
        riskLevel: 'READ',
        validate: () => ({}),
        execute: jest.fn(),
    };
}

describe('ToolRegistryService', () => {
    let registry: ToolRegistryService;

    beforeEach(() => {
        registry = new ToolRegistryService();
    });

    it('registers a tool and rejects duplicate names', () => {
        const tool = makeTool('generate_image', ['ai.image.generate']);
        registry.register(tool);
        expect(registry.get('generate_image')).toBe(tool);
        expect(() => registry.register(makeTool('generate_image', []))).toThrow('already registered');
    });

    it('hasAny reflects whether any tool is registered', () => {
        expect(registry.hasAny()).toBe(false);
        registry.register(makeTool('generate_image', ['ai.image.generate']));
        expect(registry.hasAny()).toBe(true);
    });

    it('listAllowed only exposes tools whose permissions are all granted', () => {
        registry.register(makeTool('generate_image', ['ai.image.generate']));
        registry.register(makeTool('read_calendar', ['calendar.read']));
        registry.register(makeTool('dual_tool', ['a.read', 'b.write']));

        const allowed = registry.listAllowed(['ai.image.generate', 'calendar.read', 'a.read']);

        expect(allowed.map((tool) => tool.name)).toEqual(['generate_image', 'read_calendar']);
        for (const tool of allowed) {
            expect(tool).toEqual(expect.objectContaining({ name: expect.any(String), description: expect.any(String), parameters: expect.any(Object) }));
        }
    });

    it('resolves a tool display name by permission code', () => {
        registry.register(makeTool('generate_image', ['ai.image.generate']));
        registry.register(makeTool('generate_document', ['ai.document.generate']));

        expect(registry.getByPermission('ai.image.generate')?.displayName).toBe('工具 generate_image');
        expect(registry.getByPermission('ai.document.generate')?.displayName).toBe('工具 generate_document');
        expect(registry.getByPermission('ai.web.search')).toBeUndefined();
    });
});
