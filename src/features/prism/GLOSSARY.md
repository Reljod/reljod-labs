# Prism — Domain Glossary

Read this before naming anything in `src/features/prism/`.

- **Decision Model**: A non-generative evaluation model (`experimental_decide`, `outputTokens = 0`) that evaluates one shared state against multiple typed questions (`boolean`, `choice`, `score`) in a single forward pass and returns calibrated probabilities.
- **Slip**: A specimen piece of Meridian Bank paperwork, message, wire note, or custom visitor text fed into the Prism.
- **Refraction**: One single-forward-pass call to a Decision Model, splitting a Slip into simultaneous calibrated answers across a slate of questions.
- **Spectrum**: The probability distribution returned for a `choice` or `score` question, together with its normalized Shannon entropy (`0` = decisive, `1` = maximum uncertainty).
- **Gate**: A visitor-adjustable threshold rule (`autoClearMaxRisk`, `escalateMinRisk`, `maxUncertainty`, `adversarialTripwire`) that routes a Refraction into a Chute with zero additional model calls.
- **Chute**: The destination bay chosen by the Gates — `clear` (Auto-Clear), `review` (Human Officer Review), or `escalate` (Block & Deep Escalation).
- **Tribunal**: A parallel run of multiple Decision Models from different labs over the same Slip, racing live to measure latency and cross-model consensus (`unanimous`, `majority`, `split`).
- **Juror**: One Decision Model participating in a Tribunal.
- **Cascade**: A streamed batch of Slips running through the kinetic sorting machine, showing how Decision Models screen out routine volume for micro-cents before a generative LLM is ever invoked.
- **Lab**: The custom rubric workbench where a visitor defines their own `boolean`, `choice`, and `score` questions and tests any Decision Model live.
