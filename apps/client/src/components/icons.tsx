import type { LucideIcon } from 'lucide-react';
import {
  ALargeSmall,
  ArrowDownUp,
  ArrowLeft,
  ChevronUp,
  Command,
  Scissors,
  RotateCw,
  Move,
  Vote,
  Milestone,
  ChefHat,
  TabletSmartphone,
  Clock,
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  ArrowDown,
  ArrowUp,
  BringToFront,
  Camera,
  Check,
  SquareCheckBig,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Circle,
  ClipboardPaste,
  Inbox,
  Search,
  Users,
  Cloud,
  Code,
  CloudCheck,
  CloudDownload,
  CloudOff,
  Copy,
  CopyPlus,
  Crop,
  Diamond,
  Download,
  Droplet,
  Expand,
  Eye,
  Flag,
  EyeOff,
  ExternalLink,
  File,
  FilePlus2,
  FileText,
  StickyNote,
  Film,
  BadgeCheck,
  FlipHorizontal2,
  FlipVertical2,
  Folder,
  FolderInput,
  FolderOpen,
  Fullscreen,
  Globe,
  GripVertical,
  Group,
  Heading1,
  Image,
  ImagePlus,
  Images,
  Layers,
  Columns3,
  RefreshCw,
  Presentation,
  Ellipsis,
  SquareKanban,
  ChartGantt,
  Captions,
  Filter,
  Keyboard,
  LayoutDashboard,
  Newspaper,
  Bookmark,
  BookOpen,
  LayoutTemplate,
  Network,
  ChartColumn,
  Grid3x3,
  Puzzle,
  LayoutGrid,
  List,
  Link,
  ListMusic,
  Lock,
  Mail,
  ScanFace,
  ScanLine,
  LockOpen,
  LogOut,
  Map,
  MessageCircle,
  Maximize,
  Menu,
  Mic,
  Minus,
  Rows3,
  Scan,
  Monitor,
  MonitorDown,
  Moon,
  Mouse,
  MousePointer2,
  MoveHorizontal,
  MoveUpRight,
  MoveVertical,
  Music,
  Package,
  Palette,
  PanelLeft,
  Bold,
  Italic,
  Strikethrough,
  Heading2,
  Heading3,
  ListOrdered,
  TextQuote,
  SquareCode,
  House,
  Pause,
  Pencil,
  PenTool,
  PenLine,
  Percent,
  PictureInPicture2,
  Pipette,
  Play,
  Plus,
  Files,
  Printer,
  Telescope,
  Brain,
  QrCode,
  Redo2,
  Repeat,
  ArrowRightLeft,
  Calendar,
  ListChecks,
  RotateCcw,
  Rss,
  Save,
  ScreenShare,
  SendToBack,
  Shapes,
  SkipBack,
  SkipForward,
  Slash,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareDashed,
  Star,
  Scale,
  Sun,
  SunMoon,
  Tag,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  Upload,
  Video,
  Volume,
  ZoomIn,
  ZoomOut,
  Volume1,
  Volume2,
  VolumeX,
  X,
  MapPin,
  Share2,
} from 'lucide-react';

/**
 * The app's icon set: lucide-react (stroke-based, 24-unit grid, currentColor)
 * wrapped once so every icon shares the chrome's default size and weight.
 */
const wrap = (C: LucideIcon) =>
  function WrappedIcon({ size = 15 }: { size?: number }) {
    return <C size={size} strokeWidth={1.8} aria-hidden />;
  };

/** Transport marks (play/pause/skip) read better solid than stroked. */
const wrapFilled = (C: LucideIcon) =>
  function FilledIcon({ size = 15 }: { size?: number }) {
    return <C size={size} strokeWidth={1.5} fill="currentColor" aria-hidden />;
  };

// ── chrome / toolbar ──
export const GearIcon = wrap(SlidersHorizontal);
export const FileIcon = wrap(File);
export const LinkIcon = wrap(Link);
export const GlobeIcon = wrap(Globe);
export const MapPinIcon = wrap(MapPin);
export const GraphIcon = wrap(Share2);
export const EyeIcon = wrap(Eye);
export const FlagIcon = wrap(Flag);
export const EyeOffIcon = wrap(EyeOff);
export const PlusIcon = wrap(Plus);
export const CloseIcon = wrap(X);
export const SparkleIcon = wrap(Sparkles);
export const BadgeCheckIcon = wrap(BadgeCheck);
export const CursorIcon = wrap(MousePointer2);
export const HeadingIcon = wrap(Heading1);
export const EyedropperIcon = wrap(Pipette);
export const FitIcon = wrap(Fullscreen);
export const UndoIcon = wrap(Undo2);
export const RedoIcon = wrap(Redo2);
export const MoonIcon = wrap(Moon);
export const SunIcon = wrap(Sun);
export const ExpandIcon = wrap(Maximize);
export const GridIcon = wrap(LayoutGrid);
export const ChartIcon = wrap(ChartColumn);
export const GridSmallIcon = wrap(Grid3x3);
export const PuzzleIcon = wrap(Puzzle);
export const ListIcon = wrap(List);
export const CloudIcon = wrap(Cloud);
export const CloudDownloadIcon = wrap(CloudDownload);
export const CloudCheckIcon = wrap(CloudCheck);
export const CloudOffIcon = wrap(CloudOff);
export const DownloadIcon = wrap(Download);
export const ImageIcon = wrap(Image);
export const TypeIcon = wrap(Type);
export const TextSizeIcon = wrap(ALargeSmall);
export const DropletIcon = wrap(Droplet);
export const PaletteIcon = wrap(Palette);
export const BoardsIcon = wrap(LayoutDashboard);
export const MinusIcon = wrap(Minus);
export const VideoIcon = wrap(Video);
export const GalleryIcon = wrap(Images);
export const MinimapIcon = wrap(Map);
export const PopOutIcon = wrap(PictureInPicture2);
export const LayersIcon = wrap(Layers);
export const ChatIcon = wrap(MessageCircle);
export const SearchIcon = wrap(Search);
export const CheckSquareIcon = wrap(SquareCheckBig);
export const ChevronRightIcon = wrap(ChevronRight);
export const ChevronLeftIcon = wrap(ChevronLeft);
export const ChevronsLeftIcon = wrap(ChevronsLeft);
export const ChevronsRightIcon = wrap(ChevronsRight);
export const ChevronDownIcon = wrap(ChevronDown);
export const LockIcon = wrap(Lock);
export const MailIcon = wrap(Mail);
export const ScanFaceIcon = wrap(ScanFace);
export const ScanLineIcon = wrap(ScanLine);
export const UnlockIcon = wrap(LockOpen);
export const GripIcon = wrap(GripVertical);
export const FolderIcon = wrap(Folder);
export const CameraIcon = wrap(Camera);
export const FilmIcon = wrap(Film);
export const CheckIcon = wrap(Check);

// ── shape tools ──
export const ShapesIcon = wrap(Shapes);
export const SquareIcon = wrap(Square);
export const CircleIcon = wrap(Circle);
export const LineIcon = wrap(Slash);
export const ArrowIcon = wrap(MoveUpRight);
export const DiamondIcon = wrap(Diamond);
export const PencilIcon = wrap(Pencil);
export const PenToolIcon = wrap(PenTool);
export const BookIcon = wrap(BookOpen);
export const BookOpenIcon = wrap(BookOpen);
export const TemplateIcon = wrap(LayoutTemplate);
export const NetworkIcon = wrap(Network);
export const BookmarkIcon = wrap(Bookmark);
export const KeyboardIcon = wrap(Keyboard);
export const StarIcon = wrap(Star);
export const ScaleIcon = wrap(Scale);

// ── media transport ──
export const PlayIcon = wrapFilled(Play);
export const PauseIcon = wrapFilled(Pause);
export const StepBackIcon = wrapFilled(SkipBack);
export const StepFwdIcon = wrapFilled(SkipForward);
export const LoopIcon = wrap(Repeat);
export const SwapIcon = wrap(ArrowRightLeft);
export const CalendarIcon = wrap(Calendar);
export const ListChecksIcon = wrap(ListChecks);
export const MusicNoteIcon = wrap(Music);
export const EvidenceIcon = wrap(BadgeCheck);

// ── menus / actions ──
export const CopyIcon = wrap(Copy);
export const PasteIcon = wrap(ClipboardPaste);
export const InboxIcon = wrap(Inbox);
export const UsersIcon = wrap(Users);
export const DuplicateIcon = wrap(CopyPlus);
export const TrashIcon = wrap(Trash2);
export const ScissorsIcon = wrap(Scissors);
export const CommandIcon = wrap(Command);
export const GroupIcon = wrap(Group);
export const UngroupIcon = wrap(Ungroup);
export const BringFrontIcon = wrap(BringToFront);
export const BringFwdIcon = wrap(ArrowUp);
export const SendBackwardIcon = wrap(ArrowDown);
export const SendBackIcon = wrap(SendToBack);
export const TextAlignLeftIcon = wrap(AlignLeft);
export const TextAlignCenterIcon = wrap(AlignCenter);
export const TextAlignRightIcon = wrap(AlignRight);
export const VAlignTopIcon = wrap(AlignVerticalJustifyStart);
export const VAlignMiddleIcon = wrap(AlignVerticalJustifyCenter);
export const VAlignBottomIcon = wrap(AlignVerticalJustifyEnd);
export const AlignLeftIcon = wrap(AlignStartVertical);
export const AlignCenterXIcon = wrap(AlignCenterVertical);
export const AlignRightIcon = wrap(AlignEndVertical);
export const AlignTopIcon = wrap(AlignStartHorizontal);
export const AlignMiddleYIcon = wrap(AlignCenterHorizontal);
export const AlignBottomIcon = wrap(AlignEndHorizontal);
export const DistributeHIcon = wrap(AlignHorizontalSpaceBetween);
export const DistributeVIcon = wrap(AlignVerticalSpaceBetween);
export const MatchWidthIcon = wrap(MoveHorizontal);
export const MatchHeightIcon = wrap(MoveVertical);
export const TagIcon = wrap(Tag);
export const RenameIcon = wrap(PenLine);
export const PenLineIcon = wrap(PenLine);
export const SelectAllIcon = wrap(SquareDashed);
export const ResetViewIcon = wrap(RotateCcw);
export const QrIcon = wrap(QrCode);
export const ClockIcon = wrap(Clock);
export const MoveIcon = wrap(Move);
export const RotateIcon = wrap(RotateCw);
export const PrinterIcon = wrap(Printer);
export const PagesIcon = wrap(Files);
export const TelescopeIcon = wrap(Telescope);
export const BrainIcon = wrap(Brain);
export const FitPageIcon = wrap(Scan);
export const ScrollViewIcon = wrap(Rows3);
export const ChevronUpIcon = wrap(ChevronUp);
export const ChefHatIcon = wrap(ChefHat);
export const VoteIcon = wrap(Vote);
export const MilestoneIcon = wrap(Milestone);
export const TabletIcon = wrap(TabletSmartphone);
export const CodeIcon = wrap(Code);
export const ExportIcon = wrap(Upload);
export const FilePlusIcon = wrap(FilePlus2);
export const ExitIcon = wrap(LogOut);
export const FlipHIcon = wrap(FlipHorizontal2);
export const FlipVIcon = wrap(FlipVertical2);
export const CropIcon = wrap(Crop);
export const LightboxIcon = wrap(Expand);
export const PlaylistIcon = wrap(ListMusic);
export const FolderInputIcon = wrap(FolderInput);
export const FolderOpenIcon = wrap(FolderOpen);
export const ExternalLinkIcon = wrap(ExternalLink);
export const ArrowLeftIcon = wrap(ArrowLeft);
export const MonitorIcon = wrap(Monitor);
export const SunMoonIcon = wrap(SunMoon);
export const SaveIcon = wrap(Save);
export const FileTextIcon = wrap(FileText);
export const StickyNoteIcon = wrap(StickyNote);
export const PackageIcon = wrap(Package);
export const ZoomInIcon = wrap(ZoomIn);
export const ZoomOutIcon = wrap(ZoomOut);
export const PercentIcon = wrap(Percent);
export const ArrowUpIcon = wrap(ArrowUp);
export const ArrowDownIcon = wrap(ArrowDown);
export const MouseIcon = wrap(Mouse);
export const MicIcon = wrap(Mic);
export const HamburgerIcon = wrap(Menu);
export const ScreenShareIcon = wrap(ScreenShare);
export const ScreenshotIcon = wrap(MonitorDown);
export const PanelLeftIcon = wrap(PanelLeft);
export const BoldIcon = wrap(Bold);
export const ItalicIcon = wrap(Italic);
export const StrikethroughIcon = wrap(Strikethrough);
export const Heading1Icon = wrap(Heading1);
export const Heading2Icon = wrap(Heading2);
export const Heading3Icon = wrap(Heading3);
export const ListOrderedIcon = wrap(ListOrdered);
export const SortIcon = wrap(ArrowDownUp);
export const TextQuoteIcon = wrap(TextQuote);
export const SquareCodeIcon = wrap(SquareCode);
export const HomeIcon = wrap(House);
export const RssIcon = wrap(Rss);
export const StockIcon = wrap(ImagePlus);

// ── special cases ──

/** Solid status dot (save state, board pill) — stays a filled custom mark. */
export const DotIcon = ({ color }: { color?: string }) => (
  <svg width={8} height={8} viewBox="0 0 8 8" aria-hidden>
    <circle cx="4" cy="4" r="4" fill={color ?? 'currentColor'} />
  </svg>
);

/** Volume icon that reflects the current level (muted / low / high). */
export const VolumeIcon = ({ level = 1 }: { level?: number }) => {
  const C = level === 0 ? VolumeX : level < 0.34 ? Volume : level < 0.67 ? Volume1 : Volume2;
  return <C size={15} strokeWidth={1.8} aria-hidden />;
};

export const MasonryIcon = wrap(Columns3);
export const KanbanIcon = wrap(SquareKanban);
export const GanttIcon = wrap(ChartGantt);
export const BlogViewIcon = wrap(Newspaper);
export const FilterIcon = wrap(Filter);
export const CaptionsIcon = wrap(Captions);
export const MoreIcon = wrap(Ellipsis);
/** Phone Kanban layouts: stacked columns / a horizontal row. */
export const StackIcon = wrap(Rows3);
export const ColumnsIcon = wrap(Columns3);
export const PresentationIcon = wrap(Presentation);
export const RefreshIcon = wrap(RefreshCw);
