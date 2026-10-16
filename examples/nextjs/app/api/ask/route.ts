import { askHandler } from '../../../lib/ask-handler';
import { withAskCounter } from '../../../lib/counters';

// A counter line for each question posted, from the site or a demo (lib/counters.ts).
const handler = withAskCounter(askHandler);

export const POST = handler;
// The CORS preflight from the live demos' dialogs: the handler answers it with a 204, and with
// CORS headers for their origins (`allowedOrigins` in lib/ask-handler.ts).
export const OPTIONS = handler;
