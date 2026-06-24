import React, { useCallback, useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const CELEBRATION_DURATION_MS = 6000;
const COUNTER_ANIMATION_MS = 1400;

const formatCurrency = (value) => `₪${Math.round(value).toLocaleString('he-IL')}`;

function useAnimatedNumber(from, to, duration, isActive) {
  const [value, setValue] = useState(from);

  useEffect(() => {
    if (!isActive) {
      setValue(from);
      return undefined;
    }

    const startValue = from;
    const delta = to - from;
    const startTime = performance.now();
    let frameId = 0;

    const tick = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      setValue(Math.round(startValue + delta * eased));

      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
      }
    };

    setValue(startValue);
    frameId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frameId);
  }, [from, to, duration, isActive]);

  return value;
}

function fireSubtleConfetti(stopRef) {
  const endAt = Date.now() + 3200;
  const colors = ['#2563eb', '#0d9488', '#d97706', '#7c3aed'];

  const burst = () => {
    if (stopRef.current) return;

    confetti({
      particleCount: 2,
      angle: 60,
      spread: 50,
      startVelocity: 42,
      origin: { x: 0.08, y: 0.72 },
      colors,
      ticks: 180,
      gravity: 0.9,
      scalar: 0.9,
      disableForReducedMotion: true,
    });
    confetti({
      particleCount: 2,
      angle: 120,
      spread: 50,
      startVelocity: 42,
      origin: { x: 0.92, y: 0.72 },
      colors,
      ticks: 180,
      gravity: 0.9,
      scalar: 0.9,
      disableForReducedMotion: true,
    });

    if (Date.now() < endAt) {
      requestAnimationFrame(burst);
    }
  };

  confetti({
    particleCount: 70,
    spread: 78,
    startVelocity: 38,
    origin: { y: 0.58 },
    colors,
    ticks: 200,
    gravity: 0.85,
    scalar: 0.95,
    disableForReducedMotion: true,
  });

  requestAnimationFrame(burst);
}

function KpiCard({ label, value, className }) {
  return (
    <div className={cn('rounded-xl border border-white/20 bg-white/10 px-5 py-4 text-center backdrop-blur-sm', className)}>
      <p className="text-sm text-white/80 mb-2">{label}</p>
      <p className="text-3xl sm:text-4xl font-bold tracking-tight tabular-nums">{value}</p>
    </div>
  );
}

export default function CollectionCelebrationOverlay({ celebration, onDismiss }) {
  const stopConfettiRef = useRef(false);
  const dismissTimerRef = useRef(null);

  const before = celebration?.before;
  const after = celebration?.after;
  const isActive = Boolean(before && after);

  const openCollectionValue = useAnimatedNumber(
    before?.openCollectionAmount ?? 0,
    after?.openCollectionAmount ?? 0,
    COUNTER_ANIMATION_MS,
    isActive,
  );
  const recordedCollectionValue = useAnimatedNumber(
    before?.recordedCollection ?? 0,
    after?.recordedCollection ?? 0,
    COUNTER_ANIMATION_MS,
    isActive,
  );

  const dismiss = useCallback(() => {
    stopConfettiRef.current = true;
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    onDismiss?.();
  }, [onDismiss]);

  useEffect(() => {
    if (!isActive) return undefined;

    stopConfettiRef.current = false;
    fireSubtleConfetti(stopConfettiRef);

    dismissTimerRef.current = setTimeout(() => {
      dismiss();
    }, CELEBRATION_DURATION_MS);

    return () => {
      stopConfettiRef.current = true;
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [isActive, celebration, dismiss]);

  if (!isActive) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="גבייה הושלמה בהצלחה"
    >
      <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px]" />

      <div className="relative w-full max-w-xl rounded-2xl border border-white/15 bg-gradient-to-br from-slate-900/95 via-slate-800/95 to-slate-900/95 p-6 sm:p-8 shadow-2xl text-white">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute left-3 top-3 h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
          onClick={dismiss}
          aria-label="סגור"
        >
          <X className="h-4 w-4" />
        </Button>

        <div className="text-center space-y-2 mb-8">
          <p className="text-xs tracking-[0.2em] uppercase text-emerald-300/90">כל הכבוד</p>
          <h2 className="text-2xl sm:text-3xl font-bold">גבייה הושלמה בהצלחה</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <KpiCard
            label="גבייה לטיפול עכשיו"
            value={formatCurrency(openCollectionValue)}
          />
          <KpiCard
            label="גבייה רשומה השנה"
            value={formatCurrency(recordedCollectionValue)}
          />
        </div>
      </div>
    </div>
  );
}
