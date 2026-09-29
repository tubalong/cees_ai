import { Injectable } from '@nestjs/common';

/** 服务端可自动启用的能力标识，与公开契约 TurnCapabilities.autoEnabled 的取值一致。 */
export type AutoEnabledCapability = 'web_search' | 'knowledge_search';

/** 意图识别结果：仅表示“用户消息里是否明确提到需要该项能力”。 */
export interface DetectedIntent {
    webSearch: boolean;
    knowledgeBase: boolean;
}

/**
 * 联网检索意图关键词：只覆盖“用户明确表达要联网/要外部实时信息”的说法，
 * 作为显式开关之外的补充。命中即认为用户希望使用联网检索。
 */
const WEB_SEARCH_INTENT_KEYWORDS: readonly string[] = [
    '联网',
    '上网',
    '网上',
    '网页',
    '搜索引擎',
    '百度',
    '谷歌',
    'google',
    'bing',
    '互联网',
    '全网',
    '网上查',
    '在线查',
    '实时',
    '新闻',
    '天气',
    '股价',
    '汇率',
    '外部资料',
    '公开资料',
    'search the web',
    'look up online',
];

/**
 * 知识库检索意图关键词：覆盖“检索公司/团队/内部资料”的说法。
 * 与联网关键词一样，仅作为显式开关之外的补充。
 */
const KNOWLEDGE_BASE_INTENT_KEYWORDS: readonly string[] = [
    '知识库',
    '内部资料',
    '内部文档',
    '内部规范',
    '内部流程',
    '公司资料',
    '公司文档',
    '公司制度',
    '员工手册',
    '规章制度',
    '组织架构',
    '部门架构',
    '资料库',
    '文档库',
    '检索资料',
    '查一下资料',
    '查一下文档',
];

/**
 * 轻量级意图识别：判断本轮用户消息是否明确提到需要联网或知识库检索。
 *
 * 设计原则：只做“把用户已经明确表达的需求翻译成能力开关”，不猜测隐含意图。
 * 命中的能力会与用户显式开关取并集得到“本轮有效能力”，并把“自动启用”的部分
 * 通过 started 事件回传前端，保证用户可见、可控。识别失败（例如空文本）时
 * 一律返回不启用，绝不误开。
 */
@Injectable()
export class IntentCapabilityService {
    detect(text: string | null | undefined): DetectedIntent {
        if (!text) return { webSearch: false, knowledgeBase: false };
        const normalized = text.toLowerCase();
        return {
            webSearch: matchesAny(normalized, WEB_SEARCH_INTENT_KEYWORDS),
            knowledgeBase: matchesAny(normalized, KNOWLEDGE_BASE_INTENT_KEYWORDS),
        };
    }
}

function matchesAny(normalizedText: string, keywords: readonly string[]): boolean {
    return keywords.some((keyword) => normalizedText.includes(keyword));
}
