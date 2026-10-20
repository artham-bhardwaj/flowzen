import type { InterviewDefinition } from '../types';
import { urlShortener } from './urlShortener';
import { fileStorage, notificationService, productCatalog, rateLimiter } from './set2';
import { autocomplete, chat, checkout, newsFeed } from './set3';
import { jobScheduler, rideBooking, videoProcessing } from './set4';

/** The interview library, in the order shown by default (roughly by difficulty). */
export const PROBLEMS: InterviewDefinition[] = [
  urlShortener, productCatalog, rateLimiter, notificationService, fileStorage,
  checkout, chat, autocomplete, videoProcessing, newsFeed, rideBooking, jobScheduler,
];
