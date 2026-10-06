/**
 * 导出工具：整库 JSON 存档、编目卡文本、损泐台账 CSV
 * 全部在浏览器本地完成，不经过任何服务端。
 */
import type { Stele } from '@/types/stele';
import type { Rubbing } from '@/types/rubbing';
import type { Loss } from '@/types/loss';
import type { Seal } from '@/types/seal';
import type { Compare } from '@/types/compare';
import { STELE_FORM_LABEL } from '@/types/stele';
import { INK_TONE_LABEL, RUBBING_METHOD_LABEL, RUBBING_STATE_LABEL } from '@/types/rubbing';
import { LOSS_SEVERITY_LABEL, LOSS_TYPE_LABEL } from '@/types/loss';
import { SEAL_TYPE_LABEL, sealPositionWeight } from '@/types/seal';
import { COMPARE_CONCLUSION_LABEL } from '@/types/compare';
import { diffLosses, encodeCoord, buildEffectiveLosses } from './collate';
import type { RubbingSnapshot } from './db';

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function stampSuffix(): string {
  const date = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function exportSnapshotJson(snapshot: RubbingSnapshot): string {
  const filename = `gbrubbing-backup-${stampSuffix()}.json`;
  download(filename, JSON.stringify(snapshot, null, 2), 'application/json;charset=utf-8');
  return filename;
}

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 编目卡：一块碑刻 + 其拓本 + 损泐 + 钤印 + 比对结论 */
export function buildCatalogCard(
  stele: Stele,
  rubbings: Rubbing[],
  losses: Loss[],
  seals: Seal[],
  compares: Compare[],
): string {
  const lines: string[] = [];
  lines.push(`【碑帖编目卡】${stele.title}`);
  lines.push(`年代：${stele.era || '待考'}　形制：${STELE_FORM_LABEL[stele.form]}　尺寸：${stele.sizeCm || '未测'}`);
  lines.push(`所在地：${stele.location || '未记'}　书者：${stele.calligrapher || '佚名'}`);
  const effectiveLosses = buildEffectiveLosses(losses);
  lines.push(`拓本数：${rubbings.length}　有效损泐字位：${effectiveLosses.length} 字（原始标注 ${losses.length} 条）　钤印：${seals.length} 方`);
  lines.push('');

  [...rubbings]
    .sort((a, b) => a.versionNo - b.versionNo)
    .forEach((rubbing) => {
      const rubbingEffective = effectiveLosses.filter((item) => item.rubbingId === rubbing.id);
      const rubbingRawCount = losses.filter((loss) => loss.rubbingId === rubbing.id).length;
      const rubbingSeals = seals
        .filter((seal) => seal.rubbingId === rubbing.id)
        .sort((a, b) => sealPositionWeight(a.position) - sealPositionWeight(b.position));
      lines.push(
        `第 ${rubbing.versionNo} 版　${RUBBING_METHOD_LABEL[rubbing.method]}　${INK_TONE_LABEL[rubbing.inkTone]}　${rubbing.paperType}　${rubbing.sizeCm || '尺寸未记'}　收藏号 ${rubbing.collectionNo || '未编'}　${rubbing.dateGuess || '年代待考'}　${RUBBING_STATE_LABEL[rubbing.state]}`,
      );
      lines.push(
        `　有效损泐字位（${rubbingEffective.length} 字${
          rubbingRawCount > rubbingEffective.length ? `，原始标注 ${rubbingRawCount} 条、补标 ${rubbingRawCount - rubbingEffective.length} 条` : ''
        }）：`,
      );
      if (rubbingEffective.length === 0) lines.push('　　无');
      rubbingEffective.forEach((item) => {
        const rep = item.representative;
        lines.push(
          `　　${encodeCoord(rep.lineNo, rep.charNo)}　${LOSS_TYPE_LABEL[rep.type]}·${LOSS_SEVERITY_LABEL[rep.severity]}　${rep.note || ''}`,
        );
        // 同一字位的补标明细挂在代表条目之后，原始明细完整保留；类型程度取最重的一条
        item.sources.slice(1).forEach((source) => {
          lines.push(
            `　　　└ 补标　${LOSS_TYPE_LABEL[source.type]}·${LOSS_SEVERITY_LABEL[source.severity]}　${source.note || ''}`,
          );
        });
      });
      lines.push(`　钤印（${rubbingSeals.length} 方）：`);
      if (rubbingSeals.length === 0) lines.push('　　无');
      rubbingSeals.forEach((seal) => {
        lines.push(`　　${seal.position}　${seal.sealText}　${SEAL_TYPE_LABEL[seal.sealType]}　${seal.transcription || ''}`);
      });
      lines.push('');
    });

  const steleCompares = compares.filter((compare) => compare.steleId === stele.id);
  lines.push(`版本比对记录（${steleCompares.length} 条）：`);
  if (steleCompares.length === 0) lines.push('　无');
  steleCompares.forEach((compare) => {
    const a = rubbings.find((item) => item.id === compare.rubbingIdA);
    const b = rubbings.find((item) => item.id === compare.rubbingIdB);
    lines.push(
      `　${compare.date}　A：第 ${a?.versionNo ?? '?'} 版　B：第 ${b?.versionNo ?? '?'} 版　差异 ${compare.diffCount} 字　结论 ${
        COMPARE_CONCLUSION_LABEL[compare.conclusion]
      }　操作人 ${compare.operator || '未填'}`,
    );
  });
  return lines.join('\n');
}

/** 导出编目卡为文本文件 */
export function exportCatalogCard(
  stele: Stele,
  rubbings: Rubbing[],
  losses: Loss[],
  seals: Seal[],
  compares: Compare[],
): string {
  const filename = `${stele.title}-编目卡-${stampSuffix()}.txt`;
  download(filename, buildCatalogCard(stele, rubbings, losses, seals, compares), 'text/plain;charset=utf-8');
  return filename;
}

export interface ExportContext {
  steles: Stele[];
  rubbings: Rubbing[];
  losses: Loss[];
  seals: Seal[];
  compares: Compare[];
}

/** 全部碑刻的编目卡合订文本 */
export function buildAllCatalogCards(context: ExportContext): string {
  if (context.steles.length === 0) return '当前没有碑刻档案。';
  return context.steles
    .map((stele) =>
      buildCatalogCard(
        stele,
        context.rubbings.filter((rubbing) => rubbing.steleId === stele.id),
        context.losses,
        context.seals,
        context.compares,
      ),
    )
    .join('\n\n————————————————\n\n');
}

/** 损泐台账 CSV（碑刻 / 拓本 / 字位 / 类型 / 程度 / 补标）；同一字位多条折叠为一条有效值 */
export function exportLossLedgerCsv(context: ExportContext): string {
  const header = ['碑名', '拓本版本', '拓法', '行号', '字位', '坐标', '有效损泐类型', '严重程度', '原始标注条数', '补标条数', '释文备注'];
  const lines: string[] = [header.map(csvCell).join(',')];
  const effectiveLosses = buildEffectiveLosses(context.losses);
  context.steles.forEach((stele) => {
    const rubbings = context.rubbings
      .filter((rubbing) => rubbing.steleId === stele.id)
      .sort((a, b) => a.versionNo - b.versionNo);
    rubbings.forEach((rubbing) => {
      effectiveLosses
        .filter((item) => item.rubbingId === rubbing.id)
        .forEach((item) => {
          const rep = item.representative;
          lines.push(
            [
              stele.title,
              `第 ${rubbing.versionNo} 版`,
              RUBBING_METHOD_LABEL[rubbing.method],
              rep.lineNo,
              rep.charNo,
              encodeCoord(rep.lineNo, rep.charNo),
              LOSS_TYPE_LABEL[rep.type],
              LOSS_SEVERITY_LABEL[rep.severity],
              item.recordCount,
              item.extraCount,
              rep.note,
            ]
              .map(csvCell)
              .join(','),
          );
        });
    });
  });
  const filename = `碑帖损泐台账-${stampSuffix()}.csv`;
  download(filename, `\uFEFF${lines.join('\n')}`, 'text/csv;charset=utf-8');
  return filename;
}

/** 差异清单文本（比对页复制用） */
export function buildDiffText(
  stele: Stele,
  rubbingA: Rubbing | undefined,
  rubbingB: Rubbing | undefined,
  lossesA: Loss[],
  lossesB: Loss[],
): string {
  const result = diffLosses(lossesA, lossesB);
  const lines: string[] = [
    `【版本差异清单】${stele.title}`,
    `A：第 ${rubbingA?.versionNo ?? '?'} 版（${rubbingA ? RUBBING_METHOD_LABEL[rubbingA.method] : '未知'}）　B：第 ${rubbingB?.versionNo ?? '?'} 版（${
      rubbingB ? RUBBING_METHOD_LABEL[rubbingB.method] : '未知'
    }）`,
    `差异合计 ${result.diffCount} 字：仅 A ${result.onlyACount} / 仅 B ${result.onlyBCount} / 程度不同 ${result.severityDiffCount}`,
    '',
  ];
  result.rows
    .filter((row) => row.diffKind !== 'same')
    .forEach((row) => {
      const part = (loss: typeof row.lossA, extra: number): string =>
        loss
          ? `${LOSS_TYPE_LABEL[loss.type]}·${LOSS_SEVERITY_LABEL[loss.severity]}${extra > 0 ? `（+${extra} 补标）` : ''}`
          : '无损泐';
      lines.push(
        `${encodeCoord(row.lineNo, row.charNo)}　A：${part(row.lossA, row.extraA)}　B：${part(row.lossB, row.extraB)}`,
      );
    });
  return lines.join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
