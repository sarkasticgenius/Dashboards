# HM Nexus public display dashboards

All six artifacts are public read-only displays, by owner request. No login or MFA is required. They refresh every 30 seconds from hm_public_dashboard, a database function callable with the public anon key. The HM Operations app, underlying table RLS, MFA and write permissions remain unchanged.

Displayed fields: asset names, venue names, coordinates rounded to 3 decimals (~100 m), connectivity, source timestamps, cellular usage, agent-reported problems and the signage alert signal. PC hostnames are shown only as a stable pseudonym ("Player 3F2A9C"). Maintenance-ticket titles, screen-report descriptions and campaign/playback data are not displayed. The site contains no privileged key. Upstream sync delays still apply.

To disable public data access later, revoke execute on public.hm_public_dashboard(text) from anon and authenticated, then restore authenticated frontend access.
