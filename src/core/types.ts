export interface Video {
  originalOrder: number;
  videoId: string;
  title: string;
  youtubeUrl: string;
}

export interface UserConstraints {
  category: string;
  subCategories: string;
  lessonGroups: string;
  rabbis: string;
}

export interface CustomInstructions {
  summary: string;
  hasSimanim: boolean;
  sortBy: 'siman' | 'chumash-order' | 'upload-date' | 'custom' | null;
  customSubCategoryRules: string | null;
  freeText: string;
}

export interface AiResultItem {
  videoId: string;
  lessonTitle: string;
  subCategory: string;
  lessonGroup: string | null;
  rabbi: string;
  baseSlug: string;
  simanValue: number | null;
  simanSectionValue: number | null;
  isNewSubCategory?: boolean;
  isNewLessonGroup?: boolean;
  isNewRabbi?: boolean;
}

export interface ApprovedVideo {
  videoId: string;
  youtubeUrl: string;
  originalTitle: string;
  lessonTitle: string;
  description: string;
  rabbi: string;
  category: string;
  subCategory: string;
  lessonGroup: string | null;
  baseSlug: string;
  simanValue: number | null;
  simanSectionValue: number | null;
  originalOrder: number;
}

export interface ProcessedVideo {
  videoId: string;
  youtubeUrl: string;
  originalTitle: string;
  lessonTitle: string;
  description: string;
  rabbi: string;
  category: string;
  subCategory: string;
  lessonGroup: string | null;
  order: number;
  slug: string;
}

export type DialogResponse =
  | { action: 'skip' }
  | { action: 'assign'; subCategory: string; lessonGroup: string | null; rabbi: string };

export interface OutOfScopePrompt {
  type: 'OUT_OF_SCOPE';
  videoTitle: string;
  category: string;
  subCategories: string;
  lessonGroups: string;
  rabbis: string;
}

export interface NewSubCategoryPrompt {
  type: 'NEW_SUBCATEGORY_NEEDED';
  videoTitle: string;
  suggestedSubCategory: string;
  suggestedLessonGroup: string | null;
}

export type InteractiveDialogPayload = OutOfScopePrompt | NewSubCategoryPrompt;

export interface ProcessingContext {
  jobId: string;
  userId: number;
  outputDir: string;
  log(text: string): void;
  progress(text: string): Promise<void>;
  askInteractive(prompt: InteractiveDialogPayload): Promise<DialogResponse>;
  isAborted(): boolean;
}

export interface ProcessorResult {
  outputPath: string;
  data: ProcessedVideo[];
  approved: ApprovedVideo[];
}

export interface PreChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface HistoryEntry {
  jobId: string;
  playlistId: string;
  category: string;
  totalVideos: number;
  status: 'completed' | 'failed' | 'interrupted-by-restart' | 'aborted';
  completedAt: number;
  jobFile?: string;
}

export type PublishMode = 'publish' | 'draft';
