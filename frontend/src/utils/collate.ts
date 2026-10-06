/**
 * 校勘工具
 * - 字位坐标编解码（lineNo / charNo ↔ L03C07）
 * - 损泐程度排序权重与字位排序
 * - 同一字位多条损泐折叠为「一条有效损泐」
 * - 两份拓本有效损泐集合的差异清单与断代规则匹配
 */
import {
  LOSS_SEVERITY_LABEL,
  LOSS_TYPE_LABEL,
  type Loss,
  type LossSeverity,
  type LossType,
} from '@/types/loss';
import type { CompareConclusion } from '@/types/compare';

/** 字位坐标 → 可读编码 L03C07 */
export function encodeCoord(lineNo: number, charNo: number): string {
  const pad = (n: number): string => String(Math.max(1, Math.trunc(n))).padStart(2, '0');
  return `L${pad(lineNo)}C${pad(charNo)}`;
}

/** 可读编码 → 字位坐标；解析失败返回 null */
export function decodeCoord(code: string): { lineNo: number; charNo: number } | null {
  const matched = /^L(\d{1,3})C(\d{1,3})$/i.exec(code.trim());
  if (!matched) return null;
  const lineNo = Number.parseInt(matched[1] as string, 10);
  const charNo = Number.parseInt(matched[2] as string, 10);
  if (!Number.isFinite(lineNo) || !Number.isFinite(charNo)) return null;
  return { lineNo, charNo };
}

/** 严重程度权重：重 > 中 > 轻 */
export function severityWeight(severity: LossSeverity): number {
  if (severity === 'heavy') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

/**
 * 同一字位多条损泐取代表条目的排序：
 * 1) 严重程度取最重（重 > 中 > 轻）；
 * 2) 程度相同取先标注的一条（createdAt 早者优先）；
 * 3) 再相同以 id 兜底，保证口径稳定。
 */
export function compareRepresentative(a: Loss, b: Loss): number {
  const bySeverity = severityWeight(b.severity) - severityWeight(a.severity);
  if (bySeverity !== 0) return bySeverity;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 按行号、字位排序（同字位按代表条目规则，最重在前） */
export function sortLosses(losses: Loss[]): Loss[] {
  return [...losses].sort((a, b) => {
    if (a.lineNo !== b.lineNo) return a.lineNo - b.lineNo;
    if (a.charNo !== b.charNo) return a.charNo - b.charNo;
    return compareRepresentative(a, b);
  });
}

/** 字位键：同一坐标视为同一字位（不含拓本维度，调用方需先按拓本过滤） */
export function coordKey(loss: Pick<Loss, 'lineNo' | 'charNo'>): string {
  return `${loss.lineNo}:${loss.charNo}`;
}

/** 拓本维度 + 字位坐标的组合键，供跨拓本折叠时使用 */
export function rubbingCoordKey(loss: Pick<Loss, 'rubbingId' | 'lineNo' | 'charNo'>): string {
  return `${loss.rubbingId}:${loss.lineNo}:${loss.charNo}`;
}

/**
 * 有效损泐：同一拓本同一字位上的若干条原始明细，按口径折叠成一条参与比对与统计。
 * - representative：类型、程度取最重的代表条目（其余条目作为补标保留在 sources 中，原始明细不删不改）
 * - recordCount：该字位原始标注条数（>=1）
 * - extraCount：除代表条目外另有几条（recordCount - 1）
 */
export interface EffectiveLoss {
  key: string;
  rubbingId: string;
  lineNo: number;
  charNo: number;
  /** 代表条目（最重）；类型与程度以它为准 */
  representative: Loss;
  /** 该字位全部原始明细，最重在前 */
  sources: Loss[];
  /** 原始标注条数 */
  recordCount: number;
  /** 另有几条补标 */
  extraCount: number;
}

/** 取同一字位上最严重的代表条目；空列表返回 null */
export function pickRepresentative(list: Loss[]): Loss | null {
  if (list.length === 0) return null;
  return [...list].sort(compareRepresentative)[0] ?? null;
}

/**
 * 把损泐明细按「拓本 + 字位」折叠为有效损泐列表（一个字位一条）。
 * 统计、网格、比对、导出统一消费该结果，保证口径一致。
 */
export function buildEffectiveLosses(losses: Loss[]): EffectiveLoss[] {
  const groups = new Map<string, Loss[]>();
  losses.forEach((loss) => {
    const key = rubbingCoordKey(loss);
    groups.set(key, [...(groups.get(key) ?? []), loss]);
  });
  const result: EffectiveLoss[] = [];
  groups.forEach((items, key) => {
    const sources = [...items].sort(compareRepresentative);
    const representative = sources[0] as Loss;
    result.push({
      key,
      rubbingId: representative.rubbingId,
      lineNo: representative.lineNo,
      charNo: representative.charNo,
      representative,
      sources,
      recordCount: sources.length,
      extraCount: sources.length - 1,
    });
  });
  return result.sort((a, b) => {
    if (a.lineNo !== b.lineNo) return a.lineNo - b.lineNo;
    return a.charNo - b.charNo;
  });
}

export interface LossDiffRow {
  key: string;
  lineNo: number;
  charNo: number;
  /** A 拓本在该字位的有效损泐（同字位多条取最重） */
  lossA: Loss | null;
  /** B 拓本在该字位的有效损泐 */
  lossB: Loss | null;
  /** A 在该字位的补标条数（原始条数 - 1） */
  extraA: number;
  /** B 在该字位的补标条数 */
  extraB: number;
  /** 差异类型：仅 A / 仅 B / 程度不同 / 一致 */
  diffKind: 'onlyA' | 'onlyB' | 'severity' | 'same';
  severityDelta: number;
}

export interface LossDiffResult {
  rows: LossDiffRow[];
  /** 差异字数：仅 A + 仅 B + 程度不同（每字位按一条有效损泐计） */
  diffCount: number;
  onlyACount: number;
  onlyBCount: number;
  severityDiffCount: number;
  sameCount: number;
  /** A / B 参与比对的有效损泐字数（同字位多条算一条） */
  totalA: number;
  totalB: number;
  /** A / B 原始标注条数（含补标） */
  rawTotalA: number;
  rawTotalB: number;
  /** A / B 的补标条数合计（原始条数 - 有效字数） */
  extraTotalA: number;
  extraTotalB: number;
}

/**
 * 按字位坐标比对两个拓本的损泐集合，输出差异清单与差异计数。
 * 同一字位的多条损泐先折叠为一条有效损泐（类型、程度取最重），再做比对：
 * 一方有有效损泐另一方没有，或双方代表条目严重程度不同，即判为差异。
 */
export function diffLosses(lossesA: Loss[], lossesB: Loss[]): LossDiffResult {
  const effectiveA = buildEffectiveLosses(lossesA);
  const effectiveB = buildEffectiveLosses(lossesB);
  const mapA = new Map<string, EffectiveLoss>();
  const mapB = new Map<string, EffectiveLoss>();
  effectiveA.forEach((item) => mapA.set(coordKey(item), item));
  effectiveB.forEach((item) => mapB.set(coordKey(item), item));

  const keys = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort((a, b) => {
    const [la, ca] = a.split(':').map((item) => Number.parseInt(item, 10));
    const [lb, cb] = b.split(':').map((item) => Number.parseInt(item, 10));
    if (la !== lb) return (la as number) - (lb as number);
    return (ca as number) - (cb as number);
  });

  const rows: LossDiffRow[] = keys.map((key) => {
    const [lineNo, charNo] = key.split(':').map((item) => Number.parseInt(item, 10)) as [number, number];
    const effA = mapA.get(key) ?? null;
    const effB = mapB.get(key) ?? null;
    const lossA = effA?.representative ?? null;
    const lossB = effB?.representative ?? null;
    const weightA = lossA ? severityWeight(lossA.severity) : 0;
    const weightB = lossB ? severityWeight(lossB.severity) : 0;
    const severityDelta = weightA - weightB;
    let diffKind: LossDiffRow['diffKind'] = 'same';
    if (lossA && !lossB) diffKind = 'onlyA';
    else if (!lossA && lossB) diffKind = 'onlyB';
    else if (severityDelta !== 0) diffKind = 'severity';
    return {
      key,
      lineNo,
      charNo,
      lossA,
      lossB,
      extraA: effA?.extraCount ?? 0,
      extraB: effB?.extraCount ?? 0,
      diffKind,
      severityDelta,
    };
  });

  const onlyACount = rows.filter((row) => row.diffKind === 'onlyA').length;
  const onlyBCount = rows.filter((row) => row.diffKind === 'onlyB').length;
  const severityDiffCount = rows.filter((row) => row.diffKind === 'severity').length;
  const extraTotalA = effectiveA.reduce((sum, item) => sum + item.extraCount, 0);
  const extraTotalB = effectiveB.reduce((sum, item) => sum + item.extraCount, 0);

  return {
    rows,
    diffCount: onlyACount + onlyBCount + severityDiffCount,
    onlyACount,
    onlyBCount,
    severityDiffCount,
    sameCount: rows.filter((row) => row.diffKind === 'same').length,
    totalA: effectiveA.length,
    totalB: effectiveB.length,
    rawTotalA: lossesA.length,
    rawTotalB: lossesB.length,
    extraTotalA,
    extraTotalB,
  };
}

/**
 * 断代规则匹配：拓本 A 相对 B 多出的损泐（仅 A 有损）说明 A 拓制更晚、石面更损；
 * 反之则 A 更早。差异全部为程度不同时按程度权重之和判断。
 */
export function matchConclusion(result: LossDiffResult): CompareConclusion {
  if (result.diffCount === 0) return 'same';
  const weightA = result.rows.reduce((sum, row) => sum + Math.max(0, row.severityDelta), 0);
  const weightB = result.rows.reduce((sum, row) => sum + Math.max(0, -row.severityDelta), 0);
  const scoreB = result.onlyACount * 2 + weightB;
  const scoreA = result.onlyBCount * 2 + weightA;
  if (scoreB === scoreA) return 'pending';
  // B 的损泐更多 → B 拓制更晚 → A 为早本
  return scoreB > scoreA ? 'early' : 'late';
}

/** 差异清单文本，用于编目卡与比对记录（同字位有补标时附「+n」） */
export function describeDiffRows(result: LossDiffResult, limit = 20): string[] {
  const part = (loss: Loss | null, extra: number): string =>
    loss
      ? `${LOSS_TYPE_LABEL[loss.type as LossType]}(${LOSS_SEVERITY_LABEL[loss.severity]})${extra > 0 ? `+${extra}` : ''}`
      : '无损泐';
  return result.rows
    .filter((row) => row.diffKind !== 'same')
    .slice(0, limit)
    .map((row) => `${encodeCoord(row.lineNo, row.charNo)}　A：${part(row.lossA, row.extraA)}　B：${part(row.lossB, row.extraB)}`);
}

/** 把损泐按行分组，用于网格标注（默认按有效损泐分组，每字位一条） */
export function groupByLine(
  losses: Loss[],
): Array<{ lineNo: number; items: EffectiveLoss[] }> {
  const map = new Map<number, EffectiveLoss[]>();
  buildEffectiveLosses(losses).forEach((item) => {
    map.set(item.lineNo, [...(map.get(item.lineNo) ?? []), item]);
  });
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([lineNo, items]) => ({ lineNo, items }));
}

/** 网格最大字位，用于渲染标注网格 */
export function maxCharNo(losses: Loss[]): number {
  return losses.reduce((max, loss) => Math.max(max, loss.charNo), 8);
}

/** 拓本版本序号展示文案 */
export function versionLabel(versionNo: number): string {
  return `第 ${versionNo} 版`
}
