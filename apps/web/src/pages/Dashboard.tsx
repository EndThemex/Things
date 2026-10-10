import { Card, Col, Empty, Flex, Image, Row, Spin, Typography, theme } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../api/client";
import type { StatsOverview } from "../types";
import { formatMoney, formatTime } from "../utils/format";

/** 图表固定纯色色板（明暗主题通用，不含渐变） */
const PALETTE = [
  "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#0ea5e9",
];
const UNCATEGORIZED_COLOR = "#94a3b8";

function Donut({
  data,
  size,
  stroke,
  centerValue,
  centerLabel,
}: {
  data: { name: string; value: number; color: string }[];
  size: number;
  stroke: number;
  centerValue: string;
  centerLabel: string;
}) {
  const { token } = theme.useToken();
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="分类数量分布">
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={token.colorFillSecondary} strokeWidth={stroke} />
        {total > 0 &&
          data.map((d) => {
            const dash = (d.value / total) * c;
            const el = (
              <circle
                key={d.name}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return el;
          })}
      </g>
      <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" fontSize={22} fontWeight={700} fill={token.colorText}>
        {centerValue}
      </text>
      <text x="50%" y="61%" textAnchor="middle" dominantBaseline="middle" fontSize={12} fill={token.colorTextSecondary}>
        {centerLabel}
      </text>
    </svg>
  );
}

export default function DashboardPage() {
  const { token } = theme.useToken();
  const { data, isLoading } = useQuery({
    queryKey: ["stats"],
    queryFn: () => api<StatsOverview>("/stats/overview"),
  });

  const summary = data?.summary;
  const pieData = (data?.categoryDistribution ?? []).map((c, i) => ({
    name: c.name,
    value: c.quantity,
    color: c.id === null ? UNCATEGORIZED_COLOR : PALETTE[i % PALETTE.length],
  }));
  const maxLow = Math.max(1, ...(data?.lowStock ?? []).map((l) => l.quantity));
  const totalQuantity = pieData.reduce((s, d) => s + d.value, 0);

  const statCards = [
    { title: "物品种类数", value: summary ? String(summary.kinds) : "-" },
    { title: "总数量", value: summary ? String(summary.totalQuantity) : "-" },
    { title: "总价值", value: summary ? formatMoney(summary.totalValue) : "-" },
  ];

  return (
    <Spin spinning={isLoading}>
      <Flex vertical gap={12}>
        {/* 概览卡片：窄屏缩小字号，避免三列挤压 */}
        <Row gutter={12}>
          {statCards.map((s) => (
            <Col xs={8} key={s.title}>
              <Card size="small" styles={{ body: { padding: "10px 8px" } }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {s.title}
                </Typography.Text>
                <div
                  style={{
                    fontSize: "clamp(15px, 4.2vw, 22px)",
                    fontWeight: 700,
                    lineHeight: 1.3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {s.value}
                </div>
              </Card>
            </Col>
          ))}
        </Row>

        <Row gutter={12}>
          {/* 分类数量分布（饼图） */}
          <Col xs={24} lg={12}>
            <Card size="small" title="分类数量分布">
              {pieData.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无物品" />
              ) : (
                <Flex wrap="wrap" align="center" gap={16} justify="center">
                  <Donut data={pieData} size={168} stroke={26} centerValue={`${summary?.kinds ?? 0}`} centerLabel="种类" />
                  <Flex vertical gap={4} style={{ minWidth: 160, flex: 1 }}>
                    {data!.categoryDistribution.map((cat, i) => {
                      const pct = totalQuantity > 0 ? Math.round((cat.quantity / totalQuantity) * 100) : 0;
                      const color = cat.id === null ? UNCATEGORIZED_COLOR : PALETTE[i % PALETTE.length];
                      return (
                        <Link
                          key={`${cat.id ?? "none"}-${cat.name}`}
                          // 点击分类跳转到物品库并带上该分类筛选
                          to={
                            cat.id === null
                              ? "/components"
                              : `/components?categoryId=${cat.id}&sort=quantity_desc`
                          }
                          aria-label={`查看分类 ${cat.name}`}
                          style={{ color: "inherit", textDecoration: "none" }}
                        >
                          <Flex align="center" gap={8} style={{ width: "100%" }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {cat.name}
                            </span>
                            <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                              ×{cat.quantity}（{pct}%）
                            </Typography.Text>
                          </Flex>
                        </Link>
                      );
                    })}
                  </Flex>
                </Flex>
              )}
            </Card>
          </Col>

          {/* 数量最少 Top10 */}
          <Col xs={24} lg={12}>
            <Card size="small" title="数量最少 Top10">
              {(data?.lowStock ?? []).length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无物品" />
              ) : (
                <Flex vertical gap={8}>
                  {data!.lowStock.map((l) => (
                    <Link
                      key={l.id}
                      to={`/components?q=${encodeURIComponent(l.name)}`}
                      aria-label={`查看 ${l.name}`}
                      style={{ color: "inherit", textDecoration: "none" }}
                    >
                      <Flex align="center" gap={8}>
                        <Typography.Text ellipsis style={{ width: "42%", flexShrink: 0 }}>
                          {l.name}
                        </Typography.Text>
                        <div
                          style={{
                            flex: 1,
                            height: 6,
                            borderRadius: 3,
                            background: token.colorFillSecondary,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${(l.quantity / maxLow) * 100}%`,
                              height: "100%",
                              background: token.colorPrimary,
                            }}
                          />
                        </div>
                        <Typography.Text style={{ width: 36, textAlign: "right", fontSize: 12, flexShrink: 0 }}>
                          ×{l.quantity}
                        </Typography.Text>
                      </Flex>
                    </Link>
                  ))}
                </Flex>
              )}
            </Card>
          </Col>
        </Row>

        {/* 最近修改 */}
        <Card size="small" title="最近修改">
          {(data?.recent ?? []).length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无物品" />
          ) : (
            <Flex vertical gap={8}>
              {data!.recent.map((r) => (
                <Link
                  key={r.id}
                  to={`/components?q=${encodeURIComponent(r.name)}`}
                  aria-label={`查看 ${r.name}`}
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  <Flex align="center" gap={8}>
                    {r.imagePath ? (
                      <Image
                        src={r.imagePath}
                        width={28}
                        height={28}
                        style={{ objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
                        preview={false}
                      />
                    ) : (
                      <span style={{ width: 28, height: 28, borderRadius: 4, background: token.colorFillSecondary, flexShrink: 0 }} />
                    )}
                    <Flex vertical style={{ flex: 1, minWidth: 0 }}>
                      <Typography.Text ellipsis style={{ lineHeight: 1.3 }}>
                        {r.name}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: 1.3 }}>
                        {r.categoryName ?? "未分类"} · {formatMoney(r.price)}
                      </Typography.Text>
                    </Flex>
                    <span style={{ flexShrink: 0 }}>
                      <Typography.Text strong>×{r.quantity}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                        {formatTime(r.updatedAt)}
                      </Typography.Text>
                    </span>
                  </Flex>
                </Link>
              ))}
            </Flex>
          )}
        </Card>
      </Flex>
    </Spin>
  );
}
