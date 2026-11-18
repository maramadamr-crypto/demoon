import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { StudyDocument, ToolMode, AnnotationItem, SUBJECTS } from '../../types';
import { InteractiveCanvas } from './InteractiveCanvas';
import { PdfPageCanvas } from './PdfPageCanvas';
import { MovablePenToolbar } from './MovablePenToolbar';
import { StorageService } from '../../services/storage';
import { StudyProgressService } from '../../services/studyProgressService';
import { createBlankPage, warmPdfPages } from '../../services/fileProcessor';
import { 
  ArrowRight, 
  ChevronRight, 
  ChevronLeft, 
  Download, 
  FileText, 
  Image as ImageIcon, 
  Plus, 
  X, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  Star, 
  Printer, 
  LayoutGrid, 
  Bookmark,
  Share2,
  Sun,
  Moon,
  Trash2,
  BrainCircuit,
  Bell,
  BookOpen,
  Settings,
  ChevronUp,
  ChevronDown,
  StickyNote,
  MessageCircle,
  Search
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { AiTutorSidebar } from './AiTutorSidebar';
import { QuickNotesSidebar } from './QuickNotesSidebar';
import { DocumentSettingsModal } from './DocumentSettingsModal';
import { InteractiveCommentsSection } from '../comments/InteractiveCommentsSection';
import { getDocTypeInfo } from '../../types';

interface DocumentViewerProps {
  initialDocument: StudyDocument;
  openDocuments: StudyDocument[];
  activeDocId: string;
  onSelectDocument: (docId: string) => void;
  onCloseDocument: (docId: string) => void;
  onBackToLibrary: () => void;
  onOpenPublishModal: () => void;
  onDeleteDocument: (docId: string) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenReminderForDoc?: (doc: StudyDocument) => void;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  initialDocument,
  openDocuments,
  activeDocId,
  onSelectDocument,
  onCloseDocument,
  onBackToLibrary,
  onOpenPublishModal,
  onDeleteDocument,
  darkMode,
  onToggleDarkMode,
  onOpenReminderForDoc,
}) => {
  const [currentDoc, setCurrentDoc] = useState<StudyDocument>(initialDocument);
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);
  
  // Pen and Drawing Tools State (Default to hand pan on mobile so scrolling/browsing is effortless)
  const [currentTool, setCurrentTool] = useState<ToolMode>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'hand' : 'pen'
  );
  const [currentColor, setCurrentColor] = useState<string>('#dc2626'); // Red by default like teacher correction
  const [strokeWidth, setStrokeWidth] = useState<number>(3);
  const [fontSize, setFontSize] = useState<number>(18);
  const [isBold, setIsBold] = useState<boolean>(true);
  const [zoom, setZoom] = useState<number>(1.0);
  // Thumbnails sidebar is open on desktop/tablet, collapsed by default on mobile so memo pages are never squeezed
  const [showThumbnails, setShowThumbnails] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  const [thumbnailSearch, setThumbnailSearch] = useState<string>('');
  const [thumbnailFilterBookmarks, setThumbnailFilterBookmarks] = useState<boolean>(false);
  const readingSurfaceRef = useRef<HTMLDivElement>(null);

  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isAutoSaved, setIsAutoSaved] = useState<boolean>(true);
  const [showExportMenu, setShowExportMenu] = useState<boolean>(false);

  // Undo / Redo stacks per page
  const [undoStack, setUndoStack] = useState<AnnotationItem[][]>([]);
  const [redoStack, setRedoStack] = useState<AnnotationItem[][]>([]);

  const [isCommentsOpen, setIsCommentsOpen] = useState<boolean>(false);

  // Quick Page Jump State for 100-300 page books
  const [jumpPageInput, setJumpPageInput] = useState<string>('');
  const [isJumpOpen, setIsJumpOpen] = useState<boolean>(false);

  const handleJumpToPage = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseInt(jumpPageInput.trim(), 10);
    if (!isNaN(num) && num >= 1 && num <= safePages.length) {
      setCurrentPageIndex(num - 1);
      setIsJumpOpen(false);
      setJumpPageInput('');
    }
  };

  // Auto-scroll the thumbnail sidebar to keep the active page thumbnail visible
  useEffect(() => {
    if (showThumbnails) {
      const el = document.getElementById(`viewer-thumb-${currentPageIndex}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [currentPageIndex, showThumbnails]);

  // Scroll reading surface back to top when page changes
  useEffect(() => {
    readingSurfaceRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentPageIndex]);

  // AI Tutor State (المعلم الذكي بجانب المذكرة - يفتح تلقائياً على الشاشات العريضة فقط حتى لا يضغط مساحة العرض)
  const [showAiTutor, setShowAiTutor] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1280 : true
  );

  // Quick Notes Sidebar State (الملاحظات النصية السريعة لكل مذكرة ومحفوظة في Firebase)
  const [showQuickNotes, setShowQuickNotes] = useState<boolean>(false);

  // Settings Modal State (زر الإعدادات الموحد لجميع أدوات وخيارات المذكرة)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  // Sepia Mode State (وضع القراءة المريح لتقليل إجهاد العين)
  const [isSepiaMode, setIsSepiaMode] = useState<boolean>(() => {
    return localStorage.getItem('qalami_sepia_mode') === 'true';
  });

  const toggleSepiaMode = () => {
    setIsSepiaMode((prev) => {
      const next = !prev;
      localStorage.setItem('qalami_sepia_mode', String(next));
      return next;
    });
  };

  // Automatically track study time for this document's subject while reading
  useEffect(() => {
    if (!currentDoc?.subject) return;
    // Log 1 minute of study time every 60 seconds of viewing
    const interval = setInterval(() => {
      StudyProgressService.logStudyTime(currentDoc.subject, 1);
    }, 60000);
    return () => clearInterval(interval);
  }, [currentDoc?.subject]);

  // Sync when initialDocument switches or updates externally
  useEffect(() => {
    setCurrentDoc(initialDocument);
    setCurrentPageIndex(0);
    setUndoStack([]);
    setRedoStack([]);
    setShowThumbnails(typeof window !== 'undefined' ? window.innerWidth >= 768 : true);
    setThumbnailSearch('');
    setThumbnailFilterBookmarks(false);
    setExportError(null);
  }, [initialDocument.id]);

  // Clamp page index if pages length changes
  useEffect(() => {
    const pagesLen = currentDoc.pages?.length || 0;
    if (pagesLen > 0 && currentPageIndex >= pagesLen) {
      setCurrentPageIndex(pagesLen - 1);
    }
  }, [currentDoc.pages?.length, currentPageIndex]);

  // Silent zero-UI preloading & canvas warming for nearby pages so scrolling never waits
  useEffect(() => {
    if (!currentDoc?.pages) return;
    const pdfFileId = currentDoc.pdfFileId;

    const warmNumbers: number[] = [];
    for (let offset = -2; offset <= 15; offset++) {
      const idx = currentPageIndex + offset;
      if (idx >= 0 && idx < currentDoc.pages.length) {
        const page = currentDoc.pages[idx];
        if (page?.imageUrl) {
          const img = new Image();
          img.decoding = 'sync';
          img.src = page.imageUrl;
        } else if (pdfFileId && page) {
          warmNumbers.push(page.pageNumber);
        }
      }
    }

    if (pdfFileId && warmNumbers.length > 0) {
      warmPdfPages(pdfFileId, warmNumbers, 1.15);
    }
  }, [currentPageIndex, currentDoc.id, currentDoc.pdfFileId, currentDoc.pages]);

  const fallbackPages = useMemo(() => [createBlankPage(1, 'lined')], [currentDoc.id]);
  const safePages = currentDoc.pages && currentDoc.pages.length > 0
    ? currentDoc.pages
    : fallbackPages;
  const activePage = safePages[currentPageIndex] || safePages[0];
  const subjectInfo = SUBJECTS.find((s) => s.id === currentDoc.subject) || SUBJECTS[0];
  const docTypeInfo = getDocTypeInfo(currentDoc.docType);

  // Auto-Save handler
  const handleSaveAnnotations = useCallback(
    (newAnnotations: AnnotationItem[]) => {
      setIsAutoSaved(false);
      
      const updatedPages = [...safePages];
      if (updatedPages[currentPageIndex]) {
        updatedPages[currentPageIndex] = {
          ...updatedPages[currentPageIndex],
          annotations: newAnnotations,
          lastEdited: Date.now(),
        };
      }

      const updatedDoc: StudyDocument = {
        ...currentDoc,
        pages: updatedPages,
        updatedAt: new Date().toISOString(),
      };

      setCurrentDoc(updatedDoc);
      StorageService.saveDocument(updatedDoc);

      // Flash auto-saved status after short debounce
      setTimeout(() => {
        setIsAutoSaved(true);
      }, 400);
    },
    [currentDoc, safePages, currentPageIndex]
  );

  const handleClearPage = () => {
    setUndoStack((prev) => [...prev, activePage.annotations || []]);
    setRedoStack([]);
    handleSaveAnnotations([]);
  };

  const handleAddBlankPage = () => {
    const newPage = createBlankPage(safePages.length + 1, 'lined');
    const updatedDoc = {
      ...currentDoc,
      pages: [...safePages, newPage],
    };
    setCurrentDoc(updatedDoc);
    StorageService.saveDocument(updatedDoc);
    setCurrentPageIndex(safePages.length);
  };

  const handleExportPdf = async () => {
    try {
      setIsExporting(true);
      setExportError(null);
      await StorageService.exportAnnotatedPdf({ ...currentDoc, pages: safePages });
      confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 } });
    } catch (e) {
      console.error(e);
      setExportError('حدث خطأ أثناء تصدير ملف PDF، يرجى المحاولة مرة أخرى.');
      setTimeout(() => setExportError(null), 5000);
    } finally {
      setIsExporting(false);
      setShowExportMenu(false);
    }
  };

  const handleExportCurrentPage = async () => {
    try {
      setIsExporting(true);
      setExportError(null);
      await StorageService.exportPageAsImage(activePage, currentDoc.title);
    } catch (e) {
      console.error(e);
      setExportError('تعذر تصدير الصورة، يرجى المحاولة مرة أخرى.');
      setTimeout(() => setExportError(null), 5000);
    } finally {
      setIsExporting(false);
      setShowExportMenu(false);
    }
  };

  const toggleBookmark = () => {
    if (!activePage) return;
    const currentBookmarks = currentDoc.bookmarks || [];
    const isBookmarked = currentBookmarks.includes(activePage.pageNumber);
    const updated = isBookmarked
      ? currentBookmarks.filter((p) => p !== activePage.pageNumber)
      : [...currentBookmarks, activePage.pageNumber];

    const updatedDoc = { ...currentDoc, bookmarks: updated };
    setCurrentDoc(updatedDoc);
    StorageService.saveDocument(updatedDoc);
  };

  const displayedThumbnails = safePages.filter((p) => {
    if (thumbnailFilterBookmarks) {
      if (!currentDoc.bookmarks?.includes(p.pageNumber)) return false;
    }
    if (thumbnailSearch.trim()) {
      const q = thumbnailSearch.trim();
      const num = parseInt(q, 10);
      if (!isNaN(num)) {
        return p.pageNumber === num;
      }
    }
    return true;
  });

  return (
    <div className="flex flex-col h-screen bg-slate-100 dark:bg-slate-950 overflow-hidden font-['Cairo',sans-serif] relative">
      {exportError && (
        <div className="no-print fixed top-16 start-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl bg-rose-600 text-white text-xs font-black shadow-2xl flex items-center gap-2">
          <span>{exportError}</span>
          <button
            type="button"
            onClick={() => setExportError(null)}
            className="p-0.5 rounded-full hover:bg-white/20 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {/* 1. Google Chrome-Style Document Tabs Bar (مخفي في الطباعة) */}
      <nav aria-label="تبويبات المذكرات المفتوحة" className="no-print print:hidden bg-slate-200 dark:bg-slate-900 border-b border-slate-300 dark:border-slate-800 pt-1 px-1.5 sm:pt-1.5 sm:px-2 flex items-center gap-1 overflow-x-auto select-none no-scrollbar">
        {/* Back to Library Button */}
        <button
          type="button"
          onClick={onBackToLibrary}
          className="flex items-center gap-1 px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-800 transition shrink-0"
          title="الرجوع إلى المكتبة الرئيسية"
        >
          <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span>المكتبة</span>
        </button>

        <div className="h-3.5 sm:h-4 w-px bg-slate-300 dark:bg-slate-700 mx-0.5 sm:mx-1 shrink-0" />

        {/* Browser Tabs List */}
        {openDocuments.map((doc) => {
          const isActive = doc.id === currentDoc.id;
          const sInfo = SUBJECTS.find((s) => s.id === doc.subject);
          return (
            <div
              key={doc.id}
              onClick={() => {
                if (!isActive) onSelectDocument(doc.id);
              }}
              className={`group relative flex items-center gap-1.5 sm:gap-2 max-w-[160px] sm:max-w-[220px] min-w-[100px] sm:min-w-[140px] px-2 py-1 sm:px-3 sm:py-2 rounded-t-xl text-[11px] sm:text-xs font-bold cursor-pointer transition-all border-t border-x ${
                isActive
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white border-slate-300 dark:border-slate-800 shadow-sm z-10'
                  : 'bg-slate-200/80 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 border-transparent hover:bg-slate-300/80 dark:hover:bg-slate-800'
              }`}
            >
              <span
                className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: sInfo?.bgLight ? undefined : '#0284c7' }}
              />
              <span className="truncate flex-1 text-right">{doc.title}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseDocument(doc.id);
                }}
                className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition"
                title="إغلاق هذا المستند"
              >
                <X className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              </button>
            </div>
          );
        })}

        {/* Add New / Publish Document Tab Button */}
        <button
          type="button"
          onClick={onOpenPublishModal}
          className="p-1 sm:p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-300/70 dark:hover:bg-slate-800 transition shrink-0"
          title="نشر أو فتح مستند جديد (+)"
        >
          <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>
      </nav>

      {/* 2. Secondary Navigation & Actions Bar (مخفي في الطباعة) */}
      <header role="banner" className="no-print print:hidden bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-2 py-1.5 sm:px-4 sm:py-2 flex flex-wrap items-center justify-between gap-1.5 sm:gap-3 shadow-xs">
        {/* Document Metadata & Bookmark */}
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
          <span className={`hidden sm:inline-flex text-xs px-2.5 py-1 rounded-full font-bold border ${subjectInfo.badgeColor}`}>
            {subjectInfo.nameAr}
          </span>
          {docTypeInfo && (
            <span className={`hidden md:inline-flex text-[11px] px-2.5 py-0.5 rounded-full font-black border ${docTypeInfo.badgeBg} ${docTypeInfo.badgeText} ${docTypeInfo.badgeBorder}`}>
              {docTypeInfo.label}
            </span>
          )}
          <h1 className="hidden sm:block text-sm md:text-base font-extrabold text-slate-900 dark:text-white truncate max-w-[160px] md:max-w-md">
            {currentDoc.title}
          </h1>
          <button
            type="button"
            onClick={toggleBookmark}
            className={`hidden sm:inline-flex p-1 rounded-lg transition ${
              currentDoc.bookmarks?.includes(activePage.pageNumber)
                ? 'text-amber-500 hover:text-amber-600'
                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
            }`}
            title="حفظ إشارة مرجعية لهذه الصفحة"
          >
            <Bookmark className="w-4 h-4 fill-current" />
          </button>

          {/* Toggle Thumbnails Sidebar Button */}
          <button
            type="button"
            onClick={() => setShowThumbnails((prev) => !prev)}
            className={`flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-xl text-[11px] sm:text-xs font-bold transition cursor-pointer ${
              showThumbnails
                ? 'bg-amber-500 text-slate-950 font-black shadow-xs ring-2 ring-amber-400/50'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
            }`}
            title={showThumbnails ? 'إخفاء شريط الصفحات المصغرة' : 'إظهار شريط الصفحات المصغرة (Thumbnails)'}
          >
            <LayoutGrid className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
            <span className="hidden sm:inline">الصفحات المصغرة</span>
            <span className="text-[10px] px-1 py-0.2 rounded-full bg-black/10 dark:bg-white/10 font-mono font-bold">
              {safePages.length}
            </span>
          </button>
        </div>

        {/* Page Switcher with Up/Down Gliders (تقلع وتنزل بسلاسة) */}
        <div className="flex items-center gap-1 sm:gap-1.5 bg-slate-100 dark:bg-slate-800 p-0.5 sm:p-1 rounded-xl shadow-inner border border-slate-200 dark:border-slate-700/80">
          {/* Glide Up Button (تقلع لأعلى) */}
          <button
            type="button"
            onClick={() => setCurrentPageIndex((prev) => Math.max(0, prev - 1))}
            disabled={currentPageIndex === 0}
            className="flex items-center gap-1 px-1.5 py-1 sm:px-2.5 sm:py-1.5 rounded-lg bg-white dark:bg-slate-700 hover:bg-amber-500 hover:text-slate-950 disabled:opacity-30 disabled:hover:bg-white text-slate-700 dark:text-slate-200 font-black text-xs transition cursor-pointer shadow-2xs"
            title="الصعود لأعلى / الصفحة السابقة (تقلع لأعلى)"
          >
            <ChevronUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
            <span className="hidden sm:inline">أعلى 🔼</span>
          </button>

          {/* Current Page Indicator with Quick Jump */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsJumpOpen((prev) => !prev)}
              className="flex items-center gap-1 px-1.5 py-0.5 sm:px-2.5 sm:py-1 text-[11px] sm:text-xs font-black text-slate-800 dark:text-slate-200 hover:bg-slate-200/80 dark:hover:bg-slate-700/80 rounded-lg transition cursor-pointer"
              title="انقر للانتقال المباشر لأي صفحة في الكتاب"
            >
              <span className="hidden sm:inline">صفحة</span>
              <span className="text-amber-600 dark:text-amber-400 font-extrabold text-xs sm:text-sm">{currentPageIndex + 1}</span>
              <span>/</span>
              <span>{safePages.length}</span>
            </button>

            {isJumpOpen && (
              <form
                onSubmit={handleJumpToPage}
                className="absolute top-full mt-2 start-1/2 -translate-x-1/2 z-50 bg-white dark:bg-slate-800 p-2.5 rounded-2xl shadow-2xl border-2 border-amber-500 flex items-center gap-2 min-w-[210px] animate-in fade-in"
              >
                <input
                  type="number"
                  min={1}
                  max={safePages.length}
                  value={jumpPageInput}
                  onChange={(e) => setJumpPageInput(e.target.value)}
                  placeholder={`1 - ${safePages.length}`}
                  autoFocus
                  className="w-20 px-2.5 py-1 text-xs rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 font-bold text-center focus:ring-2 focus:ring-amber-500 focus:outline-none text-slate-900 dark:text-white"
                />
                <button
                  type="submit"
                  className="px-3 py-1 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs transition cursor-pointer"
                >
                  انتقال ⚡
                </button>
              </form>
            )}
          </div>

          {/* Glide Down Button (تنزل لأسفل) */}
          <button
            type="button"
            onClick={() => setCurrentPageIndex((prev) => Math.min(safePages.length - 1, prev + 1))}
            disabled={currentPageIndex >= safePages.length - 1}
            className="flex items-center gap-1 px-1.5 py-1 sm:px-2.5 sm:py-1.5 rounded-lg bg-white dark:bg-slate-700 hover:bg-amber-500 hover:text-slate-950 disabled:opacity-30 disabled:hover:bg-white text-slate-700 dark:text-slate-200 font-black text-xs transition cursor-pointer shadow-2xs"
            title="النزول لأسفل / الصفحة التالية (تنزل لأسفل)"
          >
            <span className="hidden sm:inline">أسفل 🔽</span>
            <ChevronDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
          </button>
        </div>

        {/* Action Buttons: Compact on Mobile, Expanded on Desktop */}
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Quick Unified Zoom Controls (يكبر ويصغر جميع صفحات المذكرة معاً) */}
          <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700/80">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))}
              className="p-1 sm:p-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition cursor-pointer"
              title="تصغير كل صفحات المذكرة"
            >
              <ZoomOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1.0)}
              className="px-1 sm:px-1.5 text-[10px] sm:text-xs font-mono font-black text-slate-800 dark:text-slate-200 hover:text-amber-600 transition cursor-pointer"
              title="إعادة الحجم الطبيعي 100%"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(2.2, +(z + 0.15).toFixed(2)))}
              className="p-1 sm:p-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition cursor-pointer"
              title="تكبير كل صفحات المذكرة"
            >
              <ZoomIn className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          </div>
          {/* Direct Academic PDF Download Button (hidden label on narrow mobile, available in Settings too) */}
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={isExporting}
            className="hidden sm:flex items-center gap-1.5 px-3 sm:px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-xl text-xs sm:text-sm font-black shadow-md hover:shadow-lg transition cursor-pointer disabled:opacity-50"
            title="تنزيل المذكرة كاملة كملف PDF منظم بتنسيق الطباعة الأكاديمية الرسمية"
          >
            <Download className={`w-4 h-4 stroke-[2.5] ${isExporting ? 'animate-bounce' : ''}`} />
            <span>{isExporting ? 'جاري إنشاء PDF...' : 'تنزيل PDF 📥'}</span>
          </button>

          {/* AI Tutor Toggle Button on Mobile & Tablet */}
          <button
            type="button"
            onClick={() => setShowAiTutor((prev) => !prev)}
            className={`flex items-center gap-1 px-2 py-1 sm:px-3 sm:py-2 rounded-xl text-[11px] sm:text-sm font-black transition cursor-pointer shadow-xs ${
              showAiTutor
                ? 'bg-indigo-600 text-white ring-2 ring-indigo-400'
                : 'bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 border border-slate-200 dark:border-slate-700'
            }`}
            title="المعلم الذكي AI"
          >
            <BrainCircuit className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
            <span className="hidden md:inline">المعلم الذكي</span>
          </button>

          {/* Quick Notes Toggle Button */}
          <button
            type="button"
            onClick={() => setShowQuickNotes((prev) => !prev)}
            className={`hidden sm:flex items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black transition cursor-pointer shadow-md ${
              showQuickNotes
                ? 'bg-amber-500 text-slate-950 ring-2 ring-amber-400'
                : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-amber-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
            }`}
            title="الملاحظات النصية السريعة للمذكرة (محفوظة في Firebase)"
          >
            <StickyNote className="w-4 h-4 stroke-[2.5]" />
            <span className="hidden sm:inline">الملاحظات السريعة 📝</span>
          </button>

          {/* Student Inquiries & Comments Button */}
          <button
            type="button"
            onClick={() => setIsCommentsOpen(true)}
            className="hidden sm:flex items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black transition cursor-pointer shadow-md bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-amber-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700"
            title="استفسارات وأسئلة الطلاب حول هذه المذكرة (محفوظة في Firebase)"
          >
            <MessageCircle className="w-4 h-4 stroke-[2.5] text-amber-500" />
            <span className="hidden sm:inline">استفسارات 💬</span>
          </button>

          {/* Master Settings Button */}
          <button
            type="button"
            onClick={() => setIsSettingsModalOpen(true)}
            className="flex items-center gap-1 sm:gap-2 px-2 py-1 sm:px-4 sm:py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 active:scale-95 text-slate-950 rounded-xl text-[11px] sm:text-sm font-black shadow-sm sm:shadow-md hover:shadow-lg transition cursor-pointer"
            title="إعدادات وخيارات المذكرة (الشرح، العرض، الطباعة، التحميل، والمعلم الذكي)"
          >
            <Settings className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
            <span className="hidden sm:inline">الإعدادات ⚙️</span>
          </button>
        </div>
      </header>

      {/* 3. Main Workspace Area: Sidebar (Thumbnails) + Canvas (Semantic Main) */}
      <main role="main" className="flex-1 flex overflow-hidden relative">
        {/* Thumbnails Sidebar (Overlay drawer on mobile, static sidebar on desktop) */}
        {showThumbnails && (
          <>
            <div
              onClick={() => setShowThumbnails(false)}
              className="md:hidden fixed inset-0 bg-black/50 backdrop-blur-2xs z-40"
            />
            <aside aria-label="شريط الصفحات المصغرة" className="fixed inset-y-0 start-0 z-50 md:static w-64 sm:w-72 bg-white dark:bg-slate-900 border-e border-slate-200 dark:border-slate-800 flex flex-col shadow-2xl md:shadow-xl shrink-0 select-none animate-in slide-in-from-right-3 duration-200">
            {/* Header */}
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 bg-slate-50 dark:bg-slate-900/90">
              <div className="flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-amber-500 stroke-[2.5]" />
                <span className="text-xs font-black text-slate-900 dark:text-white">
                  معاينة الصفحات ({safePages.length})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowThumbnails(false)}
                className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition text-xs cursor-pointer"
                title="إخفاء الشريط الجانبي"
              >
                ✕
              </button>
            </div>

            {/* Quick Search & Bookmark Filter inside Thumbnail Sidebar */}
            <div className="p-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 bg-white dark:bg-slate-900">
              <div className="flex-1 flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-xl text-xs">
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="ابحث برقم الصفحة..."
                  value={thumbnailSearch}
                  onChange={(e) => setThumbnailSearch(e.target.value)}
                  className="w-full bg-transparent text-slate-900 dark:text-white text-xs focus:outline-none font-bold"
                />
                {thumbnailSearch && (
                  <button type="button" onClick={() => setThumbnailSearch('')} className="text-slate-400 text-xs cursor-pointer">✕</button>
                )}
              </div>

              {/* Bookmark Filter Toggle */}
              <button
                type="button"
                onClick={() => setThumbnailFilterBookmarks((prev) => !prev)}
                className={`p-1.5 rounded-xl border transition cursor-pointer ${
                  thumbnailFilterBookmarks
                    ? 'bg-amber-500 text-slate-950 border-amber-500'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                }`}
                title="عرض الصفحات المميزة بعلامة مرجعية فقط"
              >
                <Bookmark className="w-3.5 h-3.5 fill-current" />
              </button>
            </div>

            {/* Thumbnails Grid List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {displayedThumbnails.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-400 font-bold">
                  لا توجد صفحات مطابقة للبحث
                </div>
              ) : (
                displayedThumbnails.map((p) => {
                  const actualIndex = safePages.findIndex((item) => item.id === p.id);
                  const isActive = currentPageIndex === actualIndex;
                  const isBookmarked = currentDoc.bookmarks?.includes(p.pageNumber);
                  const annotationsCount = p.annotations?.length || 0;

                  return (
                    <div
                      key={p.id}
                      id={`viewer-thumb-${actualIndex}`}
                      onClick={() => {
                        setCurrentPageIndex(actualIndex);
                        if (typeof window !== 'undefined' && window.innerWidth < 768) {
                          setShowThumbnails(false);
                        }
                      }}
                      className={`group relative rounded-2xl border-2 overflow-hidden cursor-pointer p-1.5 transition-all ${
                        isActive
                          ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-950/20 shadow-lg ring-3 ring-amber-400/40 scale-[1.02]'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 hover:border-amber-300 dark:hover:border-slate-700 hover:shadow-md'
                      }`}
                    >
                      {/* Thumbnail Image Container */}
                      <div className="relative aspect-[3/4] w-full rounded-xl overflow-hidden bg-white dark:bg-slate-950 flex items-center justify-center border border-slate-200 dark:border-slate-800">
                        {p.imageUrl ? (
                          <img
                            src={p.imageUrl}
                            alt={`صفحة ${p.pageNumber}`}
                            className="w-full h-full object-contain"
                            loading="eager"
                            decoding="sync"
                          />
                        ) : currentDoc.pdfFileId ? (
                          <PdfPageCanvas
                            pdfFileId={currentDoc.pdfFileId}
                            pageNumber={p.pageNumber}
                            scale={0.6}
                            className="w-full h-full object-contain block pointer-events-none"
                          />
                        ) : (
                          <span className="text-xs font-black text-slate-400">صفحة {p.pageNumber}</span>
                        )}
                        {/* Active Indicator Badge */}
                        {isActive && (
                          <div className="absolute top-1.5 start-1.5 px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black shadow-md flex items-center gap-1">
                            <span>الحالية</span>
                          </div>
                        )}
                        {/* Bookmark Badge */}
                        {isBookmarked && (
                          <div className="absolute top-1.5 end-1.5 p-1 rounded-full bg-amber-500 text-slate-950 shadow-md">
                            <Bookmark className="w-3 h-3 fill-current" />
                          </div>
                        )}
                      </div>

                      {/* Meta Footer */}
                      <div className="flex items-center justify-between mt-1.5 px-1 text-[11px] font-extrabold text-slate-700 dark:text-slate-300">
                        <span className={isActive ? 'text-amber-600 dark:text-amber-400 font-black' : ''}>
                          صفحة {p.pageNumber}
                        </span>
                        {annotationsCount > 0 && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 font-bold">
                            {annotationsCount} ملاحظة ✍️
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Sidebar Bottom Action */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/90 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleAddBlankPage}
                className="w-full py-2 px-3 rounded-xl bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-slate-200 dark:border-slate-700 font-bold text-xs transition flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span>إضافة صفحة كشكول للمذكرة</span>
              </button>
            </div>
            </aside>
          </>
        )}

        {/* Floating Open Sidebar Button when collapsed (Desktop only - mobile uses header button) */}
        {!showThumbnails && (
          <button
            type="button"
            onClick={() => setShowThumbnails(true)}
            className="hidden md:flex absolute top-4 start-4 z-30 items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-2xl border-2 border-amber-500 text-slate-950 dark:text-white text-xs font-black hover:bg-amber-500 hover:text-slate-950 transition cursor-pointer select-none"
            title="إظهار شريط الصفحات المصغرة (Thumbnails)"
          >
            <LayoutGrid className="w-4 h-4 text-amber-500" />
            <span>عرض الصفحات ({safePages.length})</span>
          </button>
        )}

        {/* Interactive Drawing & Reading Surface (يدعم وضع القراءة المريح Sepia + تكبير وتصغير موحد لجميع الصفحات) */}
        <div 
          ref={readingSurfaceRef}
          style={{ '--memo-zoom': zoom } as React.CSSProperties}
          className={`flex-1 overflow-auto p-1 sm:p-3 relative transition-colors duration-300 ${
            isSepiaMode 
              ? 'bg-[#f4ebd0] dark:bg-[#231b14]' 
              : 'bg-slate-200/80 dark:bg-slate-950/90'
          }`}
        >
          <div className="min-w-full w-max flex flex-col items-center mx-auto">
            {/* Previous Page Quick Pill */}
            {currentPageIndex > 0 && (
              <button
                type="button"
                onClick={() => setCurrentPageIndex((prev) => Math.max(0, prev - 1))}
                className="mb-1.5 px-3 py-1 rounded-full bg-slate-900/75 hover:bg-slate-900 text-white text-[11px] sm:text-xs font-bold flex items-center gap-1 shadow-sm active:scale-95 transition cursor-pointer"
              >
                <ChevronUp className="w-3.5 h-3.5" />
                <span>الصفحة السابقة ({currentPageIndex})</span>
              </button>
            )}

            <div 
              className={`relative transition-all duration-300 rounded-xl sm:rounded-2xl ${
                isSepiaMode 
                  ? 'shadow-2xl ring-4 ring-[#dfcfaf] dark:ring-[#453628] [filter:sepia(0.38)_brightness(0.98)_contrast(0.95)]' 
                  : ''
              }`}
            >
              {/* Corner Page Number Pill Matching Clean PDF Reader Style */}
              <span className="absolute top-3 left-3 sm:top-4 sm:left-3.5 z-20 px-2.5 py-0.5 rounded-full bg-black/75 text-white text-[11px] sm:text-xs font-black shadow-md pointer-events-none">
                {activePage.pageNumber}
              </span>

              <InteractiveCanvas
                page={activePage}
                pdfFileId={currentDoc.pdfFileId}
                currentTool={currentTool}
                currentColor={currentColor}
                strokeWidth={strokeWidth}
                fontSize={fontSize}
                isBold={isBold}
                zoom={zoom}
                onSaveAnnotations={handleSaveAnnotations}
                undoStack={undoStack}
                redoStack={redoStack}
                setUndoStack={setUndoStack}
                setRedoStack={setRedoStack}
                onNextPage={() => setCurrentPageIndex((prev) => Math.min(safePages.length - 1, prev + 1))}
                onPrevPage={() => setCurrentPageIndex((prev) => Math.max(0, prev - 1))}
              />
            </div>

            {/* Continuous Feed Preview of Upcoming Pages (All pages scale identically with zoom) */}
            {safePages.length > currentPageIndex + 1 && (
              <div className="flex flex-col items-center gap-2.5 sm:gap-4 pb-16 pt-1 sm:pt-2">
                {safePages.slice(currentPageIndex + 1, currentPageIndex + 11).map((nextPage, offset) => {
                  const targetIdx = currentPageIndex + 1 + offset;
                  return (
                    <button
                      key={nextPage.id}
                      type="button"
                      onClick={() => setCurrentPageIndex(targetIdx)}
                      className="relative w-[calc(min(80vw,275px)*var(--memo-zoom,1))] sm:w-[calc(400px*var(--memo-zoom,1))] md:w-[calc(min(500px,56vh)*var(--memo-zoom,1))] lg:w-[calc(min(560px,58vh)*var(--memo-zoom,1))] xl:w-[calc(min(620px,60vh)*var(--memo-zoom,1))] max-w-none bg-white rounded-lg sm:rounded-xl shadow-lg hover:shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden active:scale-[0.99] transition-[width,box-shadow,transform] duration-150 cursor-pointer"
                      title={`الانتقال إلى صفحة ${nextPage.pageNumber}`}
                    >
                      <span className="absolute top-2 left-2 sm:top-3 sm:left-3 z-10 px-2.5 py-0.5 rounded-full bg-black/75 text-white text-[11px] sm:text-xs font-black shadow-md">
                        {nextPage.pageNumber}
                      </span>
                      {nextPage.imageUrl ? (
                        <img
                          src={nextPage.imageUrl}
                          alt={`صفحة ${nextPage.pageNumber}`}
                          loading="eager"
                          decoding="sync"
                          className="w-full h-auto block"
                        />
                      ) : currentDoc.pdfFileId ? (
                        <PdfPageCanvas
                          pdfFileId={currentDoc.pdfFileId}
                          pageNumber={nextPage.pageNumber}
                          scale={1.05}
                          className="w-full h-auto block pointer-events-none select-none"
                        />
                      ) : (
                        <div className="w-full aspect-[3/4] bg-white flex items-center justify-center text-slate-300 font-black text-base">
                          صفحة {nextPage.pageNumber}
                        </div>
                      )}
                    </button>
                  );
                })}
                {safePages.length > currentPageIndex + 11 && (
                  <button
                    type="button"
                    onClick={() => setCurrentPageIndex((prev) => Math.min(safePages.length - 1, prev + 10))}
                    className="px-4 py-1.5 rounded-full bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black shadow-md active:scale-95 transition cursor-pointer"
                  >
                    عرض الصفحات التالية ({currentPageIndex + 12} - {safePages.length}) 🔽
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* AI Tutor Assistant Panel Beside Note (وضع AI جانب المذكرة) */}
        {showAiTutor && (
          <>
            <div
              onClick={() => setShowAiTutor(false)}
              className="lg:hidden fixed inset-0 bg-black/50 backdrop-blur-2xs z-40"
            />
            <AiTutorSidebar
              isOpen={showAiTutor}
              onClose={() => setShowAiTutor(false)}
              document={currentDoc}
              currentPage={activePage}
            />
          </>
        )}

        {/* Quick Notes Sidebar Beside Note (الملاحظات السريعة في Firebase) */}
        {showQuickNotes && (
          <>
            <div
              onClick={() => setShowQuickNotes(false)}
              className="lg:hidden fixed inset-0 bg-black/50 backdrop-blur-2xs z-40"
            />
            <QuickNotesSidebar
              isOpen={showQuickNotes}
              onClose={() => setShowQuickNotes(false)}
              document={currentDoc}
              currentPageNumber={activePage.pageNumber}
              onNavigateToPage={(pageNumber) => {
                const idx = safePages.findIndex((p) => p.pageNumber === pageNumber);
                if (idx >= 0) setCurrentPageIndex(idx);
              }}
            />
          </>
        )}

        {/* Movable Floating Electronic Pen Toolbar */}
        <MovablePenToolbar
          currentTool={currentTool}
          setCurrentTool={setCurrentTool}
          currentColor={currentColor}
          setCurrentColor={setCurrentColor}
          strokeWidth={strokeWidth}
          setStrokeWidth={setStrokeWidth}
          fontSize={fontSize}
          setFontSize={setFontSize}
          isBold={isBold}
          setIsBold={setIsBold}
          onUndo={() => {
            if (undoStack.length === 0) return;
            const previous = undoStack[undoStack.length - 1];
            setUndoStack((prev) => prev.slice(0, prev.length - 1));
            setRedoStack((prev) => [...prev, activePage.annotations || []]);
            handleSaveAnnotations(previous);
          }}
          onRedo={() => {
            if (redoStack.length === 0) return;
            const next = redoStack[redoStack.length - 1];
            setRedoStack((prev) => prev.slice(0, prev.length - 1));
            setUndoStack((prev) => [...prev, activePage.annotations || []]);
            handleSaveAnnotations(next);
          }}
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          onClearPage={handleClearPage}
          isAutoSaved={isAutoSaved}
        />
      </main>

      {/* 4. Bottom Page Tabs Bar */}
      <nav aria-label="التنقل السريع بين صفحات المستند" className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto text-xs font-bold select-none no-scrollbar">
          <span className="text-[11px] text-slate-400 font-semibold px-2 shrink-0">التنقل السريع ({safePages.length} صفحة):</span>
          {safePages.length <= 25 ? (
            safePages.map((p, idx) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setCurrentPageIndex(idx)}
                className={`px-3 py-1 rounded-lg shrink-0 transition-all ${
                  currentPageIndex === idx
                    ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                صفحة {p.pageNumber}
              </button>
            ))
          ) : (
            <>
              {/* First Page */}
              <button
                type="button"
                onClick={() => setCurrentPageIndex(0)}
                className={`px-3 py-1 rounded-lg shrink-0 transition-all ${
                  currentPageIndex === 0
                    ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                }`}
              >
                صفحة 1
              </button>

              {currentPageIndex > 4 && <span className="text-slate-400 px-1">...</span>}

              {/* Window around current page */}
              {Array.from({ length: 9 }).map((_, offset) => {
                const targetIdx = currentPageIndex - 4 + offset;
                if (targetIdx <= 0 || targetIdx >= safePages.length - 1) return null;
                const p = safePages[targetIdx];
                if (!p) return null;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setCurrentPageIndex(targetIdx)}
                    className={`px-3 py-1 rounded-lg shrink-0 transition-all ${
                      currentPageIndex === targetIdx
                        ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                    }`}
                  >
                    صفحة {p.pageNumber}
                  </button>
                );
              })}

              {currentPageIndex < safePages.length - 5 && <span className="text-slate-400 px-1">...</span>}

              {/* Last Page */}
              <button
                type="button"
                onClick={() => setCurrentPageIndex(safePages.length - 1)}
                className={`px-3 py-1 rounded-lg shrink-0 transition-all ${
                  currentPageIndex === safePages.length - 1
                    ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                }`}
              >
                صفحة {safePages.length}
              </button>
            </>
          )}
        </nav>

      {/* Floating Vertical Gliders (أزرار الصعود والنزول تقلع وتنزل بسلاسة - مخفية على الموبايل لتصفح أوضح) */}
      <div className="hidden md:flex fixed end-4 bottom-24 z-40 flex-col items-center gap-1.5 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-1.5 rounded-2xl shadow-2xl border-2 border-amber-500/80">
          <button
            type="button"
            onClick={() => setCurrentPageIndex((prev) => Math.max(0, prev - 1))}
            disabled={currentPageIndex === 0}
            className="p-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-20 text-slate-950 font-black transition active:scale-90 shadow-md cursor-pointer"
            title="الصعود لأعلى / الصفحة السابقة (تقلع لأعلى 🔼)"
          >
            <ChevronUp className="w-5 h-5 stroke-[3]" />
          </button>

          <div className="font-mono text-[11px] font-black text-slate-800 dark:text-slate-200 py-0.5 select-none">
            {currentPageIndex + 1}/{safePages.length}
          </div>

          <button
            type="button"
            onClick={() => setCurrentPageIndex((prev) => Math.min(safePages.length - 1, prev + 1))}
            disabled={currentPageIndex >= safePages.length - 1}
            className="p-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-20 text-slate-950 font-black transition active:scale-90 shadow-md cursor-pointer"
            title="النزول لأسفل / الصفحة التالية (تنزل لأسفل 🔽)"
          >
            <ChevronDown className="w-5 h-5 stroke-[3]" />
          </button>
        </div>

      {/* Master Settings Modal (كل أزرار وخيارات المذكرة غير القلم) */}
      <DocumentSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        document={currentDoc}
        currentPage={activePage}
        currentPageIndex={currentPageIndex}
        subjectInfo={subjectInfo}
        showAiTutor={showAiTutor}
        onToggleAiTutor={() => setShowAiTutor(!showAiTutor)}
        showQuickNotes={showQuickNotes}
        onToggleQuickNotes={() => setShowQuickNotes(!showQuickNotes)}
        zoom={zoom}
        onSetZoom={setZoom}
        showThumbnails={showThumbnails}
        onToggleThumbnails={() => setShowThumbnails(!showThumbnails)}
        darkMode={darkMode}
        onToggleDarkMode={onToggleDarkMode}
        isSepiaMode={isSepiaMode}
        onToggleSepiaMode={toggleSepiaMode}
        onAddBlankPage={handleAddBlankPage}
        isBookmarked={Boolean(currentDoc.bookmarks?.includes(activePage.pageNumber))}
        onToggleBookmark={toggleBookmark}
        isExporting={isExporting}
        onExportPdf={handleExportPdf}
        onExportCurrentPage={handleExportCurrentPage}
        onPrint={() => window.print()}
        onOpenReminder={onOpenReminderForDoc ? () => onOpenReminderForDoc(currentDoc) : undefined}
        onDeleteDocument={() => onDeleteDocument(currentDoc.id)}
      />

      {/* Interactive Comments & Inquiries Modal */}
      {isCommentsOpen && (
        <InteractiveCommentsSection
          targetId={currentDoc.id}
          targetType="document"
          targetTitle={currentDoc.title}
          isModal
          onClose={() => setIsCommentsOpen(false)}
        />
      )}
    </div>
  );
};
