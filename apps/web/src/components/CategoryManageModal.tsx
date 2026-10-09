import { useEffect, useState } from "react";
import {
  Button,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Typography,
  message,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json } from "../api/client";
import type { Category } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CategoryManageModal({ open, onClose }: Props) {
  const [name, setName] = useState("");
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api<{ items: Category[] }>("/categories"),
    enabled: open,
  });

  // 分类增删改会影响物品列表的分类列与看板的分类分布
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["categories"] });
    queryClient.invalidateQueries({ queryKey: ["components"] });
    queryClient.invalidateQueries({ queryKey: ["stats"] });
  };

  const create = useMutation({
    mutationFn: (n: string) => api("/categories", { method: "POST", ...json({ name: n }) }),
    onSuccess: () => {
      setName("");
      invalidate();
    },
    onError: (e) => messageApi.error(e.message),
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: number; name?: string; sortOrder?: number }) =>
      api(`/categories/${id}`, { method: "PUT", ...json(body) }),
    onSuccess: invalidate,
    onError: (e) => messageApi.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/categories/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (e) => messageApi.error(e.message),
  });

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  return (
    <Modal
      title="分类管理"
      open={open}
      onCancel={onClose}
      footer={null}
      width={480}
      destroyOnHidden
      styles={{
        body: {
          // 弹窗整体不超过视口高度，内容区超出时内部滚动
          maxHeight: "calc(100vh - 180px)",
          overflowY: "auto",
          overflowX: "hidden",
        },
      }}
    >
      {contextHolder}
      <Space.Compact block style={{ marginBottom: 12 }}>
        <Input
          placeholder="新分类名称，如：MCU / 开关 / 电容"
          value={name}
          maxLength={50}
          onChange={(e) => setName(e.target.value)}
          onPressEnter={() => name.trim() && create.mutate(name.trim())}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!name.trim()}
          loading={create.isPending}
          onClick={() => name.trim() && create.mutate(name.trim())}
        >
          添加
        </Button>
      </Space.Compact>

      <Table
        size="small"
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items ?? []}
        locale={{ emptyText: <Empty description="暂无分类" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        pagination={false}
        columns={[
          {
            title: "名称",
            dataIndex: "name",
            render: (v: string, r) => (
              <Typography.Text
                editable={{
                  tooltip: "点击编辑名称",
                  onChange: (next) => {
                    const n = next.trim();
                    if (n && n !== v) update.mutate({ id: r.id, name: n });
                  },
                }}
              >
                {v}
              </Typography.Text>
            ),
          },
          {
            title: "物品数",
            dataIndex: "componentCount",
            width: 80,
          },
          {
            title: "排序",
            dataIndex: "sortOrder",
            width: 90,
            render: (v: number, r) => (
              <InputNumber
                size="small"
                value={v}
                onChange={(n) => typeof n === "number" && n !== v && update.mutate({ id: r.id, sortOrder: n })}
              />
            ),
          },
          {
            title: "",
            width: 70,
            render: (_, r) => (
              <Popconfirm
                title="删除分类"
                description={
                  r.componentCount > 0
                    ? `有 ${r.componentCount} 个物品引用，删除后它们将变为「未分类」`
                    : "确定删除该分类？"
                }
                okButtonProps={{ danger: true }}
                onConfirm={() => remove.mutate(r.id)}
              >
                <Button size="small" danger type="text">
                  删除
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />
    </Modal>
  );
}
