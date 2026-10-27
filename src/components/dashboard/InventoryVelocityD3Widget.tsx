import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { formatINR } from '../../utils/finance';

export interface VelocityItem {
  sku: string;
  name: string;
  category: string;
  priceInr: number;
  currentStock: number;
  smartCartDemand24h: number; // Intent units added to SmartCart across users
  salesVelocity7d: number; // Avg units sold/day
  daysOfSupply: number;
  urgency: 'CRITICAL' | 'WARNING' | 'HEALTHY';
}

const INITIAL_VELOCITY_DATA: VelocityItem[] = [
  {
    sku: 'FAN-BLDC-892',
    name: 'AeroBreeze 1200mm Smart BLDC Fan',
    category: 'Smart Ceiling Fans',
    priceInr: 8499,
    currentStock: 12,
    smartCartDemand24h: 38,
    salesVelocity7d: 8.5,
    daysOfSupply: 1.4,
    urgency: 'CRITICAL',
  },
  {
    sku: 'SPO-YNX-99P',
    name: 'Yonex Astrox 99 Pro Carbon Racket',
    category: 'Badminton & Sports Gear',
    priceInr: 14990,
    currentStock: 6,
    smartCartDemand24h: 22,
    salesVelocity7d: 3.2,
    daysOfSupply: 1.8,
    urgency: 'CRITICAL',
  },
  {
    sku: 'AUD-ANC-99',
    name: 'AcousticSphere ANC Earbuds',
    category: 'Spatial Audio',
    priceInr: 11499,
    currentStock: 18,
    smartCartDemand24h: 29,
    salesVelocity7d: 5.1,
    daysOfSupply: 3.5,
    urgency: 'WARNING',
  },
  {
    sku: 'AC-WRK-8990',
    name: 'ProArt Studio Workstation X1',
    category: 'Workstations',
    priceInr: 292000,
    currentStock: 4,
    smartCartDemand24h: 7,
    salesVelocity7d: 0.8,
    daysOfSupply: 5.0,
    urgency: 'WARNING',
  },
  {
    sku: 'MON-32K-PRO',
    name: 'UltraSharp 32" 6K Reference Display',
    category: 'Displays',
    priceInr: 145000,
    currentStock: 35,
    smartCartDemand24h: 12,
    salesVelocity7d: 1.5,
    daysOfSupply: 23.3,
    urgency: 'HEALTHY',
  },
];

interface InventoryVelocityD3WidgetProps {
  showToast?: (msg: string) => void;
  onNavigateProducts?: () => void;
}

export const InventoryVelocityD3Widget: React.FC<InventoryVelocityD3WidgetProps> = ({
  showToast = console.log,
  onNavigateProducts,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [items, setItems] = useState<VelocityItem[]>(INITIAL_VELOCITY_DATA);
  const [hoveredSku, setHoveredSku] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'ALL' | 'RESTOCK_NEEDED'>('ALL');

  const filteredData = items.filter((item) => {
    if (filterMode === 'RESTOCK_NEEDED') {
      return item.urgency === 'CRITICAL' || item.urgency === 'WARNING';
    }
    return true;
  });

  // Handle instant restock
  const handleRestock = (sku: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.sku === sku) {
          const nextStock = item.currentStock + 25;
          const nextDays = Math.round((nextStock / Math.max(0.1, item.salesVelocity7d)) * 10) / 10;
          const nextUrgency = nextDays <= 2 ? 'CRITICAL' : nextDays <= 7 ? 'WARNING' : 'HEALTHY';
          return {
            ...item,
            currentStock: nextStock,
            daysOfSupply: nextDays,
            urgency: nextUrgency,
          };
        }
        return item;
      })
    );
    showToast(`⚡ Restocked +25 units for SKU ${sku}! Live inventory updated.`);
  };

  // Render D3 Visualization
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth || 640;
    const height = 260;
    const margin = { top: 20, right: 30, bottom: 45, left: 120 };

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    svg.attr('viewBox', `0 0 ${width} ${height}`).attr('width', '100%').attr('height', height);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Y Scale (SKU / Name)
    const yScale = d3
      .scaleBand()
      .domain(filteredData.map((d) => d.sku))
      .range([0, innerHeight])
      .padding(0.3);

    // X Scale (Units - Stock & Demand)
    const maxVal = d3.max(filteredData, (d) => Math.max(d.currentStock, d.smartCartDemand24h)) || 50;
    const xScale = d3.scaleLinear().domain([0, maxVal * 1.15]).range([0, innerWidth]);

    // Gridlines
    g.append('g')
      .attr('class', 'grid-lines')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(xScale)
          .ticks(5)
          .tickSize(-innerHeight)
          .tickFormat(() => '')
      )
      .selectAll('line')
      .attr('stroke', 'rgba(148, 163, 184, 0.15)')
      .attr('stroke-dasharray', '3 3');

    // Axes
    const yAxis = d3.axisLeft(yScale).tickSize(0);
    const xAxis = d3.axisBottom(xScale).ticks(5);

    g.append('g')
      .attr('class', 'y-axis')
      .call(yAxis)
      .selectAll('text')
      .attr('fill', 'currentColor')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .attr('dx', '-8px');

    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .selectAll('text')
      .attr('fill', '#64748b')
      .attr('font-size', '10px');

    g.selectAll('.domain').attr('stroke', 'rgba(148, 163, 184, 0.3)');

    // Render Paired Horizontal Bars (Current Stock vs SmartCart 24h Demand)
    const barGroup = g.selectAll('.item-group').data(filteredData).enter().append('g').attr('class', 'item-group');

    const bandwidth = yScale.bandwidth();
    const halfBand = bandwidth / 2 - 2;

    // 1. Current Stock Bar (Amber/Emerald)
    barGroup
      .append('rect')
      .attr('y', (d) => (yScale(d.sku) || 0))
      .attr('x', 0)
      .attr('height', halfBand)
      .attr('width', (d) => xScale(d.currentStock))
      .attr('rx', 3)
      .attr('fill', (d) => (d.urgency === 'CRITICAL' ? '#f43f5e' : d.urgency === 'WARNING' ? '#f59e0b' : '#10b981'))
      .attr('opacity', 0.9)
      .on('mouseenter', (_, d) => setHoveredSku(d.sku))
      .on('mouseleave', () => setHoveredSku(null));

    // Stock value label
    barGroup
      .append('text')
      .attr('y', (d) => (yScale(d.sku) || 0) + halfBand / 2 + 3)
      .attr('x', (d) => xScale(d.currentStock) + 6)
      .attr('fill', '#64748b')
      .attr('font-size', '10px')
      .attr('font-weight', '700')
      .text((d) => `${d.currentStock} stock`);

    // 2. SmartCart 24h Demand Intent Bar (Sky Blue)
    barGroup
      .append('rect')
      .attr('y', (d) => (yScale(d.sku) || 0) + halfBand + 4)
      .attr('x', 0)
      .attr('height', halfBand)
      .attr('width', (d) => xScale(d.smartCartDemand24h))
      .attr('rx', 3)
      .attr('fill', '#0284c7')
      .attr('opacity', 0.85)
      .on('mouseenter', (_, d) => setHoveredSku(d.sku))
      .on('mouseleave', () => setHoveredSku(null));

    // Demand value label
    barGroup
      .append('text')
      .attr('y', (d) => (yScale(d.sku) || 0) + halfBand + 4 + halfBand / 2 + 3)
      .attr('x', (d) => xScale(d.smartCartDemand24h) + 6)
      .attr('fill', '#0284c7')
      .attr('font-size', '10px')
      .attr('font-weight', '700')
      .text((d) => `${d.smartCartDemand24h} cart demand`);
  }, [filteredData]);

  const activeHoverItem = items.find((i) => i.sku === hoveredSku);

  return (
    <div
      data-testid="inventory-sales-velocity-widget"
      className="p-5 rounded-2xl bg-surface border border-outline-variant/30 shadow-sm space-y-4"
    >
      {/* Widget Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-outline-variant/20">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <span className="material-symbols-outlined text-[18px]">inventory_2</span>
            </div>
            <div>
              <h2 className="text-sm font-black text-on-surface uppercase tracking-wider">
                SmartCart Inventory Velocity (D3 Telemetry)
              </h2>
              <p className="text-xs text-on-surface-variant">
                Live 24h shopper demand vs remaining stock to prevent out-of-stock loss
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {/* Filter Segment */}
          <div className="flex items-center gap-1 bg-surface-container-low p-1 rounded-xl border border-outline-variant/30">
            <button
              type="button"
              onClick={() => setFilterMode('ALL')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                filterMode === 'ALL'
                  ? 'bg-primary text-on-primary shadow-2xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              All Items ({items.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('RESTOCK_NEEDED')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                filterMode === 'RESTOCK_NEEDED'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Restock Urgent ({items.filter((i) => i.urgency !== 'HEALTHY').length})
            </button>
          </div>

          {onNavigateProducts && (
            <button
              type="button"
              onClick={onNavigateProducts}
              className="px-3 py-1.5 rounded-xl bg-surface-container-low hover:bg-surface-container border border-outline-variant/30 text-xs font-semibold text-on-surface flex items-center gap-1 transition-colors cursor-pointer"
            >
              <span>Catalog</span>
              <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </button>
          )}
        </div>
      </div>

      {/* D3 Render Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left 8 Cols: D3 SVG Chart */}
        <div className="lg:col-span-8 space-y-2">
          {/* Chart Legend */}
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-2.5 rounded bg-rose-500" />
              <span className="font-medium text-on-surface-variant text-[11px]">In-Stock Units</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-2.5 rounded bg-sky-600" />
              <span className="font-medium text-on-surface-variant text-[11px]">SmartCart 24h Intent</span>
            </div>
          </div>

          <div ref={containerRef} className="w-full relative min-h-[260px] bg-surface-container-lowest p-2 rounded-xl border border-outline-variant/20">
            <svg ref={svgRef} className="w-full text-on-surface" />
          </div>
        </div>

        {/* Right 4 Cols: Rapid Restock Action List */}
        <div className="lg:col-span-4 space-y-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-secondary block">
            Velocity Restock Action Queue
          </span>

          <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
            {filteredData.map((item) => (
              <div
                key={item.sku}
                className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-2 ${
                  hoveredSku === item.sku
                    ? 'border-primary bg-primary/5 shadow-2xs'
                    : 'border-outline-variant/30 bg-surface-container-low/60'
                }`}
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${
                        item.urgency === 'CRITICAL'
                          ? 'bg-rose-500/15 text-rose-700 border border-rose-500/30'
                          : item.urgency === 'WARNING'
                          ? 'bg-amber-500/15 text-amber-700 border border-amber-500/30'
                          : 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/30'
                      }`}
                    >
                      {item.daysOfSupply}d Supply
                    </span>
                    <span className="text-[11px] font-mono font-bold text-on-surface truncate">
                      {item.sku}
                    </span>
                  </div>
                  <div className="text-xs font-bold text-on-surface truncate">{item.name}</div>
                  <div className="text-[10px] text-secondary font-tabular-nums">
                    {formatINR(item.priceInr)} • Cart Demand: {item.smartCartDemand24h} | Stock: {item.currentStock}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleRestock(item.sku)}
                  className="px-2.5 py-1.5 rounded-lg bg-primary hover:bg-primary-container text-on-primary text-[11px] font-bold shrink-0 shadow-2xs transition-colors cursor-pointer flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">add</span>
                  <span>+25</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Hover Insight Banner */}
      {activeHoverItem && (
        <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/25 flex items-center justify-between text-xs text-sky-900 dark:text-sky-200">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-sky-500 text-[18px]">insights</span>
            <span>
              <strong>{activeHoverItem.name}:</strong> Demand velocity is{' '}
              <strong>{(activeHoverItem.smartCartDemand24h / Math.max(1, activeHoverItem.currentStock)).toFixed(1)}x</strong> current stock!
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleRestock(activeHoverItem.sku)}
            className="px-3 py-1 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs shrink-0 cursor-pointer"
          >
            Restock Now
          </button>
        </div>
      )}
    </div>
  );
};
