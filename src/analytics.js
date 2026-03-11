import { init, track } from 'https://esm.sh/@plausible-analytics/tracker@0.4.4';
import config from './parserConfig.json' with { type: 'json' };

const DOMAIN = config.analytics?.domain ?? '';

/** Initialise the Plausible tracker. Called once on startup. */
export function initAnalytics() {
  try {
    init({ domain: DOMAIN, autoCapturePageviews: false });
  } catch (e) {
    // Silently ignore — should never happen outside of a double-init scenario
  }
}

/**
 * Track a virtual page view for a given path.
 * @param {string} page  e.g. 'items', 'trading/traders', 'scenarios'
 */
export function trackPageView(page) {
  try {
    track('pageview', { url: `https://${DOMAIN}/${page}` });
  } catch (e) { /* ignore */ }
}

/**
 * Track a custom event.
 * @param {string} name    Event name, e.g. 'Scenario Download'
 * @param {object} [props] Optional event properties
 */
export function trackEvent(name, props) {
  try {
    track(name, props ? { props } : undefined);
  } catch (e) { /* ignore */ }
}

/**
 * Enable or disable analytics by setting the standard Plausible opt-out flag.
 * The tracker checks `localStorage.plausible_ignore` on every event.
 * @param {boolean} enabled
 */
export function setAnalyticsEnabled(enabled) {
  try {
    if (enabled) {
      localStorage.removeItem('plausible_ignore');
    } else {
      localStorage.setItem('plausible_ignore', 'true');
    }
  } catch (e) { /* ignore */ }
}
