import { desktopAgent } from './platform';
import { showNotice } from './notices';
import { useDocumentStore } from '../state/documentStore';
import { useSessionStore } from '../state/sessionStore';
import { vaultBoard } from './vault/vaultStore';

/** Whether "Run Claude Code" exists here (the desktop shell only). */
export const canRunClaudeCode = (): boolean => desktopAgent() !== null;

/**
 * Open the user's terminal with Claude Code connected to this app. The
 * shell writes the run script and picks the terminal; this side only says
 * where to start: the open board's folder when it lives under Files.
 */
export async function runClaudeCode(): Promise<void> {
  const agent = desktopAgent();
  if (!agent) return;
  const open = useSessionStore.getState().view === 'canvas';
  const folder = open ? vaultBoard(useDocumentStore.getState().doc.id) : null;
  try {
    const res = await agent.launch(folder ? { dir: folder.path } : {});
    if (res.ok) {
      showNotice(`Claude Code is starting in ${res.terminal}, in ${res.cwd}.`, {
        id: 'agent-launch',
      });
    } else showNotice(res.error, { id: 'agent-launch', kind: 'warn' });
  } catch (err) {
    showNotice(err instanceof Error ? err.message : String(err), {
      id: 'agent-launch',
      kind: 'warn',
    });
  }
}
