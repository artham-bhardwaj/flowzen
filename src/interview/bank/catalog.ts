import { PROBLEMS } from '../problems';
import { REPORTS } from './evidence';
import type { BankGroup, BankQuestion, Evidence } from './types';

/**
 * Catalog placement for every interview definition (curated or generated from a brief). Groups, aliases,
 * "modelled on" products and prominence are editorial; company evidence comes only from evidence.ts.
 */
type Placement = { group: BankGroup; prominence: 1 | 2 | 3; aliases?: string[]; modelledOn?: string };
const PLACEMENT: Record<string, Placement> = {
  // Fundamentals
  'url-shortener': { group: 'fundamentals', prominence: 1, aliases: ['TinyURL', 'bit.ly', 'Link shortener'] },
  pastebin: { group: 'fundamentals', prominence: 2, aliases: ['Text sharing', 'GitHub Gist'] },
  'rate-limiter': { group: 'fundamentals', prominence: 1, aliases: ['Throttling', 'API rate limiting'] },
  autocomplete: { group: 'fundamentals', prominence: 1, aliases: ['Typeahead', 'Search suggestions'] },
  // Social
  'news-feed': { group: 'social', prominence: 1, aliases: ['Facebook News Feed', 'Twitter timeline', 'X timeline'], modelledOn: 'Facebook, Twitter/X' },
  'photo-sharing': { group: 'social', prominence: 1, aliases: ['Instagram', 'Photo feed'], modelledOn: 'Instagram' },
  chat: { group: 'social', prominence: 1, aliases: ['Messenger', 'WhatsApp', 'Slack'], modelledOn: 'WhatsApp, Messenger' },
  'notification-service': { group: 'social', prominence: 1, aliases: ['Push notifications', 'Email and SMS delivery'] },
  comments: { group: 'social', prominence: 2, aliases: ['Threaded comments', 'Discussion threads'] },
  'likes-counter': { group: 'social', prominence: 2, aliases: ['Reactions', 'Like counts', 'Distributed counter'] },
  'live-comments': { group: 'social', prominence: 2, aliases: ['Facebook Live comments', 'Live chat on streams'], modelledOn: 'Facebook Live' },
  'connection-degree': { group: 'social', prominence: 3, aliases: ['LinkedIn connections', 'Social graph', '2nd-degree connections'], modelledOn: 'LinkedIn' },
  'qa-forum': { group: 'social', prominence: 2, aliases: ['Reddit', 'Quora', 'Stack Overflow'], modelledOn: 'Reddit, Quora' },
  // Storage
  'file-storage': { group: 'storage', prominence: 1, aliases: ['Dropbox', 'Google Drive', 'File sync and sharing'], modelledOn: 'Dropbox, Google Drive' },
  'object-storage': { group: 'storage', prominence: 2, aliases: ['Amazon S3', 'Blob storage'], modelledOn: 'Amazon S3' },
  // Media
  'video-processing': { group: 'media', prominence: 2, aliases: ['YouTube uploads', 'Video transcoding'], modelledOn: 'YouTube' },
  'video-streaming': { group: 'media', prominence: 1, aliases: ['YouTube', 'Netflix', 'Video on demand'], modelledOn: 'YouTube, Netflix' },
  'image-hosting': { group: 'media', prominence: 2, aliases: ['Imgur', 'Image CDN'], modelledOn: 'Imgur' },
  'music-streaming': { group: 'media', prominence: 2, aliases: ['Spotify', 'Audio streaming'], modelledOn: 'Spotify' },
  'map-tiles': { group: 'media', prominence: 3, aliases: ['Google Maps', 'Map rendering'], modelledOn: 'Google Maps' },
  // Commerce
  'product-catalog': { group: 'commerce', prominence: 2, aliases: ['Amazon product pages', 'E-commerce browsing'] },
  'shopping-cart': { group: 'commerce', prominence: 2, aliases: ['Basket', 'Amazon cart'] },
  checkout: { group: 'commerce', prominence: 1, aliases: ['Order placement', 'Payments at checkout'] },
  inventory: { group: 'commerce', prominence: 2, aliases: ['Stock management', 'Flash sale'] },
  'payment-ledger': { group: 'commerce', prominence: 2, aliases: ['Ledger', 'Double-entry bookkeeping', 'Payment system'] },
  coupons: { group: 'commerce', prominence: 3, aliases: ['Discounts', 'Promotions'] },
  'price-tracker': { group: 'commerce', prominence: 3, aliases: ['Price alerts', 'CamelCamelCamel'] },
  'ticket-booking': { group: 'commerce', prominence: 1, aliases: ['Ticketmaster', 'Event tickets', 'BookMyShow'], modelledOn: 'Ticketmaster' },
  'hotel-booking': { group: 'commerce', prominence: 1, aliases: ['Airbnb', 'Booking.com', 'Reservations'], modelledOn: 'Airbnb' },
  auction: { group: 'commerce', prominence: 3, aliases: ['eBay bidding', 'Live auctions'] },
  'locker-reservations': { group: 'commerce', prominence: 3, aliases: ['Amazon Locker', 'Delivery lockers'], modelledOn: 'Amazon Locker' },
  // Infrastructure
  'api-gateway': { group: 'infrastructure', prominence: 2, aliases: ['Edge gateway', 'Reverse proxy'] },
  'distributed-cache': { group: 'infrastructure', prominence: 1, aliases: ['Memcached', 'Redis cluster', 'LRU cache'] },
  'search-engine': { group: 'infrastructure', prominence: 2, aliases: ['Google Search', 'Inverted index'] },
  'web-crawler': { group: 'infrastructure', prominence: 1, aliases: ['Spider', 'Crawler'] },
  cdn: { group: 'infrastructure', prominence: 2, aliases: ['Content delivery network', 'Cloudflare', 'Akamai'] },
  'secrets-manager': { group: 'infrastructure', prominence: 3, aliases: ['Azure Key Vault', 'AWS Secrets Manager', 'Vault'] },
  'feature-flags': { group: 'infrastructure', prominence: 3, aliases: ['LaunchDarkly', 'Remote config'] },
  'ota-updates': { group: 'infrastructure', prominence: 3, aliases: ['Firmware updates', 'Software rollout'] },
  webhooks: { group: 'infrastructure', prominence: 2, aliases: ['Event delivery', 'Callbacks'] },
  // Distributed systems
  'message-queue': { group: 'distributed', prominence: 1, aliases: ['Kafka', 'Pub/sub', 'Event log'], modelledOn: 'Apache Kafka' },
  'job-scheduler': { group: 'distributed', prominence: 2, aliases: ['Cron service', 'Task scheduler'] },
  'kv-store': { group: 'distributed', prominence: 1, aliases: ['DynamoDB', 'Cassandra', 'Key-value database'], modelledOn: 'Amazon Dynamo' },
  'distributed-lock': { group: 'distributed', prominence: 2, aliases: ['Chubby', 'ZooKeeper locks', 'Leader election'] },
  // Real-time
  'ride-booking': { group: 'realtime', prominence: 1, aliases: ['Uber', 'Lyft', 'Ride hailing'], modelledOn: 'Uber, Lyft' },
  'collaborative-editor': { group: 'realtime', prominence: 1, aliases: ['Google Docs', 'Real-time collaboration'], modelledOn: 'Google Docs' },
  leaderboard: { group: 'realtime', prominence: 2, aliases: ['Game leaderboard', 'Ranking'] },
  'online-game': { group: 'realtime', prominence: 3, aliases: ['Chess.com', 'Multiplayer game'] },
  proximity: { group: 'realtime', prominence: 1, aliases: ['Yelp', 'Nearby search', 'Find nearby friends'], modelledOn: 'Yelp' },
  'food-delivery': { group: 'realtime', prominence: 2, aliases: ['DoorDash', 'Uber Eats', 'Instacart'], modelledOn: 'DoorDash' },
  // Advanced
  'metrics-monitoring': { group: 'advanced', prominence: 2, aliases: ['Datadog', 'Prometheus', 'APM'] },
  'logging-platform': { group: 'advanced', prominence: 2, aliases: ['Log pipeline', 'ELK', 'Splunk'] },
  recommendations: { group: 'advanced', prominence: 2, aliases: ['Netflix recommendations', 'Personalisation'] },
  'ad-click-aggregation': { group: 'advanced', prominence: 2, aliases: ['Ad analytics', 'Click counting'] },
  'ab-testing': { group: 'advanced', prominence: 3, aliases: ['Experimentation', 'Feature experiments'] },
  'top-k': { group: 'advanced', prominence: 2, aliases: ['Trending topics', 'Top songs', 'Heavy hitters'] },
  'stock-exchange': { group: 'advanced', prominence: 3, aliases: ['Matching engine', 'Order book'] },
};

/** The bank: one question per interview definition, in curriculum order (editorial). */
export const BANK: BankQuestion[] = PROBLEMS.map(problem => {
  const placement = PLACEMENT[problem.id];
  if (!placement) throw new Error(`No catalog placement for ${problem.id}`);
  return { id: problem.id, definitionId: problem.id, title: problem.title, aliases: placement.aliases ?? [], summary: problem.summary, group: placement.group, difficulty: problem.difficulty, prominence: placement.prominence, ...(placement.modelledOn ? { modelledOn: placement.modelledOn } : {}), reports: REPORTS[problem.id] ?? [] };
});
export const bankQuestion = (id: string) => BANK.find(question => question.id === id);
export const evidenceOf = (question: BankQuestion): Evidence => !question.reports.length ? 'practice' : question.reports.some(report => report.sourceId) ? 'sourced' : 'reported';
export const placementIds = () => Object.keys(PLACEMENT);
