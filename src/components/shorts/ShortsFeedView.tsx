import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Heart,
  MessageCircle,
  Share2,
  Plus,
  Volume2,
  VolumeX,
  Play,
  ChevronUp,
  ChevronDown,
  Camera,
  Film,
  Trash2,
  RotateCcw,
  LayoutGrid,
  X,
  Music2,
} from 'lucide-react';
import { VideoItem } from '../../types';
import { VideoService } from '../../services/videoService';
import { StorageService } from '../../services/storage';
import { resolveVideoUrl } from '../../services/videoStorage';
import { InteractiveCommentsSection } from '../comments/InteractiveCommentsSection';
import confetti from 'canvas-confetti';

interface ShortsFeedViewProps {
  onOpenPublishVideo: () => void;
  onOpenPublisherProfile: (authorName: string) => void;
}

export const ShortsFeedView: React.FC<ShortsFeedViewProps> = ({
  onOpenPublishVideo,
  onOpenPublisherProfile,
}) => {
  const [shorts, setShorts] = useState<VideoItem[]>(() => VideoService.getShorts());
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [pausedMap, setPausedMap] = useState<Record<string, boolean>>({});
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [doubleTapHeart, setDoubleTapHeart] = useState<{ id: string; x: number; y: number } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [commentsTarget, setCommentsTarget] = useState<VideoItem | null>(null);
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({});
  const [isAllShortsOpen, setIsAllShortsOpen] = useState<boolean>(false);

  const feedContainerRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const prevTopShortIdRef = useRef<string | undefined>(shorts[0]?.id);
  const prevActiveIndexRef = useRef<number>(-1);
  const lastTapTimeRef = useRef<number>(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseDragStartYRef = useRef<number | null>(null);

  // Scroll smoothly to a specific Short index
  const scrollToIndex = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(shorts.length - 1, idx));
      const slide = slideRefs.current[clamped];
      if (slide) {
        slide.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      setCurrentIndex(clamped);
    },
    [shorts.length]
  );

  // Subscribe to live video updates & jump to newest Short when published
  useEffect(() => {
    const unsubscribe = VideoService.subscribe(() => {
      const nextShorts = VideoService.getShorts();
      setShorts(nextShorts);
      if (nextShorts[0]?.id && nextShorts[0].id !== prevTopShortIdRef.current) {
        prevTopShortIdRef.current = nextShorts[0].id;
        setCurrentIndex(0);
        setTimeout(() => {
          slideRefs.current[0]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      } else {
        setCurrentIndex((prev) => Math.min(prev, Math.max(0, nextShorts.length - 1)));
      }
    });
    return () => unsubscribe();
  }, []);

  // Resolve real playable URLs (IndexedDB / local assets) for ALL Shorts on the site
  useEffect(() => {
    let active = true;
    shorts.forEach((item) => {
      resolveVideoUrl(item).then((url) => {
        if (!active) return;
        const finalUrl = url || item.videoUrl;
        setResolvedUrls((prev) => {
          if (prev[item.id] === finalUrl) return prev;
          return { ...prev, [item.id]: finalUrl };
        });
      });
    });
    return () => {
      active = false;
    };
  }, [shorts]);

  // Track which Short slide is currently visible using IntersectionObserver (TikTok snap)
  useEffect(() => {
    const container = feedContainerRef.current;
    if (!container || shorts.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const idxAttr = entry.target.getAttribute('data-short-index');
            if (idxAttr !== null) {
              const idx = Number(idxAttr);
              if (!Number.isNaN(idx)) {
                setCurrentIndex(idx);
              }
            }
          }
        });
      },
      {
        root: container,
        threshold: 0.6,
      }
    );

    slideRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [shorts.length]);

  // Auto-play active Short from start when swiped onto it, and pause all other Shorts
  useEffect(() => {
    const isSlideSwitch = prevActiveIndexRef.current !== currentIndex;
    prevActiveIndexRef.current = currentIndex;

    videoRefs.current.forEach((video, idx) => {
      const item = shorts[idx];
      if (!video || !item) return;
      if (idx === currentIndex && !isAllShortsOpen) {
        if (isSlideSwitch) {
          video.currentTime = 0;
          setPausedMap((prev) => (prev[item.id] ? { ...prev, [item.id]: false } : prev));
        }
        if (isSlideSwitch || !pausedMap[item.id]) {
          video.play().catch(() => {});
        }
      } else {
        video.pause();
      }
    });
  }, [currentIndex, shorts, resolvedUrls, pausedMap, isAllShortsOpen]);

  // Keyboard Up/Down arrows for flipping Shorts on laptop/desktop
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (commentsTarget || isAllShortsOpen) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        scrollToIndex(currentIndex + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        scrollToIndex(currentIndex - 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentIndex, scrollToIndex, commentsTarget, isAllShortsOpen]);

  const handleToggleLike = (video: VideoItem) => {
    const isNowLiked = VideoService.toggleLike(video.id);
    if (isNowLiked) {
      confetti({ particleCount: 35, spread: 60, origin: { y: 0.7 } });
    }
  };

  const handleToggleSubscribe = (authorName: string) => {
    const nextSub = StorageService.toggleSubscription(authorName);
    if (nextSub) {
      confetti({ particleCount: 40, spread: 70, origin: { y: 0.5 } });
    }
  };

  const handleShare = async (video: VideoItem) => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: video.title,
          text: `شاهد هذا الشرح القصير على منصة قلمي: ${video.title}`,
          url,
        });
        return;
      } catch {}
    }
    navigator.clipboard.writeText(url);
    setCopiedId(video.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const togglePlayPause = (idx: number, shortId: string) => {
    const video = videoRefs.current[idx];
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
      setPausedMap((prev) => ({ ...prev, [shortId]: false }));
    } else {
      video.pause();
      setPausedMap((prev) => ({ ...prev, [shortId]: true }));
    }
  };

  // TikTok Double-Tap to Like + Single-Tap to Play/Pause (ignoring mouse drag swipes)
  const mouseDraggedRef = useRef<boolean>(false);
  const handleVideoTap = (
    e: React.MouseEvent<HTMLVideoElement>,
    idx: number,
    shortItem: VideoItem
  ) => {
    if (mouseDraggedRef.current) {
      mouseDraggedRef.current = false;
      return;
    }
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (now - lastTapTimeRef.current < 260) {
      // Double tap -> Heart burst + Like
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      setDoubleTapHeart({ id: shortItem.id, x, y });
      setTimeout(() => setDoubleTapHeart(null), 700);
      if (!shortItem.likedByUser) {
        handleToggleLike(shortItem);
      }
    } else {
      tapTimerRef.current = setTimeout(() => {
        togglePlayPause(idx, shortItem.id);
      }, 220);
    }
    lastTapTimeRef.current = now;
  };

  // Empty state when no shorts exist
  if (shorts.length === 0) {
    return (
      <main className="min-h-[calc(100vh-140px)] flex flex-col items-center justify-center p-6 text-center font-['Cairo',sans-serif]">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-rose-500/20 to-amber-500/20 text-rose-500 flex items-center justify-center mb-4 shadow-inner">
          <Film className="w-10 h-10 stroke-[2.5]" />
        </div>
        <h2 className="text-xl font-black text-slate-900 dark:text-white mb-2">
          لا توجد فيديوهات Shorts حالياً 🎬
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mb-6 leading-relaxed">
          يمكنك تجربة فيديو Shorts التجريبي لاختبار الصوت، اللايك، والتعليقات، أو تصوير فيديو جديد من كاميرا الموبايل.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => VideoService.resetToDemoVideos()}
            className="px-5 py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs sm:text-sm shadow-md transition active:scale-95 flex items-center gap-2 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4 stroke-[3]" />
            <span>عرض الفيديو التجريبي لـ Shorts ⚡</span>
          </button>
          <button
            type="button"
            onClick={onOpenPublishVideo}
            className="px-6 py-3 rounded-2xl bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-600 hover:to-amber-600 text-white font-black text-xs sm:text-sm shadow-lg hover:shadow-xl transition active:scale-95 flex items-center gap-2 cursor-pointer"
          >
            <Camera className="w-4 h-4 stroke-[2.5]" />
            <span>+ تسجيل ونشر Shorts جديد</span>
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="relative h-[calc(100dvh-124px)] w-full flex items-center justify-center bg-black overflow-hidden select-none font-['Cairo',sans-serif]">
      {/* Top Overlay Controls (TikTok Top Bar: Sound, All Shorts Grid, Counter & Publish) */}
      <div className="absolute top-3 inset-x-3 z-30 flex items-center justify-between gap-2 pointer-events-none max-w-md mx-auto">
        <button
          type="button"
          onClick={() => setIsMuted((m) => !m)}
          className="pointer-events-auto p-2.5 rounded-full bg-black/55 text-white backdrop-blur-md hover:bg-black/80 transition shadow-md cursor-pointer"
          title={isMuted ? 'تشغيل الصوت' : 'كتم الصوت'}
        >
          {isMuted ? <VolumeX className="w-4 h-4 sm:w-5 sm:h-5" /> : <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />}
        </button>

        <div className="flex items-center gap-1.5 pointer-events-auto">
          <button
            type="button"
            onClick={() => setIsAllShortsOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 hover:bg-black/85 text-white backdrop-blur-md border border-white/15 text-[11px] sm:text-xs font-black shadow-lg transition cursor-pointer"
            title="عرض كل فيديوهات Shorts على الموقع والتنقل بينها"
          >
            <LayoutGrid className="w-3.5 h-3.5 text-amber-400" />
            <span>كل Shorts ({shorts.length})</span>
            <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 font-mono text-[10px]">
              {currentIndex + 1}/{shorts.length}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenPublishVideo}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-600 hover:to-amber-600 text-white text-[11px] sm:text-xs font-black shadow-lg transition active:scale-95 cursor-pointer"
            title="نشر فيديو Shorts جديد"
          >
            <Plus className="w-3.5 h-3.5 stroke-[3]" />
            <span>نشر</span>
          </button>
        </div>
      </div>

      {/* TikTok Vertical Snap-Scroll Reel Feed (Touch swipe, Mouse drag/wheel, Keyboard arrows) */}
      <div
        ref={feedContainerRef}
        onMouseDown={(e) => {
          mouseDragStartYRef.current = e.clientY;
          mouseDraggedRef.current = false;
        }}
        onMouseMove={(e) => {
          if (mouseDragStartYRef.current !== null && Math.abs(e.clientY - mouseDragStartYRef.current) > 10) {
            mouseDraggedRef.current = true;
          }
        }}
        onMouseUp={(e) => {
          if (mouseDragStartYRef.current === null) return;
          const dy = e.clientY - mouseDragStartYRef.current;
          mouseDragStartYRef.current = null;
          if (Math.abs(dy) > 65) {
            if (dy < 0) scrollToIndex(currentIndex + 1);
            else scrollToIndex(currentIndex - 1);
          }
        }}
        className="h-full w-full max-w-md overflow-y-auto snap-y snap-mandatory no-scrollbar"
      >
        {shorts.map((shortItem, idx) => {
          const isSubscribedToAuthor = StorageService.isSubscribed(shortItem.author || '');
          const videoSrc = resolvedUrls[shortItem.id] || shortItem.videoUrl;
          const isPaused = Boolean(pausedMap[shortItem.id]);
          const progress = progressMap[shortItem.id] || 0;

          return (
            <div
              key={shortItem.id}
              ref={(el) => {
                slideRefs.current[idx] = el;
              }}
              data-short-index={idx}
              className="relative h-full w-full snap-start snap-always shrink-0 bg-slate-950 flex items-center justify-center overflow-hidden"
            >
              <video
                ref={(el) => {
                  videoRefs.current[idx] = el;
                }}
                src={videoSrc}
                poster={shortItem.thumbnailUrl || undefined}
                loop
                playsInline
                preload="auto"
                muted={isMuted}
                onTimeUpdate={(e) => {
                  const vid = e.currentTarget;
                  if (vid.duration > 0) {
                    const pct = (vid.currentTime / vid.duration) * 100;
                    setProgressMap((prev) => ({ ...prev, [shortItem.id]: pct }));
                  }
                }}
                onClick={(e) => handleVideoTap(e, idx, shortItem)}
                className="w-full h-full object-cover cursor-pointer"
              />

              {/* Subtle bottom gradient for clean white text readability (TikTok style) */}
              <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />

              {/* TikTok Double-Tap Heart Animation */}
              {doubleTapHeart?.id === shortItem.id && (
                <div
                  className="absolute z-30 pointer-events-none -translate-x-1/2 -translate-y-1/2 animate-ping"
                  style={{ left: doubleTapHeart.x, top: doubleTapHeart.y }}
                >
                  <Heart className="w-20 h-20 text-rose-500 fill-rose-500 drop-shadow-2xl" />
                </div>
              )}

              {/* Play/Pause Center Overlay Indicator */}
              {isPaused && (
                <div
                  onClick={() => togglePlayPause(idx, shortItem.id)}
                  className="absolute inset-0 flex items-center justify-center bg-black/30 cursor-pointer z-10"
                >
                  <div className="w-20 h-20 rounded-full bg-white/25 backdrop-blur-md flex items-center justify-center text-white shadow-2xl hover:scale-105 transition">
                    <Play className="w-10 h-10 fill-white ml-1" />
                  </div>
                </div>
              )}

              {/* Vertical Gliders on Desktop/Mobile to Flip Between All Shorts */}
              {shorts.length > 1 && (
                <div className="absolute start-3 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-2">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => scrollToIndex(idx - 1)}
                    className="p-2 rounded-full bg-black/50 text-white disabled:opacity-20 hover:bg-black/85 backdrop-blur-md transition shadow-md cursor-pointer"
                    title="الفيديو السابق (أعلى)"
                  >
                    <ChevronUp className="w-5 h-5" />
                  </button>
                  <span className="text-[10px] font-mono font-black px-1.5 py-0.5 rounded-full bg-black/55 text-amber-300 border border-white/10">
                    {idx + 1}/{shorts.length}
                  </span>
                  <button
                    type="button"
                    disabled={idx >= shorts.length - 1}
                    onClick={() => scrollToIndex(idx + 1)}
                    className="p-2 rounded-full bg-black/50 text-white disabled:opacity-20 hover:bg-black/85 backdrop-blur-md transition shadow-md cursor-pointer"
                    title="الفيديو التالي (أسفل)"
                  >
                    <ChevronDown className="w-5 h-5" />
                  </button>
                </div>
              )}

              {/* TikTok Right/End Floating Interaction Column (Avatar, Likes, Comments, Share, Delete, Disc) */}
              <div className="absolute bottom-6 end-3 z-20 flex flex-col items-center gap-3.5">
                {/* Author Avatar with Subscribe (+) button */}
                <div className="relative flex flex-col items-center mb-1">
                  <button
                    type="button"
                    onClick={() => onOpenPublisherProfile(shortItem.author)}
                    className="w-11 h-11 rounded-full border-2 border-white overflow-hidden shadow-lg bg-slate-800 cursor-pointer"
                    title={`زيارة صفحة ${shortItem.author}`}
                  >
                    {shortItem.authorPhoto ? (
                      <img src={shortItem.authorPhoto} alt={shortItem.author} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-tr from-amber-500 to-orange-600 text-slate-950 font-black flex items-center justify-center text-sm">
                        {(shortItem.author || 'ط')[0]}
                      </div>
                    )}
                  </button>

                  {!isSubscribedToAuthor && (
                    <button
                      type="button"
                      onClick={() => handleToggleSubscribe(shortItem.author)}
                      className="absolute -bottom-2 w-5 h-5 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center text-xs font-black shadow-md cursor-pointer transition active:scale-90"
                      title="اشتراك في قناة الناشر"
                    >
                      <Plus className="w-3.5 h-3.5 stroke-[3]" />
                    </button>
                  )}
                </div>

                {/* Like Button */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => handleToggleLike(shortItem)}
                    className={`p-2.5 rounded-full backdrop-blur-md transition shadow-lg active:scale-80 cursor-pointer ${
                      shortItem.likedByUser
                        ? 'bg-rose-600 text-white'
                        : 'bg-black/45 text-white hover:bg-black/75'
                    }`}
                    title="إعجاب (أو اضغط مرتين على الفيديو)"
                  >
                    <Heart className={`w-6 h-6 ${shortItem.likedByUser ? 'fill-white' : ''}`} />
                  </button>
                  <span className="text-white text-xs font-black mt-0.5 drop-shadow-md">
                    {shortItem.likesCount || 0}
                  </span>
                </div>

                {/* Comments Button */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => setCommentsTarget(shortItem)}
                    className="p-2.5 rounded-full bg-black/45 text-white hover:bg-black/75 backdrop-blur-md transition shadow-lg active:scale-90 cursor-pointer"
                    title="استفسارات وأسئلة الطلاب"
                  >
                    <MessageCircle className="w-6 h-6" />
                  </button>
                  <span className="text-white text-[11px] font-bold mt-0.5 drop-shadow-md">
                    {shortItem.commentsCount || 'استفسار'}
                  </span>
                </div>

                {/* Share Button */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => handleShare(shortItem)}
                    className="p-2.5 rounded-full bg-black/45 text-white hover:bg-black/75 backdrop-blur-md transition shadow-lg active:scale-90 cursor-pointer"
                    title="مشاركة الفيديو"
                  >
                    <Share2 className="w-6 h-6" />
                  </button>
                  <span className="text-white text-[11px] font-bold mt-0.5 drop-shadow-md">
                    {copiedId === shortItem.id ? 'تم!' : 'مشاركة'}
                  </span>
                </div>

                {/* Delete Short Video Button */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => {
                      if (confirmDeleteId === shortItem.id) {
                        VideoService.deleteVideo(shortItem.id);
                        setConfirmDeleteId(null);
                      } else {
                        setConfirmDeleteId(shortItem.id);
                        setTimeout(() => setConfirmDeleteId(null), 3000);
                      }
                    }}
                    className={`p-2 rounded-full backdrop-blur-md transition shadow-lg active:scale-90 cursor-pointer ${
                      confirmDeleteId === shortItem.id
                        ? 'bg-rose-600 text-white animate-pulse ring-2 ring-rose-400'
                        : 'bg-black/45 text-slate-300 hover:text-rose-500 hover:bg-black/75'
                    }`}
                    title={confirmDeleteId === shortItem.id ? 'اضغط مرة أخرى لتأكيد المسح' : 'مسح هذا الفيديو'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  {confirmDeleteId === shortItem.id && (
                    <span className="text-[10px] font-black mt-0.5 text-rose-400 drop-shadow-md">
                      تأكيد؟
                    </span>
                  )}
                </div>

                {/* Iconic Spinning TikTok Audio/Lesson Disc */}
                <div
                  className={`w-10 h-10 rounded-full bg-gradient-to-tr from-slate-900 via-slate-700 to-slate-900 border-4 border-slate-800 shadow-lg flex items-center justify-center text-amber-400 ${
                    !isPaused && idx === currentIndex ? 'animate-spin' : ''
                  }`}
                  style={{ animationDuration: '4s' }}
                  title="شورت تعليمي - منصة قلمي"
                >
                  <Music2 className="w-4 h-4" />
                </div>
              </div>

              {/* Bottom Overlay: Author, Title, Description, Audio Ticker (TikTok Style) */}
              <div className="absolute bottom-5 start-4 end-16 z-20 text-white pointer-events-auto space-y-1.5 drop-shadow-lg text-start">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onOpenPublisherProfile(shortItem.author)}
                    className="font-black text-sm sm:text-base text-white hover:text-amber-300 transition flex items-center gap-1 cursor-pointer"
                  >
                    <span>@{shortItem.author}</span>
                  </button>

                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-md text-white font-bold">
                    {shortItem.grade || 'الصف الخامس الابتدائي'}
                  </span>

                  {shortItem.id.startsWith('demo_') && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 font-black shadow-xs">
                      تجريبي 🎬
                    </span>
                  )}
                </div>

                <h3 className="font-extrabold text-sm sm:text-base leading-snug line-clamp-2">
                  {shortItem.title}
                </h3>

                {shortItem.description && (
                  <p className="text-xs text-slate-200 line-clamp-2 leading-relaxed opacity-90">
                    {shortItem.description}
                  </p>
                )}

                <div className="flex items-center gap-2 text-[11px] text-amber-300 font-bold pt-0.5">
                  <Music2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    شورت تعليمي ({shortItem.durationSeconds} ث)
                    {shorts.length > 1 ? ` • اسحب لأعلى للتالي (${idx + 1}/${shorts.length})` : ''}
                  </span>
                </div>
              </div>

              {/* TikTok Bottom Live Playback Progress Bar */}
              <div className="absolute bottom-0 inset-x-0 h-1 bg-white/20 z-30 pointer-events-none">
                <div
                  className="h-full bg-gradient-to-r from-rose-500 via-amber-400 to-rose-500 transition-[width] duration-150"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* All Shorts Gallery Drawer (عرض كل فيديوهات Shorts على الموقع والانتقال لأي فيديو فوراً) */}
      {isAllShortsOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
          onClick={() => setIsAllShortsOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[82vh] bg-slate-900 text-white rounded-t-3xl sm:rounded-3xl border border-slate-700 shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Film className="w-5 h-5 text-rose-500" />
                <h2 className="text-sm sm:text-base font-black">
                  جميع فيديوهات Shorts على الموقع ({shorts.length})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsAllShortsOpen(false)}
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 sm:p-4 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-3">
              {shorts.map((item, idx) => {
                const isCurrent = idx === currentIndex;
                const thumbSrc = item.thumbnailUrl;
                const vidSrc = resolvedUrls[item.id] || item.videoUrl;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setIsAllShortsOpen(false);
                      setTimeout(() => scrollToIndex(idx), 60);
                    }}
                    className={`group relative aspect-[9/14] rounded-2xl overflow-hidden bg-slate-950 border-2 text-start transition cursor-pointer ${
                      isCurrent
                        ? 'border-amber-500 ring-2 ring-amber-400/50 shadow-xl'
                        : 'border-slate-800 hover:border-rose-500/80'
                    }`}
                  >
                    {thumbSrc ? (
                      <img
                        src={thumbSrc}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <video
                        src={vidSrc}
                        muted
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-cover"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                    <span className="absolute top-2 start-2 px-2 py-0.5 rounded-full bg-black/75 text-white font-mono text-[10px] font-black">
                      #{idx + 1}
                    </span>
                    {isCurrent && (
                      <span className="absolute top-2 end-2 px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black">
                        يعرض الآن
                      </span>
                    )}
                    <div className="absolute bottom-2 inset-x-2 space-y-0.5">
                      <p className="text-xs font-black text-white line-clamp-2 leading-snug">
                        {item.title}
                      </p>
                      <p className="text-[10px] text-amber-300 font-bold truncate">
                        @{item.author} • {item.durationSeconds}ث
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Interactive Comments & Inquiries Modal */}
      {commentsTarget && (
        <InteractiveCommentsSection
          targetId={commentsTarget.id}
          targetType="video"
          targetTitle={commentsTarget.title}
          isModal
          onClose={() => setCommentsTarget(null)}
        />
      )}
    </main>
  );
};
