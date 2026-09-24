import { AssistantActionDraftController } from './assistant-action-draft.controller';
import type { AssistantActionDraftService } from '../drafts/assistant-action-draft.service';

/**
 * 回归：列表端点必须返回契约声明的**对象** `{ items: [...] }`，而不是裸数组。
 *
 * 此前控制器直接返回数组，客户端按 `data.items` 解构时拿到 undefined，
 * `.items.map` 在助手页渲染期抛错，表现为「一打开助手就白屏」。
 * 契约 `AssistantActionDraftList` 的形状不能被实现方的「少包一层」破坏。
 */
describe('AssistantActionDraftController', () => {
    it('wraps the pending drafts in an items object', async () => {
        const pending = [{
            draftId: '2e1c1f0e-0000-4000-8000-000000000002',
            toolName: 'create_department',
            title: '新建部门',
            fields: [{ label: '部门名称', value: '研发部' }],
            expiresAt: new Date('2026-09-24T09:00:00.000Z'),
            conversationId: '2e1c1f0e-0000-4000-8000-000000000003',
            createdAt: new Date('2026-09-24T08:50:00.000Z'),
        }];
        const drafts = { listPending: jest.fn().mockResolvedValue(pending) } as unknown as AssistantActionDraftService;
        const controller = new AssistantActionDraftController(drafts);

        const result = await controller.list();

        expect(Array.isArray(result)).toBe(false);
        expect(result).toEqual({ items: pending });
        expect(result.items).toHaveLength(1);
    });

    it('returns an empty item list when nothing is pending', async () => {
        const drafts = { listPending: jest.fn().mockResolvedValue([]) } as unknown as AssistantActionDraftService;
        const controller = new AssistantActionDraftController(drafts);

        await expect(controller.list()).resolves.toEqual({ items: [] });
    });
});
