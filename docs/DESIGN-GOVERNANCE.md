# Ngombe Herdbook design governance

## Product character

Ngombe Herdbook should feel like a dependable working farm ledger: direct, calm,
legible outdoors and recognisably agricultural. Real task language and farm imagery
take priority over decorative technology motifs.

## Interface rules

- Keep the existing green agricultural palette and system font stack. Do not add a
  web-font dependency without measured readability and loading evidence.
- Use cards for functional grouping, touch targets and forms, not as the default
  treatment for every paragraph.
- Prefer rules, spacing and hierarchy over nested cards, translucent panels, glow,
  gradient text or decorative badges.
- Use gradients only when they improve image contrast or operational hierarchy.
  Purple gradients and decorative text gradients are outside the product language.
- Replace emoji gradually with one coherent, accessible icon set. Navigation or
  workflow icon changes require their own visual and accessibility regression.
- Preserve real farm photography where provenance and usage rights are recorded.
- Do not display invented testimonials, partner logos, certifications or production
  claims. Each requires written evidence or permission before publication.
- Motion must explain state or feedback, respect reduced-motion preferences and
  never imitate activity with an ornamental pulsing indicator.
- Test signed-out and authenticated layouts at desktop and narrow mobile widths.

## End-of-build documentation set

The release is not documentation-complete until these six reviewed documents exist:

1. Product requirements: users, problems, scope, acceptance criteria and exclusions.
2. Technical requirements: architecture, security, offline behavior, quality gates
   and supported environments.
3. Design brief: visual principles, content voice, responsive behavior, accessibility
   and asset provenance.
4. Backend schema: tables, relationships, ownership, RLS, migration state and data
   retention boundaries.
5. Implementation plan: released work, remaining phases, dependencies, gates and
   rollback approach.
6. App flow: signed-out, authentication, navigation, recording, review, recovery and
   failure-state paths.

These documents must describe verified behavior at the time they are finalized;
planned behavior must be labelled as planned rather than implemented.
