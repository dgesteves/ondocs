import { askHandler } from '../../../lib/ask-handler';
import { withAskCounter } from '../../../lib/counters';
import { withDemoCors } from './cors';

// A counter line for each question posted, from the site or a demo (lib/counters.ts).
const handler = withDemoCors(withAskCounter(askHandler));

export const POST = handler;
// The CORS preflight from the live demos' dialogs; the handler answers it with a 204.
export const OPTIONS = handler;
