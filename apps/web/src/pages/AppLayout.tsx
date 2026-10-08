import { Layout, Menu, Grid, theme } from "antd";
import {
  AppstoreOutlined,
  DashboardOutlined,
  ExperimentOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Outlet, useLocation, useNavigate } from "react-router";
import { useTheme } from "../theme/ThemeProvider";

const { Header, Sider, Content } = Layout;

const NAV_ITEMS = [
  { key: "/components", icon: <AppstoreOutlined />, label: "元件库" },
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

  const menuProps = {
    items: NAV_ITEMS,
    selectedKeys: [selectedKey],
    onClick: ({ key }: { key: string }) => navigate(key),
  };

  return (
    <Layout style={{ minHeight: "100dvh" }}>
      {!isMobile && (
        <Sider width={160} theme="light">
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
          }}
        >
          {isMobile && <span style={{ fontWeight: 700, fontSize: 15 }}>Things</span>}
          <span style={{ flex: 1 }} />
          <span role="button" onClick={toggle} style={{ cursor: "pointer", fontSize: 16 }} aria-label="切换主题">
            {mode === "dark" ? "🌙" : "☀️"}
          </span>
        </Header>
        <Content style={{ padding: "0 12px 12px", maxWidth: 1200, width: "100%", margin: "0 auto" }}>
          <Outlet />
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
                <div
                  key={item.key}
                  role="button"
                  aria-label={item.label}
                  onClick={() => navigate(item.key)}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 2,
                    padding: "6px 0 4px",
                    fontSize: 12,
                    color: selected ? token.colorPrimary : token.colorText,
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontSize: 16, lineHeight: 1 }}>{item.icon}</span>
                  <span>{item.label}</span>
                </div>
              );
            })}
          </nav>
        )}
      </Layout>
    </Layout>
  );
}
