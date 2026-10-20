import type { TimeItem } from '@boardcache/schema';
import { TimeContent } from '../components/items/TimeContent';
import { defineItemType } from './registry';
import type { StageProps } from './registry';
import type { PaintContext } from '../lib/media/paint';
import { timeSnapshotText } from '../lib/structure/timeMath';
import type { Extracted } from '../lib/search/extract';
import { baseText } from '../lib/search/extract';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';

function TimeCard({ item }: { item: TimeItem }) {
  return (
    <span className="gallery-time">
      <TimeContent item={item} preview />
    </span>
  );
}

function Stage({ item }: StageProps<TimeItem>) {
  return (
    <div className="lightbox-time" onClick={(e) => e.stopPropagation()}>
      <TimeContent item={item} />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
function paint(item: TimeItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  // Static snapshot card: label on top, big time/duration text (a live
  // tick makes no sense in a cached thumbnail).
  ctx.fillStyle = p.card.bg;
  ctx.fillRect(x, y, item.width, item.height);
  const cx = x + item.width / 2;
  const big = Math.max(13, Math.min(item.width * 0.16, item.height * 0.3));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = p.card.text;
  ctx.font = `700 ${big}px ui-monospace, monospace`;
  ctx.fillText(timeSnapshotText(item), cx, y + item.height * 0.46, item.width - 16);
  ctx.fillStyle = p.card.sub;
  ctx.font = `${Math.max(9, big * 0.42)}px sans-serif`;
  const sub =
    item.name ??
    (item.mode === 'clock'
      ? (item.timezone ?? 'Local time')
      : item.mode.charAt(0).toUpperCase() + item.mode.slice(1));
  ctx.fillText(sub, cx, y + item.height * 0.72, item.width - 16);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** What the board search index sees. */
function searchText(item: TimeItem): Extracted {
  const title = item.name?.trim() ?? '';
  // Visual types index their base metadata; PDF and htmlembed get deep
  // text through the async extractors below.
  return {
    title: title || ('title' in item ? ((item as { title?: string }).title ?? '') : ''),
    body: baseText(item),
  };
}

/** The item's own window (File → Pop Out): self-contained HTML. */
function popout(item: TimeItem, _p: PopoutContext): string {
  // Self-contained ticking widget: state is absolute timestamps baked into
  // the doc; a tiny inline script re-derives the display every 250ms.
  const cfg = {
    mode: item.mode,
    timezone: item.timezone,
    showSeconds: item.showSeconds,
    hour12: item.hour12,
    targetAt: item.targetAt,
    startedAt: item.startedAt,
    accumulatedMs: item.accumulatedMs,
    workMin: item.workMin,
    breakMin: item.breakMin,
    phase: item.phase,
    phaseEndAt: item.phaseEndAt,
    phaseRemainingMs: item.phaseRemainingMs,
  };
  return (
    `<div class="timepop">` +
    (item.name ? `<div class="tlabel">${escapeHtml(item.name)}</div>` : '') +
    `<div class="tdigits" id="td">--:--</div><div class="tsub" id="ts"></div></div>` +
    `<script>(function(){var c=${JSON.stringify(cfg)};` +
    `function pad(n){return String(n).padStart(2,'0')}` +
    `function dur(ms){var neg=ms<0;ms=Math.abs(ms);var s=Math.floor(ms/1e3),d=Math.floor(s/86400);s-=d*86400;` +
    `var h=Math.floor(s/3600);s-=h*3600;var m=Math.floor(s/60);s-=m*60;` +
    `return (neg?'-':'')+(d?d+'d ':'')+pad(h)+':'+pad(m)+':'+pad(s)}` +
    `function tick(){var now=Date.now(),td=document.getElementById('td'),ts=document.getElementById('ts'),t='',sub='';` +
    `if(c.mode==='clock'){try{t=new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',` +
    `second:c.showSeconds?'2-digit':undefined,hour12:c.hour12===null?undefined:c.hour12,` +
    `timeZone:c.timezone||undefined}).format(now)}catch(e){t=new Date(now).toLocaleTimeString()}` +
    `sub=c.timezone||''}` +
    `else if(c.mode==='countdown'){if(!c.targetAt){t='--:--';sub='No target set'}else{var r=Date.parse(c.targetAt)-now;` +
    `t=dur(r);sub=r<=0?'Done':new Date(c.targetAt).toLocaleString()}}` +
    `else if(c.mode==='stopwatch'){var e=c.accumulatedMs+(c.startedAt?Math.max(0,now-Date.parse(c.startedAt)):0);` +
    `t=dur(e);sub=c.startedAt?'Running':'Paused'}` +
    `else{var ph=c.phase,rem;if(c.phaseEndAt){rem=Date.parse(c.phaseEndAt)-now;` +
    `while(rem<=0){ph=ph==='work'?'break':'work';rem+=(ph==='work'?c.workMin:c.breakMin)*6e4}}` +
    `else{rem=c.phaseRemainingMs==null?c.workMin*6e4:c.phaseRemainingMs}` +
    `t=dur(Math.max(0,rem));sub=(ph==='work'?'Focus':'Break')+(c.phaseEndAt?'':' \u00b7 paused')}` +
    `td.textContent=t;ts.textContent=sub}` +
    `tick();setInterval(tick,250)})();</script>`
  );
}

export const timeType = defineItemType('time', {
  popout,
  edit: { kind: 'plugin' },
  pdfCategory: 'image',
  meta: null,
  label: 'Time widget',
  searchText,
  thumbnail: paint,
  render: TimeContent,
  card: TimeCard,
  stage: Stage,
  cardAspect: null,
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
