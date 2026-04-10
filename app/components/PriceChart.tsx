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

  // Check-price timing — shared by countdown and R→L timer block from current dot (synced with lastOnChainPrice)
  const lastCheckRef = useRef(Date.now());
  useEffect(() => {
    lastCheckRef.current = Date.now();
  }, [lastOnChainPrice]);

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
    const pad = Math.max((max - min) * 0.001, (min || 80) * RANGE_PADDING);
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

    // Current-dot X (same as the live price dot); fallback = right edge of time axis
    const dotX = pts.length >= 1
      ? Math.min(chartW, Math.max(1, timeToX(pts[pts.length - 1].timestamp)))
      : chartW;
    const blockW = dotX;

    // Timer block: fixed width [0 → dotX], slides right → left over 3s (right edge dotX → 0).
    // Remaining px until next cycle at dot ≈ current right edge x (distance to 0).
    const CHECK_INTERVAL_MS = 3000;
    const elapsed = Date.now() - lastCheckRef.current;
    const tNorm = Math.min(1, elapsed / CHECK_INTERVAL_MS);
    const leftEdge = -tNorm * blockW;


    // Red zone — below lastOnChainPrice (only show when green — can't go red from red)
    if (lastOnChainPrice && lastOnChainPrice > 0 && light === "green") {
      const redY = priceToY(lastOnChainPrice);
      if (redY < h) {
        // Danger line
        ctx.beginPath();
        ctx.strokeStyle = "rgba(150, 30, 30, 0.7)";
        ctx.lineWidth = 1;
        ctx.setLineDash([8, 6]);
        ctx.moveTo(0, redY);
        ctx.lineTo(w, redY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    const steps = 6;

    // Y-axis labels — far right edge
    ctx.font = "bold 13px monospace";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.textAlign = "right";
    for (let i = 0; i <= steps; i++) {
      const y = (h / steps) * i;
      const p = range.max - (i / steps) * (range.max - range.min);
      ctx.fillText(`$${p.toFixed(4)}`, w - 8, y + 5);
    }

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
  }, [visiblePts, now, range, size, light, lastOnChainPrice, price]);

  // Check-price countdown — synced with actual checkPrice calls
  const [checkCountdown, setCheckCountdown] = useState(3);

  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = (Date.now() - lastCheckRef.current) / 1000;
      setCheckCountdown(Math.max(0, Math.ceil(3 - elapsed)));
    }, 200);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="h-full w-full relative">
      <div ref={containerRef} className="absolute top-[65%] left-1/2 w-full sm:w-[26%] h-[28%] -translate-x-1/2 -translate-y-1/3 overflow-hidden z-20">
        <div className="h-full w-full relative">

          {/* Light indicator + check countdown */}
          <div className="absolute top-0 right-4 z-10 flex flex-col items-end gap-2">
            <div className="text-lg font-mono text-white">
              Checking in <span className="text-yellow-400 font-bold">{checkCountdown}s</span>
            </div>
          </div>

          {/* Canvas */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full bottom-0"
            style={{ width: size.w }}
          />
        </div>
      </div>
    </div>
  );
}
