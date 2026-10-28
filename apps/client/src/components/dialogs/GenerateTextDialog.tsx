import { useEffect, useState } from 'react';
import { generateTextToCanvas } from '../../lib/ai/generateText';
import { hasSyncServer } from '../../lib/sync/apiBase';
import { usePlatformCaps } from '../../lib/platform';
import { TEXT_PROVIDERS } from '../../lib/ai/providers';
import { ensureHostedAi, hostedModelRef, refKey, useAIStore } from '../../state/aiStore';
import { useSessionStore } from '../../state/sessionStore';
import { UiDialog } from '../ui/Dialog';
import { UiPopover, UiPopoverContent, UiPopoverTrigger } from '../ui/Popover';
import { ChevronDownIcon } from '../icons';

/**
 * Add → Generate Text. Pick one or more models (grouped by provider), enter a
 * prompt; on submit a markdown text box is created per selected model and each
 * model's streamed response flows into its own box.
 */
export function GenerateTextDialog() {
  const open = useSessionStore((s) => s.generateTextOpen);
  return open ? <GenerateTextBody /> : null;
}

function GenerateTextBody() {
  const close = () => useSessionStore.getState().setGenerateTextOpen(false);
  const providers = useAIStore((s) => s.providers);
  const promptSelection = useAIStore((s) => s.promptSelection);
  const togglePromptModel = useAIStore((s) => s.togglePromptModel);

  const [prompt, setPrompt] = useState('');
  const caps = usePlatformCaps();
  useAIStore((s) => s.hosted);
  useEffect(() => void ensureHostedAi(), []);
  const hostedRef = hostedModelRef();

  // Enabled models still present, grouped by provider.
  const groups = TEXT_PROVIDERS.map((meta) => ({
    meta,
    models:
      meta.id === 'hosted'
        ? hostedRef
          ? [hostedRef.model]
          : []
        : providers[meta.id].enabledModels,
  })).filter((g) => g.models.length > 0);

  const selectedCount = promptSelection.filter((r) =>
    r.providerId === 'hosted'
      ? hostedRef !== null
      : providers[r.providerId]?.enabledModels.includes(r.model),
  ).length;
  const hasModels = groups.length > 0;
  const ready = selectedCount > 0;

  const submit = () => {
    const text = prompt.trim();
    if (!text || !ready) return;
    close();
    void generateTextToCanvas(text).catch(() => {});
  };

  const openProviders = () => {
    close();
    useSessionStore.getState().setAiProvidersOpen(true);
  };

  return (
    <UiDialog
      title="Generate Text"
      onClose={close}
      className="generate-sheet"
      size="wide"
      testId="generate-text-dialog"
    >
      <div className="generate-body">
        {!caps.ai && (
          <p className="sync-note sync-warn" role="alert" data-testid="generate-gate">
            {hasSyncServer()
              ? 'AI generation runs through your sync server, which isn’t reachable right now.'
              : 'This deployment has no sync server, so AI generation isn’t available.'}
          </p>
        )}
        {hasModels ? (
          <div className="generate-model">
            <span>Models</span>
            <div className="model-picker">
              <UiPopover>
                <UiPopoverTrigger asChild>
                  <button
                    type="button"
                    className="model-picker-toggle"
                    data-testid="generate-model-toggle"
                  >
                    <span>{selectedCount > 0 ? `${selectedCount} selected` : 'Select models'}</span>
                    <ChevronDownIcon size={16} />
                  </button>
                </UiPopoverTrigger>
                <UiPopoverContent
                  className="model-picker-list"
                  align="start"
                  style={{ width: 'var(--radix-popover-trigger-width)' }}
                >
                  <div data-testid="generate-model-list">
                    {groups.map((g) => (
                      <div className="model-picker-group" key={g.meta.id}>
                        <div className="model-picker-provider">{g.meta.label}</div>
                        {g.models.map((model) => {
                          const ref = { providerId: g.meta.id, model };
                          const checked = promptSelection.some((r) => refKey(r) === refKey(ref));
                          return (
                            <label key={model} className="ai-model-check">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => togglePromptModel(ref)}
                                data-testid={`generate-model-check-${g.meta.id}-${model}`}
                              />
                              <span>{model}</span>
                            </label>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </UiPopoverContent>
              </UiPopover>
            </div>
          </div>
        ) : null}

        <textarea
          className="generate-prompt"
          data-testid="generate-prompt"
          autoFocus
          data-autofocus
          rows={5}
          placeholder="Describe what to write"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />

        <div className="generate-foot">
          {ready ? (
            <span className="generate-provider">
              {selectedCount} {selectedCount === 1 ? 'box' : 'boxes'}
            </span>
          ) : (
            <button type="button" className="generate-config-link" onClick={openProviders}>
              {hasModels ? 'Pick at least one model' : 'Add a provider'} →
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            data-testid="generate-submit"
            disabled={!ready || !prompt.trim()}
            onClick={submit}
          >
            Generate
          </button>
        </div>
      </div>
    </UiDialog>
  );
}
