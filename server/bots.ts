// Crawlers that fetch HTML show up in a server log, unlike with a script tracker,
// so this list matters. Anything without a user agent counts as a bot too.
const BOT =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|preview|facebookexternalhit|embedly|monitor|uptime|curl|wget|python|node-fetch|axios|go-http|java\/|httpclient|okhttp|phantom|selenium|puppeteer|playwright|scrapy|dataprovider|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|anthropic|openai|perplexity|applebot|yandex|baidu|duckduck|bingpreview|linkedinbot|twitterbot|slackbot|discordbot|telegrambot|whatsapp|skypeuripreview|railway/i;

export function isBot(userAgent: string): boolean {
  return userAgent === "" || BOT.test(userAgent);
}

export type Device = "mobile" | "tablet" | "desktop";

export function deviceOf(userAgent: string): Device {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(userAgent)) return "tablet";
  if (/mobi|iphone|android/i.test(userAgent)) return "mobile";
  return "desktop";
}
