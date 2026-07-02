import { Queue } from "bullmq";
import { redisConnection } from "../lib/redis";

export const QUEUES = {
  PDF_GENERATION: "pdf-generation-queue",
  BULK_MESSAGE: "bulk-message-queue",
} as const;

const defaultJobOptions = {
  removeOnComplete: true,
  removeOnFail: false,
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1000,
  },
};

export const pdfQueue = new Queue(QUEUES.PDF_GENERATION, {
  connection: redisConnection as any,
  defaultJobOptions,
});

export const bulkMessageQueue = new Queue(QUEUES.BULK_MESSAGE, {
  connection: redisConnection as any,
  defaultJobOptions,
});
