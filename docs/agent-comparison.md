# Personal-agent comparison

Research date: October 9, 2026. These are primary-source capabilities, not benchmark results. **Inference** identifies our assessment rather than a measured failure.

| Product | Documented strengths | Limits and tradeoffs |
| --- | --- | --- |
| Grok Bot | Persistent cloud computer, continuous agents, reusable context/routines, connected apps, end-to-end work and approvals. | Official docs describe automation blocks, expired sessions and human-only steps. **Inference:** shared computers require careful session coordination. |
| Meta Muse personal agent | Proactive goals, connected apps, isolated cloud execution, separate Sentinel authorization, credential substitution without agent-readable secrets. | **Inference:** cloud availability, connector coverage and policy determine task coverage. Published defenses do not prove prompt-injection immunity. |
| OpenAI Dots | Persistent responsibilities, background tasks, scheduled/event wakeups, saved memory, scoped context, private proactive research. | Official docs separate read-only research from consequential actions. Local work requires an online connected computer with the app open; completed runs do not prove success. |

Sources: [Grok Bot introduction](https://x.ai/news/introducing-grok-bot), [Grok Bot documentation](https://docs.x.ai/grok-bot/overview), [Muse security architecture](https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse), [Dots tasks and memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory).

## Codeclub implementation

We adopt persistent conversations, private suggestions, local engagement learning, explicit PC access, and native permission checks. Suggestions have no action tools. Background objectives retain separate execution controls. The sidebar shows actual state.

Codeclub does not provide an always-online cloud computer, secure VM per orb, Muse's Sentinel/credential-substitution architecture, or independently evaluated reliability. UAC elevates the entire application. Observation is metadata-only. The real online timing model does not train a foundation model or establish feature parity.

Evaluate durable context, relevance, truthful activity, permissions, cancellation and outcomes individually. Marketing capabilities do not establish measured success rates.
