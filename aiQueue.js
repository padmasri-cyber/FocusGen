const aiCache = require('./aiCache');

const MIN_SPACING_MS = 15000; // 15-second spacing for Pollinations anonymous tier
const TIMEOUT_MS = 25000;     // 25-second timeout per request

class AiQueueManager {
  constructor() {
    this.queue = [];
    this.jobs = new Map();
    this.activeJob = null;
    this.lastCallTime = 0;
    this.isProcessing = false;
    this.generatorFn = null; // Injected from server.js generateImage
  }

  setGenerator(fn) {
    this.generatorFn = fn;
  }

  enqueue(provider, word, opts = {}) {
    return this.createJob({
      provider,
      word,
      prompt: opts.prompt || word,
      purpose: opts.purpose || 'chat',
      width: opts.width || 640,
      height: opts.height || 360,
      size: opts
    });
  }

  createJob(params) {
    const { word, purpose, width, height, provider, prompt, size } = params;
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    
    const job = {
      id,
      word,
      purpose,
      width,
      height,
      provider: provider || 'pollinations',
      prompt,
      size,
      status: 'queued', // 'queued' | 'generating' | 'completed' | 'timeout' | 'failed'
      position: this.queue.length + 1,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null
    };

    this.jobs.set(id, job);
    this.queue.push(job);
    this.updatePositions();

    console.log(`[AI Queue] Job ${id} created for "${word}" (${purpose}, ${width}x${height}). Position in queue: ${job.position}`);

    this.processQueue();
    return job;
  }

  getJob(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status === 'queued') {
      const idx = this.queue.indexOf(job);
      job.position = idx >= 0 ? idx + 1 : 1;
    }
    return job;
  }

  updatePositions() {
    this.queue.forEach((job, idx) => {
      job.position = idx + 1;
    });
  }

  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        // Enforce 15-second spacing between Pollinations API calls
        const elapsed = Date.now() - this.lastCallTime;
        if (elapsed < MIN_SPACING_MS && this.lastCallTime > 0) {
          const waitMs = MIN_SPACING_MS - elapsed;
          console.log(`[AI Queue] Spacing delay: waiting ${(waitMs / 1000).toFixed(1)}s before next Pollinations request...`);
          await new Promise(r => setTimeout(r, waitMs));
        }

        const job = this.queue.shift();
        if (!job) break;

        this.updatePositions();
        this.activeJob = job;
        job.status = 'generating';
        job.startedAt = Date.now();
        this.lastCallTime = Date.now();

        console.log(`[AI Queue] Processing job ${job.id} for "${job.word}" (${job.purpose})...`);

        try {
          if (!this.generatorFn) {
            throw new Error('Image generator function not registered');
          }

          // Run generation with 25-second timeout
          const resultPromise = this.generatorFn(job.provider, job.prompt, {
            ...job.size,
            purpose: job.purpose,
            width: job.width,
            height: job.height
          });

          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
              const err = new Error('AI image generation timed out after 25s');
              err.isTimeout = true;
              reject(err);
            }, TIMEOUT_MS);
          });

          const result = await Promise.race([resultPromise, timeoutPromise]);

          job.status = 'completed';
          job.completedAt = Date.now();
          job.result = result;

          // Save to persistent cache
          aiCache.set(job.word, result, job.purpose, job.width, job.height);
          console.log(`[AI Queue] Job ${job.id} completed successfully in ${((job.completedAt - job.startedAt) / 1000).toFixed(1)}s! Cached as ${aiCache.getCacheKey(job.word, job.purpose, job.width, job.height)}.`);

        } catch (err) {
          job.completedAt = Date.now();
          if (err.isTimeout || err.message.includes('timed out')) {
            job.status = 'timeout';
            job.error = 'AI image is taking long, showing licensed photos';
            console.warn(`[AI Queue] Job ${job.id} timed out after 25s. Web photos kept.`);
          } else {
            job.status = 'failed';
            job.error = err.message || 'Generation failed';
            console.warn(`[AI Queue] Job ${job.id} failed:`, err.message);
          }
        } finally {
          this.activeJob = null;
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}

const aiQueue = new AiQueueManager();

module.exports = aiQueue;
