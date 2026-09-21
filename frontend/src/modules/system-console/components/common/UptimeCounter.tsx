import React, { useState, useEffect } from 'react';

interface UptimeCounterProps {
  uptimeSeconds: number;
}

export const UptimeCounter: React.FC<UptimeCounterProps> = ({ uptimeSeconds }) => {
  const [seconds, setSeconds] = useState(uptimeSeconds);

  useEffect(() => {
    setSeconds(uptimeSeconds);
  }, [uptimeSeconds]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatUptime = (totalSec: number) => {
    if (totalSec <= 0) return '0s';
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = Math.floor(totalSec % 60);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || days > 0) parts.push(`${hours}h`);
    if (mins > 0 || hours > 0 || days > 0) parts.push(`${mins}m`);
    parts.push(`${secs}s`);

    return parts.join(' ');
  };

  return <span>{formatUptime(seconds)}</span>;
};
