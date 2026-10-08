import { useEffect } from "react";
import { Alert, Button, Flex, Form, InputNumber, Modal, Typography, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json } from "../api/client";
import type { ComponentItem, ComponentMovement } from "../types";
import { convertUnitPrice, formatTime } from "../utils/format";

interface FormValues {
  delta: number;
  totalCost?: number;
}

interface Props {
  open: boolean;
  component: ComponentItem | null;
  onClose: () => void;
  onSaved: () => void;
}

const QUICK_DELTAS = [1, 5, 10, 50, 100];

export default function StockModal({ open, component, onClose, onSaved }: Props) {
  const [form] = Form.useForm<FormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();

  const delta = Form.useWatch("delta", form);
  const totalCost = Form.useWatch("totalCost", form);
  const isRestock = typeof delta === "number" && delta > 0;
  const nextQuantity = component && typeof delta === "number" ? component.quantity + delta : null;
  const newPrice =
    isRestock && typeof totalCost === "number" && typeof delta === "number"
      ? convertUnitPrice(totalCost, delta)
      : null;

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({ delta: undefined, totalCost: undefined });
  }, [open, component, form]);

  // 最近库存流水（US-11：知道数量变化原因）
  const { data: moveData } = useQuery({
    queryKey: ["movements", component?.id],
    queryFn: () => api<{ items: ComponentMovement[] }>(`/components/${component!.id}/movements`),
    enabled: open && component !== null,
  });

  const adjust = useMutation({
    mutationFn: (values: FormValues) =>
      api(`/components/${component!.id}`, {
        method: "PATCH",
        ...json({ delta: values.delta, ...(values.totalCost !== undefined && { totalCost: values.totalCost }) }),
      }),
    onSuccess: () => {
      messageApi.success("库存已更新");
      queryClient.invalidateQueries({ queryKey: ["components"] });
      onSaved();
      onClose();
    },
    onError: (e) => messageApi.error(e.message),
  });

  return (
    <Modal
      title={`库存调整 - ${component?.name ?? ""}`}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={adjust.isPending}
      okText="确认调整"
      destroyOnHidden
      width={380}
    >
      {contextHolder}
      <Form form={form} layout="vertical" onFinish={(v) => adjust.mutate(v)}>
        <Form.Item
          name="delta"
          label="变动数量"
          extra="正数为入库补货，负数为出库扣减"
          rules={[
            { required: true, message: "请输入变动数量" },
            {
              validator: (_, v) =>
                v === undefined || (typeof v === "number" && Number.isInteger(v) && v !== 0)
                  ? Promise.resolve()
                  : Promise.reject(new Error("须为非零整数")),
            },
          ]}
        >
          <InputNumber style={{ width: "100%" }} placeholder="如 50 或 -10" />
        </Form.Item>
        <Flex gap={4} wrap="wrap" style={{ marginBottom: 12 }}>
          {QUICK_DELTAS.map((n) => (
            <Button key={n} size="small" onClick={() => form.setFieldValue("delta", n)}>
              +{n}
            </Button>
          ))}
          {QUICK_DELTAS.map((n) => (
            <Button key={`-${n}`} size="small" onClick={() => form.setFieldValue("delta", -n)}>
              -{n}
            </Button>
          ))}
        </Flex>

        <Form.Item
          name="totalCost"
          label="本次花费（元，可选）"
          extra="入库时填写后，单价将更新为本次采购价"
        >
          <InputNumber min={0} precision={2} style={{ width: "100%" }} disabled={!isRestock} />
        </Form.Item>

        <Alert
          type="info"
          showIcon={false}
          message={
            <Typography.Text type="secondary">
              {nextQuantity !== null && <>调整后库存：{nextQuantity}</>}
              {newPrice && <>　→　单价更新为 ¥{newPrice}</>}
              {nextQuantity !== null && nextQuantity < 0 && (
                <Typography.Text type="danger">　库存不足</Typography.Text>
              )}
            </Typography.Text>
          }
        />

        {(moveData?.items ?? []).length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              最近流水
            </Typography.Text>
            {(moveData?.items ?? []).slice(0, 5).map((m) => (
              <Flex key={m.id} justify="space-between" gap={8} style={{ fontSize: 12, lineHeight: 1.8 }}>
                <Typography.Text style={{ fontSize: 12 }} ellipsis>
                  <Typography.Text
                    type={m.delta > 0 ? "success" : "danger"}
                    style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}
                  >
                    {m.delta > 0 ? `+${m.delta}` : m.delta}
                  </Typography.Text>
                  {"  "}
                  {m.reason ?? "手动调整"}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                  {formatTime(m.createdAt)}
                </Typography.Text>
              </Flex>
            ))}
          </div>
        )}
      </Form>
    </Modal>
  );
}
