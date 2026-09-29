import { IntentCapabilityService } from './intent-capability.service';

describe('IntentCapabilityService', () => {
    const service = new IntentCapabilityService();

    it('空文本或未识别时一律不启用任何能力', () => {
        expect(service.detect(undefined)).toEqual({ webSearch: false, knowledgeBase: false });
        expect(service.detect(null)).toEqual({ webSearch: false, knowledgeBase: false });
        expect(service.detect('')).toEqual({ webSearch: false, knowledgeBase: false });
        expect(service.detect('帮我写一首关于秋天的诗')).toEqual({ webSearch: false, knowledgeBase: false });
        expect(service.detect('请根据附件更新最新版简历')).toEqual({ webSearch: false, knowledgeBase: false });
    });

    it('消息明确提到需要联网时启用 webSearch', () => {
        expect(service.detect('帮我联网查一下今天的汇率')).toEqual({ webSearch: true, knowledgeBase: false });
        expect(service.detect('搜一下新闻')).toEqual({ webSearch: true, knowledgeBase: false });
    });

    it('英文联网说法同样命中（大小写不敏感）', () => {
        expect(service.detect('Please search the web for the release')).toEqual({
            webSearch: true,
            knowledgeBase: false,
        });
    });

    it('消息明确提到公司或内部资料时启用 knowledgeBase', () => {
        expect(service.detect('公司制度里对报销是怎么规定的')).toEqual({
            webSearch: false,
            knowledgeBase: true,
        });
        expect(service.detect('在知识库里找一下入职流程')).toEqual({
            webSearch: false,
            knowledgeBase: true,
        });
    });

    it('同时提到联网与知识库时两项都启用', () => {
        expect(service.detect('结合知识库和联网资料给一份对比')).toEqual({
            webSearch: true,
            knowledgeBase: true,
        });
    });
});
