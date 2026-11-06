# Third-party notices for the Agent foundation

Added on 2026-10-18. Versions are pinned in package-lock.json. These are runtime dependencies, not hosted memory or tracing services. Existing dependency notices remain in their distributions.

- `@langchain/langgraph` 1.5.1 — MIT; [license](docs/licenses/langchain-langgraph-LICENSE.txt). Upstream: git+ssh://git@github.com/langchain-ai/langgraphjs.git

- `@langchain/core` 1.2.18 — MIT; [license](docs/licenses/langchain-core-LICENSE.txt). Upstream: git@github.com:langchain-ai/langchainjs.git

- `@langchain/langgraph-checkpoint` 1.2.0 — MIT; [license](docs/licenses/langchain-langgraph-checkpoint-LICENSE.txt). Upstream: git+ssh://git@github.com/langchain-ai/langgraphjs.git

- `zod` 4.6.7 — MIT; [license](docs/licenses/zod-LICENSE.txt). Upstream: git+https://github.com/colinhacks/zod.git

LangGraph public APIs provide the graph runtime and checkpoint serialization contract. Application authorization, memory lifecycle, source constraints and the Node SQLite saver implementation are maintained here. Official product documentation is linked and narrowly paraphrased; manufacturer manuals are not relicensed as MIT.
