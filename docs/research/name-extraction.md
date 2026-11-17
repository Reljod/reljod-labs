# Name extraction from long documents: research notes

Research behind ADR 0020 (one Analyst with tools). Written 2026-11-17. Domain words follow `src/features/name-extraction/GLOSSARY.md`.

What this covers: how to list every party named in a 10 to 500 page document with recall first, cheaply and fast, and which models to use on Vercel AI Gateway. Each claim is marked **established** (a peer-reviewed paper, a vendor's own docs, or a primary report we read), **reported** (a primary source we could only read in part, or a vendor blog with one worked example), or **our estimate** (not measured yet).

## 1. Why one long call is the wrong default

- **Long inputs are used unevenly.** Models recall information at the start and end of the context better than in the middle (Liu et al., "Lost in the Middle", TACL 2024, <https://arxiv.org/abs/2307.03172>). Established.
- **Performance falls as input grows, even on easy tasks.** Chroma tested 18 models and found that output becomes less reliable as input length grows, even on tasks as simple as repeating a word (Hong, Troynikov & Huber, "Context Rot", July 2025, <https://research.trychroma.com/context-rot>). Established as a primary report. Secondary write-ups overstate it as "every model got worse", so do not quote it that way.
- **Extraction specifically.** One information-extraction study found inconsistent results and a lost-in-the-middle effect when a document nearly fills the window (<https://arxiv.org/abs/2404.04068>). It measured redundancy, not recall, so it is indirect evidence. We found no paper that measures NER recall against position on 300k-token inputs. Our own Corpus with Answer keys is the right place to measure it.
- **Price tiers punish one big call too.** On the gateway, `anthropic/claude-haiku-5.5` costs 5 times as much above 100k input tokens. The OpenAI models double above 272k (see section 3). Established, from the gateway catalog.

The conclusion is to keep the page text in calls of about 10k to 20k tokens, and keep the deciding agent's context small.

## 2. Techniques and what is known about them

### 2.1 Treat the document as an environment (Recursive Language Models)

Zhang, Kraska & Khattab, "Recursive Language Models" (arXiv 2512.24601, v1 Dec 2025, v3 May 2026, <https://arxiv.org/abs/2512.24601>). The long prompt is a variable in a REPL. The model writes code to inspect and split it, and calls sub-models on the pieces. The abstract reports handling inputs about 100 times longer than the context window. With GPT-5, the median gain over the baselines across four long-context tasks is 26% over compaction, 130% over CodeAct with sub-calls and 13% over Claude Code, at comparable cost. A post-trained RLM-Qwen3-8B beats its base model by 28.3%. Established as a preprint by known authors. We did not check whether it has been peer reviewed. The tasks are long-context reasoning benchmarks, not NER. Whether the gains carry over to exhaustive extraction is our hypothesis, not a result.

What we take from it: the `run_code`, `grep` and `outline` tools, the pages kept on disk in the Sandbox, and Readers as the sub-model calls. One change: we cap recursion at depth 1 (the Analyst spawns Readers, and Readers spawn nothing). That keeps cost bounded and the trail easy to read.

### 2.2 Code mode and programmatic tool calling

- Anthropic, "Code execution with MCP" (Nov 2025, <https://www.anthropic.com/engineering/code-execution-with-mcp>). The agent calls tools from code, so intermediate data stays in the execution environment and only the results reach the model. One worked example went from 150k to 2k tokens. Reported (a single example, and the post says the sandbox has its own operational cost).
- Claude Platform "programmatic tool calling" (<https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling>): tools marked `allowed_callers` can be called from inside the code-execution container. This is Anthropic-only and needs Anthropic's hosted code tool. We go through the AI Gateway to several providers and run our own Vercel Sandbox, so we copy the pattern, not the API.
- Third-party benchmarks claim token cuts of 78% to 93% (e.g. <https://research.aimultiple.com/code-execution-with-mcp>). These are vendor or blog numbers. Do not cite them as facts.

What we take from it: the Analyst does counting, joins, alias clustering and "which pages have Sweep Candidates but no Reader names" in code. The context gets only the answer.

### 2.3 Sub-agents as a tool, not a fixed multi-agent pipeline

- Anthropic, "How we built our multi-agent research system" (Jun 2025, <https://www.anthropic.com/engineering/multi-agent-research-system>). Quotes we checked on the page: multi-agent systems "excel especially for breadth-first queries" and "valuable tasks that involve heavy parallelization". They use "about 15× more tokens than chats". They fit poorly in "domains that require all agents to share the same context". And "token usage by itself explains 80% of the variance" in their evaluation. Established.
- Cognition, "Don't Build Multi-Agents" (Walden Yan, Jun 2025, <https://cognition.ai/blog/dont-build-multi-agents>): parallel agents that each decide make scattered, conflicting choices. The follow-up "Multi-Agents: What's Actually Working" (Apr 2026, <https://cognition.com/blog/multi-agents-working>) reports that multi-agent works "when writes stay single-threaded": helpers add information, one agent writes, and "map-reduce-and-manage" is the shape that holds up. Established as practitioner reports, not controlled studies.
- Anthropic, "Building effective agents" (Dec 2024, <https://www.anthropic.com/engineering/building-effective-agents>) distinguishes fixed workflows from agents that direct themselves, and recommends the simplest shape that works. A fixed chunk-extract-merge workflow is the right baseline to beat, and the Corpus should score it.

What we take from it: Readers are a map over page ranges. They are stateless, they return Candidates with quotes, and they never write. The Analyst is the only writer (`record_names`). This matches both the Anthropic breadth-first case and Cognition's single-writer rule.

### 2.4 Skills (progressive disclosure)

Anthropic, "Equipping agents for the real world with Agent Skills" (Oct 2025, <https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills>): only a Skill's name and one-line description sit in context until the agent loads it. Established as a design pattern. Token figures quoted by third parties (around 50, 500 and 2,000 tokens per level) are not from Anthropic's text.

What we take from it: `load_skill` with five Skills (`long-document-triage`, `aml-name-patterns`, `alias-resolution`, `recall-audit`, `sandbox-coding`). Keep each under about 1.5k tokens, and put worked examples in the Skill, not the system prompt.

### 2.5 Deterministic candidates plus LLM verification

This is standard practice in high-recall IE: candidate generation tuned for recall, then a precise filter. No single 2026 paper owns it. Our design: the Sweep (regex and heuristics, no model) proposes Candidates, and every one must be recorded or dismissed with a reason (the Done gate). Models add what patterns miss: names in prose, lower-case names, names split across lines. Known blind spots of a regex Sweep: names in all lower case, single-token names ("Ferreira said"), names inside handles, and names transliterated without capitals. The Readers and the `includeHandles` rule cover these.

LangExtract (Google, <https://github.com/google/langextract>) runs several independent `extraction_passes` over chunks of about 1,000 characters to raise recall, and its README sets `extraction_passes=3`. That is established as the library's documented behaviour. Third-party write-ups disagree on how it merges passes. A blanket triple pass triples Reader cost. We prefer a targeted second pass (2.8).

### 2.6 Small NER models (GLiNER and friends)

- GLiNER (Zaratiana et al., NAACL 2024, <https://aclanthology.org/2024.naacl-long.300>, arXiv 2311.08526): a small bidirectional encoder for zero-shot NER over any label set, beating ChatGPT zero-shot on the benchmarks reported. Established.
- UniversalNER (Zhou et al., ICLR 2024, <https://arxiv.org/abs/2308.03279>): ChatGPT distilled into 7B and 13B open NER models, reported 7 to 9 F1 above ChatGPT. Established.

Fit for us: a GLiNER model would be a strong second Sweep, cheap per page and with no paid model calls. But the Sandbox has no network, so the weights (hundreds of MB) would have to be baked into a Sandbox snapshot. CPU inference over 300k tokens would take minutes, which is our estimate and unmeasured. **Speculative for v1. Worth a spike** once the Corpus scores show what the Sweep misses.

### 2.7 Alias, transliteration and name matching

- OFAC Sanctions List Search uses fuzzy logic on the name field only, combining Jaro-Winkler (string distance) and Soundex (phonetic), plus a third algorithm added in 2021 (OFAC FAQs, <https://ofac.treasury.gov/faqs/topic/1636>). Established.
- OpenSanctions, "How we reverse-engineered OFAC's sanctions screening algorithm" (1 Jul 2026, <https://www.opensanctions.org/articles/2026-07-01-ofac-matcher/>): OFAC's scores match a Jaro-Winkler variant that always applies the prefix bonus (skipping the usual Jaro > 0.7 check), at about 96% agreement. Established as a primary report. Thresholds (0.82, 0.88 and the like) quoted by screening vendors are unverified.
- Token-set matching for reordered names ("Bank of X" and "X Bank"), and initials expansion, are common practice (vendor guidance, unverified as a standard).

What we take from it: the `alias-resolution` Skill clusters in code first, using diacritics folding, transliteration keys, token-set comparison, initials and Jaro-Winkler with the OFAC-style prefix bonus. It asks a model only about ambiguous clusters. Aliases are kept on the Name, never dropped, because a screening system downstream matches on every form.

### 2.8 Recall audit (find what was missed)

Our design, not a published method: after the first pass, the Analyst runs code to find the pages where (a) the Sweep's Candidate density is high but Readers returned few Names, (b) a Reader errored or hit its output cap, or (c) a Name appears in the text (by `grep`) on pages its mentions do not list. Only those pages get a second Reader, with optional cross-family use (Haiku first, GPT-6 Luna second, or the other way round). Different model families make different mistakes, which is the reasoning Cognition gives for cross-frontier routing. That reasoning is reported, not measured for NER. A second family over the flagged pages costs cents (section 4).

### 2.9 Prompt caching for parallel map calls

- AI Gateway supports `providerOptions.gateway.caching: 'auto'`, which adds the provider's cache markers where they are needed (Anthropic, MiniMax). It also supports `cache_ttl: '1h'` on Anthropic and an `x-session-affinity` header that is forwarded to the provider (<https://vercel.com/docs/ai-gateway/models-and-providers/automatic-caching>). Established.
- The catalog tags `anthropic/*` as `explicit-caching` (`supports_implicit_caching: false`, so caching only happens when asked). `openai/*` is tagged implicit and explicit, and `google/*` and `zai/*` implicit. Established.
- Order every Reader prompt as: fixed instructions, then the Rulebook version, then the output schema, then the pages. The shared prefix is then cached once and read by every parallel Reader, and on Anthropic a cache read costs 10% of input. Caveats: Anthropic has a minimum cacheable prefix length, and we did not verify Haiku 5.5's. Parallel calls fired at the same moment may all miss the cache. Send one Reader first, then the rest (our estimate, cheap to test).
- The Analyst's context is a growing conversation, so its prefix is cached turn to turn. In the cost model this is the largest single saving (about 3 times on Analyst input).

### 2.10 Evaluation (recall first)

- The headline is **recall over distinct Names** (Answer key Names matched by canonical form or any alias). Also report **mention recall** (pages per Name), precision, cost, time and the missed list. `Score` in `contract.ts` already carries recall, precision and missed.
- If one number is needed for ranking settings, use F2, which weights recall four times as much as precision. That is a choice, not a standard.
- Match leniently and say how: case and diacritics folded, the gold canonical form or any gold alias counts. Report strict canonical matching too, so alias folding cannot hide misses.
- Tune on train and validation, and report test only. Break results down by genre (ledger, judgment, KYC file) and by where the name appears (table, signature block, SWIFT field, prose, split across a page).

## 3. Models on Vercel AI Gateway (checked 2026-11-17)

Checked with the Vercel MCP `list_ai_gateway_models` and `get_ai_gateway_model`. Prices are USD per million tokens at the global rate. US, EU, AU and JP regional routing costs about 10% more.

| Id (all exist) | Context | Input | Output | Cache read | Cache write | Tier above | Caching |
|---|---|---|---|---|---|---|---|
| `anthropic/claude-sonnet-5.5` | 1M | 2.00 | 10.00 | 0.10 | 2.50 | none | explicit |
| `openai/gpt-6.1-terra` | 1.05M | 1.00 | 5.00 | 0.05 | 1.25 | 272k: 2.00 / 7.50 | implicit + explicit |
| `anthropic/claude-haiku-5.5` | 1M | 0.10 | 0.50 | 0.01 | 0.125 | 100k: 0.50 / 2.50 | explicit only |
| `openai/gpt-6-luna` | 1.05M | 0.10 | 0.50 | 0.01 | 0.125 | 272k: 0.20 / 0.75 | implicit + explicit |
| `google/gemini-3.8-flash` | 1M | 0.75 | 3.75 | 0.075 | n/a | none | implicit |
| `zai/glm-5.3-flash` | 1M | 0.15 | 0.50 | 0.03 | n/a | none (varies by provider) | implicit |

The list prices in `MODELS` in `contract.ts` match the catalog for all six ids. Gaps:

- `estimateCost` ignores cached input (billed at 5% to 10%) and the price tiers. It will overstate the Analyst's cost by about 3 times, and understate a Reader call above 100k on Haiku by 5 times. Add `cacheRead` (and optionally `tierAbove`) to each `MODELS` entry and pass `cachedInputTokens` (already on the `cost` event).
- Optional additions, not required: `openai/gpt-6.1-sol` (2 / 10, cache 0.10) as a peer of Sonnet for the Analyst; `google/gemini-3.5-flash-lite` (0.30 / 2.50) and `zai/glm-5.3-flashx` (0.37 / 1.25) as Reader alternatives. Note that `gpt-6.1-luna` does **not** exist. The cheap OpenAI model is `openai/gpt-6-luna`.
- Live provider health on the day: `gpt-6.1-terra` showed 52% (Azure) and 22% (Bedrock) uptime in the last hour, against 99% on OpenAI direct. Set a gateway provider order or a fallback model for the Analyst, and treat a failed Analyst step as retryable in the workflow.
- Observed latency and throughput (last hour, p50): Haiku 5.5 645 to 1,610 ms to first token, 230 to 270 tok/s. GPT-6 Luna 773 ms on OpenAI (2.9 to 3.5 s on Azure and Bedrock), 100 to 177 tok/s. Haiku is the faster Reader.

**Recommendations**

- **Analyst: `openai/gpt-6.1-terra`** (keep the default). It is the cheapest strong tool user with reasoning effort control, and its 5% cache-read price suits a long multi-turn loop. Use reasoning effort `low` or `medium`. **Upgrade option: `anthropic/claude-sonnet-5.5`**, about twice the cost. Set `caching: 'auto'`, because Anthropic will not cache without it.
- **Reader: `anthropic/claude-haiku-5.5`** (keep the default). It costs $0.10 / $0.50, is the fastest of the cheap models, and has a 1M context, but **keep each call under 100k input tokens**. Use reasoning effort `none` or `low` and `caching: 'auto'`. **Second-family Reader for the recall audit: `openai/gpt-6-luna`**, at the same price, with implicit caching and its tier at 272k.
- Gemini 3.8 Flash is about 7.5 times Haiku's price as a Reader. Keep it as a choice, not a default. GLM 5.3 Flash is as cheap but slower and its price varies by provider. It suits the Ledger demo's default, not this one.

## 4. Cost model

Assumptions (all **our estimates**, to be replaced by measured Corpus runs):

- 600 tokens per page. 100 pages is 60k tokens and 500 pages is 300k.
- Readers take 20 pages each with one page of overlap on each side (+10% page tokens). The cached prefix is 2k tokens per call. Output is about 120 tokens per page (JSON Candidates with verbatim quotes), with reasoning off.
- The recall audit re-reads 15% of pages with a second Reader.
- The Sweep, code and the Sandbox cost no model tokens. Sandbox compute is not counted here.
- Analyst: 100 pages takes 25 turns with an average context of 20k (500k input tokens over the Run) and 20k output including reasoning. 500 pages takes 40 turns with an average context of 40k (1.6M input) and 40k output. About 90% of Analyst input is a cache hit.

| | 100 pages | 500 pages |
|---|---|---|
| Reader tokens (input / output) | ~75k / ~14k | ~375k / ~75k |
| Reader cost, Haiku 5.5 | ~$0.015 | ~$0.075 |
| Analyst cost, GPT-6.1 Terra, cached | ~$0.17 | ~$0.43 |
| **Total, recommended defaults** | **~$0.19** | **~$0.51** |
| Analyst cost, Sonnet 5.5, cached | ~$0.37 | ~$0.94 |
| Total with Sonnet as Analyst | ~$0.39 | ~$1.02 |
| Analyst cost, Terra, no caching | ~$0.60 | ~$1.80 |
| Add a full second-family pass (GPT-6 Luna over every page) | +$0.013 | +$0.07 |
| Baseline: one Terra call over the whole Document | ~$0.13 | ~$1.16 (above 272k, at the higher tier) |

Readings:

- The Analyst, not the page reading, is 80% to 90% of the cost. The levers are Analyst caching, fewer turns (do work in code, record Names in batches) and short tool outputs (summaries and counts, not lists of 2,000 Candidates). The Readers are cheap enough that a cross-family second pass over every page costs a few cents. If the Corpus shows it raises recall, it is worth turning on.
- The one-call baseline is not much cheaper at 100 pages and is more expensive at 500. It also has no Done gate and is exposed to the long-context recall losses in section 1.
- Time (our estimate): 25 Readers in parallel finish in about 10 to 20 s. Analyst turns at 3 to 6 s each put a run at 2 to 4 min for 500 pages. Reader concurrency per Run should be capped (e.g. 10) to stay within gateway rate limits.

## 5. Recommendations, in order

1. **Sweep plus Done gate first.** Build the deterministic Sweep and the harness check that every page is covered and every Candidate is recorded or dismissed. This is the recall floor and costs nothing per Run. Measure Sweep recall alone on the Corpus. It is the number every model step must beat.
2. **Readers as a cached, bounded map.** Pages of 20 with one page of overlap, under 100k input tokens per call, prefix first and pages last, `caching: 'auto'`, reasoning off, verbatim quotes required. Drop any Candidate whose quote is not on its page, which is a code check.
3. **The Analyst works in code.** `run_code` over the pages on disk for counting, `grep` cross-checks, Candidate triage and alias clustering. Only summaries return to context. Batch `record_names`. Cap turns and cost per Run.
4. **Targeted recall audit with a second model family.** Re-read the pages flagged by code (Sweep-dense but Reader-sparse, Reader errors, grep hits outside the recorded mentions) with `openai/gpt-6-luna` when the first Reader was Haiku. Measure whether a full second-family pass is worth its few cents.
5. **Alias resolution in code, the model only for doubt.** Folding, transliteration keys, token-set comparison, initials, and Jaro-Winkler with the OFAC-style prefix bonus, then a model call only for ambiguous clusters. Keep every alias.

Later, if the Corpus shows the need: a GLiNER second Sweep baked into a Sandbox snapshot (2.6), and Anthropic batch pricing (`-batch` ids, half price) for Runs that are not interactive.

## What we could not verify

- Whether RLM-style gains carry over to exhaustive NER (no study found).
- Haiku 5.5's minimum cacheable prefix, and whether its 100k tier bills the whole call or only the excess (we assumed the whole call).
- The vendor figures on code-mode token savings and on sanctions-matching thresholds.
- Whether the AI Gateway reports the charged cost per call, which `estimateCost`'s comment assumes it sometimes does not. Check `providerMetadata.gateway` in a live response before relying on the estimate.
