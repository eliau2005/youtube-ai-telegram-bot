import type { DialogResponse } from './types';

export interface ActiveJob {
  jobId: string;
  shortId: string;
  userId: number;
  scene: string;
  currentStep: string;
  startedAt: number;
  telegramMessageId?: number;
  progressChatId?: number;
  isAborted: boolean;
  pendingDialogs: Map<string, { resolve: (r: DialogResponse) => void; reject: (e: Error) => void }>;
}

class JobManagerImpl {
  private jobs = new Map<number, ActiveJob>();

  start(userId: number, scene: string, jobId: string, shortId: string): ActiveJob {
    const existing = this.jobs.get(userId);
    if (existing && !existing.isAborted) {
      throw new Error('You already have a job in progress. Use /cancel first.');
    }
    const job: ActiveJob = {
      jobId,
      shortId,
      userId,
      scene,
      currentStep: 'starting',
      startedAt: Date.now(),
      isAborted: false,
      pendingDialogs: new Map()
    };
    this.jobs.set(userId, job);
    return job;
  }

  get(userId: number): ActiveJob | undefined {
    return this.jobs.get(userId);
  }

  getByShortId(shortId: string): ActiveJob | undefined {
    for (const j of this.jobs.values()) {
      if (j.shortId === shortId) return j;
    }
    return undefined;
  }

  abort(userId: number): boolean {
    const job = this.jobs.get(userId);
    if (!job) return false;
    job.isAborted = true;
    for (const pending of job.pendingDialogs.values()) {
      pending.reject(new Error('aborted'));
    }
    job.pendingDialogs.clear();
    return true;
  }

  isAborted(userId: number): boolean {
    return this.jobs.get(userId)?.isAborted ?? false;
  }

  finish(userId: number): void {
    this.jobs.delete(userId);
  }

  setStep(userId: number, step: string): void {
    const job = this.jobs.get(userId);
    if (job) job.currentStep = step;
  }

  setProgressMessage(userId: number, chatId: number, messageId: number): void {
    const job = this.jobs.get(userId);
    if (job) {
      job.progressChatId = chatId;
      job.telegramMessageId = messageId;
    }
  }

  awaitDialog(userId: number, key: string): Promise<DialogResponse> {
    const job = this.jobs.get(userId);
    if (!job) return Promise.reject(new Error('No active job'));
    return new Promise<DialogResponse>((resolve, reject) => {
      job.pendingDialogs.set(key, { resolve, reject });
    });
  }

  resolveDialog(userId: number, key: string, response: DialogResponse): boolean {
    const job = this.jobs.get(userId);
    if (!job) return false;
    const pending = job.pendingDialogs.get(key);
    if (!pending) return false;
    pending.resolve(response);
    job.pendingDialogs.delete(key);
    return true;
  }
}

export const JobManager = new JobManagerImpl();
