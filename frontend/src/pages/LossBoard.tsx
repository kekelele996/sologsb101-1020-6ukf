/**
 * /losses 损泐字位标注台
 * 按行号字位网格标注并批量改程度；可选定基准拓本即时查看同碑差异。
 * 消费 Loss、Rubbing；复用 <LossTag>、<FilterBar>、<StatBadge>、<EmptyPanel>。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Badge,
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
  Tooltip,
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
  selectEffectiveLossMapByRubbing,
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
import { encodeCoord, groupByLine, maxCharNo } from '@/utils/collate';
import type { EffectiveLoss } from '@/utils/collate';

const FILTER_KEYS = ['type', 'severity'] as const;

export default function LossBoard() {
  const { message } = AntdApp.useApp();
  const dispatch = useAppDispatch();
  const [form] = Form.useForm<LossDraft>();

  const steles = useAppSelector(selectSteles);
  const rubbings = useAppSelector(selectRubbings);
  const losses = useAppSelector(selectLosses);
  const effectiveMapByRubbing = useAppSelector(selectEffectiveLossMapByRubbing);

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
    const cellMap = effectiveMapByRubbing.get(rubbingId);
    if (!cellMap) return [];
    return Array.from(cellMap.values())
      .filter((item) => {
        const rep = item.representative;
        if (keyword.length > 0) {
          const haystack = `${rep.lineNo}${rep.charNo}${rep.note}${encodeCoord(rep.lineNo, rep.charNo)}`;
          if (!haystack.includes(keyword)) return false;
        }
        if (types.length > 0 && !types.includes(rep.type)) return false;
        if (severities.length > 0 && !severities.includes(rep.severity)) return false;
        return true;
      })
      .sort((a, b) => (a.lineNo === b.lineNo ? a.charNo - b.charNo : a.lineNo - b.lineNo));
  }, [effectiveMapByRubbing, rubbingId, url.keyword, url.values]);

  const rawList = useMemo(
    () => losses.filter((loss) => loss.rubbingId === rubbingId),
    [losses, rubbingId],
  );

  const stat = useMemo(() => {
    const effective = Array.from(effectiveMapByRubbing.get(rubbingId)?.values() ?? []);
    const reps = effective.map((item) => item.representative);
    const count = (type: LossType): number => reps.filter((loss) => loss.type === type).length;
    return {
      total: effective.length,
      rawTotal: rawList.length,
      extraTotal: effective.reduce((sum, item) => sum + item.extraCount, 0),
      lines: new Set(effective.map((item) => item.lineNo)).size,
      missing: count('missing'),
      crack: count('crack'),
      blur: count('blur'),
      stoneFlower: count('stoneFlower'),
      heavy: reps.filter((loss) => loss.severity === 'heavy').length,
    };
  }, [effectiveMapByRubbing, rawList.length, rubbingId]);

  const gridLines = useMemo(() => {
    const grouped = groupByLine(rawList);
    const cols = maxCharNo(rawList);
    const maxLine = grouped.reduce((max, item) => Math.max(max, item.lineNo), 0);
    return { grouped, cols, maxLine: Math.max(maxLine, 6) };
  }, [rawList]);

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

  const cellEffective = (lineNo: number, charNo: number): EffectiveLoss | undefined =>
    effectiveMapByRubbing.get(rubbingId)?.get(`${lineNo}:${charNo}`);

  const columns: ColumnsType<EffectiveLoss> = [
    {
      title: '字位',
      key: 'coord',
      width: 120,
      sorter: (a, b) => (a.lineNo === b.lineNo ? a.charNo - b.charNo : a.lineNo - b.lineNo),
      render: (_value, record) => <Tag color="#2f3a34">{encodeCoord(record.lineNo, record.charNo)}</Tag>,
    },
    {
      title: '有效损泐',
      key: 'type',
      width: 180,
      render: (_value, record) => {
        const rep = record.representative;
        return <LossTag type={rep.type} severity={rep.severity} note={rep.note} />;
      },
    },
    { title: '行 / 字', key: 'line', width: 110, render: (_value, record) => `第 ${record.lineNo} 行 第 ${record.charNo} 字` },
    {
      title: '程度',
      key: 'severity',
      width: 100,
      render: (_value, record) => (
        <Tag color={LOSS_SEVERITY_COLOR[record.representative.severity]}>
          {LOSS_SEVERITY_LABEL[record.representative.severity]}
        </Tag>
      ),
    },
    {
      title: '补标',
      key: 'records',
      width: 90,
      render: (_value, record) =>
        record.extraCount > 0 ? (
          <Tooltip
            title={record.sources
              .map(
                (source) =>
                  `${LOSS_TYPE_LABEL[source.type]}·${LOSS_SEVERITY_LABEL[source.severity]}${source.note ? `　${source.note}` : ''}`,
              )
              .join('；')}
          >
            <Tag color="purple">共 {record.recordCount} 条（+{record.extraCount}）</Tag>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary">单条</Typography.Text>
        ),
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
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(record.representative)}>
            编辑有效
          </Button>
        </Space>
      ),
    },
  ];

  const sourceColumns: ColumnsType<Loss> = [
    {
      title: '原始标注',
      key: 'type',
      width: 200,
      render: (_value, record) => <LossTag type={record.type} severity={record.severity} note={record.note} size="small" />,
    },
    {
      title: '程度',
      dataIndex: 'severity',
      width: 80,
      render: (value: LossSeverity) => (
        <Tag color={LOSS_SEVERITY_COLOR[value]}>{LOSS_SEVERITY_LABEL[value]}</Tag>
      ),
    },
    {
      title: '释文备注',
      dataIndex: 'note',
      render: (value: string) => <Typography.Text type="secondary">{value || '未填写'}</Typography.Text>,
    },
    {
      title: '标注时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (value: number) => new Date(value).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_value, record) => {
        const group = rows.find(
          (item) => item.lineNo === record.lineNo && item.charNo === record.charNo,
        );
        const isRepresentative = group?.representative.id === record.id;
        return (
          <Space size={4}>
            <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
              编辑
            </Button>
            <Popconfirm
              title="撤掉该条原始标注"
              description={
                isRepresentative && (group?.extraCount ?? 0) > 0
                  ? '撤掉代表条目后，该字位将自动改取其余条目中最重的一条。'
                  : '撤掉后该字位有效损泐会即时重算。'
              }
              okText="确认"
              cancelText="取消"
              onConfirm={() =>
                void dispatch(removeLoss(record.id))
                  .unwrap()
                  .then(() => dispatch(loadLosses()))
                  .then(() => {
                    setSelectedIds((keys) => keys.filter((key) => key !== record.id));
                    message.success('已撤掉该条标注');
                  })
              }
            >
              <Button size="small" type="link" danger icon={<DeleteOutlined />}>
                撤标
              </Button>
            </Popconfirm>
            {isRepresentative ? (
              <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                有效
              </Tag>
            ) : null}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h2>损泐字位标注台</h2>
          <p>按行号字位网格逐格标注缺字、裂痕、漫漶与石花；同一字位可分多次补标，比对与统计只取最重的一条，选定基准拓本即可即时查看逐字差异。</p>
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
        <StatBadge label="有效损泐字位" value={stat.total} suffix="字" tone="primary" />
        <StatBadge label="原始标注" value={stat.rawTotal} suffix="条" tone="info" />
        <StatBadge label="补标记录" value={stat.extraTotal} suffix="条" tone="warning" />
        <StatBadge label="涉及行数" value={stat.lines} suffix="行" tone="info" />
        <StatBadge label="缺字" value={stat.missing} suffix="字" tone="danger" />
        <StatBadge label="裂痕" value={stat.crack} suffix="字" tone="warning" />
        <StatBadge label="漫漶" value={stat.blur} suffix="字" />
        <StatBadge label="石花" value={stat.stoneFlower} suffix="字" tone="info" />
        <StatBadge label="重度" value={stat.heavy} suffix="字" tone="danger" />
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
              批量改有效程度（{selectedIds.length}）
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
                    const effective = cellEffective(lineNo, charNo);
                    const rep = effective?.representative;
                    const isDiff = diffKeys.has(`${lineNo}:${charNo}`);
                    const tooltip = rep
                      ? `${encodeCoord(lineNo, charNo)}　${LOSS_TYPE_LABEL[rep.type]}·${LOSS_SEVERITY_LABEL[rep.severity]}` +
                        (effective && effective.extraCount > 0
                          ? `（有效；另有 ${effective.extraCount} 条补标，取最重）`
                          : '') +
                        (rep.note ? `　${rep.note}` : '')
                      : `${encodeCoord(lineNo, charNo)}　未标注`;
                    return (
                      <Tooltip key={charNo} title={tooltip}>
                        <div
                          className={`gb-loss-cell${rep ? ' is-marked' : ' is-empty'}${isDiff ? ' is-diff' : ''}`}
                          style={rep ? { background: LOSS_TYPE_COLOR[rep.type] } : undefined}
                          onClick={() => (rep ? openEdit(rep) : openCreate(lineNo, charNo))}
                        >
                          {rep ? LOSS_TYPE_LABEL[rep.type].slice(0, 1) : charNo}
                          {effective && effective.extraCount > 0 ? (
                            <Badge
                              count={`+${effective.extraCount}`}
                              size="small"
                              className="gb-loss-cell__badge"
                              color="#7a3fb0"
                            />
                          ) : null}
                        </div>
                      </Tooltip>
                    );
                  })}
                </div>
              ))}
            </div>
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              色块含义：{LOSS_TYPE_OPTIONS.map((item) => `${item.label}=${item.label.slice(0, 1)}`).join('　')}；同字位多条补标只按最重的一条进比对统计，角标「+n」表示该字位另有 n 条；虚线框为与基准拓本的差异字位。
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
              <Table<EffectiveLoss>
                rowKey="key"
                size="small"
                pagination={{ pageSize: 10 }}
                columns={columns}
                dataSource={rows}
                rowSelection={{
                  selectedRowKeys: selectedIds,
                  onChange: (keys) => setSelectedIds(keys.map((key) => String(key))),
                }}
                expandable={{
                  expandedRowRender: (record) => (
                    <div style={{ padding: '4px 0 4px 24px' }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        该字位原始标注 {record.recordCount} 条（补标 {record.extraCount} 条）；撤掉其中一条后，有效损泐按最重规则即时重算，已存比对记录的差异字数不受影响。
                      </Typography.Text>
                      <Table<Loss>
                        rowKey="id"
                        size="small"
                        pagination={false}
                        columns={sourceColumns}
                        dataSource={record.sources}
                        style={{ marginTop: 6 }}
                      />
                    </div>
                  ),
                  rowExpandable: (record) => record.extraCount > 0,
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
