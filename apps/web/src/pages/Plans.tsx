import { useState } from "react";
import { Button, Card, Col, Empty, Flex, Grid, Row, Spin, Tag, Typography, message, theme } from "antd";
import { ExperimentOutlined, PlusOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import type { PlanDetail, PlanSummary } from "../types";
import { formatMoney, formatTime } from "../utils/format";
import PlanEditor from "../components/PlanEditor";

function FeasibleBadge({ feasible }: { feasible: number | null }) {
  if (feasible === null) return <Tag>无明细</Tag>;
  if (feasible === 0) return <Tag color="error">无法制作</Tag>;
  return <Tag color="success">可做 {feasible} 份</Tag>;
}

export default function PlansPage() {
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const navigate = useNavigate();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<PlanDetail | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  const { data, isLoading } = useQuery({
    queryKey: ["plans"],
    queryFn: () => api<{ items: PlanSummary[] }>("/plans"),
  });

  const plans = data?.items ?? [];

  return (
    <Flex vertical gap={12}>
      {contextHolder}
      <Flex justify="space-between" align="center">
        <Typography.Title level={5} style={{ margin: 0 }}>
          方案
        </Typography.Title>
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
        >
          新建方案
        </Button>
      </Flex>

      <Spin spinning={isLoading}>
        {plans.length === 0 ? (
          <Empty description="还没有方案，点击「新建方案」创建" style={{ padding: "48px 0" }} />
        ) : (
          <Row gutter={[12, 12]}>
            {plans.map((p) => (
              <Col xs={24} md={12} key={p.id}>
                <Card
                  size="small"
                  hoverable
                  style={{ height: "100%" }}
                  styles={{ body: { padding: 12, height: "100%", display: "flex", flexDirection: "column" } }}
                  onClick={() => navigate(`/plans/${p.id}`)}
                >
                  <Flex vertical gap={6} style={{ height: "100%" }}>
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
                        <ExperimentOutlined /> {p.itemCount} 种元件
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
    </Flex>
  );
}
