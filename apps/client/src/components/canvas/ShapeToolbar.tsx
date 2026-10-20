import { useState } from 'react';
import type { ReactNode } from 'react';
import { isDrawTool, useSessionStore } from '../../state/sessionStore';
import type { DrawToolId } from '../../state/sessionStore';
import { UiPopover, UiPopoverContent, UiPopoverTrigger } from '../ui/Popover';
import { UiTooltip } from '../ui/Tooltip';
import {
  ArrowIcon,
  CircleIcon,
  DiamondIcon,
  LineIcon,
  PencilIcon,
  PenToolIcon,
  ShapesIcon,
  SquareIcon,
  StarIcon,
} from '../icons';

const TOOLS: { tool: DrawToolId; label: string; key: string; icon: ReactNode }[] = [
  { tool: 'shape:rect', label: 'Rectangle', key: 'R', icon: <SquareIcon /> },
  { tool: 'shape:diamond', label: 'Diamond', key: 'D', icon: <DiamondIcon /> },
  { tool: 'shape:ellipse', label: 'Ellipse', key: 'O', icon: <CircleIcon /> },
  { tool: 'shape:arrow', label: 'Arrow', key: 'A', icon: <ArrowIcon /> },
  { tool: 'shape:line', label: 'Line', key: 'L', icon: <LineIcon /> },
  { tool: 'shape:draw', label: 'Draw', key: 'P', icon: <PencilIcon /> },
  { tool: 'shape:path', label: 'Pen', key: 'B', icon: <PenToolIcon /> },
  { tool: 'shape:star', label: 'Star', key: 'S', icon: <StarIcon /> },
];

/** Shapes popover inside the top tool cluster (rect/diamond/ellipse/arrow/…). */
export function ShapeToolbar() {
  const tool = useSessionStore((s) => s.tool);
  const [open, setOpen] = useState(false);
  const active = isDrawTool(tool);

  return (
    <UiPopover open={open} onOpenChange={setOpen}>
      <UiTooltip label="Shapes (R / O / A / L / P …)">
        <UiPopoverTrigger asChild>
          <button
            type="button"
            className={active ? 'shapes-trigger active' : 'shapes-trigger'}
            aria-pressed={active}
            data-testid="shapes-trigger"
          >
            <ShapesIcon />
          </button>
        </UiPopoverTrigger>
      </UiTooltip>
      <UiPopoverContent className="shape-popover">
        {TOOLS.map(({ tool: t, label, key, icon }) => (
          <button
            key={t}
            type="button"
            className={tool === t ? 'active' : ''}
            data-testid={`tool-${t}`}
            title={`${label} (${key})`}
            onClick={() => {
              useSessionStore.getState().setTool(t);
              setOpen(false);
            }}
          >
            {icon}
            <span className="shape-label">{label}</span>
          </button>
        ))}
      </UiPopoverContent>
    </UiPopover>
  );
}
