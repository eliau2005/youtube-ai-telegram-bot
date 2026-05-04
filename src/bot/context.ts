import type { Context, Scenes } from 'telegraf';
import type { SceneContextScene, WizardContextWizard, WizardSessionData } from 'telegraf/typings/scenes';

export interface NewPlaylistWizardState {
  jobId?: string;
  shortJobId?: string;
  playlistId?: string;
  category?: string;
  subCategories?: string;
  lessonGroups?: string;
  rabbis?: string;
  preChat?: { messages: { role: 'user' | 'assistant'; text: string }[] };
  customInstructions?: import('../core/types').CustomInstructions | null;
  fetchedVideos?: import('../core/types').Video[];
  approvedVideos?: import('../core/types').ProcessedVideo[];
  history?: import('../core/types').ProcessedVideo[][];
  pendingDialogResolution?: {
    type: 'OUT_OF_SCOPE' | 'NEW_SUBCATEGORY_NEEDED';
    dialogKey: string;
    field?: 'subCategory' | 'lessonGroup' | 'rabbi';
    collected?: { subCategory?: string; lessonGroup?: string | null; rabbi?: string };
  };
  pendingItemEdit?: {
    index?: number;
    field?: keyof import('../core/types').ProcessedVideo;
  };
}

export interface JsonImportSceneState {
  jobShortId?: string;
  uploadedFilePath?: string;
  reportPath?: string;
  reportSummary?: { new: number; existing: number; conflict: number; total: number };
  publishMode?: 'publish' | 'draft';
  allowUpdates?: boolean;
}

export interface JsonExportSceneState {
  filters?: import('../core/exporter').LessonFilters;
  promptingField?: 'category' | 'subCategory' | 'lessonGroup' | 'rabbi';
}

export interface BotSession extends Scenes.WizardSession<WizardSessionData> {
  awaitingGeneralCorrection?: boolean;
}

export interface BotContext extends Context {
  session: BotSession;
  scene: SceneContextScene<BotContext, WizardSessionData>;
  wizard: WizardContextWizard<BotContext>;
}
