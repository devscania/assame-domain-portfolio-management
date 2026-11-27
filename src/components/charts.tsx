'use client';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Pie,
  PieChart,
  Cell,
  Bar,
  BarChart,
} from 'recharts';
import type { Summary } from './client';
import { distributionGroups } from '@/lib/chart-presentation';
import { formatMoney } from './client';
import { useReducedMotion } from 'motion/react';
function ChartEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="chart-empty">
      <span aria-hidden="true" className="chart-empty-symbol">
        &#9676;
      </span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
const palette = [
  'var(--chart-primary)',
  'var(--chart-blue)',
  'var(--chart-purple)',
  'var(--chart-amber)',
  'var(--chart-neutral)',
  'var(--chart-other, var(--border))',
];
export function TrafficChart({ data }: { data: Summary['providerStats'] }) {
  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tickFormatter={(value) => value.slice(5)}
            tick={{ fontSize: 10, fill: 'var(--muted)' }}
          />
          <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} />
          <Tooltip
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text)',
            }}
            itemStyle={{ color: 'var(--text)' }}
          />
          <Area
            isAnimationActive={false}
            dataKey="views"
            name="Provider views"
            stroke="var(--chart-primary)"
            fill="var(--chart-primary)"
            fillOpacity={0.1}
          />
          <Area
            isAnimationActive={false}
            dataKey="leads"
            name="Provider leads"
            stroke="var(--chart-purple)"
            fill="transparent"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function PerformanceChart({
  data,
  currency,
  spendingLabel = 'Acquisitions',
}: {
  data: Summary['monthly'];
  currency: string;
  spendingLabel?: string;
}) {
  const reducedMotion = useReducedMotion();
  if (!data.some((item) => Number(item.collected) !== 0 || Number(item.acquisition) !== 0))
    return (
      <ChartEmpty
        title="No financial activity in this period"
        detail="Dated cash receipts and recorded spending will appear here."
      />
    );
  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data.map((d) => ({
            ...d,
            collected: Number(d.collected),
            acquisition: Number(d.acquisition),
          }))}
          margin={{ left: 0, right: 15, top: 20, bottom: 0 }}
        >
          <defs>
            <linearGradient id="cash-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-primary)" stopOpacity={0.17} />
              <stop offset="100%" stopColor="var(--chart-primary)" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="month"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
            dy={10}
          />
          <YAxis
            width={52}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : `${v}`)}
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
          />
          <Tooltip
            formatter={(v) => formatMoney(Number(v), currency)}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
            }}
            itemStyle={{ color: 'var(--text)' }}
          />
          <Area
            type="monotone"
            dataKey="acquisition"
            isAnimationActive={!reducedMotion}
            animationDuration={450}
            name={spendingLabel}
            stroke="var(--chart-neutral)"
            fill="transparent"
            strokeDasharray="4 4"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="collected"
            isAnimationActive={!reducedMotion}
            animationDuration={450}
            name="Cash collected"
            stroke="var(--chart-primary)"
            fill="url(#cash-fill)"
            strokeWidth={2.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function Distribution({
  data,
  total,
  label = 'domains shown',
}: {
  data: { label: string; value: number }[];
  total: number;
  label?: string;
}) {
  const groups = distributionGroups(data);
  const percentage = (value: number) => `${total ? Math.round((value / total) * 100) : 0}%`;
  if (!groups.length)
    return (
      <ChartEmpty
        title={`0 ${label}`}
        detail="No distribution data has been recorded for this view."
      />
    );
  return (
    <>
      <div className="donut">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              isAnimationActive={false}
              data={groups}
              dataKey="value"
              nameKey="label"
              innerRadius={68}
              outerRadius={88}
              paddingAngle={3}
              stroke="none"
            >
              {groups.map((d, i) => (
                <Cell key={`${i}-${d.label}`} fill={palette[i % palette.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) =>
                `${Number(value).toLocaleString()} (${percentage(Number(value))})`
              }
              contentStyle={{
                borderRadius: 12,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
              }}
              itemStyle={{ color: 'var(--text)' }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center">
          <strong>{total.toLocaleString()}</strong>
          <span>{label}</span>
        </div>
      </div>
      <div className="distribution-legend">
        {groups.map((d, i) => (
          <div key={`${i}-${d.label}`}>
            <span style={{ background: palette[i % palette.length] }} />
            <strong>{d.label}</strong>
            <b>{d.value.toLocaleString()}</b>
            <small>{percentage(d.value)}</small>
          </div>
        ))}
      </div>
    </>
  );
}
export function GrowthChart({ data }: { data: Summary['growth'] }) {
  if (!data.some((item) => item.total > 0))
    return (
      <ChartEmpty
        title="No new domain records in this period"
        detail="Recorded domain creation dates will appear here."
      />
    );
  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="month"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: 'var(--muted)' }}
          />
          <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)' }} />
          <Tooltip
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
            }}
            itemStyle={{ color: 'var(--text)' }}
          />
          <Bar
            isAnimationActive={false}
            dataKey="total"
            fill="var(--chart-primary)"
            radius={[5, 5, 0, 0]}
            maxBarSize={35}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
