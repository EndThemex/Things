import { Button, Card, Form, Input, message } from "antd";
import { useNavigate } from "react-router";
import { api, json } from "../api/client";

export default function Login() {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm();

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
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      {contextHolder}
      <Card title="Things · 物品库存管理" style={{ width: "100%", maxWidth: 360 }}>
        <Form form={form} layout="vertical" onFinish={onFinish} autoFocus>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}
