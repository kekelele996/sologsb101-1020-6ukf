/**
 * /losses 损泐字位标注台
 * 按行号字位网格标注并批量改程度；可选定基准拓本即时查看同碑差异。
 * 消费 Loss、Rubbing；复用 <LossTag>、<FilterBar>、<StatBadge>、<EmptyPanel>。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import EmptyPanel from '@/components/common/EmptyPanel';
import FilterBar, { useFilterQuery, type FilterSelectConfig } from '@/components/common/FilterBar';
import LossTag from '@/components/common/LossTag';
import StatBadge from '@/components/common/StatBadge';
import { useLossDiff } from '@/hooks/useLossDiff';
import { useAppDispatch, useAppSelector } from '@/stores/store';
import { selectSteles, setCurrentStele } from '@/stores/steleSlice';
import { selectRubbings } from '@/stores/rubbingSlice';
import {
  batchUpdateLosses,
  createLoss,
  loadLosses,
  removeLoss,
  resetLossFilters,
  selectLosses,
  setLossKeyword,
  setLossSeverities,
  setLossTypes,
  updateLoss,
} from '@/stores/lossSlice';
import {
  LOSS_SEVERITY_COLOR,
  LOSS_SEVERITY_LABEL,
  LOSS_SEVERITY_OPTIONS,
  LOSS_TYPE_COLOR,
  LOSS_TYPE_LABEL,
  LOSS_TYPE_OPTIONS,
  createEmptyLossDraft,
  type Loss,
  type LossDraft,
  type LossSeverity,
  type LossType,
} from '@/types/loss';
import { effectiveLosses, encodeCoord, groupByLine, maxCharNo, sortLosses, type EffectiveLoss } from '@/utils/collate';

const FILTER_KEYS = ['type', 'severity'] as const;

export default function LossBoard() {
  const { message } = AntdApp.useApp();
  const dispatch = useAppDispatch();
  const [form] = Form.useForm<LossDraft>();

  const steles = useAppSelector(selectSteles);
  const rubbings = useAppSelector(selectRubbings);
  const losses = useAppSelector(selectLosses);

  const url = useFilterQuery(FILTER_KEYS);
  const [rubbingId, setRubbingId] = useState<string>('');
  const [baselineId, setBaselineId] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchSeverity, setBatchSeverity] = useState<LossSeverity>('heavy');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Loss | null>(null);

  useEffect(() => {
    dispatch(setLossKeyword(url.keyword));
    dispatch(setLossTypes((url.values.type ?? []) as LossType[]));
    dispatch(setLossSeverities((url.values.severity ?? []) as LossSeverity[]));
  }, [dispatch, url.keyword, url.values]);

  useEffect(() => {
    if (rubbingId.length === 0 && rubbings.length > 0) setRubbingId(rubbings[0]?.id ?? '');
  }, [rubbingId, rubbings]);

  const currentRubbing = rubbings.find((rubbing) => rubbing.id === rubbingId) ?? null;
  const diff = useLossDiff(rubbingId, baselineId);
  const diffKeys = useMemo(
    () => new Set(diff.diffRows.map((row) => `${row.lineNo}:${row.charNo}`)),
    [diff.diffRows],
  );

  const steleRubbings = useMemo(
    () => (currentRubbing ? rubbings.filter((rubbing) => rubbing.steleId === currentRubbing.steleId) : []),
    [currentRubbing, rubbings],
  );

  const rows = useMemo(() => {
    const keyword = url.keyword.trim();
    const types = url.values.type ?? [];
    const severities = url.values.severity ?? [];
    return sortLosses(
      losses.filter((loss) => {
        if (loss.rubbingId !== rubbingId) return false;
        if (keyword.length > 0) {
          const haystack = `${loss.lineNo}${loss.charNo}${loss.note}${encodeCoord(loss.lineNo, loss.charNo)}`;
          if (!haystack.includes(keyword)) return false;
        }
        if (types.length > 0 && !types.includes(loss.type)) return false;
        if (severities.length > 0 && !severities.includes(loss.severity)) return false;
        return true;
      }),
    );
  }, [losses, rubbingId, url.keyword, url.values]);

  /** 当前拓本的有效损泐：同字位多条补标算一条，类型程度取最重 */
  const effectiveList = useMemo(
    () => effectiveLosses(losses.filter((loss) => loss.rubbingId === rubbingId)),
    [losses, rubbingId],
  );

  const effectiveByCoord = useMemo(() => {
    const map = new Map<string, EffectiveLoss>();
    effectiveList.forEach((loss) => map.set(`${loss.lineNo}:${loss.charNo}`, loss));
    return map;
  }, [effectiveList]);

  const stat = useMemo(() => {
    const count = (type: LossType): number => effectiveList.filter((loss) => loss.type === type).length;
    return {
      total: effectiveList.length,
      entries: losses.filter((loss) => loss.rubbingId === rubbingId).length,
      lines: new Set(effectiveList.map((loss) => loss.lineNo)).size,
      missing: count('missing'),
      crack: count('crack'),
      blur: count('blur'),
      stoneFlower: count('stoneFlower'),
      heavy: effectiveList.filter((loss) => loss.severity === 'heavy').length,
    };
  }, [effectiveList, losses, rubbingId]);

  const gridLines = useMemo(() => {
    const grouped = groupByLine(effectiveList);
    const cols = maxCharNo(effectiveList);
    const maxLine = grouped.reduce((max, item) => Math.max(max, item.lineNo), 0);
    return { grouped, cols, maxLine: Math.max(maxLine, 6) };
  }, [effectiveList]);

  const selects: FilterSelectConfig[] = [
    { key: 'type', label: '损泐类型', options: LOSS_TYPE_OPTIONS.map((item) => ({ value: item.value, label: item.label })) },
    { key: 'severity', label: '程度', options: LOSS_SEVERITY_OPTIONS.map((item) => ({ value: item.value, label: item.label })) },
  ];

  const openCreate = (lineNo = 1, charNo = 1): void => {
    if (!rubbingId) {
      message.warning('请先选择拓本');
      return;
    }
    setEditing(null);
    form.setFieldsValue(createEmptyLossDraft(rubbingId, lineNo, charNo));
    setOpen(true);
  };

  const openEdit = (loss: Loss): void => {
    setEditing(loss);
    form.setFieldsValue({
      rubbingId: loss.rubbingId,
      lineNo: loss.lineNo,
      charNo: loss.charNo,
      type: loss.type,
      severity: loss.severity,
      note: loss.note,
    });
    setOpen(true);
  };

  const submit = async (): Promise<void> => {
    const values = await form.validateFields();
    if (editing) {
      await dispatch(updateLoss({ id: editing.id, patch: values })).unwrap();
      message.success(`已更新 ${encodeCoord(values.lineNo, values.charNo)} 字位`);
    } else {
      await dispatch(createLoss(values)).unwrap();
      message.success(`已标注 ${encodeCoord(values.lineNo, values.charNo)} 字位`);
    }
    setOpen(false);
  };

  const cellLoss = (lineNo: number, charNo: number): EffectiveLoss | undefined =>
    effectiveByCoord.get(`${lineNo}:${charNo}`);

  /** 网格单元格提示：有效值 + 同字位全部补标明细 */
  const cellTitle = (loss: EffectiveLoss): string => {
    const head = `${encodeCoord(loss.lineNo, loss.charNo)}　${LOSS_TYPE_LABEL[loss.type]}·${LOSS_SEVERITY_LABEL[loss.severity]}${loss.note ? `　${loss.note}` : ''}`;
    if (loss.entryCount <= 1) return head;
    const entries = loss.entries
      .map(
        (entry, index) =>
          `${index + 1}. ${LOSS_TYPE_LABEL[entry.type]}·${LOSS_SEVERITY_LABEL[entry.severity]}${entry.note ? `　${entry.note}` : ''}`,
      )
      .join('\n');
    return `${head}\n同字位共 ${loss.entryCount} 条补标，比对与统计取最重一条：\n${entries}`;
  };

  const columns: ColumnsType<Loss> = [
    {
      title: '字位',
      key: 'coord',
      width: 120,
      sorter: (a, b) => (a.lineNo === b.lineNo ? a.charNo - b.charNo : a.lineNo - b.lineNo),
      render: (_value, record) => <Tag color="#2f3a34">{encodeCoord(record.lineNo, record.charNo)}</Tag>,
    },
    {
      title: '损泐类型',
      dataIndex: 'type',
      width: 130,
      render: (value: LossType, record) => <LossTag type={value} severity={record.severity} note={record.note} />,
    },
    { title: '行 / 字', key: 'line', width: 110, render: (_value, record) => `第 ${record.lineNo} 行 第 ${record.charNo} 字` },
    {
      title: '程度',
      dataIndex: 'severity',
      width: 100,
      render: (value: LossSeverity) => <Tag color={LOSS_SEVERITY_COLOR[value]}>{LOSS_SEVERITY_LABEL[value]}</Tag>,
    },
    {
      title: '释文备注',
      dataIndex: 'note',
      render: (value: string) => <Typography.Text type="secondary">{value || '未填写'}</Typography.Text>,
    },
    {
      title: '有效损泐',
      key: 'effective',
      width: 96,
      render: (_value, record) => {
        const top = effectiveByCoord.get(`${record.lineNo}:${record.charNo}`);
        if (!top) return null;
        return top.id === record.id ? (
          <Tag color="green">有效</Tag>
        ) : (
          <Tag title={`该字位共 ${top.entryCount} 条，比对取「${LOSS_TYPE_LABEL[top.type]}·${LOSS_SEVERITY_LABEL[top.severity]}」`}>
            补标
          </Tag>
        );
      },
    },
    {
      title: '差异',
      key: 'diff',
      width: 100,
      render: (_value, record) =>
        baselineId
          ? diffKeys.has(`${record.lineNo}:${record.charNo}`)
            ? <Tag color="gold">存在差异</Tag>
            : <Tag>与基准一致</Tag>
          : <Typography.Text type="secondary">未选基准</Typography.Text>,
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_value, record) => (
        <Space size={4}>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="删除该字位标注"
            okText="确认"
            cancelText="取消"
            onConfirm={() =>
              void dispatch(removeLoss(record.id))
                .unwrap()
                .then(() => dispatch(loadLosses()))
                .then(() => message.success('已删除'))
            }
          >
            <Button size="small" type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h2>损泐字位标注台</h2>
          <p>按行号字位网格逐格标注缺字、裂痕、漫漶与石花；选定基准拓本即可即时查看逐字差异。</p>
        </div>
        <Space wrap>
          <Select
            style={{ minWidth: 260 }}
            placeholder="选择拓本"
            value={rubbingId || undefined}
            options={rubbings.map((rubbing) => ({
              value: rubbing.id,
              label: `${steles.find((stele) => stele.id === rubbing.steleId)?.title ?? ''} · 第 ${rubbing.versionNo} 版`,
            }))}
            onChange={(value: string) => {
              setRubbingId(value);
              const rubbing = rubbings.find((item) => item.id === value);
              if (rubbing) dispatch(setCurrentStele(rubbing.steleId));
            }}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>
            新增字位
          </Button>
        </Space>
      </div>

      <div className="gb-stat-row">
        <StatBadge label="有效字位" value={stat.total} suffix="个" tone="primary" />
        <StatBadge label="标注明细" value={stat.entries} suffix="条" tone="info" />
        <StatBadge label="涉及行数" value={stat.lines} suffix="行" tone="info" />
        <StatBadge label="缺字" value={stat.missing} suffix="个" tone="danger" />
        <StatBadge label="裂痕" value={stat.crack} suffix="个" tone="warning" />
        <StatBadge label="漫漶" value={stat.blur} suffix="个" />
        <StatBadge label="石花" value={stat.stoneFlower} suffix="个" tone="info" />
        <StatBadge label="重度" value={stat.heavy} suffix="个" tone="danger" />
      </div>

      <FilterBar
        keyword={url.keyword}
        onKeywordChange={url.setKeyword}
        selects={selects}
        values={url.values}
        onValuesChange={url.setValues}
        onReset={() => {
          url.reset();
          dispatch(resetLossFilters());
        }}
        keywordPlaceholder="搜索字位 / 坐标 / 备注…"
        actions={
          <Space size={6} wrap>
            <Select
              size="small"
              style={{ width: 110 }}
              value={batchSeverity}
              options={[...LOSS_SEVERITY_OPTIONS]}
              onChange={(value: LossSeverity) => setBatchSeverity(value)}
            />
            <Button
              size="small"
              disabled={selectedIds.length === 0}
              onClick={() =>
                void dispatch(batchUpdateLosses({ ids: selectedIds, patch: { severity: batchSeverity } }))
                  .unwrap()
                  .then(() => {
                    message.success(`已批量置为「${LOSS_SEVERITY_LABEL[batchSeverity]}」`);
                    setSelectedIds([]);
                  })
              }
            >
              批量改程度（{selectedIds.length}）
            </Button>
          </Space>
        }
      />

      {baselineId ? (
        <Alert
          style={{ marginTop: 14 }}
          type={diff.diffCount > 0 ? 'warning' : 'success'}
          showIcon
          message={`与基准拓本差异 ${diff.diffCount} 字（仅当前 ${diff.result.onlyACount} / 仅基准 ${diff.result.onlyBCount} / 程度不同 ${diff.result.severityDiffCount}）`}
          description="网格中虚线框标记的字位即为差异字位；可在版本比对页生成正式比对记录。"
        />
      ) : null}

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} xl={10}>
          <Card
            size="small"
            title="字位网格标注"
            extra={
              <Select
                allowClear
                size="small"
                style={{ width: 200 }}
                placeholder="选择基准拓本"
                value={baselineId || undefined}
                options={steleRubbings
                  .filter((rubbing) => rubbing.id !== rubbingId)
                  .map((rubbing) => ({ value: rubbing.id, label: `第 ${rubbing.versionNo} 版` }))}
                onChange={(value: string | undefined) => setBaselineId(value ?? '')}
              />
            }
          >
            {stat.total === 0 && gridLines.maxLine <= 6 ? (
              <EmptyPanel
                title="该拓本尚无字位标注"
                description="点击下方网格任意空格即可新增字位，或使用表格上方的「新增字位」。"
                actionText="新增字位"
                onAction={() => openCreate()}
                size="small"
              />
            ) : null}
            <div className="gb-loss-grid">
              {Array.from({ length: gridLines.maxLine }, (_v, index) => index + 1).map((lineNo) => (
                <div key={lineNo} className="gb-loss-grid__line">
                  <span className="gb-loss-grid__label">第{lineNo}行</span>
                  {Array.from({ length: gridLines.cols }, (_v, index) => index + 1).map((charNo) => {
                    const loss = cellLoss(lineNo, charNo);
                    const isDiff = diffKeys.has(`${lineNo}:${charNo}`);
                    return (
                      <div
                        key={charNo}
                        className={`gb-loss-cell${loss ? ' is-marked' : ' is-empty'}${isDiff ? ' is-diff' : ''}`}
                        style={loss ? { background: LOSS_TYPE_COLOR[loss.type] } : undefined}
                        title={loss ? cellTitle(loss) : `${encodeCoord(lineNo, charNo)}　未标注`}
                        onClick={() => (loss ? openEdit(loss) : openCreate(lineNo, charNo))}
                      >
                        {loss ? LOSS_TYPE_LABEL[loss.type].slice(0, 1) : charNo}
                        {loss && loss.entryCount > 1 ? (
                          <span className="gb-loss-cell__badge">{loss.entryCount}</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              色块含义：{LOSS_TYPE_OPTIONS.map((item) => `${item.label}=${item.label.slice(0, 1)}`).join('　')}；虚线框为与基准拓本的差异字位；右上角数字角标表示该字位另有多条补标，比对与统计只取最重一条。
            </Typography.Text>
          </Card>
        </Col>

        <Col xs={24} xl={14}>
          <Card className="gb-table-card" styles={{ body: { padding: 0 } }}>
            {rows.length === 0 ? (
              <EmptyPanel
                title={stat.total === 0 ? '该拓本尚未标注字位' : '当前筛选条件下没有字位'}
                description={
                  stat.total === 0
                    ? '逐格标注损泐类型与程度，标注结果会参与版本比对。'
                    : '试着调整损泐类型或程度筛选。'
                }
                actionText="新增字位"
                onAction={() => openCreate()}
                secondaryText="重置筛选"
                onSecondary={() => url.reset()}
                size="small"
              />
            ) : (
              <Table<Loss>
                rowKey="id"
                size="small"
                pagination={{ pageSize: 10 }}
                columns={columns}
                dataSource={rows}
                rowSelection={{
                  selectedRowKeys: selectedIds,
                  onChange: (keys) => setSelectedIds(keys.map((key) => String(key))),
                }}
              />
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        open={open}
        title={editing ? `编辑字位 ${encodeCoord(editing.lineNo, editing.charNo)}` : '新增损泐字位'}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="lineNo" label="行号" rules={[{ required: true }]} style={{ flex: 1 }}>
              <InputNumber min={1} max={200} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="charNo" label="字位" rules={[{ required: true }]} style={{ flex: 1 }}>
              <InputNumber min={1} max={80} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="type" label="损泐类型" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={[...LOSS_TYPE_OPTIONS]} />
            </Form.Item>
            <Form.Item name="severity" label="严重程度" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={[...LOSS_SEVERITY_OPTIONS]} />
            </Form.Item>
          </Space>
          <Form.Item name="note" label="释文备注">
            <Input placeholder="如：「壽」字右下漫漶" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
