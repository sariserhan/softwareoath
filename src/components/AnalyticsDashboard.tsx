import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Search,
  ShieldCheck,
  TrendingUp,
  XCircle,
} from "lucide-react";

interface RepairTrendPoint {
  week: string;
  passed: number;
  failed: number;
  total: number;
}

interface FindingCategory {
  category: string;
  count: number;
  color: string;
}

interface DecisionSlice {
  label: string;
  value: number;
  color: string;
}

const trendData: RepairTrendPoint[] = [
  { week: "Jun 2", passed: 4, failed: 1, total: 5 },
  { week: "Jun 9", passed: 6, failed: 2, total: 8 },
  { week: "Jun 16", passed: 5, failed: 1, total: 6 },
  { week: "Jun 23", passed: 8, failed: 0, total: 8 },
  { week: "Jun 30", passed: 7, failed: 1, total: 8 },
  { week: "Jul 7", passed: 9, failed: 2, total: 11 },
  { week: "Jul 14", passed: 11, failed: 1, total: 12 },
  { week: "Jul 21", passed: 10, failed: 0, total: 10 },
  { week: "Jul 28", passed: 12, failed: 1, total: 13 },
];

const mttrData = [
  { week: "Jun 2", avgMs: 4200 },
  { week: "Jun 9", avgMs: 3800 },
  { week: "Jun 16", avgMs: 5100 },
  { week: "Jun 23", avgMs: 3200 },
  { week: "Jun 30", avgMs: 2900 },
  { week: "Jul 7", avgMs: 3500 },
  { week: "Jul 14", avgMs: 2400 },
  { week: "Jul 21", avgMs: 2100 },
  { week: "Jul 28", avgMs: 1800 },
];

const findingCategories: FindingCategory[] = [
  { category: "Dependencies", count: 34, color: "var(--accent)" },
  { category: "Security", count: 18, color: "var(--red)" },
  { category: "Tests", count: 12, color: "var(--amber)" },
  { category: "Custom Rules", count: 8, color: "#8b5cf6" },
];

const decisionSlices: DecisionSlice[] = [
  { label: "Ready", value: 62, color: "var(--accent)" },
  { label: "Review Required", value: 24, color: "var(--amber)" },
  { label: "Blocked", value: 14, color: "var(--red)" },
];

function KpiCard({
  icon: Icon,
  label,
  value,
  trend,
  trendLabel,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
}) {
  return (
    <div className="analytics-kpi-card">
      <div className="analytics-kpi-icon">
        <Icon size={20} strokeWidth={1.7} />
      </div>
      <div className="analytics-kpi-content">
        <span className="analytics-kpi-label">{label}</span>
        <span className="analytics-kpi-value">{value}</span>
        {trendLabel && (
          <span
            className={`analytics-kpi-trend ${trend === "up" ? "trend-up" : trend === "down" ? "trend-down" : ""}`}
          >
            {trend === "up" && <ArrowUpRight size={13} />}
            {trendLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function SuccessRateChart({ data }: { data: RepairTrendPoint[] }) {
  const maxTotal = Math.max(...data.map((d) => d.total), 1);
  const chartWidth = 560;
  const chartHeight = 180;
  const padding = { top: 16, right: 16, bottom: 32, left: 36 };
  const innerW = chartWidth - padding.left - padding.right;
  const innerH = chartHeight - padding.top - padding.bottom;

  const points = data.map((d, i) => ({
    x: padding.left + (i / (data.length - 1)) * innerW,
    yPassed: padding.top + innerH - (d.passed / maxTotal) * innerH,
    yTotal: padding.top + innerH - (d.total / maxTotal) * innerH,
    rate: d.total > 0 ? Math.round((d.passed / d.total) * 100) : 0,
    ...d,
  }));

  const passedLine = points.map((p) => `${p.x},${p.yPassed}`).join(" ");
  const totalLine = points.map((p) => `${p.x},${p.yTotal}`).join(" ");
  const areaPath = `M${points[0].x},${padding.top + innerH} ${points.map((p) => `L${p.x},${p.yPassed}`).join(" ")} L${points[points.length - 1].x},${padding.top + innerH} Z`;

  return (
    <div className="analytics-chart-card">
      <div className="analytics-chart-header">
        <h3>
          <TrendingUp size={16} /> Repair Success Rate
        </h3>
        <span className="analytics-chart-badge">Last 9 weeks</span>
      </div>
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="analytics-svg-chart"
        aria-label="Repair success rate trend chart"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
          <g key={pct}>
            <line
              x1={padding.left}
              y1={padding.top + innerH * (1 - pct)}
              x2={chartWidth - padding.right}
              y2={padding.top + innerH * (1 - pct)}
              stroke="var(--border-soft)"
              strokeWidth="1"
            />
            <text
              x={padding.left - 6}
              y={padding.top + innerH * (1 - pct) + 4}
              textAnchor="end"
              fill="var(--dim)"
              fontSize="10"
            >
              {Math.round(pct * maxTotal)}
            </text>
          </g>
        ))}
        <path d={areaPath} fill="var(--accent-soft)" />
        <polyline
          points={totalLine}
          fill="none"
          stroke="var(--dim)"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        <polyline
          points={passedLine}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
        />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.yPassed} r="3.5" fill="var(--accent)" />
            <text
              x={p.x}
              y={chartHeight - 6}
              textAnchor="middle"
              fill="var(--dim)"
              fontSize="9"
            >
              {p.week.slice(0, 5)}
            </text>
          </g>
        ))}
      </svg>
      <div className="analytics-chart-legend">
        <span>
          <i style={{ background: "var(--accent)" }} /> Passed
        </span>
        <span>
          <i style={{ background: "var(--dim)" }} /> Total
        </span>
      </div>
    </div>
  );
}

function MttrChart({
  data,
}: {
  data: { week: string; avgMs: number }[];
}) {
  const maxMs = Math.max(...data.map((d) => d.avgMs), 1);
  const barWidth = 36;
  const gap = 16;
  const chartHeight = 160;
  const padding = { top: 12, bottom: 28 };
  const innerH = chartHeight - padding.top - padding.bottom;
  const chartWidth = data.length * (barWidth + gap) + gap;

  return (
    <div className="analytics-chart-card">
      <div className="analytics-chart-header">
        <h3>
          <Clock size={16} /> Mean Time to Repair
        </h3>
        <span className="analytics-chart-badge">Weekly avg</span>
      </div>
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="analytics-svg-chart"
        aria-label="Mean time to repair bar chart"
      >
        {data.map((d, i) => {
          const barH = (d.avgMs / maxMs) * innerH;
          const x = gap + i * (barWidth + gap);
          const y = padding.top + innerH - barH;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barH}
                rx="4"
                fill="url(#mttr-grad)"
                opacity="0.85"
              />
              <text
                x={x + barWidth / 2}
                y={y - 5}
                textAnchor="middle"
                fill="var(--muted)"
                fontSize="9"
                fontWeight="500"
              >
                {(d.avgMs / 1000).toFixed(1)}s
              </text>
              <text
                x={x + barWidth / 2}
                y={chartHeight - 6}
                textAnchor="middle"
                fill="var(--dim)"
                fontSize="9"
              >
                {d.week.slice(0, 5)}
              </text>
            </g>
          );
        })}
        <defs>
          <linearGradient id="mttr-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="rgba(185, 230, 63, 0.3)" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

function FindingFrequencyChart({ data }: { data: FindingCategory[] }) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="analytics-chart-card">
      <div className="analytics-chart-header">
        <h3>
          <Search size={16} /> Finding Frequency
        </h3>
        <span className="analytics-chart-badge">By category</span>
      </div>
      <div className="analytics-bar-list">
        {data.map((d) => (
          <div className="analytics-bar-row" key={d.category}>
            <span className="analytics-bar-label">{d.category}</span>
            <div className="analytics-bar-track">
              <div
                className="analytics-bar-fill"
                style={{
                  width: `${(d.count / maxCount) * 100}%`,
                  background: d.color,
                }}
              />
            </div>
            <span className="analytics-bar-count">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionDonutChart({ data }: { data: DecisionSlice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const radius = 52;
  const strokeWidth = 14;
  const circumference = 2 * Math.PI * radius;
  let accumulatedOffset = 0;

  return (
    <div className="analytics-chart-card">
      <div className="analytics-chart-header">
        <h3>
          <ShieldCheck size={16} /> Decision Distribution
        </h3>
        <span className="analytics-chart-badge">All time</span>
      </div>
      <div className="analytics-donut-container">
        <svg viewBox="0 0 140 140" className="analytics-donut-svg">
          {data.map((d) => {
            const segmentLength = (d.value / total) * circumference;
            const offset = accumulatedOffset;
            accumulatedOffset += segmentLength;
            return (
              <circle
                key={d.label}
                cx="70"
                cy="70"
                r={radius}
                fill="none"
                stroke={d.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${segmentLength} ${circumference - segmentLength}`}
                strokeDashoffset={-offset}
                strokeLinecap="round"
                transform="rotate(-90 70 70)"
              />
            );
          })}
          <text
            x="70"
            y="66"
            textAnchor="middle"
            fill="var(--text)"
            fontSize="22"
            fontWeight="600"
          >
            {total}
          </text>
          <text
            x="70"
            y="82"
            textAnchor="middle"
            fill="var(--muted)"
            fontSize="10"
          >
            decisions
          </text>
        </svg>
        <div className="analytics-donut-legend">
          {data.map((d) => (
            <span key={d.label}>
              <i style={{ background: d.color }} />
              {d.label} ({d.value}%)
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AnalyticsDashboard() {
  const totalRepairs = trendData.reduce((s, d) => s + d.total, 0);
  const totalPassed = trendData.reduce((s, d) => s + d.passed, 0);
  const passRate =
    totalRepairs > 0 ? ((totalPassed / totalRepairs) * 100).toFixed(1) : "0";
  const latestMttr = mttrData[mttrData.length - 1].avgMs;
  const previousMttr = mttrData[mttrData.length - 2].avgMs;
  const mttrChange = previousMttr > 0
    ? Math.round(((previousMttr - latestMttr) / previousMttr) * 100)
    : 0;
  const totalFindings = findingCategories.reduce((s, c) => s + c.count, 0);

  return (
    <main className="analytics-dashboard" data-testid="analytics-dashboard">
      <header className="analytics-header">
        <h2>Stewardship Analytics</h2>
        <span className="analytics-subtitle">
          Historical trends and repair performance metrics
        </span>
      </header>

      <section className="analytics-kpi-grid">
        <KpiCard
          icon={CheckCircle2}
          label="Total Repairs"
          value={String(totalRepairs)}
          trend="up"
          trendLabel="+13 this week"
        />
        <KpiCard
          icon={TrendingUp}
          label="Pass Rate"
          value={`${passRate}%`}
          trend="up"
          trendLabel="↑ 4.2% vs last month"
        />
        <KpiCard
          icon={Clock}
          label="Avg MTTR"
          value={`${(latestMttr / 1000).toFixed(1)}s`}
          trend="up"
          trendLabel={`↓ ${mttrChange}% faster`}
        />
        <KpiCard
          icon={AlertTriangle}
          label="Active Findings"
          value={String(totalFindings)}
          trend="neutral"
          trendLabel="across 4 categories"
        />
        <KpiCard
          icon={XCircle}
          label="Blocked"
          value={`${decisionSlices.find((d) => d.label === "Blocked")?.value ?? 0}%`}
          trendLabel="of all decisions"
        />
        <KpiCard
          icon={Activity}
          label="Weekly Throughput"
          value={String(trendData[trendData.length - 1].total)}
          trend="up"
          trendLabel="repairs this week"
        />
      </section>

      <section className="analytics-charts-grid">
        <SuccessRateChart data={trendData} />
        <MttrChart data={mttrData} />
        <FindingFrequencyChart data={findingCategories} />
        <DecisionDonutChart data={decisionSlices} />
      </section>
    </main>
  );
}
