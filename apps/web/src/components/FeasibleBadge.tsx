import { Tag } from "antd";

/** 方案可行份数徽标：null=无明细，0=无法制作，其余显示可做份数 */
export default function FeasibleBadge({ feasible }: { feasible: number | null }) {
  if (feasible === null) return <Tag>无明细</Tag>;
  if (feasible === 0) return <Tag color="error">无法制作</Tag>;
  return <Tag color="success">可做 {feasible} 份</Tag>;
}
