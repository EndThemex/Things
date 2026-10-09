import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Image,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Spin,
  Table,
  Tag,
  Typography,
  message,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { ArrowLeftOutlined, CopyOutlined, EditOutlined, ExportOutlined } from "@ant-design/icons";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { api, json } from "../api/client";
import type { Feasibility, PlanDetail, PlanDetailItem, ShortageEntry } from "../types";
import { formatMoney, round2 } from "../utils/format";
import { copyText } from "../utils/copyText";
import PlanEditor from "../components/PlanEditor";

/** 与服务端 services/plan.ts 相同口径的本地即时计算（保存/刷新后以服务端 feasibility 为准） */
function calcFromDetail(items: PlanDetailItem[], copies: number) {
  const active = items.filter((i) => !i.inTrash);
  const priceNum = (i: PlanDetailItem) => (i.price === null ? 0 : Number(i.price));
  const rows = active.map((i) => {
    const need = i.quantityPer * copies;
    return { ...i, need, shortage: Math.max(0, need - i.quantity) };
  });
  const shortages: ShortageEntry[] = rows
    .filter((r) => r.shortage > 0)
    .sort((a, b) => b.shortage - a.shortage)
    .map((r) => ({
      componentId: r.componentId,
      name: r.name,
      quantityPer: r.quantityPer,
      quantity: r.quantity,
      need: r.need,
      shortage: r.shortage,
      price: r.price,
      purchaseUrl: r.purchaseUrl,
    }));
  return {
    feasible:
      active.length === 0 ? null : Math.min(...active.map((i) => Math.floor(i.quantity / i.quantityPer))),
    totalCost1: round2(active.reduce((s, i) => s + i.quantityPer * priceNum(i), 0)).toFixed(2),
    totalCostCopies: round2(rows.reduce((s, r) => s + r.need * priceNum(r), 0)).toFixed(2),
    shortageCost: round2(
      shortages.reduce((s, r) => s + r.shortage * (r.price === null ? 0 : Number(r.price)), 0),
    ).toFixed(2),
    shortages,
  };
}

type TableRow = PlanDetailItem & { need: number; shortage: number };

export default function PlanDetailPage() {
  const { token } = theme.useToken();
  const params = useParams();
  const planId = Number(params.id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [copies, setCopies] = useState(1);
  const [editorOpen, setEditorOpen] = useState(false);
  const [consumeOpen, setConsumeOpen] = useState(false);
  const [consumeCopies, setConsumeCopies] = useState(1);

  const planQ = useQuery({
    queryKey: ["plan", planId],
    queryFn: () => api<{ item: PlanDetail }>(`/plans/${planId}`),
    enabled: Number.isInteger(planId) && planId > 0,
  });
  const plan = planQ.data?.item ?? null;

  const feasQ = useQuery({
    queryKey: ["feasibility", planId, copies],
    queryFn: () => api<Feasibility>(`/plans/${planId}/feasibility?copies=${copies}`),
    enabled: plan !== null,
    placeholderData: keepPreviousData,
  });

  const local = useMemo(() => (plan ? calcFromDetail(plan.items, copies) : null), [plan, copies]);
  // 服务端结果与当前目标份数一致时优先采用
  const server = feasQ.data && feasQ.data.copies === copies ? feasQ.data : null;
  const feasible = server ? server.feasible : (local?.feasible ?? null);
  const totalCost1 = server?.totalCost1 ?? local?.totalCost1 ?? "0.00";
  const totalCostCopies = server?.totalCostCopies ?? local?.totalCostCopies ?? "0.00";
  const shortageCost = server?.shortageCost ?? local?.shortageCost ?? "0.00";
  const shortages = server ? server.shortages : (local?.shortages ?? []);
  const trashItems = plan?.items.filter((i) => i.inTrash).map((i) => i.name) ?? [];

  const remove = useMutation({
    mutationFn: () => api(`/plans/${planId}`, { method: "DELETE" }),
    onSuccess: () => {
      messageApi.success("方案已删除");
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      navigate("/plans");
    },
    onError: (e) => messageApi.error(e.message),
  });

  const consume = useMutation({
    mutationFn: (n: number) =>
      api<{ deducted: number }>(`/plans/${planId}/consume`, { method: "POST", ...json({ copies: n }) }),
    onSuccess: ({ deducted }) => {
      messageApi.success(`已按方案出库，扣减 ${deducted} 种物品库存`);
      setConsumeOpen(false);
      queryClient.invalidateQueries({ queryKey: ["plan"] });
      queryClient.invalidateQueries({ queryKey: ["feasibility"] });
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      queryClient.invalidateQueries({ queryKey: ["components"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (e) => messageApi.error(e.message),
  });

  const copyShoppingList = async () => {
    if (!plan) return;
    const lines = shortages.map(
      (s) => `- ${s.name} 缺少 ${s.shortage} 个${s.purchaseUrl ? ` ${s.purchaseUrl}` : ""}`,
    );
    const text = `【${plan.name}】补料清单（目标 ${copies} 份）\n${lines.join("\n")}`;
    const ok = await copyText(text);
    if (ok) messageApi.success("已复制补料清单");
    else messageApi.error("复制失败，请手动复制");
  };

  if (planQ.isError) {
    return (
      <Flex vertical gap={12}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate("/plans")} style={{ alignSelf: "flex-start" }}>
          返回方案列表
        </Button>
        <Empty description="方案不存在或已被删除" />
      </Flex>
    );
  }

  const tableRows: TableRow[] = (plan?.items ?? []).map((i) => ({
    ...i,
    need: i.quantityPer * copies,
    shortage: Math.max(0, i.quantityPer * copies - i.quantity),
  }));

  const columns: ColumnsType<TableRow> = [
    {
      title: "物品",
      dataIndex: "name",
      width: 220,
      render: (_, r) => (
        <Flex gap={8} align="center">
          {r.imagePath ? (
            <Image src={r.imagePath} width={28} height={28} style={{ objectFit: "cover", borderRadius: 4 }} preview={false} />
          ) : (
            <span style={{ width: 28, height: 28, borderRadius: 4, background: token.colorFillSecondary, flexShrink: 0 }} />
          )}
          <Flex vertical style={{ minWidth: 0 }}>
            <Typography.Text strong={r.inTrash === false} delete={r.inTrash} style={{ fontSize: 13, lineHeight: 1.3 }}>
              {r.name}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: 1.3 }} ellipsis>
              {[r.spec, r.categoryName].filter(Boolean).join(" · ") || "—"}
            </Typography.Text>
          </Flex>
          {r.inTrash && <Tag color="warning">已在回收站</Tag>}
        </Flex>
      ),
    },
    { title: "单份用量", dataIndex: "quantityPer", width: 80, align: "right" },
    { title: "当前库存", dataIndex: "quantity", width: 80, align: "right" },
    { title: `需要量（${copies} 份）`, dataIndex: "need", width: 110, align: "right" },
    {
      title: "缺少量",
      dataIndex: "shortage",
      width: 80,
      align: "right",
      render: (v: number) => (v > 0 ? <Typography.Text type="danger">-{v}</Typography.Text> : "0"),
    },
    { title: "单价", dataIndex: "price", width: 80, align: "right", render: (v: string | null) => formatMoney(v) },
    {
      title: "小计",
      key: "subtotal",
      width: 90,
      align: "right",
      render: (_, r) => (r.price === null ? "-" : `¥${round2(r.quantityPer * Number(r.price)).toFixed(2)}`),
    },
  ];

  const summaryCards = [
    {
      title: "可行份数",
      value: feasible === null ? "—" : feasible > 0 ? `${feasible} 份` : "0 份",
      color: feasible === null || feasible > 0 ? token.colorSuccess : token.colorError,
    },
    { title: "1 份总价", value: formatMoney(totalCost1) },
    { title: `${copies} 份总价`, value: formatMoney(totalCostCopies) },
    { title: "缺料补齐花费", value: shortageCost === "0.00" ? "¥0" : `≈ ¥${shortageCost}` },
  ];

  return (
    <Spin spinning={planQ.isLoading}>
      {contextHolder}
      <Flex vertical gap={12}>
        <Flex gap={4} align="center">
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate("/plans")} aria-label="返回" />
          <Flex vertical style={{ flex: 1, minWidth: 0 }}>
            <Typography.Title level={5} style={{ margin: 0 }} ellipsis>
              {plan?.name ?? "方案详情"}
            </Typography.Title>
            {plan?.description && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                {plan.description}
              </Typography.Text>
            )}
          </Flex>
          <Button
            size="small"
            icon={<ExportOutlined />}
            onClick={() => {
              setConsumeCopies(copies);
              setConsumeOpen(true);
            }}
            disabled={!plan || plan.items.length === 0}
          >
            出库
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => setEditorOpen(true)} disabled={!plan}>
            编辑
          </Button>
          <Popconfirm
            title="删除方案"
            description="方案删除后不可恢复（不影响物品库存），确定删除？"
            okText="删除"
            okButtonProps={{ danger: true }}
            onConfirm={() => remove.mutate()}
            disabled={!plan}
          >
            <Button size="small" danger disabled={!plan} loading={remove.isPending}>
              删除
            </Button>
          </Popconfirm>
        </Flex>

        {trashItems.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message={`明细中 ${trashItems.length} 个物品已在回收站，未参与计算：${trashItems.join("、")}`}
          />
        )}

        {/* 目标份数 + 汇总 */}
        <Card size="small" styles={{ body: { padding: 12 } }}>
          <Flex gap={12} wrap="wrap" align="center">
            <Flex align="center" gap={8}>
              <Typography.Text>目标份数</Typography.Text>
              <InputNumber min={1} precision={0} value={copies} onChange={(v) => setCopies(v ?? 1)} style={{ width: 90 }} />
            </Flex>
          </Flex>
          <Row gutter={[8, 8]} style={{ marginTop: 12 }}>
            {summaryCards.map((s) => (
              <Col xs={12} md={6} key={s.title}>
                <div style={{ background: token.colorFillQuaternary, borderRadius: token.borderRadius, padding: "8px 12px" }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {s.title}
                  </Typography.Text>
                  <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.4, color: s.color }}>
                    {s.value}
                  </div>
                </div>
              </Col>
            ))}
          </Row>
        </Card>

        {/* 明细表（窄屏横向滚动） */}
        <Card size="small" title="所需物品">
          <Table
            size="small"
            rowKey="id"
            columns={columns}
            dataSource={tableRows}
            pagination={false}
            scroll={{ x: 720 }}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无明细，点击右上角「编辑」添加" /> }}
          />
        </Card>

        {/* 缺料清单 */}
        <Card size="small" title="缺料清单">
          {shortages.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="目标份数内无缺料" />
          ) : (
            <Flex vertical gap={8}>
              {shortages.map((s) => (
                <Flex key={s.componentId} gap={8} align="center" wrap="wrap">
                  <Typography.Text strong style={{ fontSize: 13 }}>
                    {s.name}
                  </Typography.Text>
                  <Typography.Text type="danger" style={{ fontSize: 12 }}>
                    缺 {s.shortage}（现有 {s.quantity} / 需 {s.need}）
                  </Typography.Text>
                  {s.price !== null && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      单价 {formatMoney(s.price)}
                    </Typography.Text>
                  )}
                  {s.purchaseUrl && (
                    <a href={s.purchaseUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                      购买链接
                    </a>
                  )}
                </Flex>
              ))}
              <Flex justify="space-between" align="center" wrap="wrap" gap={8} style={{ marginTop: 4 }}>
                <Typography.Text>
                  补齐全部缺料预计花费 <Typography.Text strong>≈ ¥{shortageCost}</Typography.Text>
                </Typography.Text>
                <Button size="small" icon={<CopyOutlined />} onClick={() => void copyShoppingList()}>
                  一键复制补料清单
                </Button>
              </Flex>
            </Flex>
          )}
        </Card>
      </Flex>

      <PlanEditor
        open={editorOpen}
        editing={plan}
        onClose={() => setEditorOpen(false)}
        onSaved={() => messageApi.success("方案已保存")}
      />

      <Modal
        title="按方案出库"
        open={consumeOpen}
        onCancel={() => setConsumeOpen(false)}
        onOk={() => consume.mutate(consumeCopies)}
        confirmLoading={consume.isPending}
        okText="确认出库"
        width={360}
      >
        <Flex vertical gap={8}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            按明细扣减各物品库存并记入流水；任一物品库存不足则整体失败，不产生扣减。
          </Typography.Text>
          <Flex align="center" gap={8}>
            <Typography.Text>出库份数</Typography.Text>
            <InputNumber
              min={1}
              precision={0}
              value={consumeCopies}
              onChange={(v) => setConsumeCopies(v ?? 1)}
              style={{ width: 90 }}
            />
          </Flex>
        </Flex>
      </Modal>
    </Spin>
  );
}
