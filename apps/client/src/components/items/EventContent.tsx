import { useEffect, useRef, useState } from 'react';
import type { EventItem } from '@boardcache/schema';
import { BellIcon, HistoryIcon } from '../icons';
import { EVENT_CARD_W, eventLeaf, eventTimeLine, isPastEvent } from '../../lib/structure/events';
import { ScaledCard } from './ScaledCard';

/**
 * A calendar event as a tear-off leaf: the year band, the weekday, the day
 * number large, the month, then the hours band and the title. The leaf is
 * laid out at its design width and zoomed like the other cards: a corner
 * drag scales everything, an edge drag gives the content more or less room
 * (the day number takes what the leaf has). One component draws the canvas
 * item (ScaledCard), the gallery card (fitted to the card) and the lightbox.
 */

function Leaf({ item }: { item: EventItem }) {
  const leaf = eventLeaf(item);
  return (
    <div className="event-item" data-testid="event-item">
      <div className="event-year">
        {isPastEvent(item) && (
          <span className="event-past-mark" data-testid="event-past">
            <HistoryIcon size={12} />
            Past
          </span>
        )}
        {leaf.year}
        {item.remindMinutes !== null && (
          <span className="event-bell" title="Reminder set" data-testid="event-bell">
            <BellIcon size={13} />
          </span>
        )}
      </div>
      <div className="event-leaf">
        <div className="event-weekday">{leaf.weekday}</div>
        <div className="event-day" data-testid="event-day">
          {leaf.day}
        </div>
        <div className="event-month">{leaf.month}</div>
      </div>
      <div className="event-time" data-testid="event-time">
        {eventTimeLine(item)}
      </div>
      <div className="event-title" data-testid="event-title">
        {item.title}
      </div>
      {item.location && (
        <div className="event-location" data-testid="event-location">
          {item.location}
        </div>
      )}
    </div>
  );
}

/** The leaf scaled to whatever box holds it (gallery cards, which size themselves). */
function FittedLeaf({ item }: { item: EventItem }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const k = box ? Math.max(0.01, box.w / EVENT_CARD_W) : 1;
  return (
    <div ref={ref} className="card-fit">
      {box && (
        <div
          className="card-scale"
          style={{ width: EVENT_CARD_W, height: box.h / k, transform: `scale(${k})` }}
        >
          <Leaf item={item} />
        </div>
      )}
    </div>
  );
}

export function EventContent({
  item,
  mode = 'canvas',
}: {
  item: EventItem;
  /** canvas: zoomed like other cards; fit: scaled to the holding box; plain: as is. */
  mode?: 'canvas' | 'fit' | 'plain';
}) {
  if (mode === 'fit') return <FittedLeaf item={item} />;
  if (mode === 'plain') return <Leaf item={item} />;
  return (
    <ScaledCard item={item} baseW={EVENT_CARD_W}>
      <Leaf item={item} />
    </ScaledCard>
  );
}
