import { lazy, Suspense } from "react";

const DashboardApp = lazy(() => import("./DashboardApp.js"));
const MarketingHome = lazy(() => import("./components/MarketingHome.js"));

export default function App() {
  const dashboard = window.location.pathname === "/dashboard" ||
    window.location.pathname.startsWith("/dashboard/");
  return (
    <Suspense fallback={<div className="route-loader">Loading Software Oath…</div>}>
      {dashboard ? <DashboardApp /> : <MarketingHome />}
    </Suspense>
  );
}
