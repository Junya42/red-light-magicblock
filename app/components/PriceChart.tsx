"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import { PricePoint } from "../hooks/useSolPrice";

const HISTORY_WINDOW_MS = 60_000; // 60s of history visible
const RANGE_PADDING = 0.00000005; // 0.05% padding — much tighter range for precision

interface Props {
  price: number | null;
  history: PricePoint[];
  lastOnChainPrice: number | null; // from GameConfig — price at last check
  light: "green" | "red";
}

export default function PriceChart({ price, history, lastOnChainPrice, light }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [now, setNow] = useState(Date.now());

  // Measure container
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        setSize({ w: containerRef.current.clientWidth, h: containerRef.current.clientHeight });
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Tick for animation
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  // Visible points
  const visiblePts = useMemo(() => {
    const cutoff = now - HISTORY_WINDOW_MS;
    return history.filter((pt) => pt.timestamp >= cutoff);
  }, [history, now]);

  // Price range
  const range = useMemo(() => {
    if (visiblePts.length === 0 && !price) return null;
    const prices = visiblePts.map((p) => p.price);
    if (price) prices.push(price);
    if (lastOnChainPrice && lastOnChainPrice > 0) prices.push(lastOnChainPrice);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const pad = Math.max((max - min) * 0.3, (min || 80) * RANGE_PADDING);
    return { min: min - pad, max: max + pad };
  }, [visiblePts, price, lastOnChainPrice]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !range) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = size;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const windowStart = now - HISTORY_WINDOW_MS;
    const pts = visiblePts;

    const priceToY = (p: number) => {
      const ratio = (range.max - p) / (range.max - range.min);
      return Math.max(0, Math.min(h, ratio * h));
    };

    const chartW = w * 0.75; // chart uses 3/4 of width
    const timeToX = (t: number) => {
      return ((t - windowStart) / HISTORY_WINDOW_MS) * chartW;
    };

    // Red zone — below lastOnChainPrice (only show when green — can't go red from red)
    if (lastOnChainPrice && lastOnChainPrice > 0 && light === "green") {
      const redY = priceToY(lastOnChainPrice);
      if (redY < h) {
        const grad = ctx.createLinearGradient(0, redY, 0, h);
        grad.addColorStop(0, "rgba(239, 68, 68, 0.15)");
        grad.addColorStop(1, "rgba(239, 68, 68, 0.35)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, redY, w, h - redY);

        // Danger line
        ctx.beginPath();
        ctx.strokeStyle = "rgba(239, 68, 68, 0.5)";
        ctx.lineWidth = 1;
        ctx.setLineDash([8, 6]);
        ctx.moveTo(0, redY);
        ctx.lineTo(w, redY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        ctx.font = "bold 11px monospace";
        ctx.fillStyle = "rgba(239, 68, 68, 0.7)";
        ctx.textAlign = "left";
        ctx.fillText("RED ZONE", 8, redY + 14);
      }
    }

    // Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    const steps = 6;
    for (let i = 1; i < steps; i++) {
      const y = (h / steps) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Y-axis labels — far right edge
    ctx.font = "bold 13px monospace";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.textAlign = "right";
    for (let i = 0; i <= steps; i++) {
      const y = (h / steps) * i;
      const p = range.max - (i / steps) * (range.max - range.min);
      ctx.fillText(`$${p.toFixed(4)}`, w - 8, y + 5);
    }
    // Separator line between chart and labels
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    ctx.moveTo(chartW + 4, 0);
    ctx.lineTo(chartW + 4, h);
    ctx.stroke();

    if (pts.length < 2) return;

    // Gradient fill under curve
    const lineColor = light === "red" ? "#ef4444" : "#22d3ee";
    const grad2 = ctx.createLinearGradient(0, 0, 0, h);
    grad2.addColorStop(0, light === "red" ? "rgba(239, 68, 68, 0.15)" : "rgba(34, 211, 238, 0.15)");
    grad2.addColorStop(1, light === "red" ? "rgba(239, 68, 68, 0.0)" : "rgba(34, 211, 238, 0.0)");

    ctx.beginPath();
    ctx.moveTo(timeToX(pts[0].timestamp), h);
    for (const pt of pts) {
      ctx.lineTo(timeToX(pt.timestamp), priceToY(pt.price));
    }
    ctx.lineTo(timeToX(pts[pts.length - 1].timestamp), h);
    ctx.closePath();
    ctx.fillStyle = grad2;
    ctx.fill();

    // Main line — thick
    ctx.beginPath();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    let started = false;
    for (const pt of pts) {
      const x = timeToX(pt.timestamp);
      const y = priceToY(pt.price);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Glow
    ctx.beginPath();
    ctx.strokeStyle = light === "red" ? "rgba(239, 68, 68, 0.3)" : "rgba(34, 211, 238, 0.3)";
    ctx.lineWidth = 14;
    ctx.lineJoin = "round";
    started = false;
    for (const pt of pts) {
      const x = timeToX(pt.timestamp);
      const y = priceToY(pt.price);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Current dot
    const last = pts[pts.length - 1];
    const lx = timeToX(last.timestamp);
    const ly = priceToY(last.price);
    ctx.beginPath();
    ctx.arc(lx, ly, 7, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lx, ly, 14, 0, Math.PI * 2);
    ctx.strokeStyle = light === "red" ? "rgba(239, 68, 68, 0.4)" : "rgba(34, 211, 238, 0.4)";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Price label
    ctx.font = "bold 20px monospace";
    ctx.fillStyle = lineColor;
    ctx.textAlign = "right";
    ctx.fillText(`$${last.price.toFixed(4)}`, lx - 18, ly - 16);
  }, [visiblePts, now, range, size, light, lastOnChainPrice]);

  // Check-price countdown — synced with actual checkPrice calls
  const lastCheckRef = useRef(Date.now());
  const [checkCountdown, setCheckCountdown] = useState(3);

  useEffect(() => {
    lastCheckRef.current = Date.now();
  }, [lastOnChainPrice]);

  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = (Date.now() - lastCheckRef.current) / 1000;
      setCheckCountdown(Math.max(0, Math.ceil(3 - elapsed)));
    }, 200);
    return () => clearInterval(id);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden" style={{ backgroundColor: "#4a7c3f" }}>
      {/* Header */}
      <div className="absolute top-4 left-5 z-10 flex flex-col gap-1">
        <span className="text-2xl font-bold text-red-500">SOL/USD</span>
      </div>

      {/* Light indicator + check countdown */}
      <div className="absolute top-4 right-4 z-10 flex flex-col items-end gap-2">
        <div className={`px-5 py-3 rounded-lg font-bold text-2xl ${
          light === "red"
            ? "bg-red-900/60 text-red-400 border border-red-700"
            : "bg-green-900/60 text-green-400 border border-green-700"
        }`}>
          {light === "red" ? "RED LIGHT" : "GREEN LIGHT"}
        </div>
        {light === "green" && (
          <div className="text-lg font-mono text-gray-400">
            Checking in <span className="text-yellow-400 font-bold">{checkCountdown}s</span>
          </div>
        )}
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ width: size.w, height: size.h }}
      />
    </div>
  );
}
