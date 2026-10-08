import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "./theme/ThemeProvider";
import AppLayout from "./pages/AppLayout";
import Login from "./pages/Login";
import Settings from "./pages/Settings";
import { PlaceholderPage } from "./pages/Placeholder";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function RequireAuth({ children }: { children: React.ReactNode }) {
  // M1 简单守护：401 时 api client 会跳转 /login
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <RequireAuth>
                  <AppLayout />
                </RequireAuth>
              }
            >
              <Route
                path="/components"
                element={<PlaceholderPage title="元件库" milestone="M2" />}
              />
              <Route path="/dashboard" element={<PlaceholderPage title="看板" milestone="M3" />} />
              <Route path="/plans" element={<PlaceholderPage title="方案" milestone="M4" />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/components" replace />} />
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
