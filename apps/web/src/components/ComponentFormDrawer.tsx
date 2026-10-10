import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Drawer,
  Form,
  Grid,
  Image,
  Input,
  InputNumber,
  Modal,
  message,
  Radio,
  Select,
  Space,
  Typography,
  Upload,
  theme,
} from "antd";
import { DeleteOutlined, InboxOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json } from "../api/client";
import type { Category, ComponentItem, Tag } from "../types";
import { compressImage } from "../utils/image";
import { convertUnitPrice } from "../utils/format";

interface FormValues {
  name: string;
  categoryId?: number;
  quantity?: number;
  priceMode?: "unit" | "total";
  price?: number;
  totalCost?: number;
  spec?: string;
  color?: string;
  purchaseUrl?: string;
  tags?: string[];
  note?: string;
}

interface Props {
  open: boolean;
  editing: ComponentItem | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function ComponentFormDrawer({ open, editing, onClose, onSaved }: Props) {
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [form] = Form.useForm<FormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  // 静态 Modal.confirm 不读取 ConfigProvider 主题，改用 hook 实例跟随深浅色
  const [modalApi, modalHolder] = Modal.useModal();
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const isCreate = editing === null;
  /** 打开时的表单与图片快照，关闭前对比值是否真的变过（仅聚焦/失焦不算改动） */
  const initialSnapshot = useRef("");

  const queryClient = useQueryClient();
  const { data: catData } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api<{ items: Category[] }>("/categories"),
    enabled: open,
  });
  const { data: tagData } = useQuery({
    queryKey: ["tags"],
    queryFn: () => api<{ items: Tag[] }>("/tags"),
    enabled: open,
  });
  const tagOptions = (tagData?.items ?? []).map((t) => ({ value: t.name }));

  const priceMode = Form.useWatch("priceMode", form);
  const totalCost = Form.useWatch("totalCost", form);
  const quantity = Form.useWatch("quantity", form);
  const converted =
    priceMode === "total" && typeof totalCost === "number" && typeof quantity === "number"
      ? convertUnitPrice(totalCost, quantity)
      : null;

  useEffect(() => {
    if (!open) return;
    setImagePath(editing?.imagePath ?? null);
    setCategorySearch("");
    // 每次打开先全量重置，避免残留上一次的表单数据
    form.resetFields();
    form.setFieldsValue(
      editing
        ? {
            name: editing.name,
            categoryId: editing.categoryId ?? undefined,
            quantity: editing.quantity,
            priceMode: "unit",
            price: editing.price ? Number(editing.price) : undefined,
            spec: editing.spec ?? undefined,
            color: editing.color ?? undefined,
            purchaseUrl: editing.purchaseUrl ?? undefined,
            tags: editing.tags.map((t) => t.name),
            note: editing.note ?? undefined,
          }
        : { name: "", quantity: 0, priceMode: "unit" },
    );
    // 记录初始快照，供关闭前脏检查
    initialSnapshot.current =
      JSON.stringify(form.getFieldsValue()) + "|" + (editing?.imagePath ?? "");
  }, [open, editing, form]);

  const createCategory = useMutation({
    mutationFn: (name: string) => api<{ item: Category }>("/categories", { method: "POST", ...json({ name }) }),
    onSuccess: ({ item }) => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      form.setFieldValue("categoryId", item.id);
      setCategorySearch("");
      messageApi.success(`已创建分类「${item.name}」`);
    },
    onError: (e) => messageApi.error(e.message),
  });

  // 搜索词与现有分类名称都不完全一致时，在选项首位插入「创建」项，
  // 使其默认高亮，回车即触发创建
  const CREATE_KEY = "__create_category__";
  const categoryOptions = useMemo<Array<{ value: number | string; label: string }>>(() => {
    const kw = categorySearch.trim();
    const opts: Array<{ value: number | string; label: string }> = (catData?.items ?? []).map(
      (c) => ({ value: c.id, label: c.name }),
    );
    if (kw && !opts.some((o) => o.label === kw)) {
      opts.unshift({
        value: CREATE_KEY,
        label: createCategory.isPending ? `正在创建「${kw}」…` : `创建分类「${kw}」`,
      });
    }
    return opts;
  }, [catData, categorySearch, createCategory.isPending]);

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing
        ? api(`/components/${editing.id}`, { method: "PUT", ...json(payload) })
        : api("/components", { method: "POST", ...json(payload) }),
    onSuccess: () => {
      messageApi.success("已保存");
      onSaved();
      onClose();
    },
    onError: (e) => messageApi.error(e.message),
  });

  const handleSubmit = async (values: FormValues) => {
    let price: string | null = null;
    if (isCreate && values.priceMode === "total") {
      if (typeof values.totalCost !== "number" || !values.quantity) {
        messageApi.error("请填写数量与总价以折算单价");
        return;
      }
      price = convertUnitPrice(values.totalCost, values.quantity);
    } else if (typeof values.price === "number") {
      price = values.price.toFixed(2);
    }
    save.mutate({
      name: values.name,
      categoryId: values.categoryId ?? null,
      ...(isCreate && { quantity: values.quantity ?? 0 }),
      spec: values.spec ?? null,
      price,
      color: values.color ?? null,
      purchaseUrl: values.purchaseUrl ?? null,
      imagePath,
      note: values.note ?? null,
      tags: values.tags ?? [],
    });
  };

  /** 关闭前检查表单值与图片是否有实际变化，避免误触遮罩/Esc 丢失输入 */
  const requestClose = () => {
    const dirty =
      JSON.stringify(form.getFieldsValue()) + "|" + (imagePath ?? "") !== initialSnapshot.current;
    if (!dirty) {
      onClose();
      return;
    }
    modalApi.confirm({
      title: "放弃未保存的修改？",
      content: "关闭后本次填写的内容将丢失",
      okText: "放弃修改",
      okButtonProps: { danger: true },
      cancelText: "继续编辑",
      onOk: () => onClose(),
    });
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const compressed = await compressImage(file);
      const fd = new FormData();
      fd.append("file", compressed);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = (await res.json()) as { path?: string; error?: string };
      if (!res.ok || !data.path) throw new Error(data.error ?? "上传失败");
      setImagePath(data.path);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Drawer
      title={isCreate ? "新建物品" : "编辑物品"}
      open={open}
      onClose={requestClose}
      width={isMobile ? "100%" : 480}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={requestClose}>取消</Button>
          <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
            保存
          </Button>
        </div>
      }
    >
      {contextHolder}
      {modalHolder}
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, whitespace: true, message: "请输入物品名称" }]}
        >
          <Input placeholder="如：M3 螺丝 / USB-C 数据线" />
        </Form.Item>

        <Form.Item
          name="categoryId"
          label="分类"
          // 选中「创建」占位项时不写入表单，保持原值，等创建成功后填入真实 id
          getValueFromEvent={(v: unknown) =>
            v === CREATE_KEY ? form.getFieldValue("categoryId") : v
          }
        >
          <Select
            showSearch
            placeholder="选择或输入新分类后回车"
            allowClear
            options={categoryOptions}
            // 忽略大小写的包含匹配；「创建」项始终保留在列表中
            filterOption={(input, option) =>
              option?.value === CREATE_KEY ||
              String(option?.label ?? "").toLowerCase().includes(input.trim().toLowerCase())
            }
            onSearch={setCategorySearch}
            onBlur={() => setCategorySearch("")}
            onChange={(v) => {
              if (v === CREATE_KEY) {
                const kw = categorySearch.trim();
                if (kw) createCategory.mutate(kw);
              } else {
                setCategorySearch("");
              }
            }}
          />
        </Form.Item>

        <Form.Item
          name="quantity"
          label={isCreate ? "数量" : "当前库存"}
          rules={[{ required: true, message: "请输入数量" }]}
          extra={isCreate ? undefined : "库存变动请使用列表中的补货/扣减，会记入流水"}
        >
          <InputNumber min={0} precision={0} style={{ width: "100%" }} disabled={!isCreate} />
        </Form.Item>

        {isCreate ? (
          <>
            <Form.Item name="priceMode" label="价格录入方式">
              <Radio.Group
                options={[
                  { value: "unit", label: "按单价" },
                  { value: "total", label: "按数量 + 总价" },
                ]}
                optionType="button"
                buttonStyle="solid"
              />
            </Form.Item>
            {priceMode === "total" ? (
              <Form.Item
                name="totalCost"
                label="总价（元）"
                rules={[{ required: true, message: "请输入总价" }]}
                extra={
                  converted ? (
                    <Typography.Text type="secondary">折算单价 ≈ ¥{converted}（四舍五入到分）</Typography.Text>
                  ) : undefined
                }
              >
                <InputNumber min={0} precision={2} style={{ width: "100%" }} placeholder="本次采购花费" />
              </Form.Item>
            ) : (
              <Form.Item name="price" label="单价（元）">
                <InputNumber min={0} precision={2} style={{ width: "100%" }} />
              </Form.Item>
            )}
          </>
        ) : (
          <Form.Item name="price" label="单价（元）">
            <InputNumber min={0} precision={2} style={{ width: "100%" }} />
          </Form.Item>
        )}

        <Space style={{ display: "flex" }} size={12}>
          <Form.Item name="spec" label="规格" style={{ flex: 1, minWidth: 180 }}>
            <Input placeholder="如：M3×10 / 500ml" />
          </Form.Item>
          <Form.Item name="color" label="颜色" style={{ flex: 1, minWidth: 120 }}>
            <Input placeholder="如 黑色" />
          </Form.Item>
        </Space>

        <Form.Item name="purchaseUrl" label="购买链接">
          <Input placeholder="https://..." />
        </Form.Item>

        <Form.Item name="tags" label="标签">
          <Select
            mode="tags"
            placeholder="输入后回车创建，如：待补货"
            options={tagOptions}
            tokenSeparators={[","]}
            maxTagCount="responsive"
          />
        </Form.Item>

        <Form.Item label="图片" extra="上传前自动压缩（长边 ≤1280px，JPEG 0.8）">
          {imagePath ? (
            <div style={{ position: "relative", display: "inline-block" }}>
              <Image
                src={imagePath}
                width={96}
                height={96}
                style={{ objectFit: "cover", borderRadius: token.borderRadius }}
              />
              <Button
                size="small"
                danger
                shape="circle"
                icon={<DeleteOutlined />}
                style={{ position: "absolute", top: -8, right: -8 }}
                onClick={() => setImagePath(null)}
              />
            </div>
          ) : (
            <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => {
              void uploadImage(file);
              return false;
            }} disabled={uploading}>
              <Button icon={<InboxOutlined />} loading={uploading}>
                {uploading ? "上传中…" : "选择图片"}
              </Button>
            </Upload>
          )}
        </Form.Item>

        <Form.Item name="note" label="备注">
          <Input.TextArea rows={2} placeholder="购买渠道、参数等补充信息" />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
