/**
 * 知识库名称唯一性归一值。
 *
 * 同租户内按「大小写不敏感 + 忽略首尾空格」判定重名，落库为 `lower(btrim(name))`。
 * 软删除必须释放名称，否则用户删掉「公司共用库」后再建同名会失败；因此软删除行
 * 使用 `归一名称#<id>`：值仍然唯一，但不再占用名称。
 *
 * 归一值只用于唯一性判定，展示始终使用原始 `name`。
 */
export function normalizeKnowledgeBaseName(name: string): string {
    return name.trim().toLowerCase();
}

/** 软删除时的归一值：追加主键保证唯一，且不再与存活行冲突。 */
export function releasedKnowledgeBaseName(normalizedName: string, knowledgeBaseId: string): string {
    return `${normalizedName}#${knowledgeBaseId}`;
}
