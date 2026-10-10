import {validateRun} from './engine.js';

// Stored game state is untrusted input, including when another same-origin page
// or an older release wrote it. Never render the raw storage object.
export function readSavedState(raw, operators) {
  const fallback = {mode:'game', modelId:operators[0]};
  const rejected = [];
  if (raw == null || raw === '') return {saved:fallback, rejected};
  if (typeof raw !== 'string' || raw.length > 2_000_000) return {saved:fallback, rejected:['storage']};
  let input;
  try { input = JSON.parse(raw); } catch { return {saved:fallback, rejected:['storage']}; }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {saved:fallback, rejected:['storage']};
  const saved = {...fallback, modelId:operators.includes(input.modelId) ? input.modelId : fallback.modelId};
  for (const campaignId of ['atlas','prism']) {
    if (!Object.hasOwn(input, campaignId)) continue;
    try {
      const record = input[campaignId];
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid save record');
      const run = validateRun(record.run);
      if (run.campaignId !== campaignId) throw new Error('Mismatched campaign');
      saved[campaignId] = {run, modelId:operators.includes(record.modelId) ? record.modelId : saved.modelId};
    } catch { rejected.push(campaignId); }
  }
  return {saved, rejected};
}
