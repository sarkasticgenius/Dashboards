# HM Nexus — authenticated operational dashboards

Public website: https://sarkasticgenius.github.io/Dashboards/

All five original HTML links remain supported. Sign in with an existing HM Operations username/email and password; verified MFA factors require a code. No new accounts or permissions are created. Data is fetched directly from the same Supabase project as HM Operations under the signed-in user's database policies. The repository contains only website code, public client configuration, and the supplied logo, never operational records or vendor credentials.

## Data mapping

| View | App source | Meaning |
| --- | --- | --- |
| Command Center | locations and location_sub_assets | Broadsign/Grassfish mapped player connectivity; combined location wrappers excluded |
| Command Center map | asset_inventory lat/lng and exact player_box_id matches | All assets with valid coordinates; status from IoT snapshots, fresh offline sync records, or matching Digital Directory heartbeat |
| Retail Media | projected app_settings.iotApi telemetry | IoT devices by venue, with excluded IDs omitted; all accessible IoT venues, filter to retail venues |
| Player Intelligence | workspace_devices | Agent heartbeat and recorded cellular usage; invalid/missing allowances are unavailable |
| Live Wall | projected app_settings.iotApi telemetry | Fleet connectivity, platform, and analytics state at source sync |
| Black Screen Intelligence | workspace_devices problems | Agent reports that signage is not running/not visible; not image confidence or black-pixel analysis |

The browser refreshes every 30 seconds, and when brought back into view. This is near-real-time polling, not a guarantee of 30-second upstream updates. Vendor sync and agent schedules remain controlled by HM Operations. Source ages are shown. No fabricated history or fallback demo records are displayed. Failed requests clear the corresponding displayed snapshot.

## Access

- Command Center: Locations or Maintenance Panels view permission.
- Map coordinates: Asset Inventory view permission. Agent status requires Digital Directory view permission.
- Player and black-screen views: Digital Directory view permission.
- IoT: administrator account under the app's existing app_settings RLS. No policies are loosened.
- Black-screen fleet suppression is applied when its setting is accessible; otherwise the page explicitly reports that only per-device suppression was available.

GitHub Pages has a different browser origin from the main HM app, so an existing app login does not automatically transfer. The dashboard stores its own authenticated session. Sign out when a shared display should stop showing data.

## Map

Green and red dots pulse for online/offline. Grey means unknown or stale source. Same-coordinate assets share a dot and are listed individually in its popup; a group is red if any member is offline, grey if a member is unknown, otherwise green. Missing/out-of-range coordinates are counted and skipped. No geocoding or invented positions are used. Exact device identifiers are required; the absence of an offline record is not treated as proof of online status. Agent offline means no heartbeat within 30 minutes. Tiles are OpenStreetMap, displayed with attribution through Leaflet 1.9.4.

## Screen playback / domain

Append `?display=wall&rotate=1#wall` for rotation every 20 seconds after sign-in. Set a custom domain in GitHub Pages settings and configure DNS later. API keys with service-role access must never be added to this site. The only key in config.js is the app's public anon client key; RLS protects the data.

## Validation

Local tests cover coordinate validation, exact-ID status matching, stale IoT snapshots, invalid usage readings, HTML escaping, suppressed alerts, combined-location/deduplication calculations, signed-out access, and MFA errors failing closed. Live unauthenticated schema requests returned no rows for all four data tables. End-to-end authenticated data verification requires the user's HM login.

Supabase JS 2.110.9 is vendored with its MIT license in SUPABASE-LICENSE. Leaflet is loaded from the version-pinned distribution with integrity checks.
