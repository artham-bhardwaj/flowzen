import type { Company, CompanyId, CompanyReport, Source } from './types';

/**
 * Company interview evidence. Every source below was fetched on 2026-10-20 and every `asked` string is quoted from
 * it. The sources are third-party preparation guides that state they compile candidate and interviewer reports; none
 * is published by the company itself, so no association is rated higher than "medium".
 *
 * Companies with no checkable source (Uber, LinkedIn, Twitter/X, Airbnb at the time of compilation) have no reports.
 * Their products may still appear as `modelledOn`, which says nothing about their interviews.
 */
export const COMPANIES: Company[] = [
  { id: 'google', name: 'Google' }, { id: 'amazon', name: 'Amazon' }, { id: 'meta', name: 'Meta' }, { id: 'microsoft', name: 'Microsoft' },
  { id: 'apple', name: 'Apple' }, { id: 'netflix', name: 'Netflix' }, { id: 'uber', name: 'Uber' }, { id: 'stripe', name: 'Stripe' },
  { id: 'linkedin', name: 'LinkedIn' }, { id: 'twitter', name: 'Twitter/X' }, { id: 'airbnb', name: 'Airbnb' },
];
export const companyName = (id: CompanyId) => COMPANIES.find(company => company.id === id)!.name;

const CHECKED = '2026-10-20';
const RELATIVE = 'The page showed “Last updated 19 days ago” when checked on 2026-10-20; it gives no absolute date.';
export const SOURCES: Source[] = [
  { id: 'aced-meta', url: 'https://www.aced.io/blog/meta-system-design-interview', title: 'Meta system design interview', publisher: 'Aced (formerly Exponent)', kind: 'third-party-compilation', sourcing: 'Here are recently reported questions, organized by role.', checkedOn: CHECKED, dateNote: RELATIVE },
  { id: 'aced-stripe', url: 'https://www.aced.io/blog/stripe-system-design-interview', title: 'Stripe system design interview', publisher: 'Aced (formerly Exponent)', kind: 'third-party-compilation', sourcing: 'Every question below comes from a verified candidate report or a Stripe interviewer.', checkedOn: CHECKED, dateNote: RELATIVE },
  { id: 'aced-google', url: 'https://www.aced.io/blog/google-system-design-interview', title: 'Google system design interview', publisher: 'Aced (formerly Exponent)', kind: 'third-party-compilation', sourcing: 'We built this guide from recent first-hand accounts: software engineers who interviewed at L3 and L4, an engineering manager at L6, and the Google interview experiences candidates have shared with us.', checkedOn: CHECKED, dateNote: RELATIVE },
  { id: 'aced-amazon', url: 'https://www.aced.io/blog/amazon-system-design-interview', title: 'Amazon system design interview', publisher: 'Aced (formerly Exponent)', kind: 'third-party-compilation', sourcing: 'Every question below traces to an Amazon interviewer or candidate we spoke with.', checkedOn: CHECKED, dateNote: RELATIVE },
  { id: 'aced-microsoft', url: 'https://www.aced.io/blog/microsoft-system-design-interview', title: 'Microsoft system design interview', publisher: 'Aced (formerly Exponent)', kind: 'third-party-compilation', sourcing: 'Every prompt below comes from a Microsoft candidate or interviewer account or our Microsoft system design question bank.', checkedOn: CHECKED, dateNote: RELATIVE },
  { id: 'aced-netflix', url: 'https://www.aced.io/blog/netflix-system-design-interview', title: 'Netflix system design interview', publisher: 'Aced (formerly Exponent)', kind: 'third-party-compilation', sourcing: 'This guide was written with insights from candidates who completed the entire Netflix software engineer loop.', checkedOn: CHECKED, dateNote: RELATIVE },
  { id: 'aced-apple', url: 'https://www.aced.io/blog/apple-system-design-interview', title: 'Apple system design interview', publisher: 'Aced (formerly Exponent)', kind: 'third-party-compilation', sourcing: 'This guide draws on firsthand accounts from Apple interviewers and engineers across multiple teams.', checkedOn: CHECKED, dateNote: RELATIVE },
];
export const sourceById = (id: string) => SOURCES.find(source => source.id === id);

const r = (company: CompanyId, sourceId: string, asked: string, confidence: CompanyReport['confidence'], note?: string): CompanyReport => ({ company, sourceId, asked, confidence, ...(note ? { note } : {}) });
/** Reports per question id. Only questions listed here carry company tags. */
export const REPORTS: Record<string, CompanyReport[]> = {
  'photo-sharing': [r('meta', 'aced-meta', 'Design Instagram', 'medium')],
  'news-feed': [r('meta', 'aced-meta', 'Design Facebook News Feed', 'medium')],
  chat: [r('meta', 'aced-meta', 'Design Facebook Messenger', 'medium'), r('microsoft', 'aced-microsoft', 'Design a chat feature for users of Microsoft Azure.', 'low', 'Listed without saying whether it came from an individual account or the publisher’s question bank.')],
  autocomplete: [r('meta', 'aced-meta', 'Design a typeahead search box', 'medium'), r('apple', 'aced-apple', 'Design a typeahead box for a search engine.', 'low', 'The page calls its list “a calibration tool, not an exhaustive set”.')],
  'web-crawler': [r('meta', 'aced-meta', 'Design a web crawler', 'medium')],
  'object-storage': [r('meta', 'aced-meta', 'Design a file storage system like S3', 'medium')],
  'live-comments': [r('meta', 'aced-meta', 'Design live commenting for Facebook', 'medium')],
  'top-k': [r('meta', 'aced-meta', 'Design a system to show the top 10 most listened songs in the last 7 days', 'medium', 'Listed under engineering-manager questions. The same page also lists “Design ‘Hot Topics’ on Instagram”.')],
  'price-tracker': [r('meta', 'aced-meta', 'Design an Amazon price tracker', 'medium', 'Listed under engineering-manager questions.')],
  auction: [r('meta', 'aced-meta', 'Design an auction feature on Instagram', 'medium', 'Listed under engineering-manager questions.')],
  'online-game': [r('meta', 'aced-meta', 'Design an online chess game', 'medium', 'The page says a recent candidate was asked this with an API-design focus.'), r('amazon', 'aced-amazon', 'Design a chess game (low-level design).', 'medium', 'Reported as a low-level design question.')],
  recommendations: [r('netflix', 'aced-netflix', 'How would you design a dynamic recommendation system for Netflix?', 'medium', 'The page says one candidate received this exact question.'), r('meta', 'aced-meta', 'Design a recommendation system for a specific business use case.', 'medium', 'Reported from an engineering-manager (M1) loop.')],
  'payment-ledger': [r('stripe', 'aced-stripe', 'Design a ledger (or bookkeeping) service.', 'medium', 'The same page lists “Design the APIs to store transactions and a transaction log.”')],
  'rate-limiter': [r('stripe', 'aced-stripe', 'Design a rate limiter.', 'medium')],
  'metrics-monitoring': [r('stripe', 'aced-stripe', 'Design a metrics service.', 'medium', 'The same page lists “design an application performance monitoring system.”'), r('google', 'aced-google', 'Design a logs and metrics pipeline.', 'medium')],
  'distributed-cache': [r('stripe', 'aced-stripe', 'Design a distributed LRU cache', 'medium')],
  'ticket-booking': [r('stripe', 'aced-stripe', 'design Ticketmaster', 'low', 'Mentioned as a generic prompt that also comes up, not as an individual report.')],
  'connection-degree': [r('google', 'aced-google', 'Design a connection-degree system for a professional network.', 'medium')],
  'logging-platform': [r('google', 'aced-google', 'Design a logs and metrics pipeline.', 'medium'), r('netflix', 'aced-netflix', 'whether to build and own event logging clients internally', 'medium', 'Reported for an internal tooling team; it covers part of a logging platform (client ownership), not the whole design.')],
  'video-streaming': [r('google', 'aced-google', 'Design a video distribution service.', 'low', 'From the page’s list of other prompts drawn from its question database.')],
  'url-shortener': [r('google', 'aced-google', 'How would you build a URL shortener along the lines of TinyURL?', 'low', 'From the page’s list of other prompts drawn from its question database.')],
  'map-tiles': [r('google', 'aced-google', 'Design a Google-scale product such as Maps or YouTube.', 'low', 'A broad prompt naming Maps as an example; this question covers the map-display part.')],
  'ab-testing': [r('amazon', 'aced-amazon', 'Design an A/B experimentation platform.', 'medium')],
  'locker-reservations': [r('amazon', 'aced-amazon', 'Manage capacity for a network of delivery lockers (high-level design).', 'medium')],
  coupons: [r('amazon', 'aced-amazon', 'Design a discount and coupon system (low-level design).', 'medium', 'Reported as a low-level design question.')],
  'ota-updates': [r('microsoft', 'aced-microsoft', 'design a way for a car company to push software updates to its vehicles', 'medium', 'The page attributes this to an SDE II candidate and also lists “Design a system that delivers firmware updates to devices”.')],
  'kv-store': [r('microsoft', 'aced-microsoft', 'Design a key-value store', 'low', 'Listed without saying whether it came from an individual account or the publisher’s question bank.')],
  'secrets-manager': [r('microsoft', 'aced-microsoft', 'Design a service like Azure Key Vault', 'low', 'Listed without saying whether it came from an individual account or the publisher’s question bank.')],
};
