const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => { 
  res.sendFile(path.join(__dirname, 'index.html')); 
}); 

async function getTikTokData(username) {
  const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-zygote',
    '--single-process'
  ],
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
});

  try {
    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    await page.goto(`https://www.tiktok.com/@${username}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Try SIGI_STATE first (VIP fast method)
    let profileData = await page.evaluate(() => {
      let user = {};
      let stats = {};
      let videos = [];
      try {
        const sigi = document.querySelector('script#SIGI_STATE');
        if (sigi) {
          const json = JSON.parse(sigi.innerText);
          const userKey = Object.keys(json?.UserModule?.users || {})[0];
          const userData = json?.UserModule?.users?.[userKey] || {};
          const userStats = json?.UserModule?.stats?.[userKey] || {};
          user = {
            username: userData?.uniqueId || '',
            nickname: userData?.nickname || '',
            avatar: userData?.avatarLarger || userData?.avatarMedium || userData?.avatarThumb || '',
            bio: userData?.signature || '',
            verified: userData?.verified || false
          };
          console.log(user);
          
          stats = {
            followers: userStats?.followerCount?.toLocaleString() || '0',
            following: userStats?.followingCount?.toLocaleString() || '0',
            likes: userStats?.heartCount?.toLocaleString() || '0',
            videos: userStats?.videoCount || 0
          };
          // Get videos from ItemModule
          const itemModule = json?.ItemModule || {};
          videos = Object.values(itemModule)
            .slice(0, 10)
            .map(v => ({
              id: v.id,
              desc: v.desc,
              cover: v.cover,
              playAddr: v.video?.playAddr || '',
              stats: v.stats || {},
              createTime: v.createTime
            }));
        }
      } catch (err) {}
      return { user, stats, videos };
    });

    // Fallback to DOM scraping if SIGI_STATE fails
    if (!profileData.user?.username) {
      profileData = await page.evaluate(() => {
        const getTextContent = (selector) => {
          const el = document.querySelector(selector);
          return el ? el.textContent.trim() : '';
        };
        const getMetric = (metric) => {
          const el = document.querySelector(`strong[data-e2e="${metric}-count"]`);
          return el ? el.textContent.trim() : '0';
        };
        const avatar = document.querySelector('[data-e2e="user-avatar"] img')?.src || '';
        const videoLinks = Array.from(document.querySelectorAll('[data-e2e="user-post-item-list"]'))
          .map(a => ({
            link: a.href,
            thumbnail: a.querySelector('img')?.src || '',
            views: a.querySelector('[data-e2e="video-views"]')?.textContent || '0'
          }))
          .slice(0, 10);
        return {
          user: {
            username: getTextContent('[data-e2e="user-title"]'),
            nickname: getTextContent('h2[data-e2e="user-title"]'),
            avatar: avatar,
            bio: getTextContent('[data-e2e="user-bio"]'),
            verified: !!document.querySelector('[data-e2e="user-verified"]')
          },
          stats: {
            followers: getMetric('followers'),
            following: getMetric('following'),
            likes: getMetric('likes'),
            videos: document.querySelectorAll('[data-e2e="user-post-item"]').length
          },
          videos: videoLinks
        };
      });
    }

    console.log('Scraped TikTok data:', profileData);

    await browser.close();
    return profileData;

  } catch (error) {
    console.error('Scraping error:', error);
    await browser.close();
    throw error;
  }
}

// Express endpoints
app.get('/api/tiktok/:username', async (req, res) => {
  try {
    const data = await getTikTokData(req.params.username);

    // Check for valid data: at least avatar, nickname, or followers must exist
    const user = data.user || {};
    const stats = data.stats || {};
    const hasProfile =
      user.avatar || user.nickname || stats.followers !== '0' || stats.followers > 0;

    if (!hasProfile) {
      console.log(`No TikTok user data found for username: ${req.params.username}`);
      return res.status(404).json({ error: `No TikTok user found for username: ${req.params.username}` });
    }

    res.json(data);
  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ error: 'Internal server error. Please try again later.' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
