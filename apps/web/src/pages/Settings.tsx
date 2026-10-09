import { useState } from "react";
import { Button, Card, Flex, Form, Input, Modal, Typography, Upload, message } from "antd";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api, json } from "../api/client";
import type { CsvImportReport } from "../types";

interface BackupPayload {
  version: number;
  data?: unknown;
}

export default function Settings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm();
  const [pendingJson, setPendingJson] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [csvReport, setCsvReport] = useState<CsvImportReport | null>(null);

  const onFinish = async (values: { oldPassword: string; newPassword: string }) => {
    try {
      await api("/auth/password", { method: "PUT", ...json(values) });
      messageApi.success("密码已修改");
      form.resetFields();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "修改失败");
    }
  };

  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    navigate("/login", { replace: true });
  };

  /** JSON 备份导入：先解析校验，再二次确认后覆盖恢复 */
  const handleJsonPick = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as BackupPayload;
      if (parsed.version !== 1 || typeof parsed.data !== "object") {
        throw new Error("不是有效的 Things 备份文件");
      }
      setPendingJson(file);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "备份文件解析失败");
    }
    return false;
  };

  const doJsonImport = async () => {
    if (!pendingJson) return;
    setImporting(true);
    try {
      const payload = JSON.parse(await pendingJson.text()) as unknown;
      const res = await api<{ counts: Record<string, number> }>("/import", {
        method: "POST",
        ...json(payload),
      });
      queryClient.clear(); // 数据已整体覆盖，清空全部缓存重新拉取
      const c = res.counts;
      messageApi.success(
        `恢复完成：物品 ${c.components ?? 0}、分类 ${c.categories ?? 0}、标签 ${c.tags ?? 0}、方案 ${c.plans ?? 0}`,
      );
      setPendingJson(null);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  /** CSV 物品导入 */
  const handleCsvImport = async (file: File) => {
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import/csv", { method: "POST", body: fd });
      const data = (await res.json().catch(() => null)) as CsvImportReport & { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? `导入失败 (${res.status})`);
      setCsvReport({
        created: data?.created ?? 0,
        skipped: data?.skipped ?? 0,
        failed: data?.failed ?? 0,
        errors: data?.errors ?? [],
      });
      queryClient.invalidateQueries(); // 可能新建了分类/标签/物品
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "导入失败");
    } finally {
      setImporting(false);
    }
    return false;
  };

  return (
    <Flex vertical gap={16} style={{ maxWidth: 480 }}>
      {contextHolder}
      <Card title="账号">
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
                  v === getFieldValue("newPassword")
                    ? Promise.resolve()
                    : Promise.reject(new Error("两次输入不一致")),
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

      <Card title="数据备份与恢复">
        <Flex vertical gap={12}>
          <Flex gap={8} wrap="wrap">
            <Button icon={<DownloadOutlined />} onClick={() => window.open("/api/export", "_blank")}>
              导出 JSON 备份
            </Button>
            <Button icon={<DownloadOutlined />} onClick={() => window.open("/api/export/csv", "_blank")}>
              导出物品 CSV
            </Button>
          </Flex>
          <Flex gap={8} wrap="wrap">
            <Upload accept=".json,application/json" showUploadList={false} beforeUpload={(f) => void handleJsonPick(f)}>
              <Button icon={<UploadOutlined />} loading={importing}>
                导入 JSON 恢复
              </Button>
            </Upload>
            <Upload accept=".csv,text/csv" showUploadList={false} beforeUpload={(f) => void handleCsvImport(f)}>
              <Button icon={<UploadOutlined />} loading={importing}>
                导入物品 CSV
              </Button>
            </Upload>
          </Flex>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            JSON 备份包含物品、分类、标签、方案与流水的全量数据（含回收站），导入将覆盖现有业务数据、保留账号；
            CSV 仅物品数据，按表头字段名自动识别（无需模板），同名同规格默认跳过。
          </Typography.Text>
        </Flex>
      </Card>

      <Modal
        title="确认导入恢复"
        open={pendingJson !== null}
        onCancel={() => setPendingJson(null)}
        onOk={() => void doJsonImport()}
        confirmLoading={importing}
        okText="覆盖导入"
        okButtonProps={{ danger: true }}
      >
        <Typography.Text>
          导入将用「{pendingJson?.name}」覆盖当前全部业务数据（物品、方案、流水），该操作不可恢复。确定继续？
        </Typography.Text>
      </Modal>

      <Modal
        title="CSV 导入报告"
        open={csvReport !== null}
        footer={<Button type="primary" onClick={() => setCsvReport(null)}>知道了</Button>}
        onCancel={() => setCsvReport(null)}
      >
        {csvReport && (
          <Flex vertical gap={8}>
            <Typography.Text>
              新增 <Typography.Text strong>{csvReport.created}</Typography.Text> 条，跳过重复{" "}
              <Typography.Text strong>{csvReport.skipped}</Typography.Text> 条，失败{" "}
              <Typography.Text strong type={csvReport.failed > 0 ? "danger" : undefined}>
                {csvReport.failed}
              </Typography.Text>{" "}
              条
            </Typography.Text>
            {csvReport.errors.length > 0 && (
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
                {csvReport.errors.map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </Typography.Paragraph>
            )}
          </Flex>
        )}
      </Modal>
    </Flex>
  );
}
