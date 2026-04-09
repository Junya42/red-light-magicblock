import { useEffect, useRef, useState } from "react";

export default function FinishLine({ lastOnChainPrice, fieldH, fieldW }: { lastOnChainPrice: number | null; fieldH: number; fieldW: number }) {
    const FINISH_LINE_Y = fieldH * (2 / 9);
    const [checkCountdown, setCheckCountdown] = useState(3);
    // Check-price timing — shared by countdown and R→L timer block from current dot (synced with lastOnChainPrice)
    const lastCheckRef = useRef(Date.now());
    useEffect(() => {
        lastCheckRef.current = Date.now();
    }, [lastOnChainPrice]);

    useEffect(() => {
        const id = setInterval(() => {
            const elapsed = (Date.now() - lastCheckRef.current) / 1000;
            setCheckCountdown(Math.max(0, 3 - elapsed));
        }, 50);
        return () => clearInterval(id);
    }, []);

    const countdownProgress = Math.min(1, Math.max(0, (3 - checkCountdown) / 3));

    return (
        <div className="absolute left-1/2 -translate-x-1/2 z-10" style={{
            top: FINISH_LINE_Y - 14,
            width: fieldW,
            height: 20,
            backgroundImage: `repeating-conic-gradient(#000 0% 25%, #fff 0% 50%)`,
            backgroundSize: "20px 20px",
        }}>
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-full bg-transparent opacity-50 overflow-hidden">
                <div
                    className="h-full bg-purple-500"
                    style={{ width: `${countdownProgress * 100}%` }}
                />
            </div>
        </div>
    )
}