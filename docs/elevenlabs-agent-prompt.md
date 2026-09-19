# ElevenLabs adaptive check-in agent

The voice agent is configured in the ElevenLabs dashboard. The frontend uses
the saved agent prompt directly and does not send runtime prompt overrides,
which keeps the widget compatible with ElevenLabs' default security settings.

## Required one-time dashboard setup

For agent `agent_1201m2wz6ap4e3yrmdy4cfbgn5pm`:

1. Open the agent in the ElevenLabs dashboard.
2. Put the adaptive instructions from `frontend/src/lib/voiceAgent.js` into
   the agent's normal system prompt.
3. Set the normal **First message** to:

   > Hi, I'm the NeuroTriage AI check-in assistant. You've already completed
   > the short questionnaire, so I won't repeat it. In your own words, what has
   > felt most noticeable about your health or energy today?

4. Save and publish the agent.
5. Recommended: enable the **Focus** guardrail so the agent stays within the
   check-in and safety boundaries.

Leave the prompt and first-message conversation overrides disabled. The
frontend sends neither field, so ElevenLabs will not reject the conversation.

Official references:

- [ElevenLabs overrides](https://elevenlabs.io/docs/eleven-agents/customization/personalization/overrides)
- [Widget runtime configuration](https://elevenlabs.io/docs/eleven-agents/customization/widget)
- [Prompting guide](https://elevenlabs.io/docs/eleven-agents/best-practices/prompting-guide)

## Adaptive prompt behavior

The prompt template in `frontend/src/lib/voiceAgent.js` is a reference for the
agent's dashboard prompt. It:

- summarizes only answers the patient actually supplied;
- picks the most relevant concern for the opening message;
- tells the agent not to repeat the completed questionnaire;
- requires one question at a time and short, natural spoken turns;
- explores onset, change from baseline, severity, pattern, and daily impact
  only when relevant;
- follows new concerns introduced during the conversation;
- asks for a natural narrative when answers are too short for a useful voice
  sample;
- ends after enough useful context instead of extending the conversation;
- identifies itself as an AI check-in assistant and does not diagnose or
  pretend to be a doctor; and
- gives explicit emergency escalation instructions for acute warning signs.

## Testing the behavior

Use several different questionnaire paths rather than testing only one script:

1. Poor sleep plus fatigue: it should begin with sleep/daytime impact.
2. Pain: it should acknowledge pain and adapt to the location, onset, pattern,
   and functional effect described aloud.
3. Concentration change: it should ask for a concrete example and whether the
   change is new or worsening.
4. No selected concern: it should use a broad question about health or energy,
   not invent a problem.
5. A new concern introduced aloud: it should follow that concern rather than
   returning immediately to its original path.
6. An emergency warning sign: it should stop the routine interview and direct
   immediate emergency action.

Review the resulting ElevenLabs transcripts for repetition, multi-question
turns, unsupported medical claims, and conversations that end too early or run
too long.
