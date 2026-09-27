// OpenNext adapter config for Cloudflare Workers (docs/DECISIONS.md D1: the web app is hosted on Cloudflare).
// No incremental cache binding: every page is either static or reads live data at request time.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
