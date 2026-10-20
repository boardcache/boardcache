/** Lightbox Assistant tab: model picker, describe, OCR and transcript panels. */
import { useEffect, useRef, useState } from 'react';
import type { AudioItem, ImageItem, VideoItem } from '@boardcache/schema';
import { updateItems } from '../../state/commands';
import {
  likelyVisionModel,
  ocrAvailable,
  ocrModelChoice,
  ocrModelChoices,
  runDescribe,
  runOcr,
  setOcrModelChoice,
  textBoxFromOcr,
  useDescribeStore,
  useOcrStore,
} from '../../lib/media/ocr';
import {
  transcribeAvailable,
  transcribeItem,
  useTranscribeStore,
} from '../../lib/media/transcribe';
import { seekMedia } from '../../lib/media/mediaSeek';
import type { ModelRef } from '../../state/aiStore';
import { UiSelect } from '../ui/Select';

/** Shared vision-model picker for the image AI panels (OCR + Description). */
export function AiModelPicker() {
  if (ocrModelChoices().length <= 1) return null;
  return (
    <div className="lsp-field lsp-ai-model">
      <UiSelect
        ariaLabel="AI model for OCR and descriptions"
        testId="lightbox-ocr-model"
        value={(() => {
          const c = ocrModelChoice();
          return c === 'auto' ? 'auto' : `${c.providerId}:${c.model}`;
        })()}
        onChange={(v) => {
          if (v === 'auto') setOcrModelChoice('auto');
          else {
            const idx = v.indexOf(':');
            setOcrModelChoice({
              providerId: v.slice(0, idx) as ModelRef['providerId'],
              model: v.slice(idx + 1),
            });
          }
        }}
        options={[
          { value: 'auto', label: 'Automatic model' },
          ...ocrModelChoices().map((c) => ({
            value: `${c.providerId}:${c.model}`,
            label:
              (c.providerId === 'hosted' ? 'Hosted AI' : `${c.providerId} · ${c.model}`) +
              (likelyVisionModel(c.providerId, c.model) ? '' : '  (no vision?)'),
          })),
        ]}
      />
    </div>
  );
}

/** AI image description: search metadata, editable; manual generate only. */
export function LightboxDescribePanel({ item }: { item: ImageItem }) {
  const running = useDescribeStore((s) => Boolean(s.running[item.id]));
  const [value, setValue] = useState(item.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const stored = item.description ?? '';
  const prevStored = useRef(stored);
  useEffect(() => {
    if (stored !== prevStored.current) {
      prevStored.current = stored;
      setValue(stored);
    }
  }, [stored]);
  const commit = () => {
    const v = value.trim();
    if (v === (item.description ?? '')) return;
    updateItems([item.id], 'Edit description', (d) => {
      if (d.type === 'image') d.description = v || null;
    });
  };
  return (
    <div className="lsp-field" data-testid="lightbox-describe">
      <span className="lsp-field-label">Description</span>
      <textarea
        className="lightbox-note lightbox-ocr-text"
        data-testid="lightbox-describe-text"
        value={running ? 'Describing' : value}
        disabled={running}
        placeholder="Generate — or write a description to make this image searchable"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') return;
          e.stopPropagation();
        }}
      />
      {error && <p className="lightbox-ocr-error">{error}</p>}
      {ocrAvailable() && !running && (
        <button
          type="button"
          className="lsp-ai-btn"
          data-testid="lightbox-describe-run"
          onClick={() => {
            setError(null);
            void runDescribe(item.id).catch((err: unknown) =>
              setError(err instanceof Error ? err.message : 'Description failed.'),
            );
          }}
        >
          {item.description ? 'Regenerate Description' : 'Generate Description'}
        </button>
      )}
    </div>
  );
}

/** Audio/video transcript: editable like the OCR field; manual AI run. */
export function LightboxTranscriptPanel({ item }: { item: AudioItem | VideoItem }) {
  const running = useTranscribeStore((s) => Boolean(s.running[item.id]));
  const [value, setValue] = useState(item.transcript ?? '');
  const [error, setError] = useState<string | null>(null);
  const stored = item.transcript ?? '';
  const prevStored = useRef(stored);
  useEffect(() => {
    if (stored !== prevStored.current) {
      prevStored.current = stored;
      setValue(stored);
    }
  }, [stored]);
  const commit = () => {
    const v = value.trim();
    if (v === (item.transcript ?? '')) return;
    updateItems([item.id], 'Edit transcript', (d) => {
      if (d.type === 'audio' || d.type === 'video') d.transcript = v || null;
    });
  };
  const segments = item.transcriptSegments;
  const mmss = (t: number) => {
    const m = Math.floor(t / 60);
    const sec = Math.floor(t % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };
  return (
    <div className="lsp-field" data-testid="lightbox-transcript">
      <span className="lsp-field-label">Transcript</span>
      {segments && segments.length > 0 && !running && (
        <div className="transcript-segments" data-testid="transcript-segments">
          {segments.map((seg, i) => (
            <button
              type="button"
              key={i}
              className="transcript-seg"
              data-testid={`transcript-seg-${i}`}
              title="Jump the player here"
              onClick={() => seekMedia(item.id, seg.t0)}
            >
              <span className="transcript-seg-time">{mmss(seg.t0)}</span>
              <span className="transcript-seg-text">{seg.text}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        className="lightbox-note lightbox-ocr-text"
        data-testid="lightbox-transcript-text"
        value={running ? 'Transcribing' : value}
        disabled={running}
        placeholder="Transcribe — or type/paste the spoken text to make it searchable"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') return;
          e.stopPropagation();
        }}
      />
      {error && <p className="lightbox-ocr-error">{error}</p>}
      {item.assetId && transcribeAvailable() && !running && (
        <button
          type="button"
          className="community-preview-btn"
          data-testid="lightbox-transcribe"
          onClick={() => {
            setError(null);
            void transcribeItem(item.id).catch((err: unknown) =>
              setError(err instanceof Error ? err.message : 'Transcription failed.'),
            );
          }}
        >
          {item.transcript ? 'Re-transcribe (AI)' : 'Transcribe (AI)'}
        </button>
      )}
    </div>
  );
}

/** Image text content: OCR-extracted text, editable like the note field. */
export function LightboxOcrPanel({ item }: { item: ImageItem }) {
  const running = useOcrStore((s) => Boolean(s.running[item.id]));
  const [value, setValue] = useState(item.ocrText ?? '');
  const [error, setError] = useState<string | null>(null);
  // Reflect a finished OCR run without clobbering in-progress edits.
  const stored = item.ocrText ?? '';
  const prevStored = useRef(stored);
  useEffect(() => {
    if (stored !== prevStored.current) {
      prevStored.current = stored;
      setValue(stored);
    }
  }, [stored]);

  const commit = () => {
    const v = value.trim();
    if (v === (item.ocrText ?? '')) return;
    updateItems([item.id], 'Edit text content', (d) => {
      if (d.type === 'image') d.ocrText = v || null;
    });
  };
  const extract = () => {
    setError(null);
    void runOcr(item.id)
      .then((text) => {
        prevStored.current = text;
        setValue(text);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'OCR failed.'));
  };

  return (
    <div className="lsp-field" data-testid="lightbox-ocr">
      <span className="lsp-field-label">Text content</span>
      <textarea
        className="lightbox-note lightbox-ocr-text"
        data-testid="lightbox-ocr-text"
        value={running ? 'Extracting text' : value}
        disabled={running}
        placeholder="Run OCR — or type/paste the image’s text to make it searchable"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') return;
          e.stopPropagation();
        }}
      />

      {error && <p className="lightbox-ocr-error">{error}</p>}
      <div className="lightbox-ocr-actions">
        <button
          type="button"
          className="lsp-ai-btn"
          disabled={running || !ocrAvailable()}
          title={ocrAvailable() ? undefined : 'Configure an AI model first (Settings → AI)'}
          data-testid="lightbox-ocr-run"
          onClick={extract}
        >
          {running ? 'Extracting' : value ? 'Re-run OCR' : 'Extract Text (OCR)'}
        </button>
        {value && !running && (
          <button
            type="button"
            className="lsp-ai-btn"
            data-testid="lightbox-ocr-textbox"
            onClick={() => void textBoxFromOcr(item.id)}
          >
            Create Text Box
          </button>
        )}
      </div>
    </div>
  );
}
