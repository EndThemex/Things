import { Button, Card, Flex, Form, Input, message, theme } from "antd";
import { AppstoreOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router";
import { api, json } from "../api/client";

export default function Login() {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm();
  const { token } = theme.useToken();

  const onFinish = async (values: { username: string; password: string }) => {
    try {
      await api("/auth/login", { method: "POST", ...json(values) });
      navigate("/", { replace: true });
    } catch (e) {
      messageApi.error(e instanceof Error && e.message ? e.message : "登录失败");
      form.setFieldValue("password", "");
    }
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        // 项目未引入全局 reset，默认 content-box 会让 padding 撑出 100dvh 之外产生滚动条
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      {contextHolder}
      <Flex vertical align="center" gap={20} style={{ width: "100%", maxWidth: 380 }}>
        {/* 品牌区：与侧边栏同款主色圆角图标 */}
        <Flex vertical align="center" gap={10}>
          <Flex
            align="center"
            justify="center"
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: `linear-gradient(135deg, ${token.colorPrimary}, ${token.colorPrimaryActive})`,
              color: "#fff",
              fontSize: 26,
              boxShadow: `0 8px 24px ${token.colorPrimaryBg}`,
            }}
          >
            <AppstoreOutlined />
          </Flex>
          <Flex vertical align="center">
            <span style={{ fontWeight: 700, fontSize: 22, lineHeight: 1.3 }}>Things</span>
            <span style={{ fontSize: 13, color: token.colorTextSecondary }}>物品库存管理</span>
          </Flex>
        </Flex>

        <Card style={{ width: "100%", boxShadow: token.boxShadowTertiary }} styles={{ body: { padding: 24 } }}>
          <Form form={form} layout="vertical" onFinish={onFinish} autoFocus>
            <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
              <Input autoComplete="username" size="large" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
              <Input.Password autoComplete="current-password" size="large" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large">
              登录
            </Button>
          </Form>
        </Card>
      </Flex>
    </div>
  );
}
