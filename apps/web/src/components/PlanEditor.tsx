import { useEffect, useState } from "react";
import {
  Button,
  Modal,
  Empty,
  Flex,
  Form,
  Grid,
  Input,
  InputNumber,
  List,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json } from "../api/client";
import type { ComponentItem, Paged, PlanDetail } from "../types";

interface FormValues {
  name: string;
  description?: string;
}

interface EditorItem {
  componentId: number;
  name: string;
  spec: string | null;
  quantity: number;
  quantityPer: number;
  inTrash: boolean;
}

interface Props {
  open: boolean;
  /** null = 新建 */
  editing: PlanDetail | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function PlanEditor({ open, editing, onClose, onSaved }: Props) {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [form] = Form.useForm<FormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [items, setItems] = useState<EditorItem[]>([]);
  const [pickId, setPickId] = useState<number | undefined>();
  const [pickQty, setPickQty] = useState<number>(1);
  const [q, setQ] = useState("");
  const isCreate = editing === null;

  const queryClient = useQueryClient();
  const { data: compData } = useQuery({
    queryKey: ["components", "options", q],
    queryFn: () =>
      api<Paged<ComponentItem>>(
        `/components?q=${encodeURIComponent(q)}&pageSize=50&sort=name_asc`,
      ),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      name: editing?.name ?? "",
      description: editing?.description ?? undefined,
    });
    setItems(
      (editing?.items ?? []).map((it) => ({
        componentId: it.componentId,
        name: it.name,
        spec: it.spec,
        quantity: it.quantity,
        quantityPer: it.quantityPer,
        inTrash: it.inTrash,
      })),
    );
    setPickId(undefined);
    setPickQty(1);
    setQ("");
  }, [open, editing, form]);

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      editing
        ? api(`/plans/${editing.id}`, {
            method: "PUT",
            ...json({
              name: values.name,
              description: values.description ?? null,
              items: items.map((i) => ({ componentId: i.componentId, quantityPer: i.quantityPer })),
            }),
          })
        : api("/plans", {
            method: "POST",
            ...json({
              name: values.name,
              description: values.description ?? null,
              items: items.map((i) => ({ componentId: i.componentId, quantityPer: i.quantityPer })),
            }),
          }),
    onSuccess: () => {
      messageApi.success("已保存");
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      queryClient.invalidateQueries({ queryKey: ["plan"] });
      queryClient.invalidateQueries({ queryKey: ["feasibility"] });
      onSaved();
      onClose();
    },
    onError: (e) => messageApi.error(e.message),
  });

  const addItem = () => {
    if (pickId === undefined) return;
    const comp = (compData?.items ?? []).find((c) => c.id === pickId);
    if (!comp) return;
    setItems((prev) => {
      const exists = prev.find((i) => i.componentId === pickId);
      if (exists) {
        messageApi.info("该物品已在明细中，已更新单份用量");
        return prev.map((i) =>
          i.componentId === pickId ? { ...i, quantityPer: pickQty } : i,
        );
      }
      return [
        ...prev,
        {
          componentId: pickId,
          name: comp.name,
          spec: comp.spec,
          quantity: comp.quantity,
          quantityPer: pickQty,
          inTrash: false,
        },
      ];
    });
    setPickId(undefined);
    setPickQty(1);
  };

  return (
    <Modal
      title={isCreate ? "新建方案" : "编辑方案"}
      open={open}
      onCancel={onClose}
      width={isMobile ? "100%" : 640}
      style={{ top: isMobile ? 8 : 60 }}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
            保存
          </Button>
        </div>
      }
    >
      {contextHolder}
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
        <Form.Item
          name="name"
          label="方案名称"
          rules={[{ required: true, whitespace: true, message: "请输入方案名称" }]}
        >
          <Input placeholder="如：客制化键盘" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={2} placeholder="方案说明（可选）" />
        </Form.Item>
      </Form>

      <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
        所需物品（单份用量）
      </Typography.Text>
      <Flex gap={8} wrap="wrap" style={{ marginBottom: 12 }}>
        <Select
          showSearch
          value={pickId}
          onSearch={setQ}
          onChange={setPickId}
          filterOption={false}
          placeholder="搜索并选择物品"
          style={{ flex: 1, minWidth: 180 }}
          notFoundContent="未找到物品"
          options={(compData?.items ?? []).map((c) => ({
            value: c.id,
            label: `${c.name}${c.spec ? `（${c.spec}）` : ""} · 库存 ${c.quantity}`,
          }))}
        />
        <Space.Compact>
          <InputNumber
            min={1}
            precision={0}
            value={pickQty}
            onChange={(v) => setPickQty(v ?? 1)}
            style={{ width: 90 }}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={addItem} disabled={pickId === undefined}>
            添加
          </Button>
        </Space.Compact>
      </Flex>

      {items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无明细，可保存后再补充" />
      ) : (
        <List
          size="small"
          dataSource={items}
          renderItem={(item) => (
            <List.Item
              actions={[
                <InputNumber
                  key="qty"
                  min={1}
                  precision={0}
                  size="small"
                  value={item.quantityPer}
                  onChange={(v) =>
                    setItems((prev) =>
                      prev.map((i) =>
                        i.componentId === item.componentId
                          ? { ...i, quantityPer: v ?? 1 }
                          : i,
                      ),
                    )
                  }
                  style={{ width: 80 }}
                />,
                <Button
                  key="del"
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    setItems((prev) => prev.filter((i) => i.componentId !== item.componentId))
                  }
                />,
              ]}
            >
              <List.Item.Meta
                title={
                  <Flex gap={6} align="center">
                    <Typography.Text delete={item.inTrash} style={{ fontSize: 13 }}>
                      {item.name}
                    </Typography.Text>
                    {item.inTrash && <Tag color="warning">已在回收站</Tag>}
                  </Flex>
                }
                description={`当前库存 ${item.quantity}${item.spec ? ` · ${item.spec}` : ""}`}
              />
            </List.Item>
          )}
        />
      )}
    </Modal>
  );
}
