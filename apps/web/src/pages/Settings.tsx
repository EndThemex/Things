import { Button, Card, Form, Input, message } from "antd";
import { useNavigate } from "react-router";
import { api, json } from "../api/client";

export default function Settings() {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm();

  const onFinish = async (values: { oldPassword: string; newPassword: string }) => {
    try {
      await api("/auth/password", { method: "PUT", ...json(values) });
      messageApi.success("密码已修改");
      form.resetFields();
    } catch (e: any) {
      messageApi.error(e.message ?? "修改失败");
    }
  };

  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    navigate("/login", { replace: true });
  };

  return (
    <Card title="设置" style={{ maxWidth: 480 }}>
      {contextHolder}
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item name="oldPassword" label="旧密码" rules={[{ required: true, message: "请输入旧密码" }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[
            { required: true, message: "请输入新密码" },
            { min: 8, message: "至少 8 位" },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="确认新密码"
          dependencies={["newPassword"]}
          rules={[
            { required: true, message: "请再次输入新密码" },
            ({ getFieldValue }) => ({
              validator: (_, v) =>
                v === getFieldValue("newPassword") ? Promise.resolve() : Promise.reject(new Error("两次输入不一致")),
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          修改密码
        </Button>
      </Form>
      <Button danger style={{ marginTop: 24 }} onClick={logout}>
        退出登录
      </Button>
    </Card>
  );
}
