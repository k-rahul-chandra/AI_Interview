import React from 'react';

interface WaveformProps {
  isRecording: boolean;
  isPlaying: boolean;
}

export const Waveform: React.FC<WaveformProps> = ({ isRecording, isPlaying }) => {
  const bars = Array.from({ length: 18 });

  if (isRecording) {
    return (
      <div className="flex items-center justify-center gap-[3px] h-16 w-full max-w-[200px] mx-auto">
        {bars.map((_, i) => {
          // Generate staggered heights and delay offsets
          const height = [16, 36, 24, 48, 12, 40, 20, 56, 32, 44, 16, 52, 28, 48, 12, 36, 24, 16][i % 18];
          const delay = `${(i % 5) * 0.15}s`;
          return (
            <div
              key={i}
              className="w-[3px] rounded-full bg-gradient-to-t from-red-600 to-rose-400 wave-bar"
              style={{
                height: `${height}px`,
                animationDelay: delay,
                animationDuration: '0.8s',
              }}
            />
          );
        })}
      </div>
    );
  }

  if (isPlaying) {
    return (
      <div className="flex items-center justify-center gap-[3px] h-16 w-full max-w-[200px] mx-auto">
        {bars.map((_, i) => {
          const height = [12, 24, 16, 32, 28, 40, 16, 48, 20, 36, 24, 32, 16, 28, 12, 20, 16, 12][i % 18];
          const delay = `${(i % 6) * 0.12}s`;
          return (
            <div
              key={i}
              className="w-[3px] rounded-full bg-gradient-to-t from-indigo-600 to-violet-400 wave-bar"
              style={{
                height: `${height}px`,
                animationDelay: delay,
                animationDuration: '1.4s',
              }}
            />
          );
        })}
      </div>
    );
  }

  // Idle state
  return (
    <div className="flex items-center justify-center gap-[4px] h-16 w-full max-w-[200px] mx-auto">
      {bars.map((_, i) => (
        <div
          key={i}
          className="w-[3px] h-[6px] rounded-full bg-slate-700 transition-all duration-300"
        />
      ))}
    </div>
  );
};
