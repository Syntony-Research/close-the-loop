// Hosted inference is enabled only after the service is verified and published.
const host = globalThis.location?.hostname;
export const ARENA_API_URL = ['localhost', '127.0.0.1'].includes(host)
  ? 'http://127.0.0.1:8768/api'
  : ['www.syntonyresearch.ai', 'syntonyresearch.ai'].includes(host)
    ? 'https://syntony-close-the-loop.nathanheath92.chatgpt.site/api'
    : ''; // Fork operators must connect their own hosted service.
