import type { QuestionBrief } from '../brief';
import { COMMERCE_BRIEFS } from './commerce';
import { INFRASTRUCTURE_BRIEFS } from './infrastructure';
import { MEDIA_BRIEFS } from './media';
import { REALTIME_BRIEFS } from './realtime';
import { SOCIAL_BRIEFS } from './social';

/** Every authored question-bank brief (the 12 curated interviews are defined separately in ../../problems). */
export const BRIEFS: QuestionBrief[] = [...SOCIAL_BRIEFS, ...MEDIA_BRIEFS, ...COMMERCE_BRIEFS, ...INFRASTRUCTURE_BRIEFS, ...REALTIME_BRIEFS];
