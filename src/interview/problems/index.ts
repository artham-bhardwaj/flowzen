import { fromBrief } from '../bank/brief';
import { BRIEFS } from '../bank/briefs';
import type { InterviewDefinition } from '../types';
import { urlShortener } from './urlShortener';
import { fileStorage, notificationService, productCatalog, rateLimiter } from './set2';
import { autocomplete, chat, checkout, newsFeed } from './set3';
import { jobScheduler, rideBooking, videoProcessing } from './set4';

/** The 12 curated interviews, each with its own tuned benchmark and reference architectures. */
export const CURATED: InterviewDefinition[] = [
  urlShortener, productCatalog, rateLimiter, notificationService, fileStorage,
  checkout, chat, autocomplete, videoProcessing, newsFeed, rideBooking, jobScheduler,
];
/** The full interview library: curated interviews followed by the question-bank problems generated from briefs. */
export const PROBLEMS: InterviewDefinition[] = [...CURATED, ...BRIEFS.map(fromBrief)];
