import { askHandler } from '../../../lib/ask-handler';
import { withDemoCors } from './cors';

const handler = withDemoCors(askHandler);

export const POST = handler;
// The CORS preflight from the live demos' dialogs; the handler answers it with a 204.
export const OPTIONS = handler;
