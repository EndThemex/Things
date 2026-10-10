import { useEffect, useRef } from "react";
import { Layout, Menu, Grid, Button, Typography, theme } from "antd";
import {
  AppstoreOutlined,
  DashboardOutlined,
  ExperimentOutlined,
  SettingOutlined,
  SunOutlined,
  MoonOutlined,
} from "@ant-design/icons";
import { Outlet, useLocation, useNavigate } from "react-router";
import { useTheme } from "../theme/ThemeProvider";

const { Header, Sider, Content } = Layout;

const NAV_ITEMS = [
  { key: "/components", icon: <AppstoreOutlined />, label: "物品库" },
  { key: "/dashboard", icon: <DashboardOutlined />, label: "看板" },
  { key: "/plans", icon: <ExperimentOutlined />, label: "方案" },
  { key: "/settings", icon: <SettingOutlined />, label: "设置" },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, toggle } = useTheme();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const { token } = theme.useToken();

  const selectedKey =
    NAV_ITEMS.filter((i) => location.pathname.startsWith(i.key))
      .sort((a, b) => b.key.length - a.key.length)[0]?.key ?? "/components";
  const pageTitle =
    location.pathname.startsWith("/plans/") ? "方案详情" : NAV_ITEMS.find((i) => i.key === selectedKey)?.label;

  const menuProps = {
    items: NAV_ITEMS,
    selectedKeys: [selectedKey],
    onClick: ({ key }: { key: string }) => navigate(key),
  };

  // 滚动容器是 Content 而非 window，路由切换时需手动回顶
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    // 应用壳布局：整体占满视口，侧边栏与顶栏固定，仅内容区滚动
    <Layout style={{ height: "100dvh" }}>
      {!isMobile && (
        <Sider width={160} theme="light" style={{ overflowY: "auto" }}>
          <div style={{ fontWeight: 700, padding: "12px 16px" }}>Things</div>
          <Menu mode="inline" {...menuProps} style={{ borderInlineEnd: "none" }} />
        </Sider>
      )}
      <Layout>
        <Header
          style={{
            background: "transparent",
            padding: "0 12px",
            display: "flex",
            alignItems: "center",
            height: 44,
            lineHeight: "44px",
            gap: 8,
          }}
        >
          {isMobile && <span style={{ fontWeight: 700, fontSize: 15 }}>Things</span>}
          <Typography.Text
            type="secondary"
            style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {pageTitle}
          </Typography.Text>
          <span style={{ flex: 1 }} />
          <Button
            type="text"
            size="small"
            shape="circle"
            icon={mode === "dark" ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggle}
            aria-label="切换主题"
          />
        </Header>
        <Content ref={contentRef} style={{ overflowY: "auto" }}>
          <div style={{ padding: "0 12px 12px", maxWidth: 1200, width: "100%", margin: "0 auto" }}>
            <Outlet />
          </div>
        </Content>
        {isMobile && (
          <nav
            style={{
              position: "sticky",
              bottom: 0,
              display: "flex",
              borderTop: `1px solid ${token.colorSplit}`,
              background: token.colorBgContainer,
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            {NAV_ITEMS.map((item) => {
              const selected = item.key === selectedKey;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-label={item.label}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => navigate(item.key)}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 2,
                    padding: "6px 0 4px",
                    fontSize: 12,
                    border: "none",
                    background: "transparent",
                    color: selected ? token.colorPrimary : token.colorText,
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontSize: 16, lineHeight: 1 }}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        )}
      </Layout>
    </Layout>
  );
}
