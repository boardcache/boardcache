import type { ProjectItem, ProjectTask } from '@boardcache/schema';
import { SimpleMarkdown } from '../ui/SimpleMarkdown';
import { CheckIcon, ExpandIcon, MilestoneIcon } from '../icons';
import {
  PROJECT_CARD_W,
  PROJECT_STATUS_LABEL,
  formatDate,
  milestoneProgress,
  milestonesOf,
  projectProgress,
} from '../../lib/structure/projects';
import { ScaledCard } from './ScaledCard';

/**
 * Project card (Projects suite): the canvas anchor for a body of work —
 * title and status, dates, counters, progress, then every milestone with
 * its tasks and the unscheduled tasks, in a scrollable body. Nothing on the
 * canvas card is interactive: double-click (or tap in view mode) opens the
 * full Projects view. In the lightbox (`stage`) an open button does the same.
 */
export function ProjectContent({ item, stage = false }: { item: ProjectItem; stage?: boolean }) {
  const milestones = milestonesOf(item);
  const progress = projectProgress(item);
  const accent = item.color ?? 'var(--accent)';
  const backlog = item.tasks.filter(
    (t) => !t.milestoneId || !milestones.some((m) => m.id === t.milestoneId),
  );
  const open = () =>
    window.dispatchEvent(
      new CustomEvent('boardcache:open-projects', { detail: { projectId: item.id } }),
    );
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <ScaledCard item={item} baseW={PROJECT_CARD_W} stage={stage}>
      <div
        className={`project-card${stage ? ' project-stage' : ''}`}
        data-testid="project-card"
        style={{ ['--project-accent' as string]: accent }}
      >
        <div className="project-head">
          <span className="project-dot" aria-hidden />
          <span className="project-title" data-testid="project-title">
            {item.title}
          </span>
          <span className={`project-status status-${item.status}`} data-testid="project-status">
            {PROJECT_STATUS_LABEL[item.status]}
          </span>
          {stage && (
            <button
              type="button"
              className="project-iconbtn project-open"
              title="Open in Projects"
              aria-label="Open in Projects"
              data-testid="project-open"
              onPointerDown={stop}
              onClick={(e) => {
                stop(e);
                open();
              }}
            >
              <ExpandIcon size={14} />
            </button>
          )}
        </div>

        {item.description && !stage && (
          <SimpleMarkdown text={item.description} className="project-desc" testId="project-desc" />
        )}

        {(item.startDate || item.endDate) && (
          <div className="project-dates-card" data-testid="project-dates">
            <span>{formatDate(item.startDate) || '…'}</span>
            <span className="project-dates-arrow" aria-hidden>
              →
            </span>
            <span>{formatDate(item.endDate) || '…'}</span>
          </div>
        )}

        <div className="project-stats" data-testid="project-meta">
          <span className="project-stat">
            <b>
              {progress.done}/{progress.total}
            </b>{' '}
            tasks done
          </span>
          <span className="project-stat">
            <b>{milestones.length}</b> {milestones.length === 1 ? 'milestone' : 'milestones'}
          </span>
        </div>
        <div
          className="project-progress"
          title={`${progress.done} of ${progress.total} tasks done`}
        >
          <i style={{ width: `${Math.round(progress.frac * 100)}%` }} />
        </div>

        {(milestones.length > 0 || backlog.length > 0) && (
          <div className="project-body" data-testid="project-body">
            {milestones.map((m) => {
              const mp = milestoneProgress(item, m.id);
              return (
                <div key={m.id} className="project-group" data-testid="project-ms">
                  <div className={`project-ms status-${m.status}`}>
                    <MilestoneIcon size={13} />
                    <span className="project-ms-title">{m.title}</span>
                    {m.endDate && <span className="project-ms-date">{formatDate(m.endDate)}</span>}
                    {mp.total > 0 && (
                      <span className="project-ms-count">
                        {mp.done}/{mp.total}
                      </span>
                    )}
                  </div>
                  {item.tasks
                    .filter((t) => t.milestoneId === m.id)
                    .map((t) => (
                      <TaskLine key={t.id} task={t} />
                    ))}
                </div>
              );
            })}
            {backlog.length > 0 && (
              <div className="project-group" data-testid="project-backlog">
                <div className="project-ms project-ms-backlog">
                  <span className="project-ms-title">Tasks</span>
                  <span className="project-ms-count">
                    {backlog.filter((t) => t.status === 'done').length}/{backlog.length}
                  </span>
                </div>
                {backlog.map((t) => (
                  <TaskLine key={t.id} task={t} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </ScaledCard>
  );
}

function TaskLine({ task }: { task: ProjectTask }) {
  const done = task.status === 'done';
  return (
    <div className={`project-task status-${task.status}`} data-testid="project-task">
      <span className="project-task-check" aria-hidden>
        {done && <CheckIcon size={9} />}
      </span>
      <span className="project-task-title">{task.title}</span>
      {task.due && <span className="project-task-due">{formatDate(task.due)}</span>}
    </div>
  );
}
