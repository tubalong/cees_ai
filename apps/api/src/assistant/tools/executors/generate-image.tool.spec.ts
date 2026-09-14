import { ImageService } from '../../../image/image.service';
import { ToolRegistryService } from '../tool-registry';
import { GenerateImageTool } from './generate-image.tool';

describe('GenerateImageTool', () => {
    let registry: ToolRegistryService;
    let imageService: jest.Mocked<Pick<ImageService, 'generateImage'>>;
    let definition: ReturnType<ToolRegistryService['get']>;

    beforeEach(() => {
        registry = new ToolRegistryService();
        imageService = { generateImage: jest.fn() };
        const tool = new GenerateImageTool(registry, imageService as unknown as ImageService);
        tool.onModuleInit();
        definition = registry.get('generate_image');
    });

    it('self-registers with the ai.image.generate permission and a JSON Schema', () => {
        expect(definition).toBeDefined();
        expect(definition?.requiredPermissions).toEqual(['ai.image.generate']);
        expect(definition?.parameters).toEqual(expect.objectContaining({
            type: 'object',
            required: ['prompt'],
        }));
    });

    it('validates and trims the prompt, rejecting non-object or empty prompt input', () => {
        expect(() => definition?.validate(null)).toThrow('工具参数必须为对象');
        expect(() => definition?.validate([])).toThrow('工具参数必须为对象');
        expect(() => definition?.validate({ prompt: '' })).toThrow('prompt 必须是非空字符串');
        expect(() => definition?.validate({ prompt: 42 })).toThrow('prompt 必须是非空字符串');
        expect(definition?.validate({ prompt: ' 一只猫 ' })).toEqual({ prompt: '一只猫' });
    });

    it('validates size and quality enums', () => {
        expect(() => definition?.validate({ prompt: 'ok', size: '800x600' })).toThrow('size');
        expect(() => definition?.validate({ prompt: 'ok', quality: 'ultra' })).toThrow('quality');
        expect(definition?.validate({ prompt: 'ok', size: 'auto', quality: 'high' })).toEqual({
            prompt: 'ok',
            size: 'auto',
            quality: 'high',
        });
    });

    it('executes via ImageService and returns the resource summary', async () => {
        imageService.generateImage.mockResolvedValue({
            imageId: 'image-1',
            contentType: 'image/png',
            sizeBytes: 1024,
            provider: 'openai_compatible',
            model: 'image-model',
        });
        const result = await definition!.execute({
            tenantId: 't-1',
            userId: 'u-1',
            membershipId: 'm-1',
            requestId: 'r-1',
            conversationId: 'c-1',
            turnId: 'turn-1',
            toolCallId: 'tc-1',
            executionOwner: 'api:test',
            executionToken: 'execution-token-1',
            permissions: ['ai.image.generate'],
        }, { prompt: '一只猫', size: 'auto' });

        expect(imageService.generateImage).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: 't-1',
            turnId: 'turn-1',
            toolCallId: 'tc-1',
            prompt: '一只猫',
            size: 'auto',
        }));
        expect(result).toEqual({
            resourceType: 'IMAGE',
            resourceId: 'image-1',
            summary: expect.stringContaining('image-1') as unknown,
        });
        expect(result.summary).toContain('图片已生成');
    });
});
