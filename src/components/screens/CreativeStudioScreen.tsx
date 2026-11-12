import React, { useState, useRef, useEffect } from 'react';
import { ThreeProductStudioScene, StudioModelPreset } from '../three/ThreeProductStudioScene';
import { useRole } from '../../context/RoleContext';

export type StudioTabId = 'three-3d' | 'image-studio' | 'video-studio' | 'gemini-chat' | 'audio-transcribe';
export type ChatGeminiModel = 'gemini-4-argon' | 'gemini-3.8-flash' | 'gemini-3.1-flash-lite';

interface ChatTurn {
  id: string;
  role: 'user' | 'model';
  text: string;
  modelUsed?: string;
  timestamp: string;
}

interface CreativeStudioScreenProps {
  portalMode?: 'customer' | 'seller';
  initialTab?: StudioTabId;
  showToast?: (msg: string) => void;
}

export const CreativeStudioScreen: React.FC<CreativeStudioScreenProps> = ({
  portalMode,
  initialTab = 'three-3d',
  showToast,
}) => {
  const { role, authFetch } = useRole();
  const resolvedPortal: 'customer' | 'seller' =
    portalMode || (role === 'customer' ? 'customer' : 'seller');

  const [activeTab, setActiveTab] = useState<StudioTabId>(initialTab);
  const [selected3dPreset, setSelected3dPreset] = useState<StudioModelPreset>('aerobreeze-fan');

  // ============================================================================
  // 1. Create & Edit Images State (gemini-nano-banana-2.1)
  // ============================================================================
  const [imagePrompt, setImagePrompt] = useState<string>(
    resolvedPortal === 'seller'
      ? 'Studio product photograph of a sleek matte-black 1200mm smart BLDC ceiling fan with subtle warm rim lighting on a minimalist architectural concrete backdrop'
      : 'Modern Indian living room with a matte-black smart ceiling fan above a walnut coffee table, warm afternoon sunlight'
  );
  const [imageAspectRatio, setImageAspectRatio] = useState<'1:1' | '16:9' | '9:16' | '4:3' | '3:4'>('1:1');
  const [imageSize, setImageSize] = useState<'1K' | '2K'>('1K');
  const [sourceEditImage, setSourceEditImage] = useState<{ base64: string; mimeType: string } | null>(null);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [imageCaption, setImageCaption] = useState<string>('');
  const [imageLoading, setImageLoading] = useState<boolean>(false);
  const [imageError, setImageError] = useState<string | null>(null);

  // ============================================================================
  // 2. Animate Images into Video State (gemini-omni-1.1-flash via Interactions API)
  // ============================================================================
  const [videoSourceImage, setVideoSourceImage] = useState<{ base64: string; mimeType: string; name: string } | null>(null);
  const [videoPrompt, setVideoPrompt] = useState<string>(
    'Smooth cinematic orbital camera pan around the product as soft studio light glides across the brushed metallic surface.'
  );
  const [videoAspectRatio, setVideoAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [videoDuration, setVideoDuration] = useState<'5s' | '10s'>('5s');
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState<boolean>(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  // ============================================================================
  // 3. Multi-Turn Gemini Chatbot State (gemini-4-argon, gemini-3.8-flash, gemini-3.1-flash-lite)
  // ============================================================================
  const [chatModel, setChatModel] = useState<ChatGeminiModel>('gemini-3.8-flash');
  const [systemInstruction, setSystemInstruction] = useState<string>(
    resolvedPortal === 'customer'
      ? 'You are the AC PayPilot Customer Shopping & Escrow Concierge. Help shoppers compare smart hardware products, inspect 3D/AR specifications, optimize SmartCart budgets in INR (₹), and understand 100% PayPal Escrow buyer protection.'
      : 'You are the AC PayPilot Seller Operations & Autonomous Escrow Strategist. Help merchants analyze 30-day order volume trends, audit GST invoices, optimize product listings, triage escrow risk anomalies, and manage PayPal Sandbox settlements in INR (₹).'
  );
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([
    {
      id: 'init-1',
      role: 'model',
      text:
        resolvedPortal === 'customer'
          ? 'Hello! I am your Customer Shopping & Escrow Concierge. You can switch between gemini-4-argon (complex reasoning), gemini-3.8-flash (general tasks), and gemini-3.1-flash-lite (fast responses). How can I help with your order or 3D catalog today?'
          : 'Welcome to the Seller AI Operations Desk. Switch between gemini-4-argon (complex financial & escrow audits), gemini-3.8-flash (general operations), and gemini-3.1-flash-lite (fast queries). What would you like to analyze?',
      modelUsed: 'gemini-3.8-flash',
      timestamp: 'Just now',
    },
  ]);
  const [chatInput, setChatInput] = useState<string>('');
  const [chatLoading, setChatLoading] = useState<boolean>(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // ============================================================================
  // 4. Microphone Audio Transcription State (gemini-3.5-transcribe)
  // ============================================================================
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [transcribing, setTranscribing] = useState<boolean>(false);
  const [transcriptText, setTranscriptText] = useState<string>('');
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, chatLoading]);

  // Helper to read file as base64
  const readFileAsBase64 = (file: File): Promise<{ base64: string; mimeType: string; name: string }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        resolve({
          base64: result,
          mimeType: file.type || 'image/png',
          name: file.name,
        });
      };
      reader.onerror = () => reject(new Error('Unable to read file'));
      reader.readAsDataURL(file);
    });
  };

  // Image Generation / Editing Handler (gemini-nano-banana-2.1)
  const handleRunImageStudio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imagePrompt.trim() || imageLoading) return;

    setImageLoading(true);
    setImageError(null);
    try {
      const res = await authFetch('/api/ai/image', {
        method: 'POST',
        body: JSON.stringify({
          prompt: imagePrompt.trim(),
          imageBase64: sourceEditImage?.base64,
          mimeType: sourceEditImage?.mimeType || 'image/png',
          aspectRatio: imageAspectRatio,
          imageSize,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setImageError(data.error || `Image generation failed (HTTP ${res.status}).`);
      } else {
        setGeneratedImageUrl(data.imageUrl);
        setImageCaption(data.caption || '');
        showToast?.(
          sourceEditImage
            ? 'Edited image with gemini-nano-banana-2.1'
            : 'Generated image with gemini-nano-banana-2.1'
        );
      }
    } catch (err: any) {
      setImageError(err?.message || 'Network error while generating image.');
    } finally {
      setImageLoading(false);
    }
  };

  // Photo-to-Video Animation Handler (gemini-omni-1.1-flash via Interactions API)
  const handleRunVideoStudio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoSourceImage || videoLoading) {
      setVideoError('Please upload a photo first to animate into a video.');
      return;
    }

    setVideoLoading(true);
    setVideoError(null);
    try {
      const res = await authFetch('/api/ai/video', {
        method: 'POST',
        body: JSON.stringify({
          imageBase64: videoSourceImage.base64,
          mimeType: videoSourceImage.mimeType,
          prompt: videoPrompt.trim(),
          aspectRatio: videoAspectRatio,
          duration: videoDuration,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setVideoError(data.error || `Video animation failed (HTTP ${res.status}).`);
      } else {
        setGeneratedVideoUrl(data.videoUrl);
        showToast?.(`Animated ${videoAspectRatio} video with gemini-omni-1.1-flash`);
      }
    } catch (err: any) {
      setVideoError(err?.message || 'Network error while animating video.');
    } finally {
      setVideoLoading(false);
    }
  };

  // Multi-turn Chat Handler (gemini-4-argon, gemini-3.8-flash, gemini-3.1-flash-lite)
  const handleSendChatMessage = async (customText?: string) => {
    const textToSend = (customText ?? chatInput).trim();
    if (!textToSend || chatLoading) return;

    const userTurn: ChatTurn = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const nextHistory = [...chatHistory, userTurn];
    setChatHistory(nextHistory);
    if (!customText) setChatInput('');
    setChatLoading(true);
    setChatError(null);

    try {
      const res = await authFetch('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: nextHistory.map((m) => ({ role: m.role, text: m.text })),
          model: chatModel,
          portalRole: resolvedPortal,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setChatError(data.error || `Chat request failed (HTTP ${res.status}).`);
      } else {
        setChatHistory((prev) => [
          ...prev,
          {
            id: `m-${Date.now()}`,
            role: 'model',
            text: data.reply,
            modelUsed: data.model,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
      }
    } catch (err: any) {
      setChatError(err?.message || 'Unable to reach Gemini chat endpoint.');
    } finally {
      setChatLoading(false);
    }
  };

  // Microphone Recording & Audio Transcription Handler (gemini-3.5-transcribe)
  const startMicrophoneRecording = async (onTranscribed?: (text: string) => void) => {
    setTranscribeError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size === 0) return;

        setTranscribing(true);
        try {
          const reader = new FileReader();
          reader.onloadend = async () => {
            const base64Audio = String(reader.result || '');
            const res = await authFetch('/api/ai/transcribe', {
              method: 'POST',
              body: JSON.stringify({
                audioBase64: base64Audio,
                mimeType,
              }),
            });
            const data = await res.json().catch(() => ({}));
            setTranscribing(false);
            if (!res.ok || !data.ok) {
              setTranscribeError(data.error || `Audio transcription failed (HTTP ${res.status}).`);
            } else {
              const cleanText = data.transcript || '';
              setTranscriptText(cleanText);
              onTranscribed?.(cleanText);
              showToast?.('Audio transcribed with gemini-3.5-transcribe');
            }
          };
          reader.readAsDataURL(blob);
        } catch (err: any) {
          setTranscribing(false);
          setTranscribeError(err?.message || 'Failed to transcribe audio.');
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (err: any) {
      setTranscribeError(
        err?.message || 'Microphone access was denied or is unavailable in this browser.'
      );
    }
  };

  const stopMicrophoneRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleUploadAudioFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTranscribing(true);
    setTranscribeError(null);
    try {
      const { base64, mimeType } = await readFileAsBase64(file);
      const res = await authFetch('/api/ai/transcribe', {
        method: 'POST',
        body: JSON.stringify({
          audioBase64: base64,
          mimeType: mimeType || 'audio/mp3',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setTranscribeError(data.error || `Audio transcription failed (HTTP ${res.status}).`);
      } else {
        setTranscriptText(data.transcript || '');
        showToast?.('Audio file transcribed with gemini-3.5-transcribe');
      }
    } catch (err: any) {
      setTranscribeError(err?.message || 'Unable to process audio file.');
    } finally {
      setTranscribing(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header & Portal Mode Switcher */}
      <div className="p-6 rounded-2xl bg-surface border border-outline-variant/30 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-on-surface-variant font-medium">
            <span>
              {resolvedPortal === 'seller'
                ? 'Seller Creative & Spatial AI Suite'
                : 'Customer Spatial & Multimodal Shopping Suite'}
            </span>
            <span aria-hidden="true">·</span>
            <span>Three.js PBR</span>
            <span aria-hidden="true">·</span>
            <span>Gemini Multimodal</span>
          </div>
          <h1 className="text-xl lg:text-2xl font-black text-on-surface tracking-tight">
            {resolvedPortal === 'seller'
              ? 'Seller 3D Studio, Image/Video Lab & Gemini Copilot'
              : 'Customer 3D Spatial Showcase, Visual Customizer & AI Concierge'}
          </h1>
        </div>

        {/* 5 Feature Navigation Tabs */}
        <div
          className="flex flex-wrap items-center gap-1.5 bg-surface-container-low p-1.5 rounded-xl border border-outline-variant/30"
          role="tablist"
        >
          {(
            [
              { id: 'three-3d', label: 'Three.js 3D Scenes', icon: '3d_rotation' },
              { id: 'image-studio', label: 'Create & Edit Images', icon: 'add_photo_alternate' },
              { id: 'video-studio', label: 'Animate Photo to Video', icon: 'movie' },
              { id: 'gemini-chat', label: 'Gemini Multi-Turn Chat', icon: 'forum' },
              { id: 'audio-transcribe', label: 'Transcribe Audio', icon: 'graphic_eq' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-primary text-on-primary shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[16px] shrink-0" aria-hidden="true">
                {tab.icon}
              </span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: THREE.JS 3D SCENES */}
      {activeTab === 'three-3d' && (
        <div className="space-y-4">
          <ThreeProductStudioScene
            initialPreset={selected3dPreset}
            portalMode={resolvedPortal}
            onSelectModelSku={(sku) => showToast?.(`Loaded 3D composite group for #${sku}`)}
          />
        </div>
      )}

      {/* TAB 2: CREATE & EDIT IMAGES (gemini-nano-banana-2.1) */}
      {activeTab === 'image-studio' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleRunImageStudio}
            className="lg:col-span-5 p-6 rounded-2xl bg-surface border border-outline-variant/30 shadow-xs space-y-4"
          >
            <div>
              <h2 className="text-base font-bold text-on-surface">
                Create &amp; Edit Images (gemini-nano-banana-2.1)
              </h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                {resolvedPortal === 'seller'
                  ? 'Generate studio catalog photography or upload an existing product image to edit backgrounds and lighting.'
                  : 'Visualize products in your room or customize finishes using text prompts.'}
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-on-surface">Text Prompt</label>
                <button
                  type="button"
                  onClick={() =>
                    isRecording
                      ? stopMicrophoneRecording()
                      : startMicrophoneRecording((txt) =>
                          setImagePrompt((prev) => (prev ? `${prev} ${txt}` : txt))
                        )
                  }
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer ${
                    isRecording
                      ? 'bg-rose-600 text-white'
                      : 'bg-surface-container text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px]">mic</span>
                  <span>{isRecording ? 'Stop Mic' : transcribing ? 'Transcribing...' : 'Voice Prompt'}</span>
                </button>
              </div>
              <textarea
                rows={4}
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                placeholder="Describe the image to create or how to edit the uploaded image..."
                className="w-full rounded-xl bg-surface-container-low border border-outline-variant/40 p-3 text-xs text-on-surface focus:outline-none focus:border-primary"
              />
            </div>

            {/* Optional Image Upload for Image Editing */}
            <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-on-surface">
                  Source Image for Editing (Optional)
                </span>
                {sourceEditImage && (
                  <button
                    type="button"
                    onClick={() => setSourceEditImage(null)}
                    className="text-[11px] font-semibold text-rose-600 hover:underline cursor-pointer"
                  >
                    Clear Source Image (Switch to Create)
                  </button>
                )}
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const loaded = await readFileAsBase64(file);
                  setSourceEditImage({ base64: loaded.base64, mimeType: loaded.mimeType });
                }}
                className="block w-full text-xs text-on-surface-variant file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-on-primary cursor-pointer"
              />
              {sourceEditImage && (
                <div className="flex items-center gap-3 pt-1">
                  <img
                    src={sourceEditImage.base64}
                    alt="Source for editing"
                    className="w-14 h-14 rounded-lg object-cover border border-outline-variant/40"
                  />
                  <span className="text-[11px] text-emerald-700 font-medium">
                    Edit Mode Active — prompt will modify this image
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-on-surface mb-1">
                  Aspect Ratio
                </label>
                <select
                  value={imageAspectRatio}
                  onChange={(e) => setImageAspectRatio(e.target.value as any)}
                  className="w-full rounded-xl bg-surface-container-low border border-outline-variant/40 px-3 py-2 text-xs text-on-surface"
                >
                  <option value="1:1">1:1 (Square)</option>
                  <option value="16:9">16:9 (Landscape)</option>
                  <option value="9:16">9:16 (Portrait)</option>
                  <option value="4:3">4:3 (Standard)</option>
                  <option value="3:4">3:4 (Vertical)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface mb-1">
                  Resolution
                </label>
                <select
                  value={imageSize}
                  onChange={(e) => setImageSize(e.target.value as '1K' | '2K')}
                  className="w-full rounded-xl bg-surface-container-low border border-outline-variant/40 px-3 py-2 text-xs text-on-surface"
                >
                  <option value="1K">1K Standard</option>
                  <option value="2K">2K High-Res</option>
                </select>
              </div>
            </div>

            {imageError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700">
                {imageError}
              </div>
            )}

            <button
              type="submit"
              disabled={imageLoading}
              className="w-full py-2.5 px-4 rounded-xl bg-primary text-on-primary text-xs font-bold hover:bg-primary/90 transition-all cursor-pointer disabled:opacity-50"
            >
              {imageLoading
                ? 'Running gemini-nano-banana-2.1...'
                : sourceEditImage
                ? 'Edit Image with gemini-nano-banana-2.1'
                : 'Generate Image with gemini-nano-banana-2.1'}
            </button>
          </form>

          <div className="lg:col-span-7 p-6 rounded-2xl bg-surface border border-outline-variant/30 shadow-xs flex flex-col justify-between min-h-[420px]">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
              <span className="text-xs font-bold text-on-surface">
                Output Canvas · gemini-nano-banana-2.1
              </span>
              {generatedImageUrl && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSourceEditImage({ base64: generatedImageUrl, mimeType: 'image/png' });
                      showToast?.('Loaded output image as source for iterative editing');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-surface-container text-xs font-semibold text-on-surface hover:bg-surface-container-high cursor-pointer"
                  >
                    Edit This Image
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setVideoSourceImage({
                        base64: generatedImageUrl,
                        mimeType: 'image/png',
                        name: 'generated-product.png',
                      });
                      setActiveTab('video-studio');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-primary text-on-primary text-xs font-semibold cursor-pointer"
                  >
                    Animate into Video →
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 flex items-center justify-center py-6">
              {generatedImageUrl ? (
                <div className="space-y-3 text-center max-w-lg">
                  <img
                    src={generatedImageUrl}
                    alt="Generated by gemini-nano-banana-2.1"
                    className="max-h-[360px] w-auto mx-auto rounded-xl border border-outline-variant/30 shadow-md"
                  />
                  {imageCaption && (
                    <p className="text-xs text-on-surface-variant">{imageCaption}</p>
                  )}
                </div>
              ) : (
                <div className="text-center space-y-2 text-on-surface-variant max-w-sm">
                  <span className="material-symbols-outlined text-4xl opacity-40" aria-hidden="true">
                    add_photo_alternate
                  </span>
                  <p className="text-xs">
                    Enter a prompt on the left to generate a new visual or upload an existing photo to edit it with{' '}
                    <span className="font-mono font-semibold">gemini-nano-banana-2.1</span>.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ANIMATE IMAGES INTO VIDEO (gemini-omni-1.1-flash via Interactions API) */}
      {activeTab === 'video-studio' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleRunVideoStudio}
            className="lg:col-span-5 p-6 rounded-2xl bg-surface border border-outline-variant/30 shadow-xs space-y-4"
          >
            <div>
              <h2 className="text-base font-bold text-on-surface">
                Animate Photo into Video (gemini-omni-1.1-flash)
              </h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Upload a product or room photo and animate it into a 16:9 or 9:16 video using the Gemini Interactions API.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/30 space-y-2">
              <label className="block text-xs font-semibold text-on-surface">
                1. Upload Photo to Animate
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const loaded = await readFileAsBase64(file);
                  setVideoSourceImage(loaded);
                  setVideoError(null);
                }}
                className="block w-full text-xs text-on-surface-variant file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-on-primary cursor-pointer"
              />
              {videoSourceImage && (
                <div className="flex items-center gap-3 pt-2">
                  <img
                    src={videoSourceImage.base64}
                    alt="Selected starting frame"
                    className="w-16 h-16 rounded-lg object-cover border border-outline-variant/40"
                  />
                  <div className="text-xs min-w-0">
                    <p className="font-semibold text-on-surface truncate">{videoSourceImage.name}</p>
                    <p className="text-[11px] text-emerald-700">Ready for gemini-omni-1.1-flash</p>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-on-surface mb-1">
                  2. Video Aspect Ratio
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      { id: '16:9', label: '16:9 Landscape' },
                      { id: '9:16', label: '9:16 Portrait' },
                    ] as const
                  ).map((ar) => (
                    <button
                      key={ar.id}
                      type="button"
                      onClick={() => setVideoAspectRatio(ar.id)}
                      className={`py-2 px-2.5 rounded-xl text-xs font-bold border cursor-pointer transition-colors ${
                        videoAspectRatio === ar.id
                          ? 'bg-primary text-on-primary border-primary'
                          : 'bg-surface-container-low text-on-surface border-outline-variant/40'
                      }`}
                    >
                      {ar.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface mb-1">
                  Duration
                </label>
                <select
                  value={videoDuration}
                  onChange={(e) => setVideoDuration(e.target.value as '5s' | '10s')}
                  className="w-full rounded-xl bg-surface-container-low border border-outline-variant/40 px-3 py-2 text-xs text-on-surface"
                >
                  <option value="5s">5 Seconds (720p)</option>
                  <option value="10s">10 Seconds (720p)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1">
                3. Camera &amp; Motion Prompt
              </label>
              <textarea
                rows={3}
                value={videoPrompt}
                onChange={(e) => setVideoPrompt(e.target.value)}
                placeholder="Describe the camera motion and scene animation..."
                className="w-full rounded-xl bg-surface-container-low border border-outline-variant/40 p-3 text-xs text-on-surface focus:outline-none focus:border-primary"
              />
            </div>

            {videoError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700">
                {videoError}
              </div>
            )}

            <button
              type="submit"
              disabled={videoLoading}
              className="w-full py-2.5 px-4 rounded-xl bg-primary text-on-primary text-xs font-bold hover:bg-primary/90 transition-all cursor-pointer disabled:opacity-50"
            >
              {videoLoading
                ? 'Generating Video via Interactions API (gemini-omni-1.1-flash)...'
                : `Animate Photo into ${videoAspectRatio} Video`}
            </button>
          </form>

          <div className="lg:col-span-7 p-6 rounded-2xl bg-surface border border-outline-variant/30 shadow-xs flex flex-col justify-between min-h-[420px]">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
              <span className="text-xs font-bold text-on-surface">
                Video Output · gemini-omni-1.1-flash ({videoAspectRatio})
              </span>
              {generatedVideoUrl && (
                <a
                  href={generatedVideoUrl}
                  download={`ac-paypilot-omni-${videoAspectRatio.replace(':', 'x')}.mp4`}
                  className="px-3 py-1 rounded-lg bg-primary text-on-primary text-xs font-semibold"
                >
                  Download MP4
                </a>
              )}
            </div>

            <div className="flex-1 flex items-center justify-center py-6">
              {generatedVideoUrl ? (
                <video
                  src={generatedVideoUrl}
                  controls
                  autoPlay
                  loop
                  className={`rounded-xl border border-outline-variant/30 shadow-md ${
                    videoAspectRatio === '9:16' ? 'max-h-[420px] aspect-[9/16]' : 'w-full max-w-xl aspect-video'
                  }`}
                />
              ) : (
                <div className="text-center space-y-2 text-on-surface-variant max-w-sm">
                  <span className="material-symbols-outlined text-4xl opacity-40">movie</span>
                  <p className="text-xs">
                    Upload a photo and choose <span className="font-mono font-semibold">16:9</span> or{' '}
                    <span className="font-mono font-semibold">9:16</span> to animate it using{' '}
                    <span className="font-mono font-semibold">gemini-omni-1.1-flash</span> via the Interactions API.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: MULTI-TURN GEMINI CHATBOT (gemini-4-argon, gemini-3.8-flash, gemini-3.1-flash-lite) */}
      {activeTab === 'gemini-chat' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left 4 Cols: Model Tier Selector & Role System Instruction */}
          <div className="lg:col-span-4 p-6 rounded-2xl bg-surface border border-outline-variant/30 shadow-xs space-y-4">
            <div>
              <h2 className="text-base font-bold text-on-surface">Multi-Turn Gemini Configuration</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Select the Gemini model tier for your task and customize the role-specific system instruction.
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-on-surface">
                Select Gemini Model
              </label>
              {(
                [
                  {
                    id: 'gemini-4-argon',
                    title: 'gemini-4-argon',
                    desc: 'Complex reasoning, GST & escrow audit, deep financial analysis',
                  },
                  {
                    id: 'gemini-3.8-flash',
                    title: 'gemini-3.8-flash',
                    desc: 'General tasks, catalog comparison, order & storefront assistance',
                  },
                  {
                    id: 'gemini-3.1-flash-lite',
                    title: 'gemini-3.1-flash-lite',
                    desc: 'Fast, low-latency responses for quick lookups',
                  },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setChatModel(m.id)}
                  className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer ${
                    chatModel === m.id
                      ? 'bg-primary/10 border-primary text-on-surface'
                      : 'bg-surface-container-low border-outline-variant/30 text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <div className="text-xs font-mono font-bold text-primary">{m.title}</div>
                  <div className="text-[11px] mt-0.5">{m.desc}</div>
                </button>
              ))}
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1">
                Role System Instruction ({resolvedPortal === 'seller' ? 'Seller Advisor' : 'Customer Concierge'})
              </label>
              <textarea
                rows={4}
                value={systemInstruction}
                onChange={(e) => setSystemInstruction(e.target.value)}
                className="w-full rounded-xl bg-surface-container-low border border-outline-variant/40 p-3 text-xs text-on-surface focus:outline-none focus:border-primary"
              />
            </div>

            <button
              type="button"
              onClick={() =>
                setChatHistory([
                  {
                    id: `reset-${Date.now()}`,
                    role: 'model',
                    text: `Conversation history cleared. Active model: ${chatModel}.`,
                    modelUsed: chatModel,
                    timestamp: 'Just now',
                  },
                ])
              }
              className="w-full py-2 px-3 rounded-xl bg-surface-container border border-outline-variant/40 text-xs font-semibold text-on-surface hover:bg-surface-container-high cursor-pointer"
            >
              Reset Conversation History
            </button>
          </div>

          {/* Right 8 Cols: Scrollable Multi-Turn Conversation Thread */}
          <div className="lg:col-span-8 p-6 rounded-2xl bg-surface border border-outline-variant/30 shadow-xs flex flex-col h-[540px]">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3 mb-3">
              <div className="text-xs font-bold text-on-surface">
                Multi-Turn Thread · {chatHistory.length} turns
              </div>
              <span className="text-xs font-mono text-primary font-semibold">{chatModel}</span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {chatHistory.map((turn) => (
                <div
                  key={turn.id}
                  className={`flex flex-col ${
                    turn.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div
                    className={`max-w-[82%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                      turn.role === 'user'
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-container-low border border-outline-variant/30 text-on-surface'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{turn.text}</p>
                  </div>
                  <div className="text-[10px] text-on-surface-variant mt-1 px-1">
                    <span>{turn.role === 'user' ? 'You' : turn.modelUsed || chatModel}</span>
                    <span aria-hidden="true"> · </span>
                    <span>{turn.timestamp}</span>
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="text-xs text-on-surface-variant italic px-2">
                  {chatModel} is generating a response...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {chatError && (
              <div className="my-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700">
                {chatError}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSendChatMessage();
              }}
              className="mt-3 pt-3 border-t border-outline-variant/20 flex items-center gap-2"
            >
              <button
                type="button"
                onClick={() =>
                  isRecording
                    ? stopMicrophoneRecording()
                    : startMicrophoneRecording((txt) =>
                        setChatInput((prev) => (prev ? `${prev} ${txt}` : txt))
                      )
                }
                title="Record voice with gemini-3.5-transcribe"
                className={`p-2.5 rounded-xl border transition-colors cursor-pointer shrink-0 ${
                  isRecording
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-surface-container-low text-on-surface border-outline-variant/40 hover:bg-surface-container'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">mic</span>
              </button>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={`Message ${chatModel} (or click Mic to transcribe voice)...`}
                className="flex-1 rounded-xl bg-surface-container-low border border-outline-variant/40 px-3.5 py-2.5 text-xs text-on-surface focus:outline-none focus:border-primary"
              />
              <button
                type="submit"
                disabled={chatLoading || !chatInput.trim()}
                className="px-4 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold hover:bg-primary/90 cursor-pointer disabled:opacity-50 shrink-0"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB 5: TRANSCRIBE AUDIO (gemini-3.5-transcribe) */}
      {activeTab === 'audio-transcribe' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 p-6 rounded-2xl bg-surface border border-outline-variant/30 shadow-xs space-y-4">
            <div>
              <h2 className="text-base font-bold text-on-surface">
                Microphone Audio Transcription (gemini-3.5-transcribe)
              </h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Record voice notes from your microphone or upload an audio clip to transcribe it with{' '}
                <span className="font-mono font-semibold">gemini-3.5-transcribe</span>.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-surface-container-low border border-outline-variant/30 flex flex-col items-center justify-center text-center space-y-3">
              <button
                type="button"
                onClick={() =>
                  isRecording ? stopMicrophoneRecording() : startMicrophoneRecording()
                }
                className={`w-16 h-16 rounded-full flex items-center justify-center shadow-md transition-all cursor-pointer ${
                  isRecording
                    ? 'bg-rose-600 text-white scale-105'
                    : 'bg-primary text-on-primary hover:bg-primary/90'
                }`}
              >
                <span className="material-symbols-outlined text-[28px]">
                  {isRecording ? 'stop' : 'mic'}
                </span>
              </button>
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-on-surface">
                  {isRecording
                    ? 'Recording Microphone Audio... Click to Stop & Transcribe'
                    : transcribing
                    ? 'Transcribing with gemini-3.5-transcribe...'
                    : 'Click Microphone to Record Voice'}
                </p>
                <p className="text-[11px] text-on-surface-variant">
                  Uses browser MediaRecorder + server-side gemini-3.5-transcribe
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/30 space-y-2">
              <label className="block text-xs font-semibold text-on-surface">
                Or Upload an Audio File (.webm, .mp3, .wav)
              </label>
              <input
                type="file"
                accept="audio/*"
                onChange={handleUploadAudioFile}
                className="block w-full text-xs text-on-surface-variant file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-on-primary cursor-pointer"
              />
            </div>

            {transcribeError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700">
                {transcribeError}
              </div>
            )}
          </div>

          <div className="lg:col-span-7 p-6 rounded-2xl bg-surface border border-outline-variant/30 shadow-xs flex flex-col justify-between min-h-[340px]">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
              <span className="text-xs font-bold text-on-surface">
                Transcription Result · gemini-3.5-transcribe
              </span>
              {transcriptText && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setChatInput(transcriptText);
                      setActiveTab('gemini-chat');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-primary text-on-primary text-xs font-semibold cursor-pointer"
                  >
                    Send to Gemini Chat →
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setImagePrompt(transcriptText);
                      setActiveTab('image-studio');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-surface-container text-on-surface text-xs font-semibold cursor-pointer"
                  >
                    Use as Image Prompt
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 py-4">
              <textarea
                rows={8}
                value={transcriptText}
                onChange={(e) => setTranscriptText(e.target.value)}
                placeholder="Your transcribed speech from gemini-3.5-transcribe will appear here..."
                className="w-full h-full rounded-xl bg-surface-container-low border border-outline-variant/30 p-4 text-xs text-on-surface focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
