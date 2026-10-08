import { Empty, Card } from "antd";

export function PlaceholderPage({ title, milestone }: { title: string; milestone: string }) {
  return (
    <Card title={title}>
      <Empty description={`${milestone} 实现，敬请期待`} />
    </Card>
  );
}
