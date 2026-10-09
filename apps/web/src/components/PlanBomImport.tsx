import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Modal,
  Flex,
  Form,
  Grid,
  Input,
  InputNumber,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import { DeleteOutlined, InboxOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, json } from "../api/client";
import type { BomParseResult } from "../types";

interface FormValues {
  name: string;
  description?: string;
}

/** 预览表格中的一行（可编辑） */
interface RowState {
  key: string;
  name: string;
  spec: string | null;
  /** 新建物品的分类（可编辑，不存在时导入自动创建） */
  category: string | null;
  quantityPer: number;
  /** 是否为缺失物品（导入时将新建到物品库） */
  isNew: boolean;
  /** 现有物品库存（仅已有行展示） */
  existStock: number | null;
  /** 新建物品的初始库存，空 = 0 */
  stock: number | null;
  /** 新建物品的单价，空 = 不填 */
  price: number | null;
  purchaseUrl: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: (planId: number, createdComponents: number) => void;
}

export default function PlanBomImport({ open, onClose, onImported }: Props) {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [form] = Form.useForm<FormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<BomParseResult | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);

  const queryClient = useQueryClient();

  useEffect(() => {
    if (!open) {
      setParsed(null);
      setRows([]);
      form.resetFields();
    }
  }, [open, form]);

  /** 上传并解析 BOM CSV（仅预览，不写库） */
  const parse = async (file: File) => {
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/plans/parse-bom", { method: "POST", body: fd });
      const data = (await res.json().catch(() => null)) as (BomParseResult & { error?: string }) | null;
      if (!res.ok) throw new Error(data?.error ?? `解析失败 (${res.status})`);
      if (!data || data.items.length === 0) throw new Error("CSV 中没有可导入的数据行");
      setParsed(data);
      setRows(
        data.items.map((it, i) => ({
          key: String(i),
          name: it.name,
          spec: it.spec,
          category: it.category,
          quantityPer: it.quantityPer,
          isNew: it.matchedComponentId === null,
          existStock: it.stock,
          stock: null,
          // BOM 提供了单价则预填，否则默认为空
          price: it.matchedComponentId === null && it.price !== null ? Number(it.price) : null,
          purchaseUrl: it.purchaseUrl,
        })),
      );
      // 方案名称默认取文件名（去扩展名）
      form.setFieldsValue({ name: file.name.replace(/\.[^.]+$/, "") });
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "解析失败");
    } finally {
      setParsing(false);
    }
  };

  const importPlan = useMutation({
    mutationFn: (values: FormValues) =>
      api<{ id: number; createdComponents: number }>("/plans/import-bom", {
        method: "POST",
        ...json({
          name: values.name,
          description: values.description ?? null,
          items: rows.map((r) => ({
            name: r.name,
            spec: r.spec,
            quantityPer: r.quantityPer,
            // 分类/库存/单价仅对新建物品生效，已有物品由服务端按名称+规格解析后忽略
            ...(r.isNew
              ? { category: r.category || null, stock: r.stock ?? 0, price: r.price ?? null, purchaseUrl: r.purchaseUrl }
              : {}),
          })),
        }),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      queryClient.invalidateQueries({ queryKey: ["components"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      onImported(data.id, data.createdComponents);
    },
    onError: (e) => messageApi.error(e.message),
  });

  const updateRow = (key: string, patch: Partial<RowState>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const newCount = rows.filter((r) => r.isNew).length;

  return (
    <Modal
      title="导入 BOM 生成方案"
      open={open}
      onCancel={onClose}
      maskClosable={false}
      width={isMobile ? "100%" : 860}
      style={{ top: isMobile ? 8 : 50, bottom: 10, paddingBottom: 0 }}
      styles={{
        body: {
          // 弹窗整体不超过视口高度，内容区超出时内部滚动
          maxHeight: `calc(100vh - ${isMobile ? 18 : 60}px - 110px)`,
          overflowY: "auto",
          overflowX: "hidden",
        },
      }}
      footer={
        parsed ? (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={() => setParsed(null)}>重新选择文件</Button>
            <Button
              type="primary"
              loading={importPlan.isPending}
              disabled={rows.length === 0}
              onClick={() => form.submit()}
            >
              导入并创建方案
            </Button>
          </div>
        ) : null
      }
    >
      {contextHolder}
      <Form form={form} layout="vertical" onFinish={(v) => importPlan.mutate(v)}>
        <Form.Item
          name="name"
          label="方案名称"
          rules={[{ required: true, whitespace: true, message: "请输入方案名称" }]}
        >
          <Input placeholder="导入后默认取文件名，可修改" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={2} placeholder="方案说明（可选）" />
        </Form.Item>
      </Form>

      {!parsed ? (
        <Upload.Dragger
          accept=".csv,text/csv"
          showUploadList={false}
          disabled={parsing}
          beforeUpload={(file) => {
            void parse(file);
            return false;
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">{parsing ? "正在解析…" : "点击或拖拽 BOM CSV 文件到此处"}</p>
          <p className="ant-upload-hint">
            按表头字段名自动识别（名称/品名、数量/用量、规格/封装、分类/类型、单价、购买链接），无需模板；「数量」列将作为单份用量，「封装」列将作为物品规格。
          </p>
        </Upload.Dragger>
      ) : (
        <Flex vertical gap={12}>
          <Flex justify="space-between" align="center" wrap="wrap" gap={8}>
            <Typography.Text strong>预览（共 {rows.length} 行）</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              已有 {rows.length - newCount} 项 · 将新建{" "}
              <Typography.Text type="warning" strong>
                {newCount}
              </Typography.Text>{" "}
              项到物品库
            </Typography.Text>
          </Flex>

          {parsed.warnings.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message="部分行已调整"
              description={
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                  {parsed.warnings.slice(0, 8).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                  {parsed.warnings.length > 8 && <li>… 共 {parsed.warnings.length} 条</li>}
                </ul>
              }
            />
          )}

          <Table
            size="small"
            rowKey="key"
            dataSource={rows}
            pagination={false}
            sticky
            scroll={{ x: 720 }}
            columns={[
              {
                title: "物品",
                dataIndex: "name",
                width: 140,
                render: (_: unknown, r: RowState) => (
                  <Flex vertical>
                    <Typography.Text style={{ fontSize: 13 }} ellipsis>
                      {r.name}
                    </Typography.Text>
                    {r.spec && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                        {r.spec}
                      </Typography.Text>
                    )}
                  </Flex>
                ),
              },
              {
                title: "分类",
                dataIndex: "category",
                width: 108,
                render: (_: unknown, r: RowState) =>
                  r.isNew ? (
                    <Input
                      size="small"
                      placeholder="空"
                      value={r.category ?? ""}
                      onChange={(e) => updateRow(r.key, { category: e.target.value })}
                      style={{ width: 96 }}
                    />
                  ) : (
                    <Typography.Text type="secondary">—</Typography.Text>
                  ),
              },
              {
                title: "单份用量",
                dataIndex: "quantityPer",
                width: 86,
                render: (_: unknown, r: RowState) => (
                  <InputNumber
                    size="small"
                    min={1}
                    precision={0}
                    value={r.quantityPer}
                    onChange={(v) => updateRow(r.key, { quantityPer: v ?? 1 })}
                    style={{ width: 84 }}
                  />
                ),
              },
              {
                title: "状态",
                dataIndex: "isNew",
                width: 66,
                render: (_: unknown, r: RowState) =>
                  r.isNew ? (
                    <Tag color="warning">新增</Tag>
                  ) : (
                    <Tag color="success">已有 · 库存 {r.existStock}</Tag>
                  ),
              },
              {
                title: "新建数量",
                dataIndex: "stock",
                width: 80,
                render: (_: unknown, r: RowState) =>
                  r.isNew ? (
                    <InputNumber
                      size="small"
                      min={0}
                      precision={0}
                      placeholder="空"
                      value={r.stock}
                      onChange={(v) => updateRow(r.key, { stock: v })}
                      style={{ width: 88 }}
                    />
                  ) : (
                    <Typography.Text type="secondary">—</Typography.Text>
                  ),
              },
              {
                title: "新建单价",
                dataIndex: "price",
                width: 108,
                render: (_: unknown, r: RowState) =>
                  r.isNew ? (
                    <InputNumber
                      size="small"
                      min={0}
                      precision={2}
                      placeholder="空"
                      value={r.price}
                      onChange={(v) => updateRow(r.key, { price: v })}
                      style={{ width: 96 }}
                      addonAfter="元"
                    />
                  ) : (
                    <Typography.Text type="secondary">—</Typography.Text>
                  ),
              },
              {
                title: "",
                key: "action",
                width: 48,
                render: (_: unknown, r: RowState) => (
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                  />
                ),
              },
            ]}
          />

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            「新增」物品将按当前填写的数量（默认 0，即空）与单价（默认空）自动加入物品库，导入后可再编辑。
          </Typography.Text>
        </Flex>
      )}
    </Modal>
  );
}
