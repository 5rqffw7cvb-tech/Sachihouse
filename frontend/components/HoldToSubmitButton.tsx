import React, { useEffect, useRef, useState } from 'react';

interface HoldToSubmitButtonProps {
  label?: string;
  holdingLabel?: (percent: number) => string;
  holdMs?: number;
  disabled?: boolean;
  onComplete: () => void | Promise<void>;
}

export const HoldToSubmitButton: React.FC<HoldToSubmitButtonProps> = ({
  label = 'Hold 5s to submit',
  holdingLabel = (percent) => `Holding... ${percent}%`,
  holdMs = 5000,
  disabled,
  onComplete,
}) => {
  const [progress, setProgress] = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  const stop = () => {
    setIsHolding(false);
    setProgress(0);
    startTimeRef.current = null;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  };

  const tick = () => {
    if (!startTimeRef.current) {
      startTimeRef.current = performance.now();
    }
    const elapsed = performance.now() - startTimeRef.current;
    const nextProgress = Math.min(100, (elapsed / holdMs) * 100);
    setProgress(nextProgress);

    if (nextProgress >= 100) {
      stop();
      void onComplete();
      return;
    }

    frameRef.current = requestAnimationFrame(tick);
  };

  const start = () => {
    if (disabled || isHolding) {
      return;
    }
    setIsHolding(true);
    startTimeRef.current = performance.now();
    frameRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => stop(), []);

  return (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={start}
      onMouseUp={stop}
      onMouseLeave={stop}
      onTouchStart={start}
      onTouchEnd={stop}
      className="relative overflow-hidden w-full rounded-xl border border-[#041627] bg-[#041627] text-white font-semibold px-5 py-3 disabled:opacity-50"
    >
      <span
        className="absolute left-0 top-0 h-full bg-[#0d7a5f] transition-[width] duration-75"
        style={{ width: `${progress}%` }}
      />
      <span className="relative z-10">{isHolding ? holdingLabel(Math.round(progress)) : label}</span>
    </button>
  );
};
