// =====================
// background.js - BACKGROUND SCRIPT
// =====================

importScripts('config.js');

const CONFIG = self.GUARDIAN_CONFIG || {
    GATEWAY_BASE_URL: 'http://localhost:8090',
    MISINFORMATION_BASE_URL: 'http://localhost:8090/misinformation',
    PII_OPSEC_BASE_URL: 'http://localhost:8090/pii',
    HATESPEECH_BASE_URL: 'http://localhost:8090/hatespeech',
    SCAM_BASE_URL: 'http://localhost:8090/scam'
};

const GATEWAY_BASE_URL = CONFIG.GATEWAY_BASE_URL;
const MISINFO_BASE_URL = CONFIG.MISINFORMATION_BASE_URL;
const PII_OPSEC_BASE_URL = CONFIG.PII_OPSEC_BASE_URL;
const HATESPEECH_BASE_URL = CONFIG.HATESPEECH_BASE_URL;
const SCAM_BASE_URL = CONFIG.SCAM_BASE_URL;

class AIConnection {
    constructor() {
        // guardian-gateway -> misinformation
        this.baseURL = MISINFO_BASE_URL;
        this.isConnected = false;
        this.reconnectInterval = null;
        this.checkConnection();
        this.startPeriodicCheck();
    }

    startPeriodicCheck() {
        if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
        }

        this.reconnectInterval = setInterval(() => {
            this.checkConnection();
        }, 5000);
    }

    /**
     * Parse health response without failing on empty or non-JSON bodies (common with uvicorn/nginx).
     */
    async parseHealthJson(response) {
        const text = await response.text();
        const trimmed = text.trim();
        if (!trimmed) {
            return {};
        }
        try {
            return JSON.parse(trimmed);
        } catch {
            return { status: trimmed };
        }
    }

    inferAiReady(data) {
        if (!data || typeof data !== 'object') {
            return false;
        }
        if (data.ai_ready === true) {
            return true;
        }
        const st = data.status;
        if (st === true) {
            return true;
        }
        const s = String(st || '').toLowerCase();
        if (s === 'healthy' || s === 'ok' || s === 'up' || s === 'running') {
            return true;
        }
        if (data.healthy === true) {
            return true;
        }
        return false;
    }

    async checkConnection() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);

            let response = await fetch(`${this.baseURL}/api/health`, {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    Accept: 'application/json'
                }
            });

            clearTimeout(timeoutId);

            // Some deployments expose only GET / — treat as alive if health path is missing
            if (!response.ok && response.status === 404) {
                const c2 = new AbortController();
                const t2 = setTimeout(() => c2.abort(), 8000);
                response = await fetch(`${this.baseURL}/`, {
                    method: 'GET',
                    signal: c2.signal,
                    headers: { Accept: 'application/json' }
                });
                clearTimeout(t2);
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await this.parseHealthJson(response);
            const wasConnected = this.isConnected;
            const aiReady = this.inferAiReady(data);

            this.isConnected = true;

            if (wasConnected !== this.isConnected) {
                console.log(`🤖 AI Connection: ${this.isConnected ? '✅ Connected' : '❌ Disconnected'}`);
                if (this.isConnected && !aiReady) {
                    console.log('⚠️ Server is reachable but AI model is not ready yet');
                }

                chrome.runtime.sendMessage({
                    action: 'connectionStatusChanged',
                    connected: this.isConnected,
                    aiReady: aiReady
                }).catch(() => {});
            } else if (this.isConnected) {
                chrome.runtime.sendMessage({
                    action: 'connectionStatusChanged',
                    connected: true,
                    aiReady: aiReady
                }).catch(() => {});
            }
        } catch (error) {
            const wasConnected = this.isConnected;
            this.isConnected = false;
            if (wasConnected) {
                console.log('❌ Misinformation API not reachable:', error.message);
                chrome.runtime.sendMessage({
                    action: 'connectionStatusChanged',
                    connected: false
                }).catch(() => {});
            }
        }
    }

    async sendToAI(message, riskLevel = null, susceptibilityScore = null) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            const requestBody = {
                message: message
            };

            if (riskLevel) {
                requestBody.risk_level = riskLevel;
            }

            if (susceptibilityScore !== null) {
                requestBody.susceptibility_score = susceptibilityScore;
            }

            const response = await fetch(`${this.baseURL}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                let errorMsg = `HTTP error! status: ${response.status}`;
                try {
                    const errorData = await response.json();
                    if (errorData.error) {
                        errorMsg = errorData.error;
                    } else if (errorData.response) {
                        errorMsg = errorData.response;
                    }
                } catch (e) {
                    // ignore parse errors
                }
                throw new Error(errorMsg);
            }

            const data = await response.json();

            if (!this.isConnected) {
                this.isConnected = true;
                console.log('✅ AI Server connection established via successful request');
                chrome.runtime.sendMessage({
                    action: 'connectionStatusChanged',
                    connected: true
                }).catch(() => {});
            }

            return data;
        } catch (error) {
            this.isConnected = false;

            if (error.name === 'AbortError') {
                throw new Error('Request timed out. The AI server may be slow or unresponsive. Please check if the server is running.');
            }

            if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                throw new Error('Cannot connect to AI server. Please make sure:\n1. guardian-gateway is running (docker-compose, port 8090)\n2. The server is on http://localhost:8090\n3. No firewall is blocking the connection');
            }

            console.error('AI Request failed:', error);
            throw error;
        }
    }
}

class PiiOpsecConnection {
    constructor() {
        // guardian-gateway -> pii
        this.baseURL = PII_OPSEC_BASE_URL;
    }

    async analyzeText(text) {
        const response = await fetch(`${this.baseURL}/analyze`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text })
        });

        if (!response.ok) {
            throw new Error(`PII/OpSec API error: HTTP ${response.status}`);
        }

        return await response.json();
    }

    normalizeResult(result) {
        const normalized = result || {};
        const findings = Array.isArray(normalized.findings) ? normalized.findings : [];

        const piiItems = findings.filter(item =>
            String(item.risk_type || '').startsWith('PII_')
        );

        const opsecRisks = findings.filter(item =>
            String(item.risk_type || '').startsWith('OPSEC_')
        );

        const entities = piiItems.map(item => ({
            type: item.risk_type,
            text: item.highlighted_text,
            score: item.risk_score,
            explanation: item.explanation
        }));

        const riskLevel = String(normalized.risk_level || 'low').toLowerCase();
        const summaryExplanation = String(normalized.summary_explanation || '');
        const advice = String(normalized.advice || '');
        const safeRewrite = String(normalized.safe_rewrite || '');

        return {
            module: 'pii_opsec',
            risk_level: riskLevel,
            findings: findings,
            entities: entities,
            pii_items: piiItems,
            opsec_risks: opsecRisks,
            summary_explanation: summaryExplanation,
            advice: advice,
            safe_rewrite: safeRewrite,
            processing_time_ms: normalized.processing_time_ms ?? null,
            request_id: normalized.request_id ?? null,
            ui_message: {
                title:
                    riskLevel === 'high'
                        ? 'High Privacy / Safety Risk'
                        : riskLevel === 'medium'
                            ? 'Possible Privacy / Safety Risk'
                            : 'No Immediate Privacy Risk',
                summary:
                    summaryExplanation ||
                    (riskLevel === 'high'
                        ? 'Your post may expose sensitive personal or safety-related details.'
                        : riskLevel === 'medium'
                            ? 'Your post may contain personal details worth reviewing before posting.'
                            : 'No immediate privacy or safety risk detected.'),
                advice:
                    advice ||
                    (riskLevel === 'low'
                        ? 'No action needed.'
                        : 'Consider removing exact identifiers or sharing them privately.')
            }
        };
    }

    async storeResult(result) {
        const normalized = this.normalizeResult(result);

        await chrome.storage.local.set({
            latestPiiOpsecResult: normalized
        });

        await this.updateBadge(normalized.risk_level);

        return normalized;
    }

    async clearResult() {
        await chrome.storage.local.remove(['latestPiiOpsecResult']);
        await this.updateBadge('low');
    }

    async getStoredResult() {
        const data = await chrome.storage.local.get(['latestPiiOpsecResult']);
        return data.latestPiiOpsecResult || null;
    }

    async updateBadge(riskLevel) {
        const level = String(riskLevel || 'low').toLowerCase();

        if (level === 'high') {
            await chrome.action.setBadgeText({ text: '!' });
            await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
            return;
        }

        if (level === 'medium') {
            await chrome.action.setBadgeText({ text: '!' });
            await chrome.action.setBadgeBackgroundColor({ color: '#fb8c00' });
            return;
        }

        await chrome.action.setBadgeText({ text: '' });
    }
}

class HateSpeechConnection {
    constructor() {
        // guardian-gateway -> hatespeech
        this.baseURL = HATESPEECH_BASE_URL;
    }

    async analyzeText(text) {
        const response = await fetch(`${this.baseURL}/analyze`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text })
        });

        if (!response.ok) {
            throw new Error(`Hate Speech API error: HTTP ${response.status}`);
        }

        return await response.json();
    }

    normalizeResult(result) {
        const normalized = result || {};
        const label = String(normalized.label || 'neutral').toLowerCase();
        const severity = String(normalized.severity || 'none').toLowerCase();
        const confidence = Number(normalized.confidence || 0);

        return {
            module: 'hate_speech',
            flagged: Boolean(normalized.flagged),
            label: label,
            confidence: confidence,
            severity: severity,
            matches: Array.isArray(normalized.matches) ? normalized.matches : [],
            explanation: normalized.explanation || 'No hate speech analysis available.'
        };
    }

    async storeResult(result) {
        const normalized = this.normalizeResult(result);

        await chrome.storage.local.set({
            latestHateSpeechResult: normalized
        });

        return normalized;
    }

    async clearResult() {
        await chrome.storage.local.remove(['latestHateSpeechResult']);
    }

    async getStoredResult() {
        const data = await chrome.storage.local.get(['latestHateSpeechResult']);
        return data.latestHateSpeechResult || null;
    }
}

class ScamConnection {
    constructor() {
        // guardian-gateway -> scam
        this.baseURL = SCAM_BASE_URL;
    }

    async scanUrl(url, text = '') {
        try {
            const response = await fetch(`${this.baseURL}/scan`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url, text })
            });

            if (!response.ok) {
                throw new Error(`Scam API error: HTTP ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('[ScamConnection] Scan error:', error);
            return { error: error.message };
        }
    }

    async openSafePreview(url, scanData) {
        try {
            const scanId = 'safe-preview-' + Date.now();
            await chrome.storage.local.set({ [scanId]: scanData });

            const previewUrl = chrome.runtime.getURL('safe-preview.html') +
                '?url=' + encodeURIComponent(url) +
                '&risk=' + encodeURIComponent(scanData.risk_score || 0) +
                '&status=' + encodeURIComponent(scanData.status || 'unknown') +
                '&scanId=' + encodeURIComponent(scanId);

            const window = await chrome.windows.create({
                url: previewUrl,
                type: 'popup',
                width: 1200,
                height: 800,
                focused: true
            });

            return { success: true, windowId: window.id };
        } catch (error) {
            console.error('[ScamConnection] Safe Preview open error:', error);
            return { success: false, error: error.message };
        }
    }
}

class SubscriptionManager {
    constructor() {
        this.SUBSCRIPTION_DAYS = {
            free: 30,
            personal: 90,
            pro: 180,
            enterprise: 365
        };

        this.SUBSCRIPTION_CODES = {
            free: [
                'FREE-4D9K-1A2B',
                'FREE-8Q2M-7C3D',
                'FREE-6T5R-9E4F',
                'FREE-1H7N-3G5J',
                'FREE-9L2P-6K8M',
                'FREE-3W4X-2N7Q',
                'FREE-5Y8Z-1R6S',
                'FREE-7B3C-4T9V',
                'FREE-2D6F-8U1W',
                'FREE-0G5H-9X2Y'
            ],
            personal: [
                'PERS-3A9F-6H2K',
                'PERS-7C4M-1N8P',
                'PERS-5D2Q-9R3T',
                'PERS-8E1V-4W7X',
                'PERS-2G6Y-5Z0B',
                'PERS-9J3L-7C1D',
                'PERS-4K8N-2F6H',
                'PERS-1P5R-3M9Q',
                'PERS-6S0T-8V2W',
                'PERS-7X4Y-1A5E'
            ],
            pro: [
                'PRO-9M2A-7D5G',
                'PRO-4N8C-1F6J',
                'PRO-6P3E-9H2K',
                'PRO-1Q7G-4L8N',
                'PRO-8R5J-2M6P',
                'PRO-3T9K-7Q1S',
                'PRO-5V2L-8R4U',
                'PRO-7W6N-3T0X',
                'PRO-2Y1P-9V5Z',
                'PRO-0B4R-6X8C'
            ],
            enterprise: [
                'ENT-5A8D-2G7K',
                'ENT-9C1F-6J3M',
                'ENT-4E7H-0L5P',
                'ENT-8G2K-1N9R',
                'ENT-3J6M-4Q8T',
                'ENT-7L0P-5S2V',
                'ENT-1N9R-6U3X',
                'ENT-6Q4T-7W1Z',
                'ENT-2S5V-8Y0B',
                'ENT-0U3X-9A6D'
            ]
        };
    }

    async getStatus() {
        const data = await chrome.storage.local.get(['subscriptionState']);
        const state = data.subscriptionState || null;
        const now = Date.now();

        if (!state || !state.expiresAt || now >= state.expiresAt) {
            return {
                active: false,
                plan: null,
                expiresAt: null,
                remainingMs: 0
            };
        }

        return {
            active: true,
            plan: state.plan,
            code: state.code,
            activatedAt: state.activatedAt,
            expiresAt: state.expiresAt,
            remainingMs: Math.max(0, state.expiresAt - now)
        };
    }

    async redeemCode(rawCode) {
        const code = String(rawCode || '').trim().toUpperCase();
        if (!code) {
            return { success: false, error: 'Please enter a code.' };
        }

        const plan = this.findPlanByCode(code);
        if (!plan) {
            return { success: false, error: 'Invalid subscription code.' };
        }

        const data = await chrome.storage.local.get(['usedSubscriptionCodes']);
        const usedCodes = Array.isArray(data.usedSubscriptionCodes)
            ? data.usedSubscriptionCodes
            : [];

        if (usedCodes.includes(code)) {
            return { success: false, error: 'This code was already used.' };
        }

        const now = Date.now();
        const durationDays = this.SUBSCRIPTION_DAYS[plan];
        const expiresAt = now + durationDays * 24 * 60 * 60 * 1000;

        const state = {
            plan,
            code,
            activatedAt: now,
            expiresAt
        };

        await chrome.storage.local.set({
            subscriptionState: state,
            usedSubscriptionCodes: [...usedCodes, code]
        });

        return {
            success: true,
            plan,
            expiresAt
        };
    }

    findPlanByCode(code) {
        const plans = Object.keys(this.SUBSCRIPTION_CODES);
        for (const plan of plans) {
            if (this.SUBSCRIPTION_CODES[plan].includes(code)) {
                return plan;
            }
        }
        return null;
    }

    getAllCodes() {
        return this.SUBSCRIPTION_CODES;
    }
}

class BehaviorTracker {
    constructor() {
        this.ai = new AIConnection();
        this.pii = new PiiOpsecConnection();
        this.hate = new HateSpeechConnection();
        this.scam = new ScamConnection();
        this.subscriptions = new SubscriptionManager();

        this.userBehavior = {
            techSites: 0,
            socialSites: 0,
            businessSites: 0,
            newsSites: 0,
            totalSites: 0,
            lastUpdated: Date.now()
        };

        this.initializeTracking();
        this.setupMessageHandling();
    }

    initializeTracking() {
        chrome.storage.local.get(['userBehavior'], (result) => {
            if (result.userBehavior) {
                this.userBehavior = result.userBehavior;
            }
        });

        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete' && tab.url) {
                this.analyzeWebsite(tab.url);
            }
        });

        chrome.tabs.onActivated.addListener((activeInfo) => {
            chrome.tabs.get(activeInfo.tabId, (tab) => {
                if (tab.url) {
                    this.analyzeWebsite(tab.url);
                }
            });
        });
    }

    setupMessageHandling() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'openHateSpeechToolsWindow') {
                chrome.windows
                    .create({
                        url: chrome.runtime.getURL('hatespeech.html'),
                        type: 'popup',
                        width: 456,
                        height: 668,
                        focused: true
                    })
                    .then(() => sendResponse({ success: true }))
                    .catch((e) => sendResponse({ success: false, error: String(e) }));
                return true;
            }

            if (request.action === 'guardianFabQuickAction') {
                const mode = request.mode;
                if (!['misinfo', 'pii', 'hate', 'scam'].includes(mode)) {
                    sendResponse({ success: false, error: 'Invalid mode' });
                    return true;
                }

                if (mode === 'hate') {
                    chrome.storage.local
                        .set({
                            hateSpeechMonitoringEnabled: true,
                            hatespeechShowFabWelcome: true
                        })
                        .then(async () => {
                            try {
                                await chrome.windows.create({
                                    url: chrome.runtime.getURL('hatespeech.html'),
                                    type: 'popup',
                                    width: 456,
                                    height: 668,
                                    focused: true
                                });
                            } catch (e) {
                                // ignore
                            }
                            sendResponse({ success: true });
                        })
                        .catch(() => sendResponse({ success: false }));
                    return true;
                }

                chrome.storage.local
                    .set({
                        guardianFabQuickAction: mode,
                        guardianFabQuickActionTs: Date.now()
                    })
                    .then(async () => {
                        try {
                            if (chrome.action && chrome.action.openPopup) {
                                await chrome.action.openPopup();
                            }
                        } catch (e) {
                            try {
                                chrome.windows.create({
                                    url: chrome.runtime.getURL('popup.html'),
                                    type: 'popup',
                                    width: 420,
                                    height: 640
                                });
                            } catch (e2) {
                                // ignore
                            }
                        }
                        sendResponse({ success: true });
                    })
                    .catch(() => sendResponse({ success: false }));

                return true;
            }

            if (request.action === 'openChatWithText') {
                const selectedText = (request.text || '').trim();
                const pageUrl = request.pageUrl || sender?.tab?.url || null;

                chrome.storage.local.set({
                    pendingSelectedText: selectedText,
                    pendingSelectedTextUrl: pageUrl,
                    pendingSelectedTextTs: Date.now()
                }).then(async () => {
                    try {
                        if (chrome.action && chrome.action.openPopup) {
                            await chrome.action.openPopup();
                            sendResponse({ success: true, opened: 'popup' });
                            return;
                        }
                    } catch (e) {
                        // fall through
                    }

                    try {
                        chrome.windows.create({
                            url: chrome.runtime.getURL('popup.html'),
                            type: 'popup',
                            width: 420,
                            height: 600
                        }, () => {
                            sendResponse({ success: true, opened: 'window' });
                        });
                    } catch (e) {
                        sendResponse({ success: false, error: String(e) });
                    }
                }).catch((e) => {
                    sendResponse({ success: false, error: String(e) });
                });

                return true;
            }

            if (request.action === 'processMessage') {
                this.processChatMessage(request, sendResponse);
                return true;
            }

            if (request.action === 'getSubscriptionStatus') {
                this.subscriptions.getStatus()
                    .then((status) => sendResponse({ success: true, ...status }))
                    .catch((error) =>
                        sendResponse({ success: false, error: error.message })
                    );
                return true;
            }

            if (request.action === 'redeemSubscriptionCode') {
                this.subscriptions.redeemCode(request.code)
                    .then((result) => sendResponse(result))
                    .catch((error) =>
                        sendResponse({ success: false, error: error.message })
                    );
                return true;
            }

            if (request.action === 'getSubscriptionCodes') {
                sendResponse({
                    success: true,
                    codes: this.subscriptions.getAllCodes()
                });
                return true;
            }

            if (request.action === 'checkAIConnection') {
                this.ai.checkConnection().then(async () => {
                    let aiReady = null;
                    try {
                        let healthResponse = await fetch(`${this.ai.baseURL}/api/health`);
                        if (!healthResponse.ok && healthResponse.status === 404) {
                            healthResponse = await fetch(`${this.ai.baseURL}/`);
                        }
                        if (healthResponse.ok) {
                            const healthData = await this.ai.parseHealthJson(healthResponse);
                            aiReady = this.ai.inferAiReady(healthData);
                        }
                    } catch (e) {
                        // ignore
                    }

                    sendResponse({
                        connected: this.ai.isConnected,
                        aiReady: aiReady
                    });
                }).catch(() => {
                    sendResponse({ connected: false, aiReady: false });
                });

                return true;
            }

            if (request.action === 'trackUserAction') {
                userDataManager.trackMisinformationInteraction(
                    request.message,
                    request.aiResponse,
                    request.userAction
                );
                sendResponse({ success: true });
                return true;
            }

            if (request.action === 'getUserData') {
                chrome.storage.local.get(['userData'], (result) => {
                    sendResponse({ userData: result.userData });
                });
                return true;
            }

            if (request.action === 'updateUserData') {
                userDataManager.updateUserData(request.updates).then(() => {
                    sendResponse({ success: true });
                });
                return true;
            }

            if (request.action === 'analyzePiiOpsecText') {
                this.processPiiOpsecText(request, sendResponse);
                return true;
            }

            if (request.action === 'clearPiiOpsecResult') {
                this.pii.clearResult()
                    .then(() => sendResponse({ success: true }))
                    .catch((error) => sendResponse({ success: false, error: error.message }));
                return true;
            }

            if (request.action === 'getLatestPiiOpsecResult') {
                this.pii.getStoredResult()
                    .then((result) => sendResponse({ success: true, result }))
                    .catch((error) => sendResponse({ success: false, error: error.message }));
                return true;
            }

            if (request.action === 'analyzeHateSpeechText') {
                this.processHateSpeechText(request, sendResponse);
                return true;
            }

            if (request.action === 'clearHateSpeechResult') {
                this.hate.clearResult()
                    .then(() => sendResponse({ success: true }))
                    .catch((error) => sendResponse({ success: false, error: error.message }));
                return true;
            }

            if (request.action === 'getLatestHateSpeechResult') {
                this.hate.getStoredResult()
                    .then((result) => sendResponse({ success: true, result }))
                    .catch((error) => sendResponse({ success: false, error: error.message }));
                return true;
            }

            if (request.action === 'setHateSpeechMonitoring') {
                chrome.storage.local.set({
                    hateSpeechMonitoringEnabled: Boolean(request.enabled)
                }).then(() => {
                    sendResponse({
                        success: true,
                        enabled: Boolean(request.enabled)
                    });
                }).catch((error) => {
                    sendResponse({
                        success: false,
                        error: String(error)
                    });
                });
                return true;
            }

            if (request.action === 'getHateSpeechMonitoring') {
                chrome.storage.local.get(['hateSpeechMonitoringEnabled'], (result) => {
                    sendResponse({
                        success: true,
                        enabled: Boolean(result.hateSpeechMonitoringEnabled)
                    });
                });
                return true;
            }

            if (request.action === 'SCAN_URL') {
                this.processScamUrlScan(request, sendResponse);
                return true;
            }

            if (request.action === 'OPEN_SAFE_PREVIEW') {
                this.processSafePreview(request, sendResponse);
                return true;
            }
        });
    }

    async processScamUrlScan(request, sendResponse) {
        try {
            const url = String(request.url || '').trim();
            const text = String(request.text || '').trim();

            if (!url) {
                sendResponse({ error: 'No URL provided' });
                return;
            }

            const result = await this.scam.scanUrl(url, text);
            sendResponse(result);
        } catch (error) {
            console.error('Scam URL scan error:', error);
            sendResponse({ error: error.message });
        }
    }

    async processSafePreview(request, sendResponse) {
        try {
            const url = String(request.url || '').trim();
            const scanData = request.scanData || {};

            if (!url) {
                sendResponse({ success: false, error: 'No URL provided' });
                return;
            }

            const result = await this.scam.openSafePreview(url, scanData);
            sendResponse(result);
        } catch (error) {
            console.error('Safe Preview error:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    analyzeWebsite(url) {
        try {
            const domain = new URL(url).hostname;

            if (
                domain.includes('github.com') ||
                domain.includes('stackoverflow.com') ||
                domain.includes('w3schools.com') ||
                domain.includes('python.org')
            ) {
                this.userBehavior.techSites++;
            } else if (
                domain.includes('facebook.com') ||
                domain.includes('twitter.com') ||
                domain.includes('x.com') ||
                domain.includes('instagram.com') ||
                domain.includes('tiktok.com')
            ) {
                this.userBehavior.socialSites++;
            } else if (
                domain.includes('linkedin.com') ||
                domain.includes('forbes.com') ||
                domain.includes('bloomberg.com') ||
                domain.includes('business')
            ) {
                this.userBehavior.businessSites++;
            } else if (
                domain.includes('news.') ||
                domain.includes('cnn.com') ||
                domain.includes('bbc.com') ||
                domain.includes('reuters.com')
            ) {
                this.userBehavior.newsSites++;
            }

            this.userBehavior.totalSites++;
            this.userBehavior.lastUpdated = Date.now();

            chrome.storage.local.set({ userBehavior: this.userBehavior });
        } catch (error) {
            console.error('Error analyzing website:', error);
        }
    }

    async processChatMessage(request, sendResponse) {
        try {
            const { userData } = await chrome.storage.local.get(['userData']);
            const riskLevel = userData?.riskLevel || null;
            const susceptibilityScore = userData?.susceptibilityScore || null;

            const aiResponse = await this.ai.sendToAI(
                request.message,
                riskLevel,
                susceptibilityScore
            );

            if (aiResponse.success === false) {
                const errorMsg = aiResponse.response || aiResponse.error || 'AI service is currently unavailable.';
                const errorDetails = aiResponse.error_details || null;

                sendResponse({
                    success: false,
                    answer: this.getServerErrorResponse(request.message, request.behavior, errorMsg, errorDetails),
                    is_misinformation: null,
                    error: errorMsg,
                    errorDetails: errorDetails
                });
                return;
            }

            if (aiResponse.is_misinformation) {
                userDataManager.trackMisinformationInteraction(
                    request.message,
                    {
                        is_misinformation: aiResponse.is_misinformation,
                        is_factual: aiResponse.is_factual
                    },
                    'detected'
                );
            }

            sendResponse({
                success: true,
                answer: aiResponse.response,
                is_misinformation: aiResponse.is_misinformation,
                is_factual: aiResponse.is_factual,
                behavior: aiResponse.behavior_style
            });
        } catch (error) {
            console.error('AI Processing error:', error);

            const fallbackResponse = this.getFallbackResponse(request.message, request.behavior);
            sendResponse({
                success: false,
                answer: fallbackResponse.answer,
                is_misinformation: fallbackResponse.is_misinformation,
                error: error.message
            });
        }
    }

    async processPiiOpsecText(request, sendResponse) {
        try {
            const text = String(request.text || '').trim();

            if (!text || text.length < 4) {
                await this.pii.clearResult();
                sendResponse({ success: true, result: null });
                return;
            }

            const result = await this.pii.analyzeText(text);
            const normalized = await this.pii.storeResult(result);

            sendResponse({ success: true, result: normalized });
        } catch (error) {
            console.error('PII/OpSec processing error:', error);
            sendResponse({
                success: false,
                error: error.message
            });
        }
    }

    async processHateSpeechText(request, sendResponse) {
        try {
            const text = String(request.text || '').trim();

            if (!text || text.length < 2) {
                await this.hate.clearResult();
                sendResponse({ success: true, result: null });
                return;
            }

            const result = await this.hate.analyzeText(text);
            const normalized = await this.hate.storeResult(result);

            sendResponse({ success: true, result: normalized });
        } catch (error) {
            console.error('Hate speech processing error:', error);
            sendResponse({
                success: false,
                error: error.message
            });
        }
    }

    getServerErrorResponse(message, behavior, serverError, errorDetails) {
        const errorInfo = errorDetails ? `\n\nDetails: ${errorDetails}` : '';
        const responses = {
            expert: `⚠️ AI Model Not Ready\n\nThe server is running but the AI model is not loaded yet.\n\nError: ${serverError}${errorInfo}\n\nPlease check:\n1. The model files are in ./trained-model-pro/\n2. Check if checkpoint directories exist (checkpoint-1000, checkpoint-1350)\n3. The server console for detailed loading errors\n4. Try setting USE_FALLBACK_MODEL=1 to use a basic model\n\nYour message: "${message}"`,
            casual: `Hey! 😅 The server is running but my AI brain isn't loaded yet.\n\nError: ${serverError}${errorInfo}\n\nMaybe check:\n- Are the model files in the right place?\n- Look at the server console for clues\n- Or wait a moment and try again!\n\nI wanted to help with: "${message}"`,
            business: `Service Status: AI Model Unavailable\n\nThe server is operational but the AI model has not been initialized.\n\nIssue: ${serverError}${errorInfo}\n\nRecommended actions:\n1. Verify model directory exists (./trained-model-pro/)\n2. Check for checkpoint subdirectories\n3. Review server console logs\n4. Consider using fallback model (USE_FALLBACK_MODEL=1)\n\nRequest: "${message}"`
        };

        return responses[behavior] || responses.expert;
    }

    getFallbackResponse(message, behavior) {
        const responses = {
            expert: `⚠️ AI Server Connection Issue\n\nI'm unable to connect to the misinformation API through the gateway. Please:\n\n1. Start docker-compose for Guardian (gateway service on port 8090)\n2. Confirm GET http://localhost:8090/misinformation/api/health succeeds\n3. Try again in the extension\n\nYour message: "${message}"`,
            casual: `Hey! 😅 I can't reach my AI brain right now. Could you please:\n\n1. Start the gateway service (http://localhost:8090)\n2. Check docker-compose is up\n3. Come back and try again!\n\nI wanted to help with: "${message}"`,
            business: `Professional Notice: AI Service Unavailable\n\nThe misinformation API via gateway is unreachable. To restore service:\n\n1. Start Guardian gateway on http://localhost:8090 (docker-compose)\n2. Verify GET /misinformation/api/health returns success\n3. Retry your request\n\nRequest: "${message}"`
        };

        return {
            answer: responses[behavior] || responses.expert,
            is_misinformation: null
        };
    }
}

// =====================
// USER DATA MANAGER
// =====================

class UserDataManager {
    constructor() {
        this.checkFirstInstall();
    }

    async checkFirstInstall() {
        const result = await chrome.storage.local.get(['onboardingCompleted']);
        if (!result.onboardingCompleted) {
            chrome.tabs.create({
                url: chrome.runtime.getURL('onboarding.html')
            });
        }
    }

    async trackMisinformationInteraction(message, aiResponse, userAction) {
        const { userData } = await chrome.storage.local.get(['userData']);

        if (!userData) return;

        if (!userData.behaviorData) {
            userData.behaviorData = {
                misinformationDetected: 0,
                timesQuestioned: 0,
                repeatedFalseContent: 0,
                correctionsAccepted: 0,
                correctionsRejected: 0,
                interactions: []
            };
        }

        const interaction = {
            timestamp: new Date().toISOString(),
            message: message.substring(0, 100),
            is_misinformation: aiResponse.is_misinformation,
            userAction: userAction
        };

        userData.behaviorData.interactions.push(interaction);

        if (aiResponse.is_misinformation) {
            userData.behaviorData.misinformationDetected++;
        }

        if (userAction === 'questioned') {
            userData.behaviorData.timesQuestioned++;
        } else if (userAction === 'accepted') {
            userData.behaviorData.correctionsAccepted++;
        } else if (userAction === 'rejected') {
            userData.behaviorData.correctionsRejected++;
        } else if (userAction === 'repeated') {
            userData.behaviorData.repeatedFalseContent++;
        }

        if (userData.behaviorData.interactions.length > 100) {
            userData.behaviorData.interactions = userData.behaviorData.interactions.slice(-100);
        }

        const score = this.calculateSusceptibilityScore(userData);
        userData.susceptibilityScore = score.score;
        userData.riskLevel = score.riskLevel;
        userData.lastUpdated = new Date().toISOString();

        await chrome.storage.local.set({ userData });
    }

    calculateSusceptibilityScore(userData) {
        let score = 50;

        const ageFactors = {
            'under_18': 15,
            '18_25': 10,
            '26_40': 5,
            'above_40': 0
        };
        score += ageFactors[userData.ageGroup] || 0;

        const educationFactors = {
            'school': 15,
            'undergraduate': 5,
            'postgraduate': -5,
            'other': 10
        };
        score += educationFactors[userData.educationLevel] || 0;

        if (userData.behaviorData) {
            const behavior = userData.behaviorData;
            const totalInteractions = behavior.interactions.length;

            if (totalInteractions > 0) {
                const timesQuestioned = behavior.timesQuestioned || 0;
                const correctionsAccepted = behavior.correctionsAccepted || 0;
                const correctionsRejected = behavior.correctionsRejected || 0;
                const repeatedFalseContent = behavior.repeatedFalseContent || 0;

                const questionRate = timesQuestioned / totalInteractions;
                score -= questionRate * 20;

                const rejectionRate = correctionsRejected / Math.max(1, correctionsAccepted + correctionsRejected);
                score += rejectionRate * 25;

                const repeatRate = repeatedFalseContent / totalInteractions;
                score += repeatRate * 30;

                const acceptanceRate = correctionsAccepted / Math.max(1, correctionsAccepted + correctionsRejected);
                score -= acceptanceRate * 15;
            }
        }

        score = Math.max(0, Math.min(100, score));

        let riskLevel;
        if (score < 30) {
            riskLevel = 'Low';
        } else if (score < 70) {
            riskLevel = 'Medium';
        } else {
            riskLevel = 'High';
        }

        return { score: Math.round(score), riskLevel };
    }

    async updateUserData(updates) {
        const { userData } = await chrome.storage.local.get(['userData']);
        if (!userData) return;

        if (updates.ageGroup) {
            userData.ageGroup = updates.ageGroup;
        }

        if (updates.educationLevel) {
            userData.educationLevel = updates.educationLevel;
        }

        userData.lastUpdated = new Date().toISOString();

        const score = this.calculateSusceptibilityScore(userData);
        userData.susceptibilityScore = score.score;
        userData.riskLevel = score.riskLevel;

        await chrome.storage.local.set({ userData });
    }
}

const behaviorTracker = new BehaviorTracker();
const userDataManager = new UserDataManager();

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        console.log('Extension installed for the first time');
    }

    try {
        await chrome.action.setBadgeText({ text: '' });
    } catch (e) {
        // ignore
    }
});

chrome.runtime.onStartup.addListener(() => {
    console.log('Behavior-Aware Chatbot Extension started');
});