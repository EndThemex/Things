import { Card, Col, Empty, Flex, Image, Row, Spin, Tag, Typography, theme } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../api/client";
import type { PlanSummary, StatsOverview } from "../types";
import { formatMoney, formatTime } from "../utils/format";
import FeasibleBadge from "../components/FeasibleBadge";

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

/** 近 14 天出入库趋势：手写 SVG 双色并列柱状图（入绿出红） */
function TrendBars({ data }: { data: { date: string; inbound: number; outbound: number }[] }) {
  const { token } = theme.useToken();
  const W = 560;
  const H = 170;
  const padL = 30;
  const padR = 8;
  const padT = 12;
  const padB = 22;
  const max = Math.max(1, ...data.map((d) => Math.max(d.inbound, d.outbound)));
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const slot = innerW / data.length;
  const bw = slot * 0.32;
  const yOf = (v: number) => padT + innerH - (v / max) * innerH;
  const hOf = (v: number) => (v <= 0 ? 0 : Math.max(2, (v / max) * innerH));
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label="近14天出入库趋势"
    >
      {/* 顶部网格线与刻度 */}
      <line x1={padL} y1={yOf(max)} x2={W - padR} y2={yOf(max)} stroke={token.colorFillSecondary} strokeWidth={1} />
      <text x={padL - 4} y={yOf(max) + 3} textAnchor="end" fontSize={10} fill={token.colorTextTertiary}>
        {max}
      </text>
      {/* 基线与零刻度 */}
      <line x1={padL} y1={yOf(0)} x2={W - padR} y2={yOf(0)} stroke={token.colorSplit} strokeWidth={1} />
      <text x={padL - 4} y={yOf(0) + 3} textAnchor="end" fontSize={10} fill={token.colorTextTertiary}>
        0
      </text>
      {data.map((d, i) => {
        const cx = padL + i * slot + slot / 2;
        const inX = cx - bw - 1;
        const outX = cx + 1;
        return (
          <g key={d.date}>
            {d.inbound > 0 && (
              <rect x={inX} y={yOf(d.inbound)} width={bw} height={hOf(d.inbound)} rx={1} fill={token.colorSuccess}>
                <title>{`${d.date} 入库 ${d.inbound}`}</title>
              </rect>
            )}
            {d.outbound > 0 && (
              <rect x={outX} y={yOf(d.outbound)} width={bw} height={hOf(d.outbound)} rx={1} fill={token.colorError}>
                <title>{`${d.date} 出库 ${d.outbound}`}</title>
              </rect>
            )}
            {/* x 轴标签隔天显示，避免窄屏重叠 */}
            {i % 2 === 0 && (
              <text x={cx} y={H - 6} textAnchor="middle" fontSize={10} fill={token.colorTextTertiary}>
                {d.date.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function DashboardPage() {
  const { token } = theme.useToken();
  const { data, isLoading } = useQuery({
    queryKey: ["stats"],
    queryFn: () => api<StatsOverview>("/stats/overview"),
  });
  // 与方案页共用 queryKey，TanStack Query 自动共享缓存
  const { data: plansData, isLoading: plansLoading } = useQuery({
    queryKey: ["plans"],
    queryFn: () => api<{ items: PlanSummary[] }>("/plans"),
  });

  const summary = data?.summary;
  const plans = plansData?.items ?? [];
  const shortagePlans = plans.filter((p) => p.shortageCount > 0);
  const feasibleCount = plans.filter((p) => (p.feasible ?? 0) > 0).length;

  const pieData = (data?.categoryDistribution ?? []).map((c, i) => ({
    name: c.name,
    value: c.quantity,
    color: c.id === null ? UNCATEGORIZED_COLOR : PALETTE[i % PALETTE.length],
  }));
  // 分类颜色映射（数量分布与价值分布共用，保证同一分类两图同色）
  const catColor = new Map<number | null, string>();
  (data?.categoryDistribution ?? []).forEach((c, i) => {
    catColor.set(c.id, c.id === null ? UNCATEGORIZED_COLOR : PALETTE[i % PALETTE.length]);
  });

  const maxLow = Math.max(1, ...(data?.lowStock ?? []).map((l) => l.quantity));
  const totalQuantity = pieData.reduce((s, d) => s + d.value, 0);

  const categoryValue = data?.categoryValueDistribution ?? [];
  const maxCatValue = Math.max(1, ...categoryValue.map((v) => Number(v.value)));
  const valueTop = data?.valueTop10 ?? [];
  const maxValueTop = Math.max(1, ...valueTop.map((v) => Number(v.value)));

  const trend = data?.movementTrend ?? [];
  const trendHasData = trend.some((t) => t.inbound > 0 || t.outbound > 0);

  // 方案速览：缺料的排前，取前 5 条
  const planBrief = [...plans]
    .sort((a, b) => Number(b.shortageCount > 0) - Number(a.shortageCount > 0))
    .slice(0, 5);

  const statCards: { title: string; value: string; alert?: boolean }[] = [
    { title: "物品种类数", value: summary ? String(summary.kinds) : "-" },
    { title: "总数量", value: summary ? String(summary.totalQuantity) : "-" },
    { title: "总价值", value: summary ? formatMoney(summary.totalValue) : "-" },
    { title: "分类数", value: summary ? String(summary.categoryCount) : "-" },
    { title: "零库存", value: summary ? String(summary.zeroStock) : "-", alert: (summary?.zeroStock ?? 0) > 0 },
    { title: "方案数", value: plansData ? String(plans.length) : "-" },
  ];

  return (
    <Spin spinning={isLoading}>
      <Flex vertical gap={12}>
        {/* 概览卡片：移动端 2 列、平板 3 列、桌面 6 列，字号自适应防溢出 */}
        <Row gutter={12}>
          {statCards.map((s) => (
            <Col xs={12} sm={8} md={4} key={s.title}>
              <Card size="small" styles={{ body: { padding: "10px 8px" } }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {s.title}
                </Typography.Text>
                <div
                  style={{
                    fontSize: "clamp(15px, 5vw, 22px)",
                    fontWeight: 700,
                    lineHeight: 1.3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: s.alert ? token.colorError : undefined,
                  }}
                >
                  {s.value}
                </div>
              </Card>
            </Col>
          ))}
        </Row>

        <Row gutter={12}>
          {/* 近 14 天出入库趋势 */}
          <Col xs={24} lg={16}>
            <Card size="small" title="近 14 天出入库趋势">
              <Flex vertical gap={4}>
                <Flex gap={12} align="center" style={{ fontSize: 12, color: token.colorTextSecondary }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: token.colorSuccess }} />
                    入库
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: token.colorError }} />
                    出库
                  </span>
                </Flex>
                {trend.length > 0 && <TrendBars data={trend} />}
                {data && !trendHasData && (
                  <Typography.Text type="secondary" style={{ fontSize: 12, textAlign: "center" }}>
                    近 14 天无出入库记录
                  </Typography.Text>
                )}
              </Flex>
            </Card>
          </Col>

          {/* 方案概览 */}
          <Col xs={24} lg={8}>
            <Card size="small" title="方案概览">
              {plansLoading ? (
                <Spin size="small" />
              ) : plans.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无方案" />
              ) : (
                <Flex vertical gap={8}>
                  <Flex gap={16} wrap="wrap" style={{ fontSize: 12 }}>
                    <Typography.Text>方案 {plans.length}</Typography.Text>
                    <Typography.Text style={shortagePlans.length > 0 ? { color: token.colorError } : undefined}>
                      缺料 {shortagePlans.length}
                    </Typography.Text>
                    <Typography.Text>可行 {feasibleCount}</Typography.Text>
                  </Flex>
                  {planBrief.map((p) => (
                    <Link
                      key={p.id}
                      to={`/plans/${p.id}`}
                      aria-label={`打开方案 ${p.name}`}
                      style={{ color: "inherit", textDecoration: "none" }}
                    >
                      <Flex align="center" gap={8}>
                        <Typography.Text ellipsis style={{ flex: 1, minWidth: 0 }}>
                          {p.name}
                        </Typography.Text>
                        <FeasibleBadge feasible={p.feasible} />
                        <Typography.Text
                          type="secondary"
                          style={{ fontSize: 12, flexShrink: 0, color: p.shortageCount > 0 ? token.colorError : undefined }}
                        >
                          {p.shortageCount > 0 ? `缺料 ${p.shortageCount}` : "无缺料"}
                        </Typography.Text>
                      </Flex>
                    </Link>
                  ))}
                  <Link to="/plans" style={{ fontSize: 12 }}>
                    查看全部方案 →
                  </Link>
                </Flex>
              )}
            </Card>
          </Col>
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

        <Row gutter={12}>
          {/* 分类价值分布 */}
          <Col xs={24} lg={12}>
            <Card size="small" title="分类价值分布">
              {categoryValue.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无物品" />
              ) : (
                <Flex vertical gap={8}>
                  {categoryValue.map((v) => (
                    <Link
                      key={v.id ?? "none"}
                      to={v.id === null ? "/components" : `/components?categoryId=${v.id}&sort=quantity_desc`}
                      aria-label={`查看分类 ${v.name}`}
                      style={{ color: "inherit", textDecoration: "none" }}
                    >
                      <Flex align="center" gap={8}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 2,
                            background: catColor.get(v.id) ?? UNCATEGORIZED_COLOR,
                            flexShrink: 0,
                          }}
                        />
                        <Typography.Text ellipsis style={{ width: "42%", flexShrink: 0 }}>
                          {v.name}
                        </Typography.Text>
                        <div
                          style={{
                            flex: 1,
                            minWidth: 0,
                            height: 6,
                            borderRadius: 3,
                            background: token.colorFillSecondary,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${(Number(v.value) / maxCatValue) * 100}%`,
                              height: "100%",
                              background: token.colorPrimary,
                            }}
                          />
                        </div>
                        <Typography.Text style={{ textAlign: "right", fontSize: 12, flexShrink: 0 }}>
                          {formatMoney(v.value)}
                        </Typography.Text>
                      </Flex>
                    </Link>
                  ))}
                </Flex>
              )}
            </Card>
          </Col>

          {/* 库存价值最高 Top10 */}
          <Col xs={24} lg={12}>
            <Card size="small" title="库存价值 Top10">
              {valueTop.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无计价物品" />
              ) : (
                <Flex vertical gap={8}>
                  {valueTop.map((v) => {
                    const meta: string[] = [v.categoryName ?? "未分类", `×${v.quantity}`];
                    if (v.price) meta.push(`单价 ${formatMoney(v.price)}`);
                    return (
                      <Link
                        key={v.id}
                        to={`/components?q=${encodeURIComponent(v.name)}`}
                        aria-label={`查看 ${v.name}`}
                        style={{ color: "inherit", textDecoration: "none" }}
                      >
                        <Flex vertical gap={3} style={{ width: "100%" }}>
                          <Flex align="center" gap={8}>
                            <Typography.Text ellipsis style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                              {v.name}
                            </Typography.Text>
                            <Typography.Text strong style={{ flexShrink: 0 }}>
                              {formatMoney(v.value)}
                            </Typography.Text>
                          </Flex>
                          <Flex align="center" gap={8}>
                            <Typography.Text
                              type="secondary"
                              ellipsis
                              style={{ fontSize: 12, maxWidth: "55%", lineHeight: 1.3 }}
                            >
                              {meta.join(" · ")}
                            </Typography.Text>
                            <div
                              style={{
                                flex: 1,
                                minWidth: 0,
                                height: 6,
                                borderRadius: 3,
                                background: token.colorFillSecondary,
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  width: `${(Number(v.value) / maxValueTop) * 100}%`,
                                  height: "100%",
                                  background: token.colorPrimary,
                                }}
                              />
                            </div>
                          </Flex>
                        </Flex>
                      </Link>
                    );
                  })}
                </Flex>
              )}
            </Card>
          </Col>
        </Row>

        <Row gutter={12}>
          {/* 标签分布 */}
          <Col xs={24} lg={12}>
            <Card size="small" title="标签分布">
              {(data?.tagDistribution ?? []).length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无标签" />
              ) : (
                <Flex wrap="wrap" gap={8}>
                  {data!.tagDistribution.map((t) => (
                    <Link
                      key={t.id}
                      to={`/components?tagIds=${t.id}`}
                      aria-label={`查看标签 ${t.name}`}
                      style={{ color: "inherit", textDecoration: "none" }}
                    >
                      <Tag style={{ cursor: "pointer", marginInlineEnd: 0 }}>
                        {t.name}
                        <b style={{ marginLeft: 4 }}>{t.count}</b>
                      </Tag>
                    </Link>
                  ))}
                </Flex>
              )}
            </Card>
          </Col>

          {/* 最近出入库流水 */}
          <Col xs={24} lg={12}>
            <Card size="small" title="最近出入库">
              {(data?.recentMovements ?? []).length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无出入库记录" />
              ) : (
                <Flex vertical gap={8}>
                  {data!.recentMovements.map((m) => (
                    <Link
                      key={m.id}
                      to={`/components?q=${encodeURIComponent(m.componentName)}`}
                      aria-label={`查看 ${m.componentName}`}
                      style={{ color: "inherit", textDecoration: "none" }}
                    >
                      <Flex align="center" gap={8}>
                        <Tag
                          color={m.delta > 0 ? "success" : "error"}
                          style={{ marginInlineEnd: 0, flexShrink: 0, minWidth: 44, textAlign: "center" }}
                        >
                          {m.delta > 0 ? `+${m.delta}` : m.delta}
                        </Tag>
                        <Flex vertical style={{ flex: 1, minWidth: 0 }}>
                          <Typography.Text ellipsis style={{ lineHeight: 1.3 }}>
                            {m.componentName}
                          </Typography.Text>
                          <Typography.Text type="secondary" ellipsis style={{ fontSize: 12, lineHeight: 1.3 }}>
                            {m.reason ?? "库存变动"}
                          </Typography.Text>
                        </Flex>
                        <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                          {formatTime(m.createdAt)}
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
