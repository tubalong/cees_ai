import type { DocumentSourceMaterial } from '@cees/ai-service-client';
import type { FinanceLedgerRowDto } from '../../../finance/dto';

const REQUIRED_HEADERS = ['发生日期', '方向', '金额', '凭证号'] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ROWS = 5000;

export interface ParsedFinanceLedgerAttachment {
    fileId: string;
    fileName: string;
    format: 'XLSX' | 'CSV';
    periodStart: string;
    periodEnd: string;
    rows: FinanceLedgerRowDto[];
    ignoredDepartmentRefs: string[];
    ignoredProjectRefs: string[];
}

export function parseFinanceLedgerAttachment(
    materials: DocumentSourceMaterial[],
): ParsedFinanceLedgerAttachment {
    const spreadsheets = materials.filter((material) => /\.(xlsx|csv)$/i.test(fileNameOf(material)));
    if (spreadsheets.length !== 1) {
        throw new Error('本轮必须且只能上传一个 XLSX 或 CSV 台账附件');
    }
    const material = spreadsheets[0];
    const fileName = fileNameOf(material);
    const parsedLines = material.content.split(/\r?\n/).map(parseLine);
    const headerIndex = parsedLines.findIndex((cells) => {
        const normalized = cells.map(normalizeText);
        return REQUIRED_HEADERS.every((header) => normalized.includes(header));
    });
    if (headerIndex < 0) throw new Error('附件中未找到发生日期、方向、金额、凭证号等标准台账表头');

    const headers = parsedLines[headerIndex].map(normalizeText);
    const ignoredDepartments = new Set<string>();
    const ignoredProjects = new Set<string>();
    const rows: FinanceLedgerRowDto[] = [];
    let sourceRowNumber = 1;
    for (const cells of parsedLines.slice(headerIndex + 1)) {
        sourceRowNumber += 1;
        // `[Sheet: 标题]` 是提取器给出的工作表分隔标记。表头所在的工作表在标记之后、
        // 表头之前就已经进入，因此循环里再遇到标记只能是**下一张表**的开始：
        // 必须停下，不能 continue。
        //
        // 否则同一份文件在两条路径上行为不一致：桌面端只读第一个工作表，而这里读的是
        // 全部工作表拼成的文本，台账行解析完后会继续把「测试汇总」等附表当成台账数据，
        // 撞上附表的标题行就以「第 N 行方向只能是收入或支出」失败——用户看到的是
        // 「同一份文件手动上传能成功、AI 上传总是失败」。
        if (normalizeText(cells[0]).startsWith('[Sheet:')) break;
        if (cells.every((cell) => normalizeText(cell) === '')) continue;
        const read = (header: string): string => normalizeText(cells[headers.indexOf(header)] ?? '');
        const directionText = read('方向').toUpperCase();
        const direction = ['收入', 'INCOME'].includes(directionText)
            ? 'INCOME'
            : ['支出', 'EXPENSE'].includes(directionText)
                ? 'EXPENSE'
                : null;
        if (!direction) throw new Error(`第 ${sourceRowNumber} 行方向只能是收入或支出`);
        const occurredOn = normalizeDate(read('发生日期'));
        if (!occurredOn) throw new Error(`第 ${sourceRowNumber} 行发生日期格式不正确`);
        const amount = normalizeAmount(read('金额'));
        if (amount === null) throw new Error(`第 ${sourceRowNumber} 行金额格式无法识别或不大于 0`);
        const voucherNo = read('凭证号');
        if (!voucherNo) throw new Error(`第 ${sourceRowNumber} 行凭证号不能为空`);

        const departmentRef = read('部门ID');
        const projectRef = read('项目ID');
        if (departmentRef && !UUID_PATTERN.test(departmentRef)) ignoredDepartments.add(departmentRef);
        if (projectRef && !UUID_PATTERN.test(projectRef)) ignoredProjects.add(projectRef);
        rows.push({
            rowNumber: sourceRowNumber,
            occurredOn,
            direction,
            amount,
            currency: (read('币种') || 'CNY').toUpperCase(),
            categoryCode: read('科目编码') || null,
            categoryName: read('科目名称') || null,
            departmentId: UUID_PATTERN.test(departmentRef) ? departmentRef : null,
            projectId: UUID_PATTERN.test(projectRef) ? projectRef : null,
            counterparty: read('交易对方') || null,
            summary: read('摘要') || null,
            voucherNo,
        });
    }
    if (rows.length === 0) throw new Error('附件中没有可导入的台账记录');
    if (rows.length > MAX_ROWS) throw new Error(`聊天导入最多支持 ${MAX_ROWS} 行，请使用财务台账上传页面`);
    const dates = rows.map((row) => row.occurredOn).sort();
    return {
        fileId: material.id,
        fileName,
        format: fileName.toLowerCase().endsWith('.csv') ? 'CSV' : 'XLSX',
        periodStart: dates[0],
        periodEnd: dates[dates.length - 1],
        rows,
        ignoredDepartmentRefs: [...ignoredDepartments].sort(),
        ignoredProjectRefs: [...ignoredProjects].sort(),
    };
}

function fileNameOf(material: DocumentSourceMaterial): string {
    return normalizeText(material.title) || '上传台账附件';
}

function parseLine(line: string): string[] {
    if (line.includes('\t')) return line.split('\t');
    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '"') {
            if (quoted && line[index + 1] === '"') {
                current += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (character === ',' && !quoted) {
            cells.push(current);
            current = '';
        } else {
            current += character;
        }
    }
    cells.push(current);
    return cells;
}

function normalizeText(value: unknown): string {
    return String(value ?? '').replace(/^\uFEFF/, '').trim();
}

function normalizeDate(value: string): string | null {
    const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value);
    if (!match) return null;
    const normalized = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    const date = new Date(`${normalized}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized ? null : normalized;
}

function normalizeAmount(value: string): number | null {
    const normalized = value.replace(/[\s,，]/g, '').replace(/^[¥￥$€£]/, '');
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
}