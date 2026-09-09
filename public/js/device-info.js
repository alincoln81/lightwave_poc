// device-info.js

// Store gathered data
let _info = undefined;
export const isAndroid = () => _info?.os === 'Android';

// Internal - run if not collected
async function _getDeviceInfo() {
    const nav = navigator || {};
    const info = {
      userAgent: nav.userAgent || '',
      platform: nav.platform || '',
      language: nav.language || '',
      vendor: nav.vendor || '',
      hardwareConcurrency: nav.hardwareConcurrency ?? null,
      deviceMemory: nav.deviceMemory ?? null,
      deviceModel: null,
      os: null,
      osVersion: null,
      browser: null,
      browserVersion: null,
      brands: null
    };
  
    // Chromium: richer info
    if (nav.userAgentData?.getHighEntropyValues) {
      try {
        const uaHE = await nav.userAgentData.getHighEntropyValues([
          'platform','platformVersion','architecture','bitness','model','uaFullVersion','fullVersionList'
        ]);
        info.os = uaHE.platform || null;
        info.osVersion = uaHE.platformVersion || null;
        info.deviceModel = uaHE.model || null;
        info.brands = uaHE.fullVersionList || nav.userAgentData.brands || null;
  
        if (Array.isArray(uaHE.fullVersionList) && uaHE.fullVersionList.length) {
          const pref = ['Google Chrome', 'Chromium', 'Microsoft Edge', 'Opera', 'Brave'];
          const hit = uaHE.fullVersionList.find(b => pref.includes(b.brand)) || uaHE.fullVersionList[0];
          info.browser = hit?.brand || null;
          info.browserVersion = hit?.version || null;
        } else {
          info.browser = 'Chromium-based';
          info.browserVersion = uaHE.uaFullVersion || null;
        }
      } catch { /* ignore */ }
    }
  
    // Fallback UA parsing
    if (!info.browser || !info.os) {
      const ua = info.userAgent.toLowerCase();
  
      let bName = null, bVer = null;
      const matchers = [
        /(edg)\/([\d.]+)/,
        /(chrome)\/([\d.]+)/,
        /(crios)\/([\d.]+)/,
        /(fxios)\/([\d.]+)/,
        /(firefox)\/([\d.]+)/,
        /(version)\/([\d.]+).*safari/,
        /(safari)\/([\d.]+)/
      ];
      for (const re of matchers) {
        const m = ua.match(re);
        if (m) {
          bName = m[1] === 'version' ? 'safari' : m[1];
          bVer = m[2];
          break;
        }
      }
      info.browser = info.browser || (bName ? bName : null);
      info.browserVersion = info.browserVersion || (bVer ? bVer : null);
  
      if (/android/.test(ua)) {
        info.os = 'Android';
        const m = ua.match(/android\s([\d.]+)/);
        info.osVersion = m ? m[1] : null;
      } else if (/iphone|ipad|ipod/.test(ua)) {
        info.os = 'iOS';
        const m = ua.match(/os\s([\d_]+)/);
        info.osVersion = m ? m[1].replace(/_/g, '.') : null;
      } else if (/mac os x/.test(ua)) {
        info.os = 'macOS';
        const m = ua.match(/mac os x\s([\d_]+)/);
        info.osVersion = m ? m[1].replace(/_/g, '.') : null;
      } else if (/windows nt/.test(ua)) {
        info.os = 'Windows';
        const m = ua.match(/windows nt\s([\d.]+)/);
        info.osVersion = m ? m[1] : null;
      }
  
      if (/android/.test(ua)) {
        const m = info.userAgent.match(/\((?:[^;]*;){2}\s*([^;)]*)\)/i);
        info.deviceModel = m ? m[1].trim() : null;
      } else if (/iphone|ipad|ipod/.test(ua)) {
        info.deviceModel = /ipad/.test(ua) ? 'iPad' : (/iphone/.test(ua) ? 'iPhone' : 'iPod');
      }
    }
    
    _info = {...info};
    return info;
  }

// If data is gathered already - use that
// Else gather.
export async function getDeviceInfo() {
  return _info ?? await _getDeviceInfo()
}