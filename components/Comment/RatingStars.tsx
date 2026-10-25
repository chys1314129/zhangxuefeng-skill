'use client';

interface RatingStarsProps {
  value: number | null;
  onChange?: (value: number) => void;
  size?: 'sm' | 'md' | 'lg';
  readonly?: boolean;
}

export default function RatingStars({
  value,
  onChange,
  size = 'md',
  readonly = false,
}: RatingStarsProps) {
  const sizeClass = {
    sm: 'text-base',
    md: 'text-xl',
    lg: 'text-2xl',
  }[size];

  return (
    <div className={`inline-flex items-center gap-0.5 ${sizeClass}`}>
      {[1, 2, 3, 4, 5].map((star) => {
        const active = Boolean(value && star <= value);
        return (
          <button
            key={star}
            type="button"
            disabled={readonly}
            onClick={() => onChange?.(star)}
            className={`transition select-none leading-none ${
              readonly
                ? 'cursor-default'
                : 'cursor-pointer hover:scale-110 active:scale-95'
            } ${active ? 'text-amber-400' : 'text-slate-300'}`}
          >
            {active ? '⭐' : '☆'}
          </button>
        );
      })}
    </div>
  );
}
