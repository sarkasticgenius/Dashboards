# HM Nexus public display dashboards

All seven artifacts are public read-only displays, by owner request. No login or MFA is required. They refresh every 30 seconds from hm_public_dashboard, a narrowly projected database function. The HM Operations app, underlying table RLS, MFA and write permissions remain unchanged.

Published fields include asset/device names, venue names, exact coordinates, connectivity, source timestamps, cellular usage, and the signage alert signal shown on these artifacts. The function does not expose credentials, accounts, remote access fields or arbitrary notes. The site contains no privileged key. Upstream sync delays still apply.

To disable public data access later, revoke execute on public.hm_public_dashboard(text) from anon and authenticated, then restore authenticated frontend access.
