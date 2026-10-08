import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Empty,
  Flex,
  Grid,
  Image,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
  theme,
} from "antd";
import {
  AppstoreOutlined,
  DeleteOutlined,
  EditOutlined,
  ImportOutlined,
  MinusOutlined,
  PlusOutlined,
  SettingOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json } from "../api/client";
import type { Category, ComponentItem, Paged, Tag as TagItem, TrashItem } from "../types";
import { formatMoney, formatTime } from "../utils/format";
import ComponentFormDrawer from "../components/ComponentFormDrawer";
import StockModal from "../components/StockModal";
import CategoryManageModal from "../components/CategoryManageModal";

const SORT_OPTIONS = [
  { value: "updated_desc", label: "最近修改" },
  { value: "updated_asc", label: "最早修改" },
  { value: "name_asc", label: "名称" },
  { value: "quantity_asc", label: "库存少 → 多" },
  { value: "price_desc", label: "单价高 → 低" },
];

export default function ComponentsPage() {
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [sort, setSort] = useState("updated_desc");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ComponentItem | null>(null);
  const [stockTarget, setStockTarget] = useState<ComponentItem | null>(null);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [view, setView] = useState<"all" | "trash">("all");

  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (categoryId !== undefined) p.set("categoryId", String(categoryId));
    if (tagIds.length > 0) p.set("tagIds", tagIds.join(","));
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    p.set("sort", sort);
    return p.toString();
  }, [q, categoryId, tagIds, page, sort]);

  const { data, isLoading } = useQuery({
    queryKey: ["components", queryString],
    queryFn: () => api<Paged<ComponentItem>>(`/components?${queryString}`),
  });
  const { data: catData } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api<{ items: Category[] }>("/categories"),
  });
  const { data: tagData } = useQuery({
    queryKey: ["tags"],
    queryFn: () => api<{ items: TagItem[] }>("/tags"),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["components"] });
    queryClient.invalidateQueries({ queryKey: ["categories"] });
    queryClient.invalidateQueries({ queryKey: ["tags"] });
    // 库存/回收站变化会影响统计与方案计算
    queryClient.invalidateQueries({ queryKey: ["stats"] });
    queryClient.invalidateQueries({ queryKey: ["plans"] });
    queryClient.invalidateQueries({ queryKey: ["plan"] });
    queryClient.invalidateQueries({ queryKey: ["feasibility"] });
  };

  const { data: trashData, isLoading: trashLoading } = useQuery({
    queryKey: ["components", "trash"],
    queryFn: () => api<{ items: TrashItem[] }>("/components/trash"),
    enabled: view === "trash",
  });

  const quickAdjust = useMutation({
    mutationFn: ({ id, delta }: { id: number; delta: number }) =>
      api(`/components/${id}/quantity`, { method: "PATCH", ...json({ delta, reason: "快捷调整" }) }),
    onSuccess: invalidateAll,
    onError: (e) => messageApi.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/components/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      messageApi.success("已移入回收站");
      invalidateAll();
    },
    onError: (e) => messageApi.error(e.message),
  });

  const restore = useMutation({
    mutationFn: (id: number) => api(`/components/${id}/restore`, { method: "POST" }),
    onSuccess: () => {
      messageApi.success("已还原");
      invalidateAll();
    },
    onError: (e) => messageApi.error(e.message),
  });

  const hardRemove = useMutation({
    mutationFn: (id: number) => api(`/components/${id}/hard`, { method: "DELETE" }),
    onSuccess: () => {
      messageApi.success("已彻底删除");
      invalidateAll();
    },
    onError: (e) => messageApi.error(e.message),
  });

  const openCreate = () => {
    setEditing(null);
    setDrawerOpen(true);
  };
  const openEdit = (item: ComponentItem) => {
    setEditing(item);
    setDrawerOpen(true);
  };

  const quantityControl = (item: ComponentItem) => (
    <Space size={2}>
      <Button
        size="small"
        icon={<MinusOutlined />}
        disabled={item.quantity <= 0}
        loading={quickAdjust.isPending && quickAdjust.variables?.id === item.id}
        onClick={() => quickAdjust.mutate({ id: item.id, delta: -1 })}
      />
      <span
        style={{
          minWidth: 36,
          textAlign: "center",
          fontWeight: 600,
          lineHeight: "22px",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {item.quantity}
      </span>
      <Button
        size="small"
        icon={<PlusOutlined />}
        loading={quickAdjust.isPending && quickAdjust.variables?.id === item.id}
        onClick={() => quickAdjust.mutate({ id: item.id, delta: 1 })}
      />
    </Space>
  );

  const deleteButton = (item: ComponentItem) => (
    <Popconfirm
      title="删除元件"
      description={`「${item.name}」将移入回收站，可在 30 天内还原`}
      okButtonProps={{ danger: true }}
      onConfirm={() => remove.mutate(item.id)}
    >
      <Button size="small" danger type="text">
        删除
      </Button>
    </Popconfirm>
  );

  const thumbnail = (item: { imagePath: string | null }, size: number) =>
    item.imagePath ? (
      <Image
        src={item.imagePath}
        width={size}
        height={size}
        style={{ objectFit: "cover", borderRadius: token.borderRadius }}
      />
    ) : (
      <Flex
        align="center"
        justify="center"
        style={{
          width: size,
          height: size,
          borderRadius: token.borderRadius,
          background: token.colorFillTertiary,
          color: token.colorTextQuaternary,
          fontSize: 18,
        }}
      >
        <AppstoreOutlined />
      </Flex>
    );

  const actionButtons = (item: ComponentItem) => (
    <Space size={0}>
      <Button size="small" type="text" icon={<ImportOutlined />} onClick={() => setStockTarget(item)}>
        补货
      </Button>
      <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(item)}>
        编辑
      </Button>
      {deleteButton(item)}
    </Space>
  );

  const columns = [
    {
      title: "图片",
      dataIndex: "imagePath",
      width: 64,
      render: (_: unknown, item: ComponentItem) => thumbnail(item, 40),
    },
    {
      title: "名称",
      dataIndex: "name",
      render: (_: unknown, item: ComponentItem) => (
        <div>
          <div style={{ fontWeight: 500 }}>{item.name}</div>
          {(item.spec || item.color) && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {[item.spec, item.color].filter(Boolean).join(" · ")}
            </Typography.Text>
          )}
        </div>
      ),
    },
    {
      title: "分类",
      dataIndex: "categoryName",
      width: 100,
      render: (v: string | null) => v ?? <Typography.Text type="secondary">未分类</Typography.Text>,
    },
    {
      title: "数量",
      dataIndex: "quantity",
      width: 120,
      render: (_: unknown, item: ComponentItem) => quantityControl(item),
    },
    {
      title: "单价",
      dataIndex: "price",
      width: 80,
      render: (v: string | null) => formatMoney(v),
    },
    {
      title: "标签",
      dataIndex: "tags",
      render: (tags: ComponentItem["tags"]) =>
        tags.length > 0 ? (
          <Flex gap={4} wrap="wrap">
            {tags.map((t) => (
              <Tag key={t.id} style={{ marginInlineEnd: 0 }}>
                {t.name}
              </Tag>
            ))}
          </Flex>
        ) : null,
    },
    {
      title: "修改时间",
      dataIndex: "updatedAt",
      width: 100,
      render: (v: string) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {formatTime(v)}
        </Typography.Text>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 200,
      render: (_: unknown, item: ComponentItem) => actionButtons(item),
    },
  ];

  const filterBar = (
    <Flex gap={8} wrap="wrap" style={{ marginBottom: 12 }}>
      <Input.Search
        placeholder="搜索名称 / 规格"
        allowClear
        onSearch={(v) => {
          setQ(v.trim());
          setPage(1);
        }}
        style={{ width: isMobile ? "100%" : 200 }}
      />
      <Select
        placeholder="分类"
        allowClear
        value={categoryId}
        onChange={(v) => {
          setCategoryId(v);
          setPage(1);
        }}
        options={(catData?.items ?? []).map((c) => ({ value: c.id, label: c.name }))}
        style={{ width: 130 }}
      />
      <Select
        mode="multiple"
        placeholder="标签"
        allowClear
        value={tagIds}
        onChange={(v) => {
          setTagIds(v);
          setPage(1);
        }}
        options={(tagData?.items ?? []).map((t) => ({ value: t.id, label: t.name }))}
        maxTagCount="responsive"
        style={{ minWidth: 140, maxWidth: isMobile ? "100%" : 240 }}
      />
      <Select value={sort} onChange={setSort} options={SORT_OPTIONS} style={{ width: 130 }} />
      <Flex flex={1} justify="flex-end" gap={8}>
        <Button icon={<SettingOutlined />} onClick={() => setCatModalOpen(true)}>
          分类
        </Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建元件
        </Button>
      </Flex>
    </Flex>
  );

  const trashColumns = [
    {
      title: "图片",
      dataIndex: "imagePath",
      width: 64,
      render: (_: unknown, item: TrashItem) => thumbnail(item, 40),
    },
    {
      title: "名称",
      dataIndex: "name",
      render: (_: unknown, item: TrashItem) => (
        <div>
          <div style={{ fontWeight: 500 }}>{item.name}</div>
          {item.spec && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {item.spec}
            </Typography.Text>
          )}
        </div>
      ),
    },
    {
      title: "分类",
      dataIndex: "categoryName",
      width: 100,
      render: (v: string | null) => v ?? <Typography.Text type="secondary">未分类</Typography.Text>,
    },
    { title: "数量", dataIndex: "quantity", width: 70, align: "right" as const },
    {
      title: "删除时间",
      dataIndex: "deletedAt",
      width: 110,
      render: (v: string) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {formatTime(v)}
        </Typography.Text>
      ),
    },
    {
      title: "剩余天数",
      dataIndex: "daysLeft",
      width: 90,
      render: (v: number) => <Tag color={v <= 5 ? "error" : "default"}>{v} 天</Tag>,
    },
    {
      title: "操作",
      key: "actions",
      width: 190,
      render: (_: unknown, item: TrashItem) => (
        <Space size={0}>
          <Popconfirm title="还原该元件？" onConfirm={() => restore.mutate(item.id)}>
            <Button size="small" type="text" icon={<UndoOutlined />}>
              还原
            </Button>
          </Popconfirm>
          <Popconfirm
            title="彻底删除"
            description="将同时清除图片与流水，且不可恢复，确定？"
            okButtonProps={{ danger: true }}
            onConfirm={() => hardRemove.mutate(item.id)}
          >
            <Button size="small" danger type="text" icon={<DeleteOutlined />}>
              彻底删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const trashPane = (
    <>
      {isMobile ? (
        <>
          <Flex vertical gap={8}>
            {(trashData?.items ?? []).map((item) => (
              <Flex
                key={item.id}
                vertical
                gap={8}
                style={{
                  padding: 10,
                  borderRadius: token.borderRadiusLG,
                  border: `1px solid ${token.colorBorderSecondary}`,
                }}
              >
                <Flex gap={10} align="flex-start" style={{ minWidth: 0 }}>
                  {thumbnail(item, 48)}
                  <Flex vertical flex={1} style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{item.name}</div>
                    {item.spec && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                        {item.spec}
                      </Typography.Text>
                    )}
                    <Flex gap={8} align="center" style={{ marginTop: 2 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        数量 {item.quantity}
                      </Typography.Text>
                      <Tag
                        color={item.daysLeft <= 5 ? "error" : "default"}
                        style={{ marginInlineEnd: 0, lineHeight: "16px", fontSize: 11 }}
                      >
                        {item.daysLeft} 天
                      </Tag>
                    </Flex>
                  </Flex>
                </Flex>
                <Flex justify="space-between" align="center">
                  <Typography.Text type="secondary" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                    删除于 {formatTime(item.deletedAt)}
                  </Typography.Text>
                  <Space size={0}>
                    <Popconfirm title="还原该元件？" onConfirm={() => restore.mutate(item.id)}>
                      <Button size="small" type="text" icon={<UndoOutlined />} />
                    </Popconfirm>
                    <Popconfirm
                      title="彻底删除"
                      description="将同时清除图片与流水，且不可恢复，确定？"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => hardRemove.mutate(item.id)}
                    >
                      <Button size="small" danger type="text" icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                </Flex>
              </Flex>
            ))}
          </Flex>
          {(trashData?.items.length ?? 0) === 0 && !trashLoading && (
            <Empty description="回收站为空" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 24 }} />
          )}
        </>
      ) : (
        <Table
          size="small"
          rowKey="id"
          loading={trashLoading}
          columns={trashColumns}
          dataSource={trashData?.items ?? []}
          scroll={{ x: 720 }}
          pagination={false}
          locale={{ emptyText: <Empty description="回收站为空" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
      )}
      {(trashData?.items.length ?? 0) > 0 && (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
          回收站元件保留 30 天后自动清理；彻底删除将同时清除图片与流水，不可恢复
        </Typography.Text>
      )}
    </>
  );

  return (
    <Card styles={{ body: { padding: 12 } }}>
      {contextHolder}
      <Tabs
        size="small"
        activeKey={view}
        onChange={(k) => setView(k as "all" | "trash")}
        items={[
          {
            key: "all",
            label: "全部",
            children: (
              <>
                {filterBar}

                {isMobile ? (
                  <>
                    <Flex vertical gap={8}>
                      {data?.items.map((item) => (
                        <Flex
                          key={item.id}
                          vertical
                          gap={8}
                          style={{
                            padding: 10,
                            borderRadius: token.borderRadiusLG,
                            border: `1px solid ${token.colorBorderSecondary}`,
                          }}
                        >
                          <Flex gap={10} align="flex-start" style={{ minWidth: 0 }}>
                            {thumbnail(item, 48)}
                            <Flex vertical flex={1} style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 500 }}>{item.name}</div>
                              <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                                {[item.categoryName ?? "未分类", item.spec, item.color]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </Typography.Text>
                            </Flex>
                            <Typography.Text
                              strong
                              style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
                            >
                              {formatMoney(item.price)}
                            </Typography.Text>
                          </Flex>
                          {item.tags.length > 0 && (
                            <Flex gap={4} wrap="wrap">
                              {item.tags.map((t) => (
                                <Tag
                                  key={t.id}
                                  style={{ marginInlineEnd: 0, lineHeight: "16px", fontSize: 11 }}
                                >
                                  {t.name}
                                </Tag>
                              ))}
                            </Flex>
                          )}
                          <Flex justify="space-between" align="center">
                            {quantityControl(item)}
                            <Flex align="center" gap={4} style={{ minWidth: 0 }}>
                              <Typography.Text
                                type="secondary"
                                style={{ fontSize: 11, whiteSpace: "nowrap" }}
                              >
                                {formatTime(item.updatedAt)}
                              </Typography.Text>
                              <Space size={0}>
                                <Button
                                  size="small"
                                  type="text"
                                  icon={<ImportOutlined />}
                                  onClick={() => setStockTarget(item)}
                                />
                                <Button
                                  size="small"
                                  type="text"
                                  icon={<EditOutlined />}
                                  onClick={() => openEdit(item)}
                                />
                                <Popconfirm
                                  title="删除元件"
                                  description={`「${item.name}」将移入回收站，可在 30 天内还原`}
                                  okButtonProps={{ danger: true }}
                                  onConfirm={() => remove.mutate(item.id)}
                                >
                                  <Button size="small" danger type="text" icon={<DeleteOutlined />} />
                                </Popconfirm>
                              </Space>
                            </Flex>
                          </Flex>
                        </Flex>
                      ))}
                    </Flex>
                    {(data?.items.length ?? 0) === 0 && !isLoading && (
                      <Empty description="暂无元件" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 24 }} />
                    )}
                    <Flex justify="flex-end" style={{ marginTop: 12 }}>
                      <Pagination data={data} onChange={setPage} />
                    </Flex>
                  </>
                ) : (
        <Table
          size="small"
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={data?.items ?? []}
          locale={{ emptyText: <Empty description="暂无元件，点击右上角「新建元件」录入" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          pagination={{
            current: page,
            pageSize,
            total: data?.total ?? 0,
            onChange: setPage,
            showTotal: (t) => `共 ${t} 件`,
            size: "default",
          }}
        />
                )}
              </>
            ),
          },
          { key: "trash", label: "回收站", children: trashPane },
        ]}
      />

      <ComponentFormDrawer
        open={drawerOpen}
        editing={editing}
        onClose={() => setDrawerOpen(false)}
        onSaved={invalidateAll}
      />
      <StockModal
        open={stockTarget !== null}
        component={stockTarget}
        onClose={() => setStockTarget(null)}
        onSaved={invalidateAll}
      />
      <CategoryManageModal open={catModalOpen} onClose={() => setCatModalOpen(false)} />
    </Card>
  );
}

function Pagination({
  data,
  onChange,
}: {
  data?: Paged<ComponentItem>;
  onChange: (page: number) => void;
}) {
  if (!data || data.total <= data.pageSize) return null;
  return (
    <Flex gap={8} align="center">
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        共 {data.total} 件 · 第 {data.page} / {Math.ceil(data.total / data.pageSize)} 页
      </Typography.Text>
      <Button size="small" disabled={data.page <= 1} onClick={() => onChange(data.page - 1)}>
        上一页
      </Button>
      <Button
        size="small"
        disabled={data.page >= Math.ceil(data.total / data.pageSize)}
        onClick={() => onChange(data.page + 1)}
      >
        下一页
      </Button>
    </Flex>
  );
}
