import { useState } from "react";
import { Button, Card, Col, Empty, Flex, Grid, Row, Space, Spin, Typography, message, theme } from "antd";
import { ExperimentOutlined, ImportOutlined, PlusOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { api } from "../api/client";
import type { PlanDetail, PlanSummary } from "../types";
import { formatMoney, formatTime } from "../utils/format";
import PlanEditor from "../components/PlanEditor";
import PlanBomImport from "../components/PlanBomImport";
import FeasibleBadge from "../components/FeasibleBadge";

export default function PlansPage() {
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const navigate = useNavigate();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<PlanDetail | null>(null);
  const [bomOpen, setBomOpen] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const { data, isLoading } = useQuery({
    queryKey: ["plans"],
    queryFn: () => api<{ items: PlanSummary[] }>("/plans"),
  });

  const plans = data?.items ?? [];

  return (
    <Flex vertical gap={16}>
      {contextHolder}
      {/* 页面标题由顶栏展示，这里只保留操作区 */}
      <Flex justify="flex-end">
        <Space>
          <Button icon={<ImportOutlined />} onClick={() => setBomOpen(true)}>
            导入 BOM
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => {
            setEditing(null);
            setEditorOpen(true);
          }}>
            新建方案
          </Button>
        </Space>
      </Flex>

      <Spin spinning={isLoading}>
        {plans.length === 0 ? (
          <Empty description="还没有方案，点击「新建方案」创建" style={{ padding: "48px 0" }} />
        ) : (
          <Row gutter={[16, 16]}>
            {plans.map((p) => (
              <Col xs={24} md={12} key={p.id}>
                <Link
                  to={`/plans/${p.id}`}
                  style={{ display: "block", height: "100%", color: "inherit" }}
                  aria-label={`打开方案 ${p.name}`}
                >
                <Card
                  hoverable
                  style={{ height: "100%" }}
                  styles={{ body: { padding: 16, height: "100%", display: "flex", flexDirection: "column" } }}
                >
                  <Flex vertical gap={8} style={{ height: "100%" }}>
                    <Flex justify="space-between" align="center" gap={8}>
                      <Typography.Text strong ellipsis style={{ flex: 1 }}>
                        {p.name}
                      </Typography.Text>
                      <FeasibleBadge feasible={p.feasible} />
                    </Flex>
                    {p.description && (
                      <Typography.Paragraph
                        type="secondary"
                        ellipsis={{ rows: 2 }}
                        style={{ marginBottom: 0, fontSize: 12, minHeight: isMobile ? undefined : 0 }}
                      >
                        {p.description}
                      </Typography.Paragraph>
                    )}
                    <Flex gap={12} wrap="wrap" style={{ marginTop: "auto", fontSize: 12 }} align="center">
                      <span>
                        <ExperimentOutlined /> {p.itemCount} 种物品
                      </span>
                      <span>1 份 {formatMoney(p.totalCost1)}</span>
                      <span style={p.shortageCount > 0 ? { color: token.colorError } : undefined}>
                        {p.shortageCount > 0 ? `缺料 ${p.shortageCount} 项` : "无缺料"}
                      </span>
                      <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: "auto" }}>
                        {formatTime(p.updatedAt)}
                      </Typography.Text>
                    </Flex>
                  </Flex>
                </Card>
                </Link>
              </Col>
            ))}
          </Row>
        )}
      </Spin>

      <PlanEditor
        open={editorOpen}
        editing={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={() => messageApi.success("方案已保存")}
      />

      <PlanBomImport
        open={bomOpen}
        onClose={() => setBomOpen(false)}
        onImported={(id, created) => {
          setBomOpen(false);
          messageApi.success(created > 0 ? `方案已创建，并新增 ${created} 项物品到物品库` : "方案已创建");
          navigate(`/plans/${id}`);
        }}
      />
    </Flex>
  );
}
