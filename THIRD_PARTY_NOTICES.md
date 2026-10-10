# Third-party services and model references

This kit distributes no model weights or browser inference runtime. Live generation uses the operator's configured hosted services; visitors receive application assets and results. Names below identify integration targets and recommended deployments, not evidence that every target has been provisioned, tested, or endorsed by its publisher.

## OpenAI

The OpenAI adapter uses the Responses API with a server-held key. The initial selection is `gpt-5.6-terra`; the configured deployment must have access to the actual selected model. This kit grants no license to OpenAI model weights. API use is governed by the operator's applicable OpenAI agreement and service terms.

- [OpenAI text generation documentation](https://developers.openai.com/api/docs/guides/text)
- [OpenAI Services Agreement](https://openai.com/policies/services-agreement/)
- [OpenAI Service Terms](https://openai.com/policies/service-terms/)
- [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)

## Microsoft Phi

Hosted Phi integration uses Microsoft Foundry, subject to the operator's subscription, region, and capacity. `Phi-4` and `Phi-4-mini-instruct` are Microsoft models with upstream **MIT License** notices, copyright Microsoft Corporation. The hosted provider's service terms also apply. Always inspect the actual connected model; a family label does not identify the deployment version.

- [Official model card](https://huggingface.co/microsoft/Phi-4-mini-instruct)
- [Phi-4 model card and license](https://huggingface.co/microsoft/phi-4)
- [Official model license](https://huggingface.co/microsoft/Phi-4-mini-instruct/blob/main/LICENSE)
- [Foundry deployment guide](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/create-model-deployments)

If you separately distribute model files, preserve the applicable copyright and license notices. This kit does not do so.

## Meta Llama

**Built with Llama** applies to the optional configured Llama integration. A disabled target does not generate Llama results.

Recommended hosted candidate: `Llama-4-Maverick-17B-128E-Instruct-FP8`, published by Meta. The upstream model uses the **Llama 4 Community License**, with its incorporated acceptable-use policy. It is not licensed under MIT or Apache 2.0. Provider access terms also apply.

- [Official model card](https://huggingface.co/meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8)
- [Official Llama 4 Community License](https://huggingface.co/meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8/blob/main/LICENSE)
- [Llama 4 acceptable-use policy](https://www.llama.com/llama4/use-policy)
- [Azure-hosted model catalog](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure)

When making a Llama-backed service available, retain the license's required “Built with Llama” attribution in an appropriate prominent location and follow the applicable license. If you later distribute model copies, include the required license and notices with them.

## Additional optional families

The catalog also offers explicit connection slots for Anthropic Claude, Mistral, Alibaba Qwen, and Google Gemini Flash. A disconnected slot neither calls a provider nor downloads model files. The operator must connect and verify an actual supported endpoint before enabling it.

Claude uses Anthropic's hosted-service terms. Microsoft Foundry deployments also depend on subscription eligibility, model access, and available quota. [Claude documentation](https://docs.anthropic.com/en/docs/intro-to-claude), [Foundry Claude quota](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/claude-models-quotas-limits).

Mistral models have model-specific licenses and hosted-service terms. Syntony's connected deployment uses Mistral Medium 3.5. Consult the selected model's official terms before distributing any model files. [Mistral inference](https://docs.mistral.ai/inference).

Qwen model licenses and capabilities vary by release. Record the exact model and host rather than assigning a license to the whole family. [Qwen's official project](https://qwenlm.github.io/).

Gemini Flash uses Google's hosted Gemini API and its applicable terms. The server holds the API key and fixes the model and destination. This integration does not distribute Google model weights. [Gemini API documentation](https://ai.google.dev/gemini-api/docs), [Gemini API terms](https://ai.google.dev/gemini-api/terms).

This code license does not license third-party models or services. This kit distributes no weights from any model family.

## Deployment and identity

A model publisher and its inference host may be different organizations. Record the actual provider, model/deployment, version when available, and endpoint configuration used for each target. Model-family names are not government approval, data-residency commitments, benchmark results, or endorsement of Syntony.

Syntony's name, identity, and existing brand assets remain Syntony's property. Procedural challenge graphics and application code are part of this kit; model and service terms do not grant rights to Syntony's marks or imply endorsement by OpenAI, Microsoft, Meta, Cloudflare, or GitHub. Consult the containing repository's license for challenge code distribution terms.
