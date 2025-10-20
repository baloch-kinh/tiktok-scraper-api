const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

module.exports = async function scrape(username) {
  const url = `https://www.tiktok.com/@${username}`;
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/115.0.0.0 Safari/537.36");

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const data = await page.evaluate(() => {
      const el = document.querySelector('script#SIGI_STATE');
      return el?.innerText || null;
    });

    if (!data) throw new Error("TikTok blocked access or profile doesn't exist");

    const json = JSON.parse(data);
    const user = json?.UserModule?.users?.[username];
    const stats = json?.UserModule?.stats?.[username];

    if (!user || !stats) throw new Error("Invalid username or data missing");

    return {
      username,
      name: user.nickname,
      avatar: user.avatarLarger,
      followers: stats.followerCount,
      following: stats.followingCount,
      likes: stats.heartCount,
      bio: user.signature
    };
  } catch (err) {
    throw err;
  } finally {
    await browser.close();
  }
};
