// Only Syntony hosts use the Syntony sign-in service. Forks must configure their own.
const host=globalThis.location?.hostname;
export const ARENA_API_URL=['www.syntonyresearch.ai','syntonyresearch.ai'].includes(host)
  ? 'https://syntony-close-the-loop.nathanheath92.chatgpt.site/api' : '';
